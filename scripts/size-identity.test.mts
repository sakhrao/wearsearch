/* Stage 3-B Size-identity unit guard (F19b + audience context).

   Pure fixture test - imports the real pipeline directly, never
   touches /api/meta or the live catalog. Locks the explicit
   prohibitions of the approved design:

     - identity = audience | productType | system | value;
     - EU 42 never matches US 42 (system is part of the identity);
     - a MEN-size chip never keeps WOMEN products (and vice versa);
     - UNISEX folds into MEN/WOMEN columns only - never KIDS;
     - a KIDS-selected size never matches UNISEX products;
     - a single-audience window renders one column with NO heading;
     - chips/counts come only from the products passed in (Load more
       adds sizes only when new products actually carry them);
     - the legacy bare-value match survives for the server facet
       block equivalence (o4), so the wire stays byte-identical.

   Usage: npx tsx scripts/size-identity.test.mts */

import {
  AUDIENCE_DISPLAY_LABELS,
  SIZE_SECTION_ORDER,
  buildSizeSectionColumns,
  normalizeAudience,
  parseSizeIdentity,
  productSizeTriples,
  sizeIdentity,
  type SizeSectionColumn,
} from "../src/lib/size-sections";
import {
  countProductsForFacetValue,
  productMatchesFilters,
  type ActiveFacetFilters,
  type FacetProduct,
} from "../src/lib/search-facets";

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

function sized(
  system: string | null | undefined,
  value: string
): {
  color: null;
  size: { value: string; system: string | null };
} {
  return { color: null, size: { value, system: system ?? null } };
}

function prod(
  gender: string | null,
  category: string,
  variants: ReturnType<typeof sized>[] | null
): FacetProduct {
  return {
    gender,
    category: { id: category, name: category },
    brand: { id: "b", name: "B" },
    variants: variants ?? [],
  };
}

function filters(
  size: string[]
): ActiveFacetFilters {
  return {
    gender: new Set(),
    category: new Set(),
    color: new Set(),
    size: new Set(size),
    brand: new Set(),
  };
}

const EMPTY = filters([]);

const identityOf = (
  columns: SizeSectionColumn[],
  label: string
): string | null => {
  for (const column of columns) {
    const chip = column.chips.find((c) => c.value === label);
    if (chip) return chip.identity;
  }
  return null;
};

/* I1. identity format + round trip -------------------------------- */
{
  const id = sizeIdentity("MEN", "shoes", "EU", "42");
  const parts = parseSizeIdentity(id);
  check(
    "I1 identity serializes as audience|productType|system|value",
    id === "MEN|shoes|EU|42" &&
      parts?.audience === "MEN" &&
      parts.productType === "shoes" &&
      parts.system === "EU" &&
      parts.value === "42",
    `id=${id} parts=${JSON.stringify(parts)}`
  );

  const nullSystem = parseSizeIdentity(
    sizeIdentity("WOMEN", "clothing", null, "M")
  );
  check(
    "I1 a null system round-trips back to null (NONE sentinel)",
    nullSystem?.system === null,
    JSON.stringify(nullSystem)
  );
}

/* I2. EU 42 != US 42 (same audience) ------------------------------- */
{
  const columns = buildSizeSectionColumns([
    prod("MEN", "Sneakers", [sized("EU", "42"), sized("US", "42")]),
  ]);
  const eu: string = identityOf(columns["shoes-eu"], "42") ?? "NONE";
  const us: string = identityOf(columns["shoes-us"], "42") ?? "NONE";

  const euBoxed = eu === "MEN|shoes|EU|42";
  const usBoxed = us === "MEN|shoes|US|42";
  const euVsUs = eu !== us;

  check(
    "I2 EU42 and US42 are distinct chips with distinct identities",
    euBoxed && usBoxed && euVsUs,
    `eu=${eu} us=${us}`
  );

  const euProduct = prod("MEN", "Sneakers", [sized("EU", "42")]);
  const usProduct = prod("MEN", "Sneakers", [sized("US", "42")]);
  check(
    "I2 selecting MEN|shoes|EU|42 keeps EU42, drops US42 product",
    productMatchesFilters(euProduct, filters(["MEN|shoes|EU|42"])) ===
        true &&
      productMatchesFilters(usProduct, filters(["MEN|shoes|EU|42"])) ===
        false,
    `eu=${productMatchesFilters(euProduct, filters(["MEN|shoes|EU|42"]))} us=${productMatchesFilters(usProduct, filters(["MEN|shoes|EU|42"]))}`
  );
}

