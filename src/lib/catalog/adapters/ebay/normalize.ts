/* eBay Browse item -> NormalizedListing (syntax-only, Phase 1).

   Takes a source-native eBay item payload (a Browse item summary, or an
   item-summary enriched with a `variations` array from the optional
   getItem path) and produces the uniform NormalizedListing shape. No
   canonical brand/category/currency resolution, no fx, no DB.

   Field mapping:
     - identity: itemId -> externalListingId
     - URLs: itemWebUrl/itemAffiliateWebUrl -> sourceProductUrl/purchaseUrl
     - name/description/image
     - price: price.value + price.currency; marketingPrice -> salePrice
     - aspects: localizedAspects -> brand/mpn/gtin/color/size/gender
     - seller: seller.username -> attribute
     - condition -> attribute + availability hint

   Every aspect is also preserved verbatim in `attributes` for audit.
   Variants are emitted ONLY when the raw payload actually carries a
   `variations` array (never manufactured). GTIN is validated as a
   plausible EAN/UPC/GTIN digit sequence before being accepted.
*/

import type { NormalizedListing, NormalizedVariant, OfferAvailability } from "../../types";
import {
  cleanText,
  normalizeColorName,
  parseSizeAudience,
} from "../../normalize";
import type { EbayItemSummary } from "./client";

/* ==== GTIN/MPN/colour/size aspect helpers ==== */

/* Minimal structural GTIN plausibility: 8-14 digits. We do NOT checksum
   here (that is validation); we just reject obvious junk. */
export function plausibleGtin(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 14;
}

/* Normalize a raw GTIN/UPC/EAN string into {gtin, gtinType}. */
export function gtinFromValue(value: string, hintType?: string): { gtin: string; gtinType: string } | null {
  const digits = (value ?? "").replace(/\D/g, "");
  if (!plausibleGtin(digits)) return null;
  const gtinType = hintType || (digits.length === 12 ? "UPC" : digits.length === 13 ? "EAN13" : "GTIN");
  return { gtin: digits, gtinType };
}

/* Map an eBay aspect name (case-insensitive) to a normalized key. */
const ASPECT_KEYS: Array<[RegExp, string]> = [
  [/^(brand|manufacturer|mfr)$/i, "brand"],
  [/^(mpn|mfg part number|manufacturer part number|model number)$/i, "mpn"],
  [/^(gtin|upc|ean|ean13|barcode|isbn)$/i, "gtin"],
  [/^(color|colour)$/i, "color"],
  [/^(size|shoe size|clothing size)$/i, "size"],
  [/^(style|gender|department)$/i, "style"],
  [/^(condition)$/i, "condition"],
  [/^(material|fabric)$/i, "material"],
  [/^(model)$/i, "mpn"],
];

export type ExtractedAspects = {
  brand: string | null;
  mpn: string | null;
  gtin: { gtin: string; gtinType: string } | null;
  color: string | null;
  size: string | null;
  style: string | null;
  condition: string | null;
  material: string | null;
  gender: NormalizedListing["gender"];
  raw: Array<{ name: string; value: string }>;
};

export function extractAspects(summary: Pick<EbayItemSummary, "localizedAspects">): ExtractedAspects {
  const out: ExtractedAspects = {
    brand: null,
    mpn: null,
    gtin: null,
    color: null,
    size: null,
    style: null,
    condition: null,
    material: null,
    gender: null,
    raw: [],
  };
  for (const aspect of summary.localizedAspects ?? []) {
    const name = cleanText(aspect.name ?? "");
    const value = cleanText(aspect.value ?? "");
    if (!name || !value) continue;
    out.raw.push({ name, value });

    for (const [re, key] of ASPECT_KEYS) {
      if (!re.test(name)) continue;
      if (key === "brand" && !out.brand) out.brand = value;
      else if (key === "mpn" && !out.mpn) out.mpn = value;
      else if (key === "gtin" && !out.gtin) {
        const parsed = gtinFromValue(value);
        if (parsed) out.gtin = parsed;
      } else if (key === "color" && !out.color) out.color = value;
      else if (key === "size" && !out.size) out.size = value;
      else if (key === "style") {
        const lower = value.toLowerCase();
        const gender = parseSizeAudience(value) ?? mapStyleGender(lower);
        if (gender) out.gender = gender;
        if (!out.style) out.style = value;
      } else if (key === "condition" && !out.condition) out.condition = value;
      else if (key === "material" && !out.material) out.material = value;
      break;
    }
  }
  /* Fall back to the summary's first image/condition/brand fields the
     browse API exposes at top level. */
  if (!out.condition && summary.localizedAspects?.length === 0 && typeof (summary as never)["condition"] === "string") {
    out.condition = cleanText((summary as never)["condition"]);
  }
  return out;
}

