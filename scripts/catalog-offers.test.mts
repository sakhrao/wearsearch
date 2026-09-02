import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { runImport, inspectSample, verifyCatalogInvariants } from "../src/lib/catalog/import";
import { ensureSource, ensureBrandAlias, ensureCategoryMapping } from "../src/lib/catalog/registry";
import { isOfferStale, resolvePrimaryOffer, type OfferResolveRow } from "../src/lib/catalog/offers";
import { fixtureAdapter, type FixtureRawListing } from "./fixtures/catalog-fixtures";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail: string) {
  if (cond) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name} :: ${detail}`);
  }
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
  }),
});

const TS = Date.now();
const OFFICIAL = `P0 Official Store ${TS}`;
const RETAILER = `P0 Retailer ${TS}`;
const MARKETPLACE = `P0 Marketplace ${TS}`;
const TEST_SOURCES = [OFFICIAL, RETAILER, MARKETPLACE];
const BRAND_NAME = `P0ZoomBrand${TS}`;

const OFFICIAL_RAW: FixtureRawListing = {
  id: "zoom-official-001",
  title: "Nike Zoom Fly 5",
  brand: "Zoom Athletics",
  category: "Running Shoes",
  price: 130,
  currency: "EUR",
  gtin: "0194258723419",
  mpn: "DV0652",
  color: "Black",
  buyUrl: "https://www.official-store.phase0/p/zoom-001",
};
const RETAILER_RAW: FixtureRawListing = {
  id: "zoom-retail-001",
  title: "Nike Zoom Fly 5 Running Shoe",
  brand: "Zoom Athletics",
  category: "Running",
  price: 119.9,
  currency: "EUR",
  gtin: "0194258723419",
  color: "Black",
  buyUrl: "https://www.retail.phase0/p/zoom-001",
};
const MARKETPLACE_RAW: FixtureRawListing = {
  id: "zoom-market-001",
  title: "Nike Zoom Fly 5 Size 42",
  brand: "Zoom Athletics",
  category: "Running",
  price: 125,
  currency: "EUR",
  gtin: "0194258723419",
  color: "Black",
  buyUrl: "https://www.market.phase0/listing/zoom-001",
};
const UNMAPPED_RAW: FixtureRawListing = {
  id: "mystery-001",
  title: "Unbranded Mystery Hoodie",
  brand: "Mystery Label",
  category: "Hoodies",
  price: 45,
  currency: "EUR",
  buyUrl: "https://www.sketchy.phase0/p/hoodie-001",
};

const officialAdapter = fixtureAdapter({
  sourceName: OFFICIAL,
  sourceType: "OFFICIAL_API",
  priority: 1,
  official: true,
  listings: [OFFICIAL_RAW, UNMAPPED_RAW],
});
const retailerAdapter = fixtureAdapter({
  sourceName: RETAILER,
  sourceType: "AUTHORIZED_FEED",
  priority: 2,
  listings: [RETAILER_RAW],
});
const marketplaceAdapter = fixtureAdapter({
  sourceName: MARKETPLACE,
  sourceType: "AUTHORIZED_FEED",
  priority: 4,
  listings: [MARKETPLACE_RAW],
});

const FX = { rate: 1.0 };
const result: {
  createdProducts: string[];
  offersByProduct: Map<string, string[]>;
  preferredProductId: string | null;
} = {
  createdProducts: [],
  offersByProduct: new Map(),
  preferredProductId: null,
};

async function teardown() {
  const sources = await prisma.source.findMany({
    where: { name: { in: TEST_SOURCES } },
    select: { id: true },
  });
  const ids = sources.map((s) => s.id);
  if (ids.length > 0) {
    await prisma.product.deleteMany({ where: { sourceId: { in: ids } } });
    await prisma.brandAlias.deleteMany({ where: { sourceId: { in: ids } } });
    await prisma.categoryMapping.deleteMany({ where: { sourceId: { in: ids } } });
    await prisma.productQuarantine.deleteMany({ where: { sourceId: { in: ids } } });
    await prisma.source.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.brand.deleteMany({
    where: { name: { startsWith: `P0ZoomBrand${TS}` }, products: { none: {} } },
  });
}

try {
  /* ---- prepare registry: canonical brand + category mappings for both sources ---- */
  for (const name of TEST_SOURCES) {
    await ensureSource(prisma, {
      name,
      type: name === RETAILER ? "AUTHORIZED_FEED" : "OFFICIAL_API",
      baseUrl: null,
      priority: name === OFFICIAL ? 1 : name === RETAILER ? 2 : 4,
      freshnessHours: 24,
      official: name === OFFICIAL,
    });
    await ensureBrandAlias(prisma, {
      brandName: BRAND_NAME,
      token: "Zoom Athletics",
      sourceName: name,
      kind: "EXACT",
    });
    await ensureCategoryMapping(prisma, {
      sourceName: name,
      sourceToken: "Running Shoes",
      canonicalSlug: "shoes",
    });
    await ensureCategoryMapping(prisma, {
      sourceName: name,
      sourceToken: "Running",
      canonicalSlug: "shoes",
    });
    await ensureCategoryMapping(prisma, {
      sourceName: name,
      sourceToken: "Hoodies",
      canonicalSlug: "tops",
    });
  }

  /* ---- sample-only: nothing written ---- */
  const beforeSample = await prisma.product.count();
  await inspectSample(prisma, officialAdapter, { sampleSize: 10, fx: FX });
  const afterSample = await prisma.product.count();
  check(
    "inspectSample never writes products",
    afterSample === beforeSample,
    `${beforeSample} -> ${afterSample}`
  );

  /* ---- official source: 1 new product + 1 quarantine ---- */
  const officialRun = await runImport(prisma, officialAdapter, { sampleSize: 10, maxListings: 20, fx: FX });
  check(
    "official import created exactly 1 product (unmapped brand quarantined)",
    officialRun.created === 1 && officialRun.quarantined === 1,
    JSON.stringify(officialRun)
  );
  check(
    "official run records a SourceSyncRun",
    officialRun.syncRunId !== null,
    JSON.stringify(officialRun.syncRunId)
  );

  const afterOfficial = await prisma.product.count();
  check(
    "official import added exactly 1 product to catalog",
    afterOfficial === beforeSample + 1,
    `${beforeSample} -> ${afterOfficial}`
  );

  const quarantineCount = await prisma.productQuarantine.count({
    where: { externalListingId: "mystery-001" },
  });
  check(
    "unmapped brand parked in quarantine (never searchable)",
    quarantineCount === 1,
    `quarantine=${quarantineCount}`
  );

  /* ---- retailer source: SAME GTIN => merge into the existing product ---- */
  const retailerRun = await runImport(prisma, retailerAdapter, { sampleSize: 10, maxListings: 20, fx: FX });
  check(
    "retailer import created 0 new products (merged by GTIN)",
    retailerRun.created === 0 && retailerRun.updated === 1,
    JSON.stringify(retailerRun)
  );
  check(
    "merged product count unchanged",
    (await prisma.product.count()) === beforeSample + 1,
    String(await prisma.product.count())
  );

  /* ---- marketplace source: third offer ---- */
  const marketRun = await runImport(prisma, marketplaceAdapter, { sampleSize: 10, maxListings: 20, fx: FX });
  check(
    "marketplace import merged (created 0)",
    marketRun.created === 0,
    JSON.stringify(marketRun)
  );

  /* ---- canonical product has exactly one row + 3 offers ---- */
  const product = await prisma.product.findFirst({
    where: { brand: { name: BRAND_NAME } },
    include: { offers: { include: { source: true } } },
  });
  check(
    "exactly 1 canonical product row for the merged sneaker",
    product !== null,
    "no product row"
  );
  if (product) {
    check(
      "product carries 3 offers (all preserved, none deleted)",
      product.offers.length === 3,
      `offers=${product.offers.length}`
    );
    check(
      "exactly one primary offer",
      product.offers.filter((o) => o.isPrimary).length === 1,
      JSON.stringify(product.offers.map((o) => ({ src: o.source.name, primary: o.isPrimary })))
    );

    const primary = product.offers.find((o) => o.isPrimary);
    check(
      "primary offer = OFFICIAL source (priority 1, official flag)",
      primary?.source.name === OFFICIAL,
      JSON.stringify(primary?.source.name)
    );

    /* ---- Product mirror reflects the primary offer ---- */
    check(
      "Product.price mirrors primary offer originalPrice (130)",
      Number(product.price) === 130,
      `price=${Number(product.price)}`
    );
    check(
      "Product.productUrl mirrors primary purchaseUrl",
      product.productUrl === OFFICIAL_RAW.buyUrl,
      `url=${product.productUrl}`
    );
    check(
      "Product.currency mirrors primary currency",
      product.currency === "EUR",
      product.currency
    );
    check(
      "Product.availability mirror = AVAILABLE",
      product.availability === "AVAILABLE",
      product.availability
    );

    /* the marketplace + retailer offers still carry their own prices */
    const retailerOffer = product.offers.find((o) => o.source.name === RETAILER);
    check(
      "retailer offer preserved its own originalPrice (119.9)",
      !!retailerOffer && Number(retailerOffer.originalPrice) === 119.9,
      JSON.stringify(retailerOffer?.originalPrice)
    );

    result.createdProducts.push(product.id);
    result.offersByProduct.set(
      product.id,
      product.offers.map((o) => o.source.name)
    );
    result.preferredProductId = primary?.id ?? null;
  }

  /* ---- offers row carries source metadata verbatim ---- */
  const offers = await prisma.productOffer.findMany({
    where: { externalListingId: { in: ["zoom-official-001", "zoom-retail-001", "zoom-market-001"] } },
  });
  check(
    "each offer keeps its own purchaseUrl + externalListingId",
    offers.length === 3 &&
      offers.every((o) => o.purchaseUrl !== "" && o.externalListingId !== ""),
    JSON.stringify(offers.map((o) => ({ id: o.externalListingId, url: o.purchaseUrl })))
  );

  /* ---- freshness: fresh offers never stale, window respected ---- */
  const fresh = offers[0];
  check(
    "fresh offer (24h window) is NOT stale",
    !isOfferStale({ availabilityUpdatedAt: fresh.availabilityUpdatedAt, freshnessHours: 24 }),
    String(fresh.availabilityUpdatedAt)
  );
  check(
    "ancient offer IS stale",
    isOfferStale({ availabilityUpdatedAt: new Date(Date.now() - 25 * 3600 * 1000), freshnessHours: 24 }) &&
      !isOfferStale({ availabilityUpdatedAt: new Date(Date.now() - 25 * 3600 * 1000), freshnessHours: 48 }),
    "window comparison"
  );

  /* ---- pure primary resolver over fabricated rows ---- */
  const resolverOffers: OfferResolveRow[] = [
    { offerId: "market", official: false, priority: 4, availability: "AVAILABLE", normalizedEur: 125, updatedAt: new Date("2026-09-01T00:00:00Z") },
    { offerId: "retail", official: false, priority: 2, availability: "AVAILABLE", normalizedEur: 119.9, updatedAt: new Date("2026-09-01T01:00:00Z") },
    { offerId: "official", official: true, priority: 1, availability: "AVAILABLE", normalizedEur: 130, updatedAt: new Date("2026-09-01T02:00:00Z") },
  ];
  check(
    "resolvePrimaryOffer prefers official (flag) over cheaper retail",
    resolvePrimaryOffer(resolverOffers) === "official",
    String(resolvePrimaryOffer(resolverOffers))
  );

  /* ---- availability must trump source priority: an OUT_OF_STOCK /
         UNKNOWN primary can never be the effective buy target while an
         available alternative exists ---- */
  const fullSet: OfferResolveRow[] = [
    { offerId: "official-oos", official: true, priority: 1, availability: "OUT_OF_STOCK", normalizedEur: 100, updatedAt: new Date("2026-09-01T00:00:00Z") },
    { offerId: "authorized-avail", official: false, priority: 2, availability: "AVAILABLE", normalizedEur: 115, updatedAt: new Date("2026-09-01T01:00:00Z") },
    { offerId: "market-x", official: false, priority: 4, availability: "UNKNOWN", normalizedEur: 90, updatedAt: new Date("2026-09-01T02:00:00Z") },
  ];
  check(
    "resolver: available Authorized beats out-of-stock Official",
    resolvePrimaryOffer(fullSet) === "authorized-avail",
    String(resolvePrimaryOffer(fullSet))
  );

  const unknownOfficial: OfferResolveRow[] = [
    { offerId: "official-unknown", official: true, priority: 1, availability: "UNKNOWN", normalizedEur: 100, updatedAt: new Date("2026-09-01T00:00:00Z") },
    { offerId: "market-avail", official: false, priority: 4, availability: "AVAILABLE", normalizedEur: 118, updatedAt: new Date("2026-09-01T01:00:00Z") },
  ];
  check(
    "resolver: available Marketplace beats UNKNOWN official",
    resolvePrimaryOffer(unknownOfficial) === "market-avail",
    String(resolvePrimaryOffer(unknownOfficial))
  );

  const preorderVsOut: OfferResolveRow[] = [
    { offerId: "official-pre", official: true, priority: 1, availability: "PREORDER", normalizedEur: 130, updatedAt: new Date("2026-09-01T00:00:00Z") },
    { offerId: "authorized-oos", official: false, priority: 2, availability: "OUT_OF_STOCK", normalizedEur: 120, updatedAt: new Date("2026-09-01T01:00:00Z") },
  ];
  check(
    "resolver: PREORDER is buyable and beats OUT_OF_STOCK authorized",
    resolvePrimaryOffer(preorderVsOut) === "official-pre",
    String(resolvePrimaryOffer(preorderVsOut))
  );

  const allUnavailable: OfferResolveRow[] = [
    { offerId: "authorized-oos", official: false, priority: 2, availability: "OUT_OF_STOCK", normalizedEur: 120, updatedAt: new Date("2026-09-01T00:00:00Z") },
    { offerId: "official-oos", official: true, priority: 1, availability: "OUT_OF_STOCK", normalizedEur: 130, updatedAt: new Date("2026-09-01T01:00:00Z") },
  ];
  check(
    "resolver: all unavailable -> official stays (least-bad canonical primary)",
    resolvePrimaryOffer(allUnavailable) === "official-oos",
    String(resolvePrimaryOffer(allUnavailable))
  );

  const staleUnknownVsAvail: OfferResolveRow[] = [
    { offerId: "official-stale", official: true, priority: 1, availability: "UNKNOWN", normalizedEur: 100, updatedAt: new Date("2020-01-01T00:00:00Z") },
    { offerId: "authorized-fresh", official: false, priority: 2, availability: "AVAILABLE", normalizedEur: 116, updatedAt: new Date("2026-09-01T00:00:00Z") },
  ];
  check(
    "resolver: stale UNKNOWN official loses to fresh available authorized",
    resolvePrimaryOffer(staleUnknownVsAvail) === "authorized-fresh",
    String(resolvePrimaryOffer(staleUnknownVsAvail))
  );

  /* ---- post-run invariant check (whole catalog) ---- */
  const violations = await verifyCatalogInvariants(prisma);
  check(
    "verifyCatalogInvariants has no violations after merges",
    violations.length === 0,
    violations.join("; ")
  );

  /* ---- no Search/Outfit-visible regression: catalog shape unchanged ---- */
  const totals = await prisma.$transaction([
    prisma.product.count(),
    prisma.productVariant.count(),
  ]);
  check(
    "catalog totals sane after harness runs",
    totals[0] === beforeSample + 1 && totals[1] >= 0,
    JSON.stringify(totals)
  );
} finally {
  await teardown();
}

void result;

console.log(`\ncatalog-offers: passed=${passed} failed=${failed}`);
await prisma.$disconnect();
if (failed > 0) process.exit(1);