/* I3. MEN 42 never keeps WOMEN 42 -------------------------------- */
{
  const men = prod("MEN", "Sneakers", [sized("EU", "42")]);
  const women = prod("WOMEN", "Sneakers", [sized("EU", "42")]);

  const columns = buildSizeSectionColumns([men, women]);
  const menCol = columns["shoes-eu"].find((c) => c.audience === "MEN");
  const womenCol = columns["shoes-eu"].find((c) => c.audience === "WOMEN");

  check(
    "I3 MEN+WOMEN window splits the EU section into two columns",
    menCol?.chips.map((c) => c.identity).join(",") ===
        "MEN|shoes|EU|42" &&
      womenCol?.chips.map((c) => c.identity).join(",") ===
        "WOMEN|shoes|EU|42",
    `men=${JSON.stringify(menCol)} women=${JSON.stringify(womenCol)}`
  );

  check(
    "I3 selecting MEN|shoes|EU|42 keeps MEN, drops WOMEN product",
    productMatchesFilters(men, filters(["MEN|shoes|EU|42"])) ===
        true &&
      productMatchesFilters(women, filters(["MEN|shoes|EU|42"])) ===
        false,
    "men match + women miss"
  );
  check(
    "I3 selecting WOMEN|shoes|EU|42 keeps WOMEN, drops MEN product",
    productMatchesFilters(women, filters(["WOMEN|shoes|EU|42"])) ===
        true &&
      productMatchesFilters(men, filters(["WOMEN|shoes|EU|42"])) ===
        false,
    "women match + men miss"
  );
}

/* I4. UNISEX folds into MEN/WOMEN, never KIDS -------------------- */
{
  const men41 = prod("MEN", "Sneakers", [sized("EU", "41")]);
  const unisex45 = prod("UNISEX", "Sneakers", [sized("EU", "45")]);
  const women42 = prod("WOMEN", "Sneakers", [sized("EU", "42")]);
  const kids43 = prod("KIDS", "Sneakers", [sized("EU", "43")]);

  const columns = buildSizeSectionColumns([
    men41,
    unisex45,
    women42,
    kids43,
  ]);
  const eu = columns["shoes-eu"];
  const menCol = eu.find((c) => c.audience === "MEN");
  const womenCol = eu.find((c) => c.audience === "WOMEN");
  const kidsCol = eu.find((c) => c.audience === "KIDS");

  check(
    "I4 unisex EU45 appears in BOTH the MEN and WOMEN columns",
    menCol?.chips.some((c) => c.value === "45") === true &&
      womenCol?.chips.some((c) => c.value === "45") === true,
    `men=${JSON.stringify(menCol)} women=${JSON.stringify(womenCol)}`
  );
  check(
    "I4 unisex EU45 does NOT appear in the KIDS column",
    kidsCol?.chips.some((c) => c.value === "45") === false,
    JSON.stringify(kidsCol)
  );

  check(
    "I4 MEN|shoes|EU|41 is not shown in the WOMEN column",
    womenCol?.chips.some((c) => c.value === "41") === false &&
      menCol?.chips.some((c) => c.value === "41") === true,
    `men=${JSON.stringify(menCol)} women=${JSON.stringify(womenCol)}`
  );

  check(
    "I4 selecting MEN|shoes|EU|45 matches the UNISEX product",
    productMatchesFilters(
      unisex45,
      filters(["MEN|shoes|EU|45"])
    ) === true,
    "unisex 45 should fold into the MEN selection"
  );
  check(
    "I4 selecting KIDS|shoes|EU|45 never matches the UNISEX product",
    productMatchesFilters(
      unisex45,
      filters(["KIDS|shoes|EU|45"])
    ) === false,
    "unisex must not fold into KIDS"
  );
  check(
    "I4 selecting KIDS|shoes|EU|43 matches the KIDS product only",
    productMatchesFilters(kids43, filters(["KIDS|shoes|EU|43"])) ===
        true &&
      productMatchesFilters(
        women42,
        filters(["KIDS|shoes|EU|43"])
      ) === false,
    "kids-only enforcement"
  );
}

