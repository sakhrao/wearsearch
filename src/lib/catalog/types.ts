/* Real-catalog source architecture (Phase 0).

   The boundary this module draws:
     - A SOURCE adapter is the only source-specific code in the system.
       It fetches raw listings over the source API/feed and converts
       each to the uniform NormalizedListing shape below (syntax only -
       no canonical brand/category/currency resolution, no DB access).
     - The import harness applies the pure engines (normalization,
       validation, dedup) and the registry-backed resolvers, then stores
       canonical Products with one row per source in ProductOffer.

   Search and the Outfit Engine never see this layer; they keep reading
   the canonical Product row (whose price/availability/purchaseUrl
   mirror the primary offer). Nothing here is allowed to change their
   semantics. */

/* Adapter source kind maps to the existing SourceType enum plus the
   richer commerce-specific signal the priority resolver needs.
   OFFICIAL_API / AFFILIATE_FEED / AUTHORIZED_FEED are existing prisma
   enum values; PREORDER/etc live on the offer, not on Product. */
export type AdapterSourceType =
  | "OFFICIAL_API"
  | "AFFILIATE_FEED"
  | "AUTHORIZED_FEED"
  | "CRAWLER"
  | "MANUAL"
  | "DEMO";

/* Rich availability states a real commerce source can report. These
   live ONLY on ProductOffer.availability (a raw string), never on the
   Search-facing Product.availability enum. */
export type OfferAvailability =
  | "AVAILABLE"
  | "OUT_OF_STOCK"
  | "PREORDER"
  | "BACKORDER"
  | "UNKNOWN";

export const OFFER_AVAILABILITY_VALUES: readonly OfferAvailability[] = [
  "AVAILABLE",
  "OUT_OF_STOCK",
  "PREORDER",
  "BACKORDER",
  "UNKNOWN",
];

/* The narrow subset the Search-facing Product enum understands:
   PREORDER/BACKORDER demote to OUT_OF_STOCK. Search semantics are
   untouched by richer offer states. */
export function productAvailabilityOf(
  offer: OfferAvailability
): "AVAILABLE" | "OUT_OF_STOCK" | "UNKNOWN" {
  switch (offer) {
    case "AVAILABLE":
      return "AVAILABLE";
    case "OUT_OF_STOCK":
    case "PREORDER":
    case "BACKORDER":
      return "OUT_OF_STOCK";
    case "UNKNOWN":
      return "UNKNOWN";
  }
}

export type CatalogGender =
  | "MEN"
  | "WOMEN"
  | "UNISEX"
  | "KIDS";
export const CATALOG_GENDER_VALUES: readonly CatalogGender[] = [
  "MEN",
  "WOMEN",
  "UNISEX",
  "KIDS",
];

/* ==== Uniform normalized listing (adapter output) ==== */

export type NormalizedSize = {
  value: string;
  /* SizeSystem enum value: INTERNATIONAL | EU | US | UK | IT | FR | UNKNOWN */
  system: string;
  /* SizeProductType enum value: CLOTHING | FOOTWEAR | ACCESSORY | HEADWEAR | UNKNOWN */
  productType: string;
  /* SizeAudience enum value: MEN | WOMEN | KIDS | UNISEX | UNKNOWN */
  audience: string;
};

export type NormalizedVariant = {
  /* Internal per-listing id (source variant id or listing id); used to
     key OfferVariant rows and for the primary-offer variant mirror. */
  id: string;
  color: string | null;
  size: NormalizedSize | null;
  sku: string | null;
  /* Variant-level barcode (EAN13/EAN8/UPC/GTIN...) when the source
     reports per-variation codes. */
  gtin: string | null;
  gtinType: string | null;
  /* Per-variation buy URL; omit when the listing URL covers all. */
  purchaseUrl?: string;
  price: number;
  currency: string;
  salePrice?: number | null;
  availability: OfferAvailability;
};

export type NormalizedListing = {
  /* Source's own id for THIS listing. Unique per (source, externalListingId). */
  externalListingId: string;
  /* The canonical listing page on the source (traceability).
     Required and must pass the product-url guard. */
  sourceProductUrl: string;
  /* The actual buy URL. Defaults to sourceProductUrl when the source
     does not distinguish; must pass the guard. */
  purchaseUrl?: string;
  name: string;
  description: string | null;
  imageUrl: string | null;

  /* Raw source tokens (kept verbatim for mapping/audit). */
  brand: string | null;
  category: string | null;
  gender: CatalogGender | null;

  colors: string[];
  sizes: NormalizedSize[];
  variants?: NormalizedVariant[];

  originalPrice: number;
  originalCurrency: string;
  salePrice: number | null;
  /* Filled by the normalization engine via the fx layer. Null when we
     refuse to invent a number (see normalize.ts). */
  normalizedEur: number | null;

  availability: OfferAvailability;

  gtins: Array<{ gtin: string; gtinType: string }>;
  mpn: string | null;
  sku: string | null;

  attributes: Array<{ name: string; value: string }>;
};

/* ==== Identity bundle used by the dedup engine ==== */

export type IdentityBundle = {
  gtins: Array<{ gtin: string; gtinType: string }>;
  brand: string | null;
  mpn: string | null;
  sku: string | null;
  name: string;
  color: string | null;
};

export const DEDUP_LAYERS = {
  GTIN: 1,
  BRAND_MPN: 2,
  BRAND_SKU: 3,
  BRAND_NAME_COLOR: 4,
  SIMILARITY: 5,
} as const;

export type DedupLayer = 1 | 2 | 3 | 4 | 5;

/* ==== Adapter contract ==== */

export type RawListingBatch = {
  /* Source-native listing payloads (adapter-specific shape). */
  listings: unknown[];
  hasMore: boolean;
  page: number;
};

export type CommerceSourceAdapter = {
  id: string;
  sourceName: string;
  sourceType: AdapterSourceType;
  priority: number;
  freshnessHours: number;
  official?: boolean;
  authRef?: string;

  /* Raw fetch, page-aware. The adapter owns auth, pagination cursors
     and rate limits. Returns source-native payloads, NOT normalized. */
  fetch(options?: { page?: number; limit?: number }): Promise<RawListingBatch>;

  /* A small deterministic sample used by the controlled import harness
     BEFORE any real batch is processed. */
  sample(limit: number): Promise<RawListingBatch>;

  /* Syntax-only conversion: raw payload -> NormalizedListing.
     No canonical brand/category resolution, no fx, no DB. */
  toNormalizedListing(raw: unknown): NormalizedListing | null;
};

/* ==== Quality-gate verdicts ==== */

export type ValidationVerdict =
  | { status: "ACCEPT"; reasons: [] }
  | { status: "QUARANTINE" | "REJECT"; reasons: string[] };

/* ==== Import harness bookkeeping ==== */

export type StoreOutcome = {
  productId: string;
  action: "created" | "updated" | "merged";
  offerId: string;
  isPrimary: boolean;
  identityLayer: DedupLayer;
};