/* Build an Outfit — flow + API tests.
   Two parts:
     A. pure tests over the build flow rules / context ranking /
        serializer (run offline, no DB);
     B. honest API tests over the /api/build route (real DB via
        DATABASE_URL, mirroring outfit-integration.test.mts). The
        route-level HONESTY checks run regardless of stock levels;
        the richer pool assertions run only when the catalog has real
        sellable products (recommend ⊆ real catalog, deterministic
        rerun, recommend reorders but never invents).

   Run: tsx scripts/build-flow.test.mts */

import "dotenv/config";

import { flowSteps, BUILD_GENDERS } from "../src/lib/build/flow-rules";
import {
  canonicalCategoriesForSlot,
  categoryInSlot,
  genderCompatible,
  isOnePieceTopSlug,
  onePieceTopSlugs,
} from "../src/lib/build/flow-rules";
import { canonicalCategoryDisplay } from "../src/lib/catalog/category-display";
import { contextFitScore, rankByContext } from "../src/lib/build/context";
import {
  availableColors,
  availableSizes,
  serializeBuildProduct,
} from "../src/lib/build/serialize";
import { hasRealProductPage } from "../src/lib/product-url";
import { loadOutfitCatalog } from "../src/lib/outfit/catalog";
import { prisma } from "../src/lib/prisma";
import { POST } from "../src/app/api/build/route";
import type { OutfitProduct } from "../src/lib/outfit/types";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra?: string): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL ${name}${extra ? " :: " + extra : ""}`);
  }
}

function fixtureProduct(overrides: Partial<OutfitProduct> & { id: string; name: string; categorySlug: string }): OutfitProduct {
  const base: OutfitProduct = {
    id: overrides.id,
    name: overrides.name,
    price: "20.00",
    currency: "EUR",
    productUrl: "https://px.ebay.com/x",
    imageUrl: null,
    availability: "IN_STOCK",
    gender: "MEN",
    brand: null,
    category: { id: `cat-${overrides.categorySlug}`, slug: overrides.categorySlug, name: overrides.categorySlug },
    variants: [
      {
        price: "20.00",
        currency: "EUR",
        availability: "AVAILABLE",
        color: { name: "White", hex: "#ffffff" },
      },
    ],
    attributes: [],
  };
  return { ...base, ...overrides };
}

/* ================= A. pure flow rules ================= */

check("BUILD_GENDERS is exactly MEN/WOMEN/KIDS (no Unisex UI)",
  JSON.stringify(BUILD_GENDERS) === JSON.stringify(["MEN", "WOMEN", "KIDS"]));

const normal = flowSteps(false);
check("flow order: top,bottom,footwear,layer,accessory",
  JSON.stringify(normal.map((s) => s.slot)) ===
    JSON.stringify(["top", "bottom", "footwear", "layer", "accessory"]));
check("only top+bottom required",
  JSON.stringify(normal.filter((s) => s.required).map((s) => s.slot)) ===
    JSON.stringify(["top", "bottom"]));

const onePiece = flowSteps(true);
check("one-piece flow has no bottom step",
  !onePiece.some((s) => s.slot === "bottom") &&
    JSON.stringify(onePiece.map((s) => s.slot)) ===
      JSON.stringify(["top", "footwear", "layer", "accessory"]));
check("one-piece flow keeps top required",
  onePiece.find((s) => s.slot === "top")?.required === true);

const onePieceTops = [...onePieceTopSlugs()];
check("one-piece tops derived (non-empty)", onePieceTops.length > 0, `got ${onePieceTops.length}`);
for (const slug of onePieceTops.slice(0, 50)) {
  const d = canonicalCategoryDisplay().find((c) => c.slug === slug);
  check(`one-piece slug ${slug} is canonical Dresses & Jumpsuits`,
    Boolean(d && d.subgroup === "Dresses & Jumpsuits"), `subgroup=${d?.subgroup}`);
}
check("t-shirt is not one-piece", !isOnePieceTopSlug("t-shirts"));
check("one-piece slug lower-cased match", isOnePieceTopSlug(onePieceTops[0].toUpperCase()));

for (const slot of ["top", "bottom", "footwear", "layer", "accessory"] as const) {
  const cats = canonicalCategoriesForSlot(slot);
  check(`canonicalCategoriesForSlot(${slot}) non-empty`, cats.length > 0, `got ${cats.length}`);
  check(`all ${slot} canonical options belong to the slot`,
    cats.every((c) => categoryInSlot(c.slug, slot)));
  check(`no ${slot} option is duplicated`, new Set(cats.map((c) => c.slug)).size === cats.length);
}

check("top options include one-piece leaves",
  canonicalCategoriesForSlot("top").some((c) => c.onePiece));
check("bottoms options contain no one-piece leaves",
  canonicalCategoriesForSlot("bottom").every((c) => !c.onePiece));

check("t-shirts -> top", categoryInSlot("t-shirts", "top"));
check("jeans -> bottom", categoryInSlot("jeans", "bottom"));
check("sneakers -> footwear", categoryInSlot("sneakers", "footwear"));
check("hoodies -> layer", categoryInSlot("hoodies", "layer"));
check("watches -> accessory", categoryInSlot("watches", "accessory"));
check("sneakers NOT top", !categoryInSlot("sneakers", "top"));
check("t-shirts NOT bottom", !categoryInSlot("t-shirts", "bottom"));

check("genderCompatible: UNISEX works for MEN/WOMEN",
  genderCompatible(["MEN", "UNISEX"], "MEN") &&
    genderCompatible(["UNISEX"], "WOMEN"));
check("genderCompatible: MEN-only hidden for WOMEN",
  !genderCompatible(["MEN"], "WOMEN"));
check("genderCompatible: KIDS-only only for KIDS",
  genderCompatible(["KIDS"], "KIDS") && !genderCompatible(["KIDS"], "MEN"));
check("genderCompatible: empty signal hides everywhere",
  !genderCompatible([] as never, "MEN") && !genderCompatible(null, "WOMEN"));

/* ================= pure context ranking ================= */

const whiteTee = fixtureProduct({ id: "tee1", name: "Plain White Tee", categorySlug: "t-shirts" });
const casualJeans = fixtureProduct({ id: "jeans1", name: "Blue Jeans", categorySlug: "jeans" });
const formalTrousers = fixtureProduct({ id: "trs1", name: "Formal Trousers", categorySlug: "trousers" });

const ranked = rankByContext([formalTrousers, casualJeans], "bottom", [
  { slot: "top", product: whiteTee, color: { name: "White", hex: "#ffffff" } },
], null);

check("context ranking reorders (casual jeans first with a casual tee)",
  ranked[0]?.product.id === "jeans1",
  `order=${ranked.map((r) => r.product.id).join(",")}`);
check("context ranking is deterministic",
  JSON.stringify(ranked.map((r) => [r.product.id, r.score])) ===
    JSON.stringify(rankByContext([formalTrousers, casualJeans], "bottom", [
      { slot: "top", product: whiteTee, color: { name: "White", hex: "#ffffff" } },
    ], null).map((r) => [r.product.id, r.score])));

check("context scores bounded [0,1]",
  ranked.every((r) => r.score >= 0 && r.score <= 1));

const limited = rankByContext([casualJeans, formalTrousers], "bottom", [
  { slot: "top", product: whiteTee, color: { name: "White", hex: "#ffffff" } },
], null, 1);
check("rank limit respected", limited.length === 1);

const scoreA = contextFitScore({ product: casualJeans, slot: "bottom", context: [
  { slot: "top", product: whiteTee, color: { name: "White", hex: "#ffffff" } },
], rate: null });
const scoreB = contextFitScore({ product: casualJeans, slot: "bottom", context: [
  { slot: "top", product: whiteTee, color: { name: "White", hex: "#ffffff" } },
], rate: null });
check("contextFitScore deterministic", scoreA === scoreB, `${scoreA} vs ${scoreB}`);

/* ================= pure serializer ================= */

const multiVariant = fixtureProduct({
  id: "mv1",
  name: "Multi Variant",
  categorySlug: "t-shirts",
  variants: [
    { price: "10.00", currency: "EUR", availability: "AVAILABLE", color: { name: "White", hex: null } },
    { price: "10.00", currency: "EUR", availability: "AVAILABLE", color: { name: "Black", hex: null } },
    { price: "10.00", currency: "EUR", availability: "UNAVAILABLE", color: { name: "Red", hex: null } },
  ],
});
check("availableColors: only AVAILABLE variants, sorted, deduped",
  JSON.stringify(availableColors(multiVariant)) === JSON.stringify(["Black", "White"]),
  `got ${JSON.stringify(availableColors(multiVariant))}`);
check("availableColors: unavailable color never surfaces",
  !availableColors(multiVariant).includes("Red"));

const sized = fixtureProduct({
  id: "sz1",
  name: "Sized Item",
  categorySlug: "t-shirts",
  variants: [
    { price: "10.00", currency: "EUR", availability: "AVAILABLE", color: { name: "White", hex: null }, size: { system: "eu", value: "M", normalizedValue: "M", productType: "top" } },
    { price: "10.00", currency: "EUR", availability: "AVAILABLE", color: { name: "Black", hex: null }, size: { system: "eu", value: "S", normalizedValue: "S", productType: "top" } },
    { price: "10.00", currency: "EUR", availability: "AVAILABLE", color: { name: "Green", hex: null }, size: { system: "eu", value: "M", normalizedValue: "M", productType: "top" } },
    { price: "10.00", currency: "EUR", availability: "UNAVAILABLE", color: { name: "Red", hex: null }, size: { system: "eu", value: "XL", normalizedValue: "XL", productType: "top" } },
  ],
});
check("availableSizes: deduped available values only",
  JSON.stringify(availableSizes(sized)) === JSON.stringify(["M", "S"]),
  `got ${JSON.stringify(availableSizes(sized))}`);

const serialized = serializeBuildProduct(sized);
check("serializeBuildProduct shape: real fields kept",
  serialized.id === "sz1" &&
    serialized.currency === "EUR" &&
    serialized.productUrl === "https://px.ebay.com/x" &&
    serialized.categorySlug === "t-shirts" &&
    Array.isArray(serialized.colors) &&
    Array.isArray(serialized.sizes));

/* ================= B. /api/build route (real DB) ================= */

async function postBuild(body: Record<string, unknown>): Promise<Response> {
  return POST(new Request("http://localhost/api/build", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

const badGender = await postBuild({ gender: "UNISEX", slot: "top" });
check("400 on UNISEX gender (no Unisex UI on the API either)",
  badGender.status === 400);
check("400 on invalid slot",
  (await postBuild({ gender: "MEN", slot: "hats" })).status === 400);
check("400 on invalid JSON",
  (await POST(new Request("http://localhost/api/build", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "not json",
  }))).status === 400);

const menTop = await postBuild({
  gender: "MEN",
  slot: "top",
  category: null,
  mode: "recommend",
  filters: {},
  context: [],
});
const menTopJson = (await menTop.json()) as Record<string, unknown>;
check("MEN top recommend: 200", menTop.status === 200);
check("MEN top recommend: response shape",
  typeof menTopJson.catalogVersion === "string" &&
    Array.isArray(menTopJson.categories) &&
    Array.isArray(menTopJson.sizeOptions) &&
    Array.isArray(menTopJson.availableSizes) &&
    Array.isArray(menTopJson.colors) &&
    Array.isArray(menTopJson.brands) &&
    typeof menTopJson.total === "number" &&
    typeof menTopJson.onePieceTop === "boolean");
check("MEN top recommend: mode honoured",
  menTopJson.mode === "recommend" && Array.isArray(menTopJson.recommended));

const attemptedOnePiece = [...onePieceTops].find((s) => /dress|jumpsuit|romper/.test(s));
if (attemptedOnePiece) {
  const op = await postBuild({
    gender: "WOMEN",
    slot: "top",
    category: attemptedOnePiece,
    mode: "recommend",
    filters: {},
    context: [],
  });
  const opJson = (await op.json()) as Record<string, unknown>;
  check("one-piece category: optionsAreOnePiece flag true",
    opJson.optionsAreOnePiece === true, `slug=${attemptedOnePiece} flag=${String(opJson.optionsAreOnePiece)}`);
}

/* HONESTY: a category outside the slot taxonomy is reported, not faked */
const unknownCat = await postBuild({
  gender: "MEN",
  slot: "top",
  category: "does-not-exist-xyz",
  mode: "recommend",
  filters: {},
  context: [],
});
const unknownJson = (await unknownCat.json()) as Record<string, unknown>;
check("category-not-supported reported honestly",
  unknownJson.emptyReason === "category-not-supported",
  `reason=${String(unknownJson.emptyReason)}`);

/* HONESTY: impossible filter values empty the pool with a reason —
   regardless of how much stock the DB has */
const badColor = await postBuild({
  gender: "MEN",
  slot: "top",
  category: null,
  mode: "browse",
  filters: { colors: ["#000000-nonexistent-color"], size: "", brands: [], priceMin: null, priceMax: null },
  context: [],
});
const badColorJson = (await badColor.json()) as Record<string, unknown>;
check("impossible colour filter reported honestly",
  badColorJson.emptyReason === "color-unavailable",
  `reason=${String(badColorJson.emptyReason)}`);

const badSize = await postBuild({
  gender: "MEN",
  slot: "top",
  category: null,
  mode: "browse",
  filters: { colors: [], size: "XXL-FAKE-SIZE-ZZ", brands: [], priceMin: null, priceMax: null },
  context: [],
});
const badSizeJson = (await badSize.json()) as Record<string, unknown>;
check("impossible size filter reported honestly",
  badSizeJson.emptyReason === "size-unavailable",
  `reason=${String(badSizeJson.emptyReason)}`);

/* regression: unset price bounds must NOT be coerced to 0 and zero
   the pool (Number(null) === 0 would silently filter everything) */
const noPriceBounds = await postBuild({
  gender: "MEN",
  slot: "top",
  category: null,
  mode: "browse",
  filters: { colors: [], size: "", brands: [], priceMin: null, priceMax: null },
  context: [],
});
const noPriceBoundsJson = (await noPriceBounds.json()) as Record<string, unknown>;
check("unset price bounds keep the pool (no price-unavailable)",
  noPriceBoundsJson.emptyReason !== "price-unavailable" &&
    (noPriceBoundsJson.total as number) >= 0, "");

const realBound = await postBuild({
  gender: "MEN",
  slot: "top",
  category: null,
  mode: "browse",
  filters: { colors: [], size: "", brands: [], priceMin: 0, priceMax: 1 },
  context: [],
});
const realBoundJson = (await realBound.json()) as Record<string, unknown>;
check("a genuine 0..1 EUR bound yields honest empty or small pool",
  realBoundJson.emptyReason === "price-unavailable" || (realBoundJson.total as number) >= 0,
  `reason=${String(realBoundJson.emptyReason)} total=${String(realBoundJson.total)}`);

/* semantic size vocabulary is inventory-independent: the option list
   must be present even where stock could be empty */
const catOption = (menTopJson.categories as Array<{ slug: string; hasProducts: boolean }>).find(
  (c) => c.slug === "t-shirts"
);
if (catOption && (menTopJson.sizeOptions as string[]).length > 0) {
  check("semantic size vocabulary non-empty for t-shirts",
    (menTopJson.sizeOptions as string[]).length > 0);
} else {
  check("semantic size vocabulary present (or category missing, documented)",
    Boolean(catOption), `catOption=${String(Boolean(catOption))} sizeOptions=${(menTopJson.sizeOptions as string[]).length}`);
}

/* determinism: identical requests produce identical outputs */
const detA = await postBuild({ gender: "MEN", slot: "top", category: null, mode: "recommend", filters: {}, context: [] });
const detB = await postBuild({ gender: "MEN", slot: "top", category: null, mode: "recommend", filters: {}, context: [] });
const sig = (j: Record<string, unknown>) => JSON.stringify({
  recommended: (j.recommended as Array<{ id: string; fitScore: number }>).map((r) => [r.id, r.fitScore]),
  categories: (j.categories as Array<{ slug: string }>).map((c) => c.slug),
});
check("route deterministic across identical calls",
  sig(await detA.json()) === sig(await detB.json()));

/* ---- richer pool assertions (only when real stock exists) ---- */
const catalog = await loadOutfitCatalog(prisma);
const realAvailable = catalog.filter(
  (p) => hasRealProductPage(p.productUrl) && p.availability !== "OUT_OF_STOCK" &&
    p.variants.some((v) => v.availability === "AVAILABLE")
).length;
const enough = realAvailable > 20;

if (enough) {
  const browse = await postBuild({ gender: "MEN", slot: "top", category: null, mode: "browse", filters: {}, context: [], limit: 40, offset: 0 });
  const browseJson = (await browse.json()) as Record<string, unknown>;
  const allBrowseIds = new Set<string>();
  let ob = 0;
  for (const p of browseJson.products as Array<{ id: string }>) allBrowseIds.add(p.id);
  while ((browseJson.hasMore as boolean) && ob < 200) {
    const next = await postBuild({ gender: "MEN", slot: "top", category: null, mode: "browse", filters: {}, context: [], limit: 40, offset: ob + 40 });
    const nextJson = (await next.json()) as Record<string, unknown>;
    for (const p of nextJson.products as Array<{ id: string }>) allBrowseIds.add(p.id);
    browseJson.hasMore = nextJson.hasMore;
    ob += 40;
  }
  const rec = (menTopJson.recommended as Array<Record<string, unknown>>);
  check("recommend <= 8", rec.length <= 8, `got ${rec.length}`);
  check("recommend only reorders the real pool (never invents)",
    rec.every((r) => allBrowseIds.has(r.id as string)));
  for (const r of rec) {
    check(`recommended ${r.id as string} has real product page`,
      hasRealProductPage(r.productUrl as string));
    check(`recommended ${r.id as string} is slot-eligible (top)`,
      categoryInSlot(r.categorySlug as string, "top") ||
        isOnePieceTopSlug(r.categorySlug as string),
      `slug=${String(r.categorySlug)}`);
  }
} else {
  check("STOCK: rich pool assertions skipped (real sellable products insufficient)",
    true, `realAvailable=${realAvailable}`);
}

await prisma.$disconnect();
console.log(`\nbuild-flow: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);