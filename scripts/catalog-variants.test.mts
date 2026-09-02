import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { runImport } from "../src/lib/catalog/import";
import { ensureSource, ensureBrandAlias, ensureCategoryMapping } from "../src/lib/catalog/registry";
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
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const TS = Date.now();
const SOURCE = `P0 Variant Store ${TS}`;
const BRAND = `P0VariantBrand${TS}`;
const FX = { rate: 1.0 };

/* A multi-variation listing: 3 variations (EU 42/43/44, Black + Red),
   each with its OWN sku, per-variation GTIN, and one carrying its own
   availability (PREORDER) and per-variation buy URL. */
const MULTI_RAW: FixtureRawListing = {
  id: "zoom-multi-001",
  title: "Nike Zoom Fly 5",
  brand: "Zoom Athletics",
  category: "Running Shoes",
  price: 130,
  currency: "EUR",
  buyUrl: "https://www.official-store.phase0/p/zoom-001",
  variants: [
    {
      id: "zoom-42",
      sku: "DV0652-EU42",
      gtin: "019425872341001",
      gtinType: "EAN13",
      color: "Black",
      sizeValue: "42",
      sizeSystem: "EU",
      price: 130,
    },
    {
      id: "zoom-43",
      sku: "DV0652-EU43",
      gtin: "019425872341002",
      gtinType: "EAN13",
      color: "Black",
      sizeValue: "43",
      sizeSystem: "EU",
      price: 133.5,
      availability: "PREORDER",
      buyUrl: "https://www.official-store.phase0/p/zoom-001?vid=43",
    },
    {
      id: "zoom-red-42",
      sku: "DV0652-RED-42",
      gtin: "019425872341003",
      gtinType: "EAN13",
      color: "Red",
      sizeValue: "42",
      sizeSystem: "EU",
      price: 130,
    },
  ],
};

/* A plain listing with NO variation dimension: must yield ZERO variant
   rows (nothing ambiguous to preserve, nothing fabricated). */
const PLAIN_RAW: FixtureRawListing = {
  id: "plain-shirt-001",
  title: "Classic White Shirt",
  brand: "Zoom Athletics",
  category: "Shirts",
  price: 40,
  currency: "EUR",
  buyUrl: "https://www.official-store.phase0/p/shirt-001",
};

const adapter = fixtureAdapter({
  sourceName: SOURCE,
  sourceType: "OFFICIAL_API",
  priority: 1,
  official: true,
  listings: [MULTI_RAW, PLAIN_RAW],
});

async function teardown() {
  const source = await prisma.source.findUnique({ where: { name: SOURCE } });
  if (source) {
    await prisma.product.deleteMany({ where: { sourceId: source.id } });
    await prisma.brandAlias.deleteMany({ where: { sourceId: source.id } });
    await prisma.categoryMapping.deleteMany({ where: { sourceId: source.id } });
    await prisma.productQuarantine.deleteMany({ where: { sourceId: source.id } });
    await prisma.source.delete({ where: { id: source.id } });
  }
  await prisma.brand.deleteMany({
    where: { name: { startsWith: `P0VariantBrand${TS}` }, products: { none: {} } },
  });
}

let offerRowCount = -1;

