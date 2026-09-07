/* FitWear phase semantics regression tests (pure, no DB/network).

   Locks the semantic-first guarantees that make the questionnaire work
   as if the catalog had millions of products:

     - category gender compatibility never depends on inventory
       (shared-catalog default, UNISEX expansion, data-only KIDS);
     - every category exposes a real standard size vocabulary
       (shoes numeric by system, bras bra-sized, accessories One Size,
       clothing letters) with no invented kids scale;
     - "Anything else" detail options are context-aware and every
       option carries a real search mapping.

   Run: npx tsx scripts/fitwear-semantics.test.mts */
import { mergeCategoryGenders } from "../src/lib/catalog/category-display";
import type { CategoryGender } from "../src/lib/catalog/category-display";
import { semanticSizeRowsFor } from "../src/lib/catalog/size-vocabulary";
import { buildSizeCatalog, sizeSectionsFor } from "../src/lib/sizes";
import { detailOptionGroupsFor } from "../src/lib/catalog/detail-options";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name} :: ${detail}`);
  }
}

const eq = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/* ---------- 1. mergeCategoryGenders: semantic-first ---------- */
{
  const merged = (
    plan: string[],
    product: string[],
    isLegacy = false
  ): ReturnType<typeof mergeCategoryGenders> =>
    mergeCategoryGenders({
      planGenders: new Set(plan as CategoryGender[]),
      productGenders: new Set(product as CategoryGender[]),
      isLegacy,
    });

  check(
    "shared default: no signal -> MEN+WOMEN+UNISEX",
    eq(merged([], []), ["MEN", "WOMEN", "UNISEX"])
  );
  check(
    "shared default never adds KIDS",
    merged([], []).includes("KIDS") === false
  );
  check(
    "legacy no-signal keeps conservative default",
    eq(merged([], [], true), ["MEN", "WOMEN", "UNISEX"])
  );
  check(
    "women-only plan stays WOMEN-only",
    eq(merged(["WOMEN"], []), ["WOMEN"])
  );
  check(
    "adult-shared plan -> MEN+WOMEN (UNISEX comes from the plan tokens)",
    eq(merged(["MEN", "WOMEN"], []), ["MEN", "WOMEN"])
  );
  check(
    "UNISEX-only stock expands to both adult audiences",
    eq(merged([], ["UNISEX"]), ["MEN", "WOMEN", "UNISEX"])
  );
  check(
    "kids-only stock stays kids-only (no adult default)",
    eq(merged([], ["KIDS"]), ["KIDS"])
  );
  check(
    "women plan + kids stock -> WOMEN+KIDS",
    eq(merged(["WOMEN"], ["KIDS"]), ["WOMEN", "KIDS"])
  );
}

/* ---------- 2. semanticSizeRowsFor: per-category vocabulary ---------- */
{
  const cat = (slug: string, name: string, rootSlug: string, group: string) =>
    ({ slug, name, rootSlug, group });

  /* Bras -> bra sizes; the merged genders for a women-only plan are
     WOMEN (see the first section), so rows must be WOMEN only. */
  const braRows = semanticSizeRowsFor(
    cat("bras", "Bras", "clothing", "Swimwear & Basics"),
    ["WOMEN"]
  );
  check(
    "bras give bra sizes (band+cup)",
    braRows.some((r) => r.value === "36B"),
    JSON.stringify(braRows.map((r) => r.value))
  );
  check(
    "bras never offer plain letters",
    braRows.some((r) => /^[XSML]+$/.test(r.value)) === false
  );
  check(
    "bras rows are WOMEN-only + CLOTHING",
    braRows.every(
      (r) => r.audience === "WOMEN" && r.productType === "CLOTHING"
    )
  );

  /* Sneakers -> FOOTWEAR numeric EU/US/UK, per-audience rings. */
  const shoeRows = semanticSizeRowsFor(
    cat("sneakers", "Sneakers", "shoes", "Shoes"),
    ["MEN", "WOMEN", "UNISEX"]
  );
  check(
    "shoes are FOOTWEAR numeric",
    shoeRows.every((r) => r.productType === "FOOTWEAR")
  );
  check(
    "shoes carry EU/US/UK systems",
    eq(
      new Set(shoeRows.map((r) => r.system)),
      new Set(["EU", "US", "UK"])
    )
  );
  const menEU = shoeRows.filter(
    (r) => r.audience === "MEN" && r.system === "EU"
  );
  const womenEU = shoeRows.filter(
    (r) => r.audience === "WOMEN" && r.system === "EU"
  );
  check(
    "men's EU ring is wider than women's",
    menEU.length > 0 &&
      womenEU.length > 0 &&
      menEU.some((r) => r.value === "46") &&
      womenEU.some((r) => r.value === "36")
  );

  /* Watches (Accessories) -> One Size, both adult audiences. */
  const watchRows = semanticSizeRowsFor(
    cat("watches", "Watches", "accessories", "Accessories"),
    ["MEN", "WOMEN", "UNISEX"]
  );
  check(
    "accessories are One Size",
    watchRows.every((r) => r.value === "One Size"),
    JSON.stringify(watchRows.map((r) => r.value))
  );
  check(
    "accessories rows cover MEN and WOMEN",
    watchRows.some((r) => r.audience === "MEN") &&
      watchRows.some((r) => r.audience === "WOMEN")
  );

  /* Headwear -> letter sizes + One Size. */
  const hatRows = semanticSizeRowsFor(
    cat("beanies", "Beanies", "headwear", "Headwear"),
    ["MEN", "WOMEN"]
  );
  check(
    "headwear gives S/M/L/XL + One Size",
    eq(
      new Set(hatRows.map((r) => r.value)),
      new Set(["S", "M", "L", "XL", "One Size"])
    ),
    JSON.stringify([...new Set(hatRows.map((r) => r.value))])
  );

  /* T-Shirts -> clothing letters. */
  const teeRows = semanticSizeRowsFor(
    cat("t-shirts", "T-Shirts", "clothing", "Tops"),
    ["MEN", "WOMEN", "UNISEX"]
  );
  check(
    "clothing gives letter sizes",
    teeRows.some((r) => r.value === "M") &&
      teeRows.some((r) => r.value === "2XL")
  );
  check(
    "clothing rows never purely numeric (2XL is a letter size)",
    teeRows.every((r) => !/^\d+(\.\d+)?$/.test(r.value))
  );

  /* Kids are never invented. */
  check(
    "kids-only audience yields no semantic rows",
    semanticSizeRowsFor(
      cat("t-shirts", "T-Shirts", "clothing", "Tops"),
      ["KIDS"]
    ).length === 0
  );
}

/* ---------- 3. semantic rows merge into the size catalog ---------- */
{
  const teeRows = semanticSizeRowsFor(
    { slug: "t-shirts", name: "T-Shirts", rootSlug: "clothing", group: "Tops" },
    ["MEN", "WOMEN"]
  );
  const catalog = buildSizeCatalog(teeRows);
  const sections = sizeSectionsFor({
    audience: "MEN",
    categoryName: "T-Shirts",
    catalog,
  });
  check(
    "semantic letters surface as one CLOTHING section",
    sections.length === 1 &&
      sections[0].productType === "CLOTHING" &&
      sections[0].values.includes("M") &&
      sections[0].values.includes("XS"),
    JSON.stringify(sections)
  );

  const shoeCatalog = buildSizeCatalog(
    semanticSizeRowsFor(
      { slug: "sneakers", name: "Sneakers", rootSlug: "shoes", group: "Shoes" },
      ["MEN"]
    )
  );
  const shoeSections = sizeSectionsFor({
    audience: "MEN",
    categoryName: "Sneakers",
    catalog: shoeCatalog,
  });
  check(
    "shoe semantics split into EU/US/UK columns",
    shoeSections.length === 3 &&
      eq(
        shoeSections.map((s) => s.system),
        ["EU", "US", "UK"]
      ),
    JSON.stringify(shoeSections)
  );
}

/* ---------- 4. detail-options: context-aware + real mapping ---------- */
{
  const names = (ctx: Parameters<typeof detailOptionGroupsFor>[0]) =>
    detailOptionGroupsFor(ctx).map((g) => g.name);

  check(
    "shoes profile: Type/Material/Use",
    eq(names({ root: "Shoes", group: "Shoes", slug: "sneakers" }), [
      "Type",
      "Material",
      "Use",
    ])
  );
  check(
    "bras profile: Style/Material/Support",
    eq(names({ root: "Clothing", group: "Swimwear & Basics", slug: "bras" }), [
      "Style",
      "Material",
      "Support",
    ])
  );
  check(
    "scarves profile specializes",
    eq(names({ root: "Clothing", group: "Accessories", slug: "scarves-hijabs" }), [
      "Type",
      "Material",
      "Pattern",
    ])
  );
  check(
    "headwear profile: Type/Material/Coverage",
    eq(names({ root: "Headwear", group: "Headwear", slug: "caps" }), [
      "Type",
      "Material",
      "Coverage",
    ])
  );
  check(
    "general tops profile: Fit/Style/Material/Pattern",
    eq(names({ root: "Clothing", group: "Tops", slug: "t-shirts" }), [
      "Fit",
      "Style",
      "Material",
      "Pattern",
    ])
  );
  check(
    "sportswear profile leads with Use",
    eq(names({ root: "Clothing", group: "Sportswear", slug: "running-trainers" })[0], "Use")
  );
  const groups = detailOptionGroupsFor({
    root: "Shoes",
    group: "Shoes",
    slug: "sneakers",
  });
  check(
    "option values are real, non-empty words",
    groups.every((g) => g.values.length > 0)
  );
  check(
    "no options ever come out empty",
    detailOptionGroupsFor({
      root: "Clothing",
      group: null,
      slug: "cards",
    }).length > 0
  );
}

console.log(`\nfitness-semantics: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);