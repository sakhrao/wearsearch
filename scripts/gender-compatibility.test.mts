/* Canonical gender compatibility for the questionnaire ("Pick a
   category" / Build slots).

   Locks the inventory-independent category->gender contract:

     - category gender compatibility is CATEGORY METADATA declared in
       the canonical taxonomy, never derived from the import plan's
       listing-path tokens and never re-gendered by live stock;
     - every canonical leaf inherits the adult-shared default
       (Men + Women + Unisex) unless it is declared single-gender
       (Bras, Dresses, Skirts, Heels, Flats, Blouses, Leggings,
       Jumpsuits, Bodysuits, Sports Bras, Scarves & Hijabs and the
       ladies' bags: Handbags/Shoulder/Crossbody/Tote);
     - a single UNISEX or mis-tagged MEN product can NEVER widen a
       women-only leaf (Scarves & Hijabs must not appear for Men);
     - single-gender inventory can NEVER narrow a shared leaf
       (Trousers with only MEN stock still offers to WOMEN);
     - KIDS is data-driven only (from live KIDS stock);
     - legacy (DB-only) rows stay inventory-first (unchanged).

   Run: npx tsx scripts/gender-compatibility.test.mts */
import {
  canonicalCategoryDisplay,
  canonicalGendersForLeaf,
  genderCompatibilityFor,
  type CategoryGender,
} from "../src/lib/catalog/category-display";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`FAIL ${name} :: ${detail}`);
  }
}
const eq = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

const compat = (
  slug: string,
  productGenders: CategoryGender[] = [],
  source: "canonical" | "legacy" = "canonical"
): CategoryGender[] =>
  genderCompatibilityFor({
    slug,
    source,
    productGenders: new Set(productGenders),
  });

/* ---- 1. the shared categories must stay adult-shared for both ----
   (the categories the brief flags as wrongly single-gendered today) */
const SHARED = [
  "sneakers",
  "boots",
  "sandals",
  "loafers",
  "formal-shoes",
  "t-shirts",
  "tank-tops",
  "polos",
  "shirts",
  "cardigans",
  "sweatshirts",
  "hoodies",
  "jeans",
  "trousers",
  "chinos",
  "cargo",
  "joggers",
  "shorts",
  "underwear",
  "swimwear",
  "jackets",
  "coats",
  "blazers",
  "vests",
  "parkas",
  "puffer-jackets",
  "belts",
  "ties-bow-ties",
  "sunglasses",
  "watches",
  "jewelry",
  "wallets",
  "backpacks",
  "bum-bags",
  "duffle-travel-bags",
];
{
  for (const slug of SHARED) {
    check(
      `shared defaults to adult-shared: ${slug}`,
      eq(compat(slug), ["MEN", "WOMEN", "UNISEX"]),
      JSON.stringify(compat(slug))
    );
  }
}

/* ---- 2. women-only leaves stay WOMEN-only ----
   even when a UNISEX or MEN product sits in the category (this is the
   Scarves & Hijabs for Men bug) */
const WOMEN_ONLY = [
  "heels",
  "flats",
  "blouses",
  "bodysuits",
  "skirts",
  "leggings",
  "dresses",
  "jumpsuits",
  "sports-bras",
  "bras",
  "scarves-hijabs",
  "handbags",
  "shoulder-bags",
  "crossbody-bags",
  "tote-bags",
];
{
  for (const slug of WOMEN_ONLY) {
    check(
      `women-only leaf resolves WOMEN: ${slug}`,
      eq(compat(slug), ["WOMEN"]),
      JSON.stringify(compat(slug))
    );
  }
  /* the headline: a UNISEX scarf product must never widen it */
  check(
    "Scarves & Hijabs: UNISEX/MEN stock cannot widen to MEN",
    eq(compat("scarves-hijabs", ["UNISEX", "MEN"]), ["WOMEN"]) &&
      !compat("scarves-hijabs", ["UNISEX"]).includes("MEN"),
    JSON.stringify(compat("scarves-hijabs", ["UNISEX", "MEN"]))
  );
  check(
    "Bras: UNISEX stock cannot widen to MEN",
    !compat("bras", ["UNISEX"]).includes("MEN")
  );
  check(
    "Heels: women-only never MEN",
    !compat("heels", ["MEN"]).includes("MEN")
  );
}

/* ---- 3. inventory can never narrow or re-gender a shared leaf ---- */
{
  check(
    "Trousers: MEN-only stock still offers WOMEN",
    compat("trousers", ["MEN"]).includes("WOMEN"),
    JSON.stringify(compat("trousers", ["MEN"]))
  );
  check(
    "Shirts: WOMEN-only stock still offers MEN",
    compat("shirts", ["WOMEN"]).includes("MEN"),
    JSON.stringify(compat("shirts", ["WOMEN"]))
  );
  check(
    "Formal Shoes: MEN-only stock still offers WOMEN",
    compat("formal-shoes", ["MEN"]).includes("WOMEN")
  );
  check(
    "Watches: WOMEN-only stock still offers MEN",
    compat("watches", ["WOMEN"]).includes("MEN")
  );
}

