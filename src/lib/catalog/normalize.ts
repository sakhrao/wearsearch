/* Pure normalization engine (Phase 0).

   Every function here is pure and DB-free: same inputs always produce
   the same outputs. It synthesizes the cacheable keys (brand, category,
   color, size identity, currency, fx-normalized EUR) and string
   cleaning used by the import harness and the dedup engine. Canonical
   BRAND / CATEGORY resolution itself lives in registry.ts (it needs the
   alias/mapping tables); this module only produces the normalized
   tokens those resolvers and the identity engine consume. */

import { roundMoney } from "../currency";
import { DEDUP_LAYERS, type DedupLayer } from "./types";

/* ==== String cleaning ==== */

/* Collapse whitespace, trim, and normalize common separator noise. */
export function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/* Comparison-safe token: lowercase, unicode-folded punctuation to
   space, collapse, drop leading separators. Keeps digits. */
export function foldToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* Slug-safe (dash) token, mirroring the schema slugify style. */
export function slugToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/* ==== Brand ==== */

/* Raw source brand string -> normalized token used to look up
   BrandAlias / canonical Brand. Never resolves on its own. */
export function normalizeBrandToken(brand: string | null | undefined): string {
  if (!brand) return "";
  return foldToken(cleanText(brand));
}

/* ==== Category ==== */

export function normalizeCategoryToken(category: string | null | undefined): string {
  if (!category) return "";
  return foldToken(cleanText(category));
}

/* ==== Color ==== */

/* Raw color string -> normalized color chip. Matches the catalog color
   naming style (singular title-case chip: "Black"). */
const KNOWN_COLOR_BY_FOLD: Record<string, string> = {
  black: "Black",
  white: "White",
  grey: "Grey",
  gray: "Grey",
  navy: "Navy",
  "navy blue": "Blue",
  blue: "Blue",
  denim: "Blue",
  red: "Red",
  green: "Green",
  beige: "Beige",
  khaki: "Khaki",
  brown: "Brown",
  pink: "Pink",
  yellow: "Yellow",
  orange: "Orange",
  purple: "Purple",
  gold: "Gold",
  silver: "Silver",
  cream: "Cream",
  "light blue": "Blue",
  "light green": "Green",
  "olive": "Olive",
};

export function normalizeColorName(color: string | null | undefined): string | null {
  if (!color) return null;
  const folded = foldToken(cleanText(color));
  if (!folded) return null;
  const hit = KNOWN_COLOR_BY_FOLD[folded];
  if (hit) return hit;
  /* Fall back to a title-cased chip for unknown-but-plausible colors;
     the validation gate decides whether it is admissible. */
  return toTitleCase(cleanText(color));
}

function toTitleCase(value: string): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/(^|\s)\p{L}/gu, (m) => m.toUpperCase());
}

/* ==== Size identity ==== */

/* Parse a raw size spec string ("EU 42", "US Men 8") into the
   structural identity the size context plumbing understands
   (audience | productType | system | value). Returns null when the
   value contains no recognizable system. */
const SYSTEM_PREFIX = new Map<string, string>([
  ["eu", "EU"],
  ["us", "US"],
  ["uk", "UK"],
  ["it", "IT"],
  ["fr", "FR"],
  ["int", "INTERNATIONAL"],
  ["international", "INTERNATIONAL"],
]);

export function parseSizeIdentity(
  raw: string
): {
  system: string;
  value: string;
} | null {
  const cleaned = cleanText(raw);
  if (!cleaned) return null;
  const parts = cleaned.split(/\s+/);
  const head = parts[0].toLowerCase();
  const match = SYSTEM_PREFIX.get(head);
  if (!match) return null;

  /* "EU 42" -> value "42"; "US Women 8" -> value "8" (audience
     keyword dropped; only the numeric/alpha VALUE survives). */
  let rest = parts.slice(1).join(" ").trim();
  const audience = parseSizeAudience(rest);
  if (audience) {
    rest = rest
      .split(/\s+/)
      .filter((token) => parseSizeAudience(token) === null)
      .join(" ")
      .trim();
  }
  if (!rest) return null;
  return { system: match, value: rest };
}

/* Audience hint from an explicit phrase in a raw size spec
   ("US Women 8" -> "WOMEN"). Conservative: only exact keywords. */
export function parseSizeAudience(raw: string): "MEN" | "WOMEN" | "KIDS" | null {
  const folded = foldToken(raw);
  if (/\b(men|man|male|mens)\b/.test(folded)) return "MEN";
  if (/\b(women|woman|womens)\b/.test(folded)) return "WOMEN";
  if (/\b(kids|child|children|girls|boys|toddler|baby)\b/.test(folded)) return "KIDS";
  return null;
}

