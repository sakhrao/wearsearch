import {
  allowedCategoriesForAnchor,
  REAL_CATEGORIES,
  preferenceFor,
  slotTemplatesForCategory,
  groupOfCategory,
  slotOfCategory,
  isAllowed,
} from "../src/lib/outfit/category-rules";

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

/* The vocabulary is now DERIVED from the shared canonical taxonomy, so
   every allowed category must (a) live in the derived group vocabulary
   and (b) belong to the slot's own group. */
const ALL_KNOWN = new Set(Object.values(REAL_CATEGORIES).flat());

/* --- every matrix category must be a known taxonomy category --- */
const anchorSlugs = [
  "sneakers", "loafers", "heels", "sandals", "boots",
  "trousers", "jeans", "joggers", "leggings", "chinos",
  "t-shirts", "tank-tops", "blouses", "button-ups", "polos",
  "hoodies", "sweatshirts", "cardigans",
];
for (const anchor of anchorSlugs) {
  const allowed = allowedCategoriesForAnchor(anchor);
  for (const a of allowed) {
    check(`anchor=${anchor} allowed category ${a.category} is a known category`,
      ALL_KNOWN.has(a.category) && REAL_CATEGORIES[groupOfCategory(a.category)!]?.includes(a.category),
      a.category);
  }
  check(`anchor=${anchor} has a template`, slotTemplatesForCategory(anchor).length > 0);
}

/* --- one-piece categories never fill a slot (they are anchors only) --- */
const ONEPIECE = ["dresses", "jumpsuits", "bodysuits", "swimwear", "bras", "underwear"];
for (const anchor of anchorSlugs) {
  const categories = allowedCategoriesForAnchor(anchor).map((a) => a.category);
  for (const bad of ONEPIECE) {
    check(`anchor=${anchor} does NOT use one-piece ${bad} as a filler`,
      !categories.includes(bad));
  }
}

/* --- sanity: sneakers allows bottoms+top+layer+accessory (all real
   groups the footwear template declares) --- */
check("sneakers allows trousers as bottom",
  isAllowed("sneakers", "bottom", "trousers"));
check("sneakers allows t-shirts as top",
  isAllowed("sneakers", "top", "t-shirts"));
check("sneakers allows cardigans as layer",
  isAllowed("sneakers", "layer", "cardigans"));
check("sneakers allows belts as accessory",
  isAllowed("sneakers", "accessory", "belts"));
check("sneakers does NOT allow jeans as top",
  !isAllowed("sneakers", "top", "jeans"));
check("sneakers does NOT allow belts as bottom",
  !isAllowed("sneakers", "bottom", "belts"));
check("sneakers does NOT pair with another shoe",
  !isAllowed("sneakers", "footwear", "boots"));

/* --- preference is stable and bounded (rank within the group list) --- */
check("sneakers trousers bottom preference is bounded",
  preferenceFor("sneakers", "bottom", "trousers") >= 1 && preferenceFor("sneakers", "bottom", "trousers") < 99);
check("unrelated category preference=99 (not allowed)",
  preferenceFor("sneakers", "bottom", "belts") === 99);
check("belts preference is a finite rank, not 99",
  preferenceFor("sneakers", "accessory", "belts") < 99);

/* --- slotOfCategory mapping is consistent --- */
check("sneakers -> footwear slot", slotOfCategory("sneakers") === "footwear");
check("trousers -> bottom slot", slotOfCategory("trousers") === "bottom");
check("t-shirts -> top slot", slotOfCategory("t-shirts") === "top");
check("cardigans -> layer slot", slotOfCategory("cardigans") === "layer");

/* --- template: footwear anchor requires Bottom+Top, optional Layer/Accessory --- */
const ft = slotTemplatesForCategory("sneakers");
const req = ft.filter((t) => t.required).map((t) => t.slot).sort();
check("footwear anchor requires bottom+top",
  JSON.stringify(req) === JSON.stringify(["bottom", "top"]));

console.log(`\noutfit-category: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);