try {
  await ensureSource(prisma, {
    name: SOURCE,
    type: "OFFICIAL_API",
    priority: 1,
    freshnessHours: 24,
    official: true,
  });
  await ensureBrandAlias(prisma, { brandName: BRAND, token: "Zoom Athletics", sourceName: SOURCE, kind: "EXACT" });
  await ensureCategoryMapping(prisma, { sourceName: SOURCE, sourceToken: "Running Shoes", canonicalSlug: "shoes" });
  await ensureCategoryMapping(prisma, { sourceName: SOURCE, sourceToken: "Shirts", canonicalSlug: "shirts" });

  const first = await runImport(prisma, adapter, { sampleSize: 10, maxListings: 20, fx: FX });
  check(
    "multi-variation import creates both listings",
    first.created === 2,
    JSON.stringify(first)
  );

  const offer = await prisma.productOffer.findFirst({
    where: { externalListingId: "zoom-multi-001" },
  });
  check(
    "listing offer row exists (the grouping grain)",
    offer !== null,
    "no offer row"
  );
  if (!offer) throw new Error("abort: no offer row");

  /* ---- variant rows preserve the POSITIONAL relationship ---- */
  let variants = await prisma.productOfferVariant.findMany({
    where: { offerId: offer.id },
    orderBy: { variantKey: "asc" },
  });
  offerRowCount = variants.length;
  check(
    "offer has exactly 3 variation rows (never flattened)",
    variants.length === 3,
    `rows=${variants.length}`
  );

  const eu42 = variants.find((v) => v.externalVariantId === "zoom-42");
  const eu43 = variants.find((v) => v.externalVariantId === "zoom-43");
  const red42 = variants.find((v) => v.externalVariantId === "zoom-red-42");

  check(
    "variant keys are distinct and sku-derived (sku > gtin)"
    ,
    new Set(variants.map((v) => v.variantKey)).size === 3 &&
      variants.every((v) => v.variantKey.startsWith("vsku:")),
    variants.map((v) => v.variantKey).join(", ")
  );

  check(
    "each variant keeps its own SKU + variation GTIN/EAN",
    !!eu42 && !!eu43 && !!red42 &&
      eu42.sku === "DV0652-EU42" && eu42.gtin === "019425872341001" && eu42.gtinType === "EAN13" &&
      red42.sku === "DV0652-RED-42" && red42.gtin === "019425872341003",
    JSON.stringify(variants.map((v) => ({ sku: v.sku, gtin: v.gtin })))
  );

  check(
    "variant identity: color + size + size system preserved positionally",
    eu42?.color === "Black" && eu42?.sizeValue === "42" && eu42?.sizeSystem === "EU" &&
      red42?.color === "Red" && red42?.sizeValue === "42" && red42?.sizeSystem === "EU" &&
      eu43?.sizeValue === "43",
    JSON.stringify(variants.map((v) => ({ c: v.color, s: v.sizeValue, sys: v.sizeSystem })))
  );

  check(
    "variant prices preserved per-variation (130 / 133.5 / 130)",
    Number(eu42?.originalPrice) === 130 &&
      Number(eu43?.originalPrice) === 133.5 &&
      Number(red42?.originalPrice) === 130 &&
      Number(eu42?.normalizedEur) === 130 &&
      Number(eu43?.normalizedEur) === 133.5,
    variants.map((v) => `${Number(v.originalPrice)}`).join(", ")
  );

  check(
    "per-variant availability preserved (PREORDER on size 43)",
    eu42?.availability === "AVAILABLE" && eu43?.availability === "PREORDER",
    variants.map((v) => v.availability).join(", ")
  );

  check(
    "per-variant buy URL preserved (custom only for size 43)",
    eu43?.purchaseUrl === "https://www.official-store.phase0/p/zoom-001?vid=43" &&
      eu42?.purchaseUrl === "https://www.official-store.phase0/p/zoom-001",
    JSON.stringify(variants.map((v) => v.purchaseUrl))
  );

  /* ---- re-sync idempotency: same listing, same 3 rows, same ids ---- */
  const idsBefore = variants.map((v) => v.id).sort();
  const second = await runImport(prisma, adapter, { sampleSize: 10, maxListings: 20, fx: FX });
  variants = await prisma.productOfferVariant.findMany({
    where: { offerId: offer.id },
    orderBy: { variantKey: "asc" },
  });
  const idsAfter = variants.map((v) => v.id).sort();
  check(
    "re-import does NOT duplicate variation rows (idempotent upsert)",
    variants.length === offerRowCount &&
      idsBefore.join("|") === idsAfter.join("|"),
    `before=${offerRowCount} after=${variants.length}`
  );
  check(
    "identity-less listing re-sync UPDATES its own product (created 0)",
    second.created === 0 && second.updated === 2,
    JSON.stringify(second)
  );

  /* ---- no-variation dimension -> no fabricated variant rows ---- */
  const plainOffer = await prisma.productOffer.findFirst({
    where: { externalListingId: "plain-shirt-001" },
  });
  const plainCount = plainOffer
    ? await prisma.productOfferVariant.count({ where: { offerId: plainOffer.id } })
    : -1;
  check(
    "listing without variation dimension yields ZERO variant rows",
    plainCount === 0,
    `plainCount=${plainCount}`
  );

  /* ---- primary + mirror still resolve on the listing grain ---- */
  const product = await prisma.product.findFirst({
    where: { brand: { name: BRAND } },
    include: { offers: { where: { externalListingId: "zoom-multi-001" } } },
  });
  check(
    "primary offer assigned and product mirror intact",
    product !== null &&
      product.offers.length === 1 &&
      product.offers[0].isPrimary === true &&
      Number(product.price) === 130 &&
      product.availability === "AVAILABLE",
    JSON.stringify(product?.price)
  );
} finally {
  await teardown();
}

console.log(`\ncatalog-variants: passed=${passed} failed=${failed}`);
await prisma.$disconnect();
if (failed > 0) process.exit(1);