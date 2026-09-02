/* Phase 0 test fixtures.

   SMALL, SYNTHETIC fixtures used ONLY by the catalog test suites. They
   never appear in the production catalog seed and never reach /
   api/search - the tests that do touch the DB create their own source
   and delete every created row afterwards. Real-world-shaped but fake:
   prices, URLs (example.com) and GTINs are invented for unit coverage,
   not for selling anything. */

import type {
  CommerceSourceAdapter,
  NormalizedListing,
  OfferAvailability,
  RawListingBatch,
} from "../../src/lib/catalog/types";

/** The raw fixture adapter emits source-native payloads shaped like a
    real commerce feed: title/brand/category + a few aspects. */
export type FixtureRawVariant = {
  id: string;
  sku?: string;
  gtin?: string;
  gtinType?: string;
  color?: string;
  sizeValue?: string;
  sizeSystem?: string;
  sizeProductType?: string;
  sizeAudience?: string;
  price?: number;
  buyUrl?: string;
  availability?: OfferAvailability;
};

export type FixtureRawListing = {
  id: string;
  title: string;
  brand: string;
  category: string;
  price: number;
  currency: string;
  gtin?: string;
  mpn?: string;
  color?: string;
  sizes?: string[];
  buyUrl?: string;
  variants?: FixtureRawVariant[];
};

export const SRICEBASE = "https://example.invalid";

/* ---- Canonical fixture listings (normalized, QC-ready) ---- */

export const OFFICIAL_SNEAKER: NormalizedListing = {
  externalListingId: "nike-zoom-001",
  sourceProductUrl: "https://store.nike.com/zoom-001",
  purchaseUrl: "https://store.nike.com/zoom-001",
  name: "Nike Zoom Fly 5",
  description: null,
  imageUrl: "https://img.nike.com/zoom-001.png",
  brand: "Nike",
  category: "Running Shoes",
  gender: "MEN",
  colors: ["Black"],
  sizes: [{ value: "42", system: "EU", productType: "FOOTWEAR", audience: "MEN" }],
  originalPrice: 130,
  originalCurrency: "EUR",
  salePrice: null,
  normalizedEur: 130,
  availability: "AVAILABLE",
  gtins: [{ gtin: "0194258723419", gtinType: "EAN13" }],
  mpn: "DV0652",
  sku: "DV0652-001",
  attributes: [],
};

export const RETAILER_SNEAKER: NormalizedListing = {
  externalListingId: "sports-retail-zoom-001",
  sourceProductUrl: "https://www.sportsretail.eu/p/zoom-001",
  purchaseUrl: "https://www.sportsretail.eu/p/zoom-001",
  name: "Nike Zoom Fly 5 Running Shoe",
  description: null,
  imageUrl: "https://www.sportsretail.eu/img/zoom-001.png",
  brand: "Nike",
  category: "Running",
  gender: "MEN",
  colors: ["Black"],
  sizes: [{ value: "42", system: "EU", productType: "FOOTWEAR", audience: "MEN" }],
  originalPrice: 119.9,
  originalCurrency: "EUR",
  salePrice: null,
  normalizedEur: 119.9,
  availability: "AVAILABLE",
  gtins: [{ gtin: "0194258723419", gtinType: "EAN13" }],
  mpn: "DV0652",
  sku: null,
  attributes: [],
};

/* ---- Alternative-brand offering used to prove non-merge ---- */
export const OTHER_BRAND_SNEAKER: NormalizedListing = {
  ...OFFICIAL_SNEAKER,
  externalListingId: "adidas-ultra-001",
  sourceProductUrl: "https://store.adidas.com/ultra-001",
  purchaseUrl: "https://store.adidas.com/ultra-001",
  name: "Adidas Ultraboost 22",
  brand: "Adidas",
  gtins: [{ gtin: "4054035264704", gtinType: "EAN13" }],
  mpn: "GW8059",
  sku: "GW8059-001",
};

/* ---- GBP listing that MUST quarantine until fx supports GBP ---- */
export const GBP_WATCH: NormalizedListing = {
  externalListingId: "casio-f91-001",
  sourceProductUrl: "https://www.watchmart.co.uk/p/casio-f91",
  purchaseUrl: "https://www.watchmart.co.uk/p/casio-f91",
  name: "Casio F-91W",
  description: null,
  imageUrl: "https://www.watchmart.co.uk/img/f91.png",
  brand: "Casio",
  category: "Watches",
  gender: "UNISEX",
  colors: [],
  sizes: [],
  originalPrice: 9.99,
  originalCurrency: "GBP",
  salePrice: null,
  normalizedEur: null,
  availability: "AVAILABLE",
  gtins: [{ gtin: "4549526176951", gtinType: "EAN13" }],
  mpn: null,
  sku: null,
  attributes: [],
};