/* I5. truthful counts on folded identities ------------------------ */
{
  const pool = [
    prod("MEN", "Sneakers", [sized("EU", "42")]),
    prod("UNISEX", "Sneakers", [sized("EU", "42")]),
    prod("WOMEN", "Sneakers", [sized("EU", "42")]),
  ];
  const menCount = countProductsForFacetValue(
    "size",
    "MEN|shoes|EU|42",
    EMPTY,
    pool
  );
  const womenCount = countProductsForFacetValue(
    "size",
    "WOMEN|shoes|EU|42",
    EMPTY,
    pool
  );
  const kidsCount = countProductsForFacetValue(
    "size",
    "KIDS|shoes|EU|42",
    EMPTY,
    pool
  );

  check(
    "I5 MEN column counts MEN+UNISEX (2), WOMEN counts WOMEN+UNISEX (2)",
    menCount === 2 && womenCount === 2,
    `men=${menCount} women=${womenCount}`
  );
  check(
    "I5 KIDS count is 0 (no kids product, unisex never folds there)",
    kidsCount === 0,
    `kids=${kidsCount}`
  );
}

/* I6. clothing gender separation (same alpha value) --------------- */
{
  const men = prod("MEN", "T-Shirts", [sized("INTERNATIONAL", "M")]);
  const women = prod("WOMEN", "T-Shirts", [sized("INTERNATIONAL", "M")]);
  const columns = buildSizeSectionColumns([men, women]);

  check(
    "I6 clothing section splits MEN/WOMEN on the same alpha value",
    identityOf(columns.clothing, "M") ===
        "MEN|clothing|INTERNATIONAL|M" &&
      columns.clothing.find((c) => c.audience === "WOMEN")?.chips[0]
        ?.identity === "WOMEN|clothing|INTERNATIONAL|M",
    JSON.stringify(columns.clothing)
  );
  check(
    "I6 MEN clothing-M chip does not keep the WOMEN clothing-M product",
    productMatchesFilters(men, filters(["MEN|clothing|INTERNATIONAL|M"])) ===
        true &&
      productMatchesFilters(
        women,
        filters(["MEN|clothing|INTERNATIONAL|M"])
      ) === false,
    "men match + women miss"
  );
}

/* I7. single-audience window has one column, no heading ------------ */
{
  const columns = buildSizeSectionColumns([
    prod("WOMEN", "Sneakers", [sized("EU", "39"), sized("EU", "40")]),
  ]);
  check(
    "I7 a single WOMEN window yields one heading-less column",
    columns["shoes-eu"].length === 1,
    JSON.stringify(columns["shoes-eu"])
  );

  const onlyUnisex = buildSizeSectionColumns([
    prod("UNISEX", "Sneakers", [sized("EU", "42")]),
  ]);
  check(
    "I7 an only-UNISEX window stays heading-less with UNISEX identity",
    onlyUnisex["shoes-eu"].length === 1 &&
      identityOf(onlyUnisex["shoes-eu"], "42") ===
        "UNISEX|shoes|EU|42",
    JSON.stringify(onlyUnisex["shoes-eu"])
  );
  check(
    "I7 selecting UNISEX|shoes|EU|42 matches the UNISEX product",
    productMatchesFilters(
      prod("UNISEX", "Sneakers", [sized("EU", "42")]),
      filters(["UNISEX|shoes|EU|42"])
    ) === true,
    "unisex identity must match unisex products"
  );
}