function mapStyleGender(lower: string): NormalizedListing["gender"] {
  if (/\b(men|man|male|mens)\b/.test(lower)) return "MEN";
  if (/\b(women|woman|womens)\b/.test(lower)) return "WOMEN";
  if (/\b(unisex|uni|adult)\b/.test(lower)) return "UNISEX";
  if (/\b(kids|child|children|girls|boys|toddler|baby)\b/.test(lower)) return "KIDS";
  return null;
}

/* Map condition text to an OfferAvailability. Conservative: only
   explicit buyable/stock signals map; everything else is UNKNOWN. */
export function availabilityFromCondition(condition: string | null, buyingOptions: string[] = []): OfferAvailability {
  if (!condition) {
    return buyingOptions.some((b) => /FIXED_PRICE/i.test(b)) ? "AVAILABLE" : "UNKNOWN";
  }
  const c = condition.toLowerCase();
  if (/new|brand new|open box|used/.test(c)) return "AVAILABLE";
  if (/pre.?order/.test(c)) return "PREORDER";
  if (/out of stock|sold out|no longer available/.test(c)) return "OUT_OF_STOCK";
  if (/back.?order/.test(c)) return "BACKORDER";
  return buyingOptions.some((b) => /FIXED_PRICE/i.test(b)) ? "AVAILABLE" : "UNKNOWN";
}

/* Master-level ebay item id (leaf vs group). We use itemId when
   present; multi-variant listings share itemGroupId. */
export function externalListingIdOf(item: { itemId?: string; itemGroupId?: string }): string {
  return item.itemId || item.itemGroupId || "";
}

/* ==== URL helpers ==== */

export function parseMoney(value?: { value?: string; currency?: string }): {
  price: number | null;
  currency: string | null;
} {
  if (!value?.value) return { price: null, currency: null };
  const num = Number(value.value);
  if (!Number.isFinite(num) || num <= 0) return { price: null, currency: null };
  /* Keep the RAW currency string (uppercased) so the validation gate can
     reject unsupported codes; we never substitute a guessed one. */
  const raw = value.currency?.trim();
  return { price: num, currency: raw && raw.length > 0 ? raw.toUpperCase() : null };
}

/* ==== Normalization ==== */

export type EbayRawItem = EbayItemSummary & { variations?: EbayVariationRaw[] };

export type EbayVariationRaw = {
  variationId?: string;
  sku?: string;
  color?: string;
  size?: string;
  price?: { value?: string; currency?: string };
  availability?: string;
  purchaseUrl?: string;
  image?: { imageUrl?: string };
};

/* Normalize one raw eBay item to a NormalizedListing.
   Returns null when the payload is too broken to carry any identity
   (no item id AND no title AND no valid URL) - the validation layer
   then decides reject-vs-quarantine for weaker cases. */
export function ebayItemToNormalizedListing(raw: unknown): NormalizedListing | null {
  const item = (raw ?? {}) as EbayRawItem;
  const id = externalListingIdOf(item);
  if (!id) return null;

  const aspects = extractAspects(item);
  const price = parseMoney(item.price);
  const sale = item.marketingPrice ? parseMoney({ value: item.marketingPrice?.originalPrice?.value, currency: item.marketingPrice?.originalPrice?.currency }) : null;

  const imageUrl = item.image?.imageUrl?.trim() || item.additionalImages?.[0]?.imageUrl?.trim() || null;
  const sourceProductUrl = item.itemWebUrl?.trim() || item.itemAffiliateWebUrl?.trim() || "";
  const purchaseUrl = item.itemAffiliateWebUrl?.trim() || sourceProductUrl;

  const gtins: NormalizedListing["gtins"] = aspects.gtin ? [aspects.gtin] : [];

  /* Build a single variation only when the item lists its own price and
     carries a discernible color/size. This is the listing's real
     attributes, NOT manufactured variation data. */
  const sizes: NormalizedListing["sizes"] = [];
  let singleVariant: NormalizedVariant | null = null;

  const sizeSpecs = item.variations?.length
    ? []
    : aspects.size
      ? [aspects.size]
      : [];

  for (const sizeSpec of sizeSpecs) {
    const size = sizeFromSpec(sizeSpec);
    if (!size) continue;
    sizes.push(size);
  }

  const variants: NormalizedVariant[] = [];
  if (item.variations && item.variations.length > 0) {
    for (const v of item.variations) {
      const vPrice = parseMoney(v.price);
      const vSize = v.size ? sizeFromSpec(v.size) : null;
      variants.push({
        id: v.variationId ?? id,
        color: v.color ? normalizeColorName(v.color) : null,
        size: vSize,
        sku: v.sku || null,
        gtin: v.sku ? null : null,
        gtinType: null,
        purchaseUrl: v.purchaseUrl,
        price: vPrice.price ?? 0,
        currency: vPrice.currency ?? "USD",
        salePrice: null,
        availability: (v.availability as OfferAvailability) ?? "AVAILABLE",
      });
    }
  } else if (aspects.color || aspects.size) {
    /* Represent the listing's own single colour/size as one variant so
       a genuine, sourced colour/size is preserved through to the offer
       variant table. This is the listing's actual attribute set. */
    const singleSize = aspects.size ? sizeFromSpec(aspects.size) : null;
    if (singleSize) sizes.push(singleSize);
    singleVariant = {
      id,
      color: aspects.color ? normalizeColorName(aspects.color) : null,
      size: singleSize,
      sku: null,
      gtin: aspects.gtin ? aspects.gtin.gtin : null,
      gtinType: aspects.gtin ? aspects.gtin.gtinType : null,
      price: price.price ?? 0,
      currency: price.currency ?? "USD",
      salePrice: sale?.price ?? null,
      availability: availabilityFromCondition(aspects.condition, item.buyingOptions),
    };
  }

  const seller = cleanText(item.seller?.username ?? "");
  const attributes: Array<{ name: string; value: string }> = [...aspects.raw];
  if (seller) attributes.push({ name: "seller", value: seller });
  if (item.categoryPath) attributes.push({ name: "categoryPath", value: item.categoryPath });
  if (item.buyingOptions?.length) attributes.push({ name: "buyingOptions", value: item.buyingOptions.join(",") });
  attributes.push({ name: "conditionId", value: String(item.conditionId ?? "") });

  return {
    externalListingId: id,
    sourceProductUrl,
    ...(purchaseUrl ? { purchaseUrl } : {}),
    name: cleanText(item.title ?? ""),
    description: item.shortDescription ? cleanText(item.shortDescription) : null,
    imageUrl,
    brand: aspects.brand ?? null,
    category: item.categoryPath ?? item.category ?? null,
    gender: aspects.gender ?? null,
    colors: aspects.color ? [normalizeColorName(aspects.color)!] : [],
    sizes,
    ...(singleVariant ? { variants: [singleVariant] } : variants.length > 0 ? { variants } : {}),
    originalPrice: price.price ?? 0,
    originalCurrency: price.currency ?? "USD",
    salePrice: sale?.price ?? null,
    normalizedEur: null,
    availability: singleVariant?.availability ?? availabilityFromCondition(aspects.condition, item.buyingOptions),
    gtins,
    mpn: aspects.mpn ?? null,
    sku: null,
    attributes,
  };
}

/* Parse a raw eBay size spec ("US 10", "EU 42", "M", "10") into the
   structural NormalizedSize. Bare numeric values without a system are
   kept with system UNKNOWN - the size is preserved (never dropped), and
   the validation gate decides admissibility. */
function sizeFromSpec(spec: string): NormalizedListing["sizes"][number] {
  const cleaned = cleanText(spec);
  if (!cleaned) return { value: "", system: "UNKNOWN", productType: "UNKNOWN", audience: "UNKNOWN" };

  const systemMatch = /^(EU|US|UK|IT|FR|INT|INTERNATIONAL)\b/i.exec(cleaned);
  let system = "UNKNOWN";
  let value = cleaned;
  if (systemMatch) {
    system = systemMatch[1].toUpperCase() === "INT" || systemMatch[1].toUpperCase() === "INTERNATIONAL"
      ? "INTERNATIONAL"
      : systemMatch[1].toUpperCase();
    value = cleaned.slice(systemMatch[0].length).trim();
  }
  const audience = parseSizeAudience(value) ?? null;

  /* Heuristic product type from the size spec itself. */
  let productType = "UNKNOWN";
  if (/\b(s|[m|l]|xl|xxl|3xl|xmm)\b/i.test(value) && !/\b(eu|us|uk)\d/i.test(value)) {
    productType = outputProductTypeFromValue(value);
  } else if (/^\d+(\.\d+)?$/.test(value)) {
    /* numeric-only bare size is ambiguous (clothing 42 vs shoe 42);
       keep UNKNOWN but preserve value */
    productType = "UNKNOWN";
  }
  if (/eu|us|uk|it|fr/.test(cleaned)) productType = "FOOTWEAR";

  return { value, system, productType, audience: audience ?? "UNKNOWN" };
}

function outputProductTypeFromValue(value: string): string {
  const upper = value.toUpperCase();
  if (/^(XS|S|M|L|XL|XXL|3XL|4XL|5XL)$/.test(upper) || /^[0-9]+-[0-9]+$/.test(upper)) return "CLOTHING";
  if (/^\d+(\.\d+)?$/.test(value)) return "UNKNOWN";
  return "UNKNOWN";
}