export const UNMAPPED_BRAND_HOODIE: NormalizedListing = {
  externalListingId: "mystery-hoodie-001",
  sourceProductUrl: "https://www.sketchy-labels.co/p/hoodie",
  purchaseUrl: "https://www.sketchy-labels.co/p/hoodie",
  name: "Mystery Label Hoodie",
  description: null,
  imageUrl: "https://www.sketchy-labels.co/img/hoodie.png",
  brand: "Mystery Label",
  category: "Hoodies",
  gender: null,
  colors: ["Gray"],
  sizes: [],
  originalPrice: 45,
  originalCurrency: "EUR",
  salePrice: null,
  normalizedEur: 45,
  availability: "AVAILABLE",
  gtins: [],
  mpn: null,
  sku: null,
  attributes: [],
};

/* ---- Malformed fixtures (must REJECT) ---- */

export const MISSING_URL_SNEAKER: NormalizedListing = {
  ...OFFICIAL_SNEAKER,
  externalListingId: "no-url-001",
  sourceProductUrl: "",
  purchaseUrl: "",
};

export const NON_POSITIVE_PRICE_WATCH: NormalizedListing = {
  ...GBP_WATCH,
  originalPrice: 0,
  originalCurrency: "EUR",
  normalizedEur: null,
};

export const FABRICATED_URL_HAT: NormalizedListing = {
  ...OFFICIAL_SNEAKER,
  name: "New Era 59FIFTY",
  externalListingId: "exp-hat-001",
  sourceProductUrl: "https://www.example.com/p/exp-001",
  purchaseUrl: "https://www.example.com/p/exp-001",
  category: "Hats",
  gtins: [],
  mpn: null,
  sku: null,
};

/* ---- Fixture adapter factory (raw -> NormalizedListing) ---- */

export function fixtureAdapter(input: {
  sourceName: string;
  sourceType: CommerceSourceAdapter["sourceType"];
  priority: number;
  freshnessHours?: number;
  official?: boolean;
  listings: FixtureRawListing[];
}): CommerceSourceAdapter {
  const pageSize = 10;
  return {
    id: `fixture-${input.sourceName.toLowerCase().replace(/\W+/g, "-")}`,
    sourceName: input.sourceName,
    sourceType: input.sourceType,
    priority: input.priority,
    freshnessHours: input.freshnessHours ?? 24,
    official: input.official ?? false,

    async sample(limit: number): Promise<RawListingBatch> {
      return {
        listings: input.listings.slice(0, Math.min(limit, input.listings.length)),
        hasMore: false,
        page: 1,
      };
    },

    async fetch(options?: { page?: number; limit?: number }): Promise<RawListingBatch> {
      const page = options?.page ?? 1;
      const slice = input.listings.slice((page - 1) * pageSize, page * pageSize);
      return {
        listings: slice,
        hasMore: page * pageSize < input.listings.length,
        page,
      };
    },

    toNormalizedListing(raw: unknown): NormalizedListing | null {
      const r = raw as FixtureRawListing;
      if (!r || typeof r !== "object" || !r.id) return null;
      if (r.title.includes("DROP-ME")) return null;
      const variants: NormalizedListing["variants"] = (r.variants ?? []).map((v) => ({
        id: v.id,
        color: v.color ?? null,
        size:
          v.sizeValue || v.sizeSystem
            ? {
                value: v.sizeValue ?? "",
                system: v.sizeSystem ?? "UNKNOWN",
                productType: v.sizeProductType ?? "UNKNOWN",
                audience: v.sizeAudience ?? "UNKNOWN",
              }
            : null,
        sku: v.sku ?? null,
        gtin: v.gtin ?? null,
        gtinType: v.gtinType ?? null,
        purchaseUrl: v.buyUrl,
        price: v.price ?? r.price,
        currency: r.currency,
        salePrice: null,
        availability: v.availability ?? "AVAILABLE",
      }));
      return {
        externalListingId: r.id,
        sourceProductUrl: r.buyUrl ?? `${SRICEBASE}/p/${r.id}`,
        purchaseUrl: r.buyUrl ?? `${SRICEBASE}/p/${r.id}`,
        name: r.title,
        description: null,
        imageUrl: r.buyUrl ? `${r.buyUrl}/img.png` : null,
        brand: r.brand,
        category: r.category,
        gender: r.title.startsWith("Women") ? "WOMEN" : r.title.startsWith("Unisex") ? "UNISEX" : null,
        colors: r.color ? [r.color] : [],
        sizes: [],
        originalPrice: r.price,
        originalCurrency: r.currency,
        salePrice: null,
        normalizedEur: null,
        availability: "AVAILABLE",
        gtins: r.gtin ? [{ gtin: r.gtin, gtinType: "EAN13" }] : [],
        mpn: r.mpn ?? null,
        sku: r.mpn ? `${r.mpn}-os` : null,
        attributes: [],
        ...(variants.length > 0 ? { variants } : {}),
      };
    },
  };
}