/* I8. null-gender products keep their own UNKNOWN identity --------- */
{
  const unknown = prod(null, "T-Shirts", [sized("INTERNATIONAL", "M")]);
  const women = prod("WOMEN", "T-Shirts", [sized("INTERNATIONAL", "M")]);
  const columns = buildSizeSectionColumns([unknown, women]);

  check(
    "I8 a WOMEN window never shows the UNKNOWN chip as a WOMEN chip",
    columns.clothing.length === 1 &&
      columns.clothing[0].audience === "WOMEN" &&
      columns.clothing[0].chips.some(
        (c) => c.identity.startsWith("UNKNOWN|")
      ) === false,
    JSON.stringify(columns.clothing)
  );
  check(
    "I8 an only-null-gender window shows the UNKNOWN identity chip",
    buildSizeSectionColumns([unknown]).clothing[0].chips[0]
      ?.identity === "UNKNOWN|clothing|INTERNATIONAL|M",
    JSON.stringify(buildSizeSectionColumns([unknown]).clothing)
  );
  check(
    "I8 UNKNOWN chip matches the null-gender product, not women",
    productMatchesFilters(
      unknown,
      filters(["UNKNOWN|clothing|INTERNATIONAL|M"])
    ) === true &&
      productMatchesFilters(
        women,
        filters(["UNKNOWN|clothing|INTERNATIONAL|M"])
      ) === false,
    "unknown-only match"
  );
}

/* I9. Load more: new sizes appear only when new products carry them */
{
  const first = [prod("WOMEN", "T-Shirts", [sized("INTERNATIONAL", "S")])];
  const appended = [
    ...first,
    prod("WOMEN", "T-Shirts", [sized("INTERNATIONAL", "XL")]),
    prod("WOMEN", "Jeans", [sized("INTERNATIONAL", "30")]),
  ];

  const before = buildSizeSectionColumns(first)
    .clothing.flatMap((c) => c.chips)
    .map((c) => c.value);
  const after = buildSizeSectionColumns(appended)
    .clothing.flatMap((c) => c.chips)
    .map((c) => c.value);

  check(
    "I9 appending products only adds sizes they actually carry",
    JSON.stringify(before) === JSON.stringify(["S"]) &&
      JSON.stringify(after) === JSON.stringify(["S", "XL", "30"]),
    `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`
  );
  check(
    "I9 the appended size gets a truthful count >=1 in the window",
    countProductsForFacetValue(
      "size",
      "WOMEN|clothing|INTERNATIONAL|XL",
      EMPTY,
      appended
    ) === 1,
    "XL count over appended window"
  );
}

/* I10. legacy bare-value semantics survive (server-block contract) */
{
  const product = prod("UNISEX", "Hoodies", [sized(null, "XL")]);
  check(
    "I10 old bare-value size match still holds for server-block equivalence",
    productMatchesFilters(product, filters(["XL"])) === true,
    "bare XL must still match (o4 legacy path)"
  );
}

/* I11. displayed values and headings derive from products only ----- */
{
  const pool = [
    prod("WOMEN", "Heels", [sized("US", "7"), sized("US", "8")]),
  ];
  const columns = buildSizeSectionColumns(pool);
  const chips = columns["shoes-us"].flatMap((c) => c.chips);

  check(
    "I11 chips are exactly the values the products own (no ranges)",
    chips.length === 2 &&
      chips.map((c) => c.value).sort().join(",") === "7,8",
    JSON.stringify(chips)
  );
  check(
    "I11 all five section labels still have display mappings",
    SIZE_SECTION_ORDER.length === 5 &&
      AUDIENCE_DISPLAY_LABELS.MEN === "Men" &&
      AUDIENCE_DISPLAY_LABELS.WOMEN === "Women" &&
      AUDIENCE_DISPLAY_LABELS.KIDS === "Kids" &&
      AUDIENCE_DISPLAY_LABELS.UNISEX === "Unisex",
    JSON.stringify(AUDIENCE_DISPLAY_LABELS)
  );
  check(
    "I11 normalizeAudience maps missing gender to UNKNOWN",
    normalizeAudience(null) === "UNKNOWN" &&
      normalizeAudience("WOMEN") === "WOMEN",
    normalizeAudience(null)
  );
}

/* I12. productSizeTriples matches the identity triple parts -------- */
{
  const triples = productSizeTriples(
    prod("MEN", "Boots", [sized("EU", "42")])
  );
  check(
    "I12 productSizeTriples exposes (productType, system, value)",
    triples.length === 1 &&
      triples[0].productType === "shoes" &&
      triples[0].system === "EU" &&
      triples[0].value === "42",
    JSON.stringify(triples)
  );
}

console.log(
  `\nSize-identity unit: ${passed} passed, ${failed} failed`
);
process.exit(failed === 0 ? 0 : 1);