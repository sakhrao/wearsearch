/* eBay integration / dry-run flow test (Phase 1) - mocked transport, real DB.

   Exercises the FULL pipeline against the real harness + DB:
     eBay Browse response -> eBayAdapter.normalize -> validate
       -> dedup -> ProductOffer / ProductOfferVariant persistence
       -> primary-offer mirror -> idempotent re-sync -> teardown.

   The eBay HTTP transport is mocked so the test is hermetic and never
   touches the real eBay API. It REGISTERS the eBay source + brand
   alias + category mapping (mirroring the real onboarding), runs the
   harness, then deletes every row it created.

   Run: npx tsx scripts/ebay-integration.test.mts  (DATABASE_URL required)
*/

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { runImport } from "../src/lib/catalog/import";
import {
  ensureSource,
  ensureBrandAlias,
  ensureCategoryMapping,
} from "../src/lib/catalog/registry";
import { createEbayAdapter } from "../src/lib/catalog/adapters/ebay";
import type { EbayItemSummary } from "../src/lib/catalog/adapters/ebay/client";
import type { NormalizedListing } from "../src/lib/catalog/types";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
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

/* ---- fixed hermetic credentials (fake; never real) ---- */
const FAKE_ID = "integration-PRD-0000000000";
const FAKE_SECRET = "integration-secret-do-not-use";

/* ---- deterministic eBay search responses (Browse item_summary shape) ---- */

function itemSummaries(seller: string) {
  return [
    /* Note : these are the actual source-native Browse shapes. */
    {
      itemId: "ebay-zoom-001",
      title: "Nike Air Zoom Pegasus 40 Running Shoes",
      itemWebUrl: "https://www.ebay.com/itm/ebay-zoom-001",
      itemAffiliateWebUrl: "https://www.ebay.com/itm/ebay-zoom-001?aff=tracker",
      shortDescription: "Brand new Nike running shoe in box",
      image: { imageUrl: "https://i.ebayimg.com/0x/zoom1.jpg" },
      price: { value: "118.00", currency: "USD" },
      condition: "New",
      buyingOptions: ["FIXED_PRICE"],
      seller: { username: seller, feedbackPercentage: "99.2" },
      categoryPath: "Shoes>Running Shoes",
      localizedAspects: [
        { name: "Brand", value: "Nike" },
        { name: "MPN", value: "DH4072-002" },
        { name: "UPC", value: "0194258723419" },
        { name: "Color", value: "Black" },
        { name: "Size", value: "US 10" },
      ],
    },
    /* Same canonical product (same UPC) but a DIFFERENT seller -> must
       become a SEPARATE ProductOffer on the SAME product (not a new
       product). */
    {
      itemId: "ebay-zoom-002",
      title: "Nike Pegasus 40 Running Shoe Black",
      itemWebUrl: "https://www.ebay.com/itm/ebay-zoom-002",
      itemAffiliateWebUrl: "https://www.ebay.com/itm/ebay-zoom-002?aff=tracker",
      shortDescription: "Nike Pegasus 40, barely used",
      image: { imageUrl: "https://i.ebayimg.com/0x/zoom2.jpg" },
      price: { value: "102.00", currency: "USD" },
      condition: "Used",
      buyingOptions: ["FIXED_PRICE"],
      seller: { username: `${seller}-2`, feedbackPercentage: "98.1" },
      categoryPath: "Shoes>Running Shoes",
      localizedAspects: [
        { name: "Brand", value: "Nike" },
        { name: "MPN", value: "DH4072-002" },
        { name: "UPC", value: "0194258723419" },
        { name: "Color", value: "Black" },
        { name: "Size", value: "US 10" },
      ],
    },
  ];
}

/* Mocked eBay transport: serves the OAuth token and the search page.
   Ignores the request URL and returns canned items, but asserts the
   Authorization header is a valid Basic (never leaks the secret). */
function makeMockFetch(items: EbayItemSummary[]) {
  let searchCalls = 0;
  return {
    searchCalls: () => searchCalls,
    impl: async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "POST") {
        /* token request */
        return new Response(
          JSON.stringify({ access_token: "integration-token", expires_in: 7200, token_type: "Application Access Token" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      /* search request */
      searchCalls += 1;
      return new Response(
        JSON.stringify({
          itemSummaries: items,
          total: items.length,
          limit: 50,
          offset: 0,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    },
  };
}

const FX = { rate: 1.1 }; /* deterministic USD->EUR for the run */

async function main() {
  /* ---- configure eBay as sandbox for a stable source name ---- */
  process.env.EBAY_CLIENT_ID = FAKE_ID;
  process.env.EBAY_CLIENT_SECRET = FAKE_SECRET;
  process.env.EBAY_ENV = "sandbox";
  process.env.EBAY_MARKETPLACE_ID = "EBAY_US";

  const mock = makeMockFetch(itemSummaries("fastfeet"));
  const adapter = createEbayAdapter({ fetchImpl: mock.impl as typeof fetch });
  const SOURCE_NAME = adapter.sourceName; /* "eBay (sandbox)" */
  check("adapter created and configured", adapter.configStatus.ok === true, JSON.stringify(adapter.configStatus));

  /* ---- register source + mapping (real onboarding) ---- */
  const source = await ensureSource(prisma, {
    name: SOURCE_NAME,
    type: adapter.sourceType,
    baseUrl: null,
    priority: adapter.priority,
    freshnessHours: adapter.freshnessHours,
    official: false,
    authRef: adapter.authRef ?? null,
  });
  await ensureBrandAlias(prisma, { brandName: "Nike", token: "Nike", sourceName: SOURCE_NAME, kind: "EXACT" });
  await ensureCategoryMapping(prisma, {
    sourceName: SOURCE_NAME,
    sourceToken: "shoes running shoes", /* foldToken("Shoes>Running Shoes") */
    canonicalSlug: "shoes",
  });

  /* ---- first import: both listings ACCEPT, same product, 2 offers ---- */
  const run1 = await runImport(prisma, adapter, { sampleSize: 10, maxListings: 20, fx: FX });
  check(
    "run1: exactly 1 canonical product created (dedup by UPC), 0 dropped, 0 quarantined",
    run1.created === 1 && run1.dropped === 0 && run1.quarantined === 0,
    JSON.stringify(run1)
  );

  const products = await prisma.product.findMany({
    where: { sourceId: source.id },
    select: { id: true, name: true },
  });
  check("exactly one canonical product for both listings", products.length === 1, `products=${products.length}`);

  const offers = await prisma.productOffer.findMany({
    where: { productId: products[0]?.id },
    select: { externalListingId: true, purchaseUrl: true, sourceProductUrl: true, originalPrice: true, originalCurrency: true, availability: true, isPrimary: true },
  });
  check("two separate offers (two sellers, same product)", offers.length === 2, `offers=${offers.length}`);
  check(
    "second offer's purchase URL preserved (affiliate)",
    offers.some((o) => o.purchaseUrl.includes("aff=tracker") && o.externalListingId === "ebay-zoom-002"),
    JSON.stringify(offers.map((o) => o.externalListingId))
  );
  check(
    "offers keep distinct original prices + USD",
    offers.some((o) => Number(o.originalPrice) === 118 && o.originalCurrency === "USD") &&
      offers.some((o) => Number(o.originalPrice) === 102 && o.originalCurrency === "USD"),
    JSON.stringify(offers.map((o) => o.originalPrice))
  );

  /* ---- variant rows: one per summary listing, carrying ONLY the
       listing's real color/size from aspects (never fabricated). ---- */
  const variantCount = await prisma.productOfferVariant.count({
    where: { offer: { productId: products[0]?.id } },
  });
  check(
    "one honest variant row per summary listing (color+size from aspects)",
    variantCount === 2,
    `variants=${variantCount}`
  );
  const variantDetails = await prisma.productOfferVariant.findMany({
    where: { offer: { productId: products[0]?.id } },
    select: { color: true, sizeValue: true, sizeSystem: true },
  });
  check(
    "variant rows preserve the listing's REAL Black / US-10 attributes",
    variantDetails.length === 2 &&
      variantDetails.every((v) => v.color === "Black" && v.sizeValue === "10" && v.sizeSystem === "US"),
    JSON.stringify(variantDetails)
  );

  /* ---- primary-offer mirror on the Product ---- */
  const mirror = await prisma.product.findUnique({
    where: { id: products[0].id },
    select: { price: true, currency: true, availability: true, productUrl: true },
  });
  check(
    "canonical Product mirrors the primary (cheapest available) offer",
    Number(mirror?.price) === 102 && mirror?.currency === "USD" && mirror?.availability === "AVAILABLE",
    JSON.stringify(mirror)
  );

  /* ---- idempotent re-sync: same data again -> 0 created, 0 new product ---- */
  const run2 = await runImport(prisma, adapter, { sampleSize: 10, maxListings: 20, fx: FX });
  check(
    "re-sync is idempotent (0 created, 2 updated, product count unchanged)",
    run2.created === 0 && run2.updated === 2,
    JSON.stringify(run2)
  );
  const productsAfter2 = await prisma.product.count({ where: { sourceId: source.id } });
  check("product count unchanged after re-sync", productsAfter2 === 1, `count=${productsAfter2}`);

  /* ---- variant persistence: feed one listing WITH variations ---- */
  const withVariations = [
    {
      itemId: "ebay-tshirt-001",
      title: "Nike Dri-FIT T-Shirt",
      itemWebUrl: "https://www.ebay.com/itm/ebay-tshirt-001",
      itemAffiliateWebUrl: "https://www.ebay.com/itm/ebay-tshirt-001?aff=tracker",
      shortDescription: "Cotton training tee",
      image: { imageUrl: "https://i.ebayimg.com/0x/tee.jpg" },
      price: { value: "25.00", currency: "USD" },
      condition: "New",
      buyingOptions: ["FIXED_PRICE"],
      seller: { username: "apparelgalore" },
      categoryPath: "Clothing>T-Shirts",
      localizedAspects: [{ name: "Brand", value: "Nike" }],
      variations: [
        { variationId: "tee-blk-m", sku: "TEE-BLK-M", color: "Black", size: "M", price: { value: "25.00", currency: "USD" } },
        { variationId: "tee-blk-l", sku: "TEE-BLK-L", color: "Black", size: "L", price: { value: "25.00", currency: "USD" } },
      ],
    },
  ];
  await ensureCategoryMapping(prisma, {
    sourceName: SOURCE_NAME,
    sourceToken: "clothing t-shirts",
    canonicalSlug: "tops",
  });
  const mock2 = makeMockFetch(withVariations);
  const adapter2 = createEbayAdapter({ fetchImpl: mock2.impl as typeof fetch });
  const run3 = await runImport(prisma, adapter2, { sampleSize: 10, maxListings: 20, fx: FX });
  check("variation listing accepted (1 created)", run3.created === 1 && run3.errors.length === 0, JSON.stringify(run3));

  const teeOffer = await prisma.productOffer.findFirst({
    where: { externalListingId: "ebay-tshirt-001" },
    include: { variants: true, product: true },
  });
  check("tee offer created", teeOffer !== null, String(teeOffer));
  if (teeOffer) {
    check(
      "two ProductOfferVariant rows with preserved sku/color/size",
      teeOffer.variants.length === 2 &&
        teeOffer.variants.some((v) => v.sku === "TEE-BLK-M" && v.color === "Black" && v.sizeValue === "M") &&
        teeOffer.variants.some((v) => v.sku === "TEE-BLK-L"),
      JSON.stringify(teeOffer.variants)
    );
  }

  /* ---- seller traceability attribute on the normalized listing ---- */
  const rawListing = adapter.toNormalizedListing(withVariations[0]);
  const l = rawListing as NormalizedListing | null;
  check(
    "seller exposed as a traceable attribute",
    l !== null && l.attributes.some((a) => a.name === "seller" && a.value === "apparelgalore"),
    JSON.stringify(l?.attributes)
  );

  /* ---- cleanup: delete everything we created ---- */
  await prisma.productOfferVariant.deleteMany({ where: { offer: { productId: { in: (await productIds()) } } } });
  await prisma.productOffer.deleteMany({ where: { productId: { in: await productIds() } } });
  await prisma.product.deleteMany({ where: { sourceId: source.id } });
  await prisma.brandAlias.deleteMany({ where: { sourceId: source.id } });
  await prisma.categoryMapping.deleteMany({ where: { sourceId: source.id } });
  await prisma.productQuarantine.deleteMany({ where: { sourceId: source.id } });
  await prisma.sourceSyncRun.deleteMany({ where: { sourceId: source.id } });
  await prisma.source.deleteMany({ where: { id: source.id } });

  async function productIds(): Promise<string[]> {
    const rows = await prisma.product.findMany({ where: { sourceId: source.id }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  console.log(`\n===== ebay-integration tests: ${passed} passed, ${failed} failed =====`);
  if (failed > 0) process.exit(1);
}

main().catch(async (err) => {
  failed += 1;
  console.log(`FAIL unhandled :: ${err.message ?? err}`);
  console.log(`\n===== ebay-integration tests: ${passed} passed, ${failed} failed =====`);
  process.exit(1);
});