/* ==== Currency ==== */

/* Uppercase 3-letter code from a WHITELIST, or null. Never guesses:
   a non-ISO string is null, not a silent EUR/USD. The whitelist covers
   the currencies the catalog actually deals with today (EUR/USD are the
   ones the fx layer understands); a token outside it is invalid input,
   not an implied currency. */

export const KNOWN_CURRENCIES = new Set([
  "EUR",
  "USD",
  "GBP",
  "CHF",
  "CAD",
  "AUD",
  "JPY",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
]);

export function parseCurrency(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = cleanText(raw).toUpperCase();
  return KNOWN_CURRENCIES.has(code) ? code : null;
}

/* EUR reference normalization.
     EUR  -> unchanged
     USD  -> usd / rate  (real rate required)
     other -> null when no real rate; null is NEVER treated as EUR
   The caller must NOT substitute the original price for null. */
export function normalizePriceToEurValue(
  price: number,
  currency: string,
  rate: number | null
): number | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  if (currency === "EUR") return roundMoney(price);
  if (currency === "USD" && rate !== null && rate > 0) {
    return roundMoney(price / rate);
  }
  return null;
}

/* ==== Identity fingerprints for the dedup engine ==== */

/* Layer-agnostic deterministic fingerprint. The exact string shape is a
   registry decision; the SAME product across sources must produce the
   SAME string at the corresponding layer. */
export function dedupKeyFor(
  layer: DedupLayer,
  bundle: {
    gtins?: Array<{ gtin: string; gtinType: string }>;
    brand?: string | null;
    mpn?: string | null;
    sku?: string | null;
    name?: string;
    color?: string | null;
  }
): string {
  switch (layer) {
    case DEDUP_LAYERS.GTIN: {
      const gtin = (bundle.gtins ?? [])[0];
      if (!gtin) return "";
      return `gtin:${gtin.gtinType}:${gtin.gtin}`;
    }
    case DEDUP_LAYERS.BRAND_MPN:
      if (!bundle.brand || !bundle.mpn) return "";
      return `brandmpn:${foldToken(String(bundle.brand))}:${String(bundle.mpn).toUpperCase()}`;
    case DEDUP_LAYERS.BRAND_SKU:
      if (!bundle.brand || !bundle.sku) return "";
      return `brandsku:${foldToken(String(bundle.brand))}:${String(bundle.sku).toUpperCase()}`;
    case DEDUP_LAYERS.BRAND_NAME_COLOR:
      if (!bundle.name) return "";
      return [
        "bnc",
        foldToken(String(bundle.brand ?? "")),
        foldToken(bundle.name),
        normalizeColorName(bundle.color) ?? "",
      ].join(":");
    default:
      return "";
  }
}

/* ==== Offer-variant identity fingerprint ==== */

/* Stable WITHIN-offer identity for a variation row. Picks the strongest
   identifier the source provided, so a re-sync of the SAME variation
   always lands on the SAME row (idempotent upsert) while two different
   variations never collide:

     SKU > variant GTIN (gtinType:gtin) > source variant id > color+size

   order matters: a source that gives BOTH sku and gtin keys off the
   sku; the gtin stays a column for cross-referencing. The color+size
   fallback needs at least one dimension, else the variant is
   indistinguishable and the caller should treat it as listing-level. */
export function variantKeyFor(variant: {
  sku?: string | null;
  gtin?: string | null;
  gtinType?: string | null;
  externalVariantId?: string | null;
  color?: string | null;
  sizeValue?: string | null;
  sizeSystem?: string | null;
}): string | null {
  const sku = cleanText(variant.sku ?? "");
  if (sku) return `vsku:${foldToken(sku)}`;
  const gtin = cleanText(variant.gtin ?? "");
  if (gtin) return `vgtin:${cleanText(variant.gtinType ?? "GTIN")}:${gtin}`;
  const vid = cleanText(variant.externalVariantId ?? "");
  if (vid) return `vvid:${foldToken(vid)}`;
  const color = normalizeColorName(variant.color ?? null) ?? "";
  const sizeValue = cleanText(variant.sizeValue ?? "");
  if (color || sizeValue) {
    return `vbcs:${foldToken(color)}:${cleanText(variant.sizeSystem ?? "")}:${foldToken(sizeValue)}`;
  }
  return null;
}