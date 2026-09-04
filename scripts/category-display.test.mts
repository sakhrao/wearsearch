/* Questionnaire "Pick a category" taxonomy tests (Phase 4 fix).

   Verifies that the questionnaire category list is built from the shared
   canonical taxonomy (import-plan via category-display) merged with legacy
   DB-only categories - meeting the 18 requirements of the UI fix. Pure:
   no DB, no network. Uses the real 40-row DB category state as a fixture.

   Run: npx tsx scripts/category-display.test.mts
*/

import {
  buildQuestionnaireCategories,
  canonicalCategoryDisplay,
  type CategoryDisplay,
} from "../src/lib/catalog/category-display";
import { CATEGORY_PLANS, PLAN_LEAF_CATEGORIES } from "../src/lib/catalog/import-plan";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

/* ---- Fixture: the exact DB category rows observed locally ---- */
const DB_PARENT: Record<string, string | null> = {
  accessories: null, beanies: "Headwear", belts: "Accessories", blouses: "Tops",
  boots: "Shoes", bottoms: "Clothing", "button-ups": "Tops", caps: "Headwear",
  cardigans: "Tops", cargo: "Bottoms", chinos: "Bottoms", clothing: null,
  "formal-shoes": "Shoes", hats: "Headwear", headwear: null, heels: "Shoes",
  hoodies: "Tops", jackets: "Tops", jeans: "Bottoms", joggers: "Bottoms",
  jumpers: "Tops", leggings: "Bottoms", loafers: "Shoes", polos: "Tops",
  "running-trainers": "Shoes", sandals: "Shoes", shirts: "Tops", shoes: null,
  shorts: "Bottoms", sneakers: "Shoes", socks: "Bottoms", sunglasses: "Accessories",
  sweatshirts: "Tops", "t-shirts": "Tops", "tank-tops": "Tops", ties: "Accessories",
  tops: "Clothing", trousers: "Bottoms", underwear: "Bottoms", watches: "Accessories",
};

const dbRows = Object.entries(DB_PARENT).map(([slug, parentName]) => ({
  slug,
  name: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
  id: `id-${slug}`,
  parentName,
}));

/* Mark some categories as stocking products (ids are the fixture ids). */
const usedProductCategoryIds = new Set<string>([
  "id-t-shirts",
  "id-sneakers",
  "id-jeans",
]);

const list = buildQuestionnaireCategories({ dbRows, usedProductCategoryIds });
const bySlug = new Map(list.map((c) => [c.slug, c]));

/* ---- 1. every canonical leaf appears in the questionnaire ---- */
const canonicalLeaves = PLAN_LEAF_CATEGORIES.map((l) => l.slug);
{
  const missing = canonicalLeaves.filter((s) => !bySlug.has(s));
  check("1. every canonical leaf appears", missing.length === 0, missing.join(","));
}

/* ---- 2. every PLANNED category also appears ---- */
{
  const plannedSlugs = CATEGORY_PLANS.filter((p) => p.phase === "planned").map((p) => p.slug);
  const missing = plannedSlugs.filter((s) => !bySlug.has(s));
  check("2. every PLANNED category appears",
    missing.length === 0 && plannedSlugs.length > 0, missing.join(","));
}

/* ---- 3. legacy DB-only categories still appear ---- */
const LEGACY = ["beanies", "caps", "hats", "button-ups", "jumpers", "running-trainers", "ties"];
{
  const missing = LEGACY.filter((s) => !bySlug.has(s));
  const legacyCount = list.filter((c) => c.source === "legacy").length;
  check("3. every legacy DB-only category preserved", missing.length === 0, missing.join(","));
  check("3. exactly 7 legacy categories", legacyCount === LEGACY.length, `got ${legacyCount}, expected ${LEGACY.length}`);
}

/* ---- 4. no duplicates ---- */
{
  const slugs = list.map((c) => c.slug);
  check("4. no duplicate options", new Set(slugs).size === slugs.length);
  const names = list.map((c) => c.name.toLowerCase());
  check("4. no duplicate names", new Set(names).size === names.length);
}

/* ---- 5. canonical hierarchy correct (root/subgroup per leaf) ---- */
const canonical = canonicalCategoryDisplay();
const canonicalBySlug = new Map(canonical.map((c) => [c.slug, c]));
{
  const t = canonicalBySlug.get("t-shirts")!;
  check("5. T-Shirts under Clothing->Tops", t.root === "Clothing" && t.subgroup === "Tops", JSON.stringify(t));
  const j = canonicalBySlug.get("jeans")!;
  check("5. Jeans under Clothing->Bottoms", j.root === "Clothing" && j.subgroup === "Bottoms");
  const sn = canonicalBySlug.get("sneakers")!;
  check("5. Sneakers under Shoes (no subgroup)", sn.root === "Shoes" && sn.subgroup === null, JSON.stringify(sn));
  const acc = canonicalBySlug.get("watches")!;
  check("5. Watches under Accessories (no subgroup)", acc.root === "Accessories" && acc.subgroup === null);
}