/* ---- 4. KIDS is data-driven only ---- */
{
  check(
    "shared leaf never declares KIDS by default",
    !compat("t-shirts").includes("KIDS")
  );
  check(
    "women-only leaf never declares KIDS by default",
    !compat("bras").includes("KIDS")
  );
  check(
    "live KIDS stock adds KIDS to a shared leaf",
    eq(compat("t-shirts", ["KIDS"]), ["MEN", "WOMEN", "KIDS", "UNISEX"]),
    JSON.stringify(compat("t-shirts", ["KIDS"]))
  );
  check(
    "live KIDS stock adds KIDS to a women-only leaf",
    eq(compat("bras", ["KIDS"]), ["WOMEN", "KIDS"]),
    JSON.stringify(compat("bras", ["KIDS"]))
  );
}

/* ---- 5. legacy rows keep the conservative inventory-first rule ---- */
{
  check(
    "legacy empty -> adult-shared default",
    eq(compat("beanies", [], "legacy"), ["MEN", "WOMEN", "UNISEX"]),
    JSON.stringify(compat("beanies", [], "legacy"))
  );
  check(
    "legacy UNISEX stock expands to both adults",
    eq(compat("beanies", ["UNISEX"], "legacy"), ["MEN", "WOMEN", "UNISEX"]),
    JSON.stringify(compat("beanies", ["UNISEX"], "legacy"))
  );
  check(
    "legacy KIDS stock stays kids-scoped",
    eq(compat("hats", ["KIDS"], "legacy"), ["KIDS"])
  );
}

/* ---- 6. generic canonical-taxonomy contract ----
   every canonical leaf resolves a non-empty adult set from the
   declaration alone, and every declared exclusive leaf really is a
   canonical leaf (typo-proof the declaration against the taxonomy) */
{
  const canonical = canonicalCategoryDisplay();
  const slugs = new Set(canonical.map((c) => c.slug));
  check(
    "every declared women-only slug is a real canonical leaf",
    WOMEN_ONLY.every((s) => slugs.has(s)) &&
      WOMEN_ONLY.length > 0,
    WOMEN_ONLY.filter((s) => !slugs.has(s)).join(",")
  );
  check(
    "every declared shared slug is a real canonical leaf",
    SHARED.every((s) => slugs.has(s)) &&
      SHARED.length > 0,
    SHARED.filter((s) => !slugs.has(s)).join(",")
  );
  const unresolved = canonical.filter(
    (c) => compat(c.slug).length === 0
  );
  check(
    "every canonical leaf resolves non-empty adult genders",
    unresolved.length === 0,
    unresolved.map((c) => c.slug).join(",")
  );
  const kidsByDeclaration = canonical.filter((c) =>
    canonicalGendersForLeaf(c).includes("KIDS")
  );
  check(
    "no canonical leaf declares KIDS (data-driven only)",
    kidsByDeclaration.length === 0
  );
  const both = canonical.filter(
    (c) => compat(c.slug).includes("MEN") && compat(c.slug).includes("WOMEN")
  );
  check(
    "the broad shared surface reaches both adult audiences",
    both.length >= SHARED.length
  );
}

/* ---- 7. incompatible categories are never offered for a gender ---- */
{
  const menCompatible = (slug: string): boolean =>
    genderCompatibilityFor({
      slug,
      source: "canonical",
      productGenders: new Set<CategoryGender>(),
    }).includes("MEN");
  const womenCompatible = (slug: string): boolean =>
    genderCompatibilityFor({
      slug,
      source: "canonical",
      productGenders: new Set<CategoryGender>(),
    }).includes("WOMEN");

  check(
    "Scarves & Hijabs is NOT offered to MEN",
    !menCompatible("scarves-hijabs")
  );
  check(
    "Bras is NOT offered to MEN",
    !menCompatible("bras")
  );
  check(
    "Dresses are NOT offered to MEN",
    !menCompatible("dresses")
  );
  check(
    "Heels are NOT offered to MEN",
    !menCompatible("heels")
  );
  check(
    "Trousers ARE offered to WOMEN (shared)",
    womenCompatible("trousers")
  );
  check(
    "Formal Shoes ARE offered to WOMEN (shared)",
    womenCompatible("formal-shoes")
  );
  check(
    "Shirts ARE offered to both",
    menCompatible("shirts") && womenCompatible("shirts")
  );
  check(
    "Sunglasses ARE offered to both",
    menCompatible("sunglasses") && womenCompatible("sunglasses")
  );
  check(
    "Watches ARE offered to both",
    menCompatible("watches") && womenCompatible("watches")
  );
  check(
    "Ties ARE offered to both",
    menCompatible("ties-bow-ties") && womenCompatible("ties-bow-ties")
  );
  check(
    "Cardigans ARE offered to both",
    menCompatible("cardigans") && womenCompatible("cardigans")
  );
  check(
    "Vests ARE offered to both",
    menCompatible("vests") && womenCompatible("vests")
  );
}

console.log(`\ngender-compatibility: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);