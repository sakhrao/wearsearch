import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  hasRealProductPage,
  productStoreLabel,
} from "../src/lib/product-url";

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

/* ---- guard unit behavior ---- */

check(
  "UC1 blank URL has no real page and no store label",
  !hasRealProductPage("") && productStoreLabel("") === "",
  `has=${hasRealProductPage("")} label=${productStoreLabel("")}`
);
check(
  "UC2 example.com/product is not a real page",
  !hasRealProductPage("https://example.com/product") &&
    productStoreLabel("https://example.com/product") === "",
  `has=${hasRealProductPage("https://example.com/product")}`
);
check(
  "UC3 /p/exp- style URLs are not real pages",
  !hasRealProductPage("https://www.puma.com/p/exp-polo-grey-001") &&
    productStoreLabel("https://www.puma.com/p/exp-polo-grey-001") === "",
  `has=${hasRealProductPage("https://www.puma.com/p/exp-polo-grey-001")}`
);
check(
  "UC4 a real product page is recognized and labeled by hostname",
  hasRealProductPage("https://livostyle.com/products/square-neck-crisscross-active-t-shirt") &&
    productStoreLabel("https://dummyjson.com/products/12") === "dummyjson.com",
  `has=${hasRealProductPage("https://livostyle.com/products/x")} label=${productStoreLabel("https://dummyjson.com/products/12")}`
);
check(
  "UC5 malformed URL is never a real page",
  !hasRealProductPage("not-a-url") && productStoreLabel("not-a-url") === "",
  `has=${hasRealProductPage("not-a-url")}`
);

const products = await prisma.product.findMany({
  select: {
    externalId: true,
    name: true,
    price: true,
    currency: true,
    productUrl: true,
    source: { select: { name: true } },
    variants: {
      select: { price: true, currency: true },
    },
  },
});

/* ---- P1 + P2: no fabricated/placeholder product URLs ---- */

const bannedExample = products.filter((p) =>
  p.productUrl.includes("example.com")
);
const bannedPExp = products.filter((p) =>
  p.productUrl.includes("/p/exp-")
);
const bannedExp = products.filter((p) =>
  p.productUrl.includes("exp-")
);
const noReal = products.filter(
  (p) => !hasRealProductPage(p.productUrl)
);

check(
  "A1 zero example.com/product URLs in the catalog",
  bannedExample.length === 0,
  `${bannedExample.map((p) => p.externalId).join(",")}`
);
check(
  "A2 zero /p/exp- URLs in the catalog",
  bannedPExp.length === 0,
  `${bannedPExp.map((p) => p.externalId).join(",")}`
);
check(
  "A3 zero exp- URLs in the catalog",
  bannedExp.length === 0,
  `${bannedExp.map((p) => p.externalId).join(",")}`
);

const demoStyles = noReal.filter((p) =>
  ["WearSearch Demo Store", "StyleHub Affiliate Feed"].includes(
    p.source.name
  )
);
const realProviders = products.filter((p) =>
  ["Livostyle Open Catalog", "DummyJSON Free API", "Fake Store API"].includes(
    p.source.name
  )
);
const realProviderMissingPage = realProviders.filter(
  (p) => !hasRealProductPage(p.productUrl)
);

check(
  "A4 every demo/stylehub product is guarded as having no real page (79)",
  demoStyles.length === 79 && demoStyles.length === noReal.length,
  `guarded=${demoStyles.length} noReal=${noReal.length}`
);
check(
  "A5 every real provider product still has a real page",
  realProviderMissingPage.length === 0,
  `missing=${realProviderMissingPage
    .map((p) => p.externalId)
    .join(",")}`
);
check(
  "A6 store label is never a placeholder host",
  noReal.every(
    (p) => productStoreLabel(p.productUrl) === ""
  ),
  `labeled=${noReal
    .filter((p) => productStoreLabel(p.productUrl) !== "")
    .map((p) => p.externalId)
    .join(",")}`
);

/* ---- P3: variant price consistency ---- */

let belowMin = 0;
let currencyMismatch = 0;
let priceMinMismatch = 0;
const mismatching = [];

for (const p of products) {
  const pp = Number(p.price);

  if (p.variants.length > 0) {
    const vPrices = p.variants.map((v) => Number(v.price));
    const min = Math.min(...vPrices);
    if (min !== pp) priceMinMismatch++;
    if (vPrices.some((v) => v < pp)) belowMin++;
  }

  if (p.variants.some((v) => v.currency !== p.currency)) {
    currencyMismatch++;
  }

  if (p.variants.some((v) => Number(v.price) !== pp)) {
    mismatching.push(p.externalId);
  }
}

check(
  "B1 product.price is always the lowest variant price (never misleads upward)",
  belowMin === 0 && priceMinMismatch === 0,
  `belowMin=${belowMin} minMismatch=${priceMinMismatch}`
);
check(
  "B2 no product/variant currency mismatches",
  currencyMismatch === 0,
  `currencyMismatch=${currencyMismatch}`
);
check(
  /* PR2-F2 re-based: 13->20. The 71 new livostyle Hoodies/Sweatshirts
     added 7 more products whose variants expose a genuine higher price
     tier (all still livostyle-only, still genuine). */
  "B3 livostyle products keep their genuine variant price range",
  mismatching.length === 20 &&
    mismatching.every((id) => id.startsWith("lv-")),
  `count=${mismatching.length} non-lv=${mismatching
    .filter((id) => !id.startsWith("lv-"))
    .join(",")}`
);
check(
  "B4 genuineness: differing-variant products expose exactly a higher price tier",
  (() => {
    return mismatching.every((id) => {
      const p = products.find((x) => x.externalId === id)!;
      const below = p.variants.some(
        (v) => Number(v.price) < Number(p.price)
      );
      return !below;
    });
  })(),
  `some variant below product.price among the 13`
);

console.log(`\n=== RESULT: ${passed}/${passed + failed} passed ===`);
process.exit(failed === 0 ? 0 : 1);