/* ---- 6-9. reparenting matches canonical taxonomy ---- */
{
  check("6. Jackets under Outerwear", canonicalBySlug.get("jackets")!.subgroup === "Outerwear");
  check("7. Dresses under Dresses & Jumpsuits", canonicalBySlug.get("dresses")!.subgroup === "Dresses & Jumpsuits");
  check("8. Hoodies under Tops", canonicalBySlug.get("hoodies")!.subgroup === "Tops");
  check("9. Leggings under Bottoms", canonicalBySlug.get("leggings")!.subgroup === "Bottoms");
}

/* ---- 10-12. clothing sub-groups + Accessories exist as roots ---- */
{
  const clothingSubs = new Set(canonical.filter((c) => c.root === "Clothing" && c.subgroup).map((c) => c.subgroup!));
  check("10. Sportswear exists", clothingSubs.has("Sportswear"));
  check("11. Swimwear & Basics exists", clothingSubs.has("Swimwear & Basics"));
  check("12. Accessories is a root branch", canonical.some((c) => c.root === "Accessories"));
}

/* ---- 13-15. Bags hierarchy, parent-not-leaf ---- */
const BAG_LEAVES = ["handbags", "backpacks", "shoulder-bags", "crossbody-bags", "duffle-travel-bags", "bum-bags", "tote-bags", "wallets"];
{
  check("13. Bags hierarchy present", BAG_LEAVES.every((s) => canonicalBySlug.get(s)?.subgroup === "Bags"));
  /* Bags itself is a parent, never a selectable leaf option */
  check("13. Bags parent is not a selectable leaf", !bySlug.has("bags"));
  check("14. all 8 bag leaves appear", BAG_LEAVES.every((s) => bySlug.has(s)));
  /* no bag leaf also appears as a legacy duplicate */
  check("14. bag leaves are canonical (not legacy)", BAG_LEAVES.every((s) => canonicalBySlug.get(s)?.source === "canonical"));
  check("15. Bags is not a duplicate selectable leaf", !(bySlug.has("bags")) && canonical.every((c) => c.slug !== "bags"));
}

/* ---- 16. legacy categories stay (re-checked via merge, incl. not moved) ---- */
{
  check("16. legacy names preserved (not renamed)",
    LEGACY.every((s) => bySlug.get(s)?.source === "legacy"));
  const ties = bySlug.get("ties")!;
  check("16. legacy 'Ties' distinct from canonical 'ties-bow-ties'",
    bySlug.has("ties-bow-ties") && ties.slug === "ties");
}

/* ---- 17. selecting a new leaf resolves within the questionnaire list ---- */
{
  const selectable = list.map((c) => c.name);
  const newLeaf = bySlug.get("handbags");
  check("17. new leaf selectable + resolves to Accessories", !!newLeaf && newLeaf.group === "Accessories" && selectable.includes("Handbags"));
}

/* ---- 18. size-semantic `group` labels are consistent (no import coupling) ---- */
{
  check("18. shoes leaves label 'Shoes'", canonicalBySlug.get("sneakers")!.group === "Shoes");
  check("18. accessories leaves label 'Accessories'", canonicalBySlug.get("watches")!.group === "Accessories");
  check("18. clothing leaves label their subgroup", canonicalBySlug.get("t-shirts")!.group === "Tops");
}
{
  /* a PLANNED leaf must be labelled+selectable even though not imported */
  const swim = bySlug.get("swimwear")!;
  const sung = bySlug.get("sunglasses")!;
  const body = bySlug.get("bodysuits")!;
  const pack = bySlug.get("backpacks")!;
  check("18. PLANNED categories visible in questionnaire",
    !!swim && !!sung && !!body && !!pack);
}

/* ---- hasProducts wiring (additive contract preserved) ---- */
{
  check("hasProducts true for a stocked category", bySlug.get("t-shirts")!.hasProducts === true);
  check("hasProducts false for an empty new category", bySlug.get("watches")!.hasProducts === false);
}

console.log(`\nCOUNT questionnaire categories=${list.length} canonical=${list.filter((c)=>c.source==="canonical").length} legacy=${list.filter((c)=>c.source==="legacy").length}`);
console.log(`===== category-display tests: ${passed} passed, ${failed} failed =====`);
process.exit(failed === 0 ? 0 : 1);
