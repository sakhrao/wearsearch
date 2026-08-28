const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

const RATIO_KEYS = [
  "brand",
  "category",
  "color",
  "size",
  "gender",
  "budget",
  "attributes",
];

let passed = 0;
let failed = 0;

function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name} :: ${detail}`);
  }
}

async function search(q) {
  const res = await fetch(`${BASE_URL}/api/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for "${q}"`);
  return res.json();
}

function genderSet(products) {
  return new Set(products.map((p) => p.gender));
}

/* Spec §2/§12: explicit Men/Women/Kids admits UNISEX into Exact,
   ranked after same-gender products; hard isolation preserved
   (no WOMEN into MEN and vice versa). */

/* 1. men jeans -> Exact = MEN + UNISEX, never WOMEN */
{
  const d = await search("men jeans");
  const exactGenders = genderSet(d.exactProducts);
  check(
    "men jeans -> Exact contains MEN and UNISEX (no WOMEN)",
    exactGenders.has("MEN") &&
      exactGenders.has("UNISEX") &&
      !exactGenders.has("WOMEN"),
    `exact genders=${[...exactGenders].join(",")}`
  );

  const unisexIndex = d.exactProducts.findIndex((p) => p.gender === "UNISEX");
  const firstUnisexScore = d.exactProducts[unisexIndex]?.score;
  const menBlockedBehindSameScore = d.exactProducts
    .slice(unisexIndex)
    .some((p) => p.gender === "MEN" && p.score === firstUnisexScore);
  check(
    "men jeans -> same-gender products before UNISEX at equal score",
    unisexIndex > 0 && !menBlockedBehindSameScore,
    unisexIndex < 0
      ? "no UNISEX product in Exact"
      : `first UNISEX at index ${unisexIndex}, equal-score MEN behind = ${menBlockedBehindSameScore}`
  );
}

/* 2. women jeans -> Exact = WOMEN + UNISEX, no MEN anywhere */
{
  const d = await search("women jeans");
  const exactGenders = genderSet(d.exactProducts);
  check(
    "women jeans -> Exact contains WOMEN and UNISEX (no MEN)",
    exactGenders.has("WOMEN") &&
      exactGenders.has("UNISEX") &&
      !exactGenders.has("MEN"),
    `exact genders=${[...exactGenders].join(",")}`
  );
  const similarGenders = genderSet(d.similarProducts);
  check(
    "women jeans -> Similar contains no MEN either",
    !similarGenders.has("MEN"),
    `similar genders=${[...similarGenders].join(",")}`
  );
}

/* 3. men sneakers -> no WOMEN in Exact or Similar */
{
  const d = await search("men sneakers");
  const exactGenders = genderSet(d.exactProducts);
  check(
    "men sneakers -> Exact has MEN and UNISEX, no WOMEN",
    !exactGenders.has("WOMEN") && exactGenders.has("MEN") && exactGenders.has("UNISEX"),
    `exact genders=${[...exactGenders].join(",")}`
  );
  const similarGenders = genderSet(d.similarProducts);
  check(
    "men sneakers -> Similar contains no WOMEN",
    !similarGenders.has("WOMEN"),
    `similar genders=${[...similarGenders].join(",")}`
  );
}

/* 4. kids jeans -> only KIDS/UNISEX accepted (no MEN/WOMEN) */
{
  const d = await search("kids jeans");
  check(
    "kids jeans -> detected as KIDS",
    d.structuredQuery.gender === "KIDS",
    `gender=${d.structuredQuery.gender}`
  );
  const exactGenders = genderSet(d.exactProducts);
  check(
    "kids jeans -> Exact contains UNISEX (no MEN/WOMEN)",
    exactGenders.has("UNISEX") && !exactGenders.has("MEN") && !exactGenders.has("WOMEN"),
    `exact genders=${[...exactGenders].join(",")}`
  );
  const similarGenders = genderSet(d.similarProducts);
  check(
    "kids jeans -> Similar contains no MEN/WOMEN",
    !similarGenders.has("MEN") && !similarGenders.has("WOMEN"),
    `similar genders=${[...similarGenders].join(",")}`
  );
}

/* 5. explicit UNISEX search admits UNISEX only */
{
  const d = await search("unisex jeans");
  const exactGenders = genderSet(d.exactProducts);
  check(
    "unisex jeans -> Exact is UNISEX only",
    exactGenders.has("UNISEX") && !exactGenders.has("MEN") && !exactGenders.has("WOMEN"),
    `exact genders=${[...exactGenders].join(",")}`
  );
}

/* 6. gender-less queries unchanged */
{
  const goldens = [
    ["sneakers", 20],
    ["jeans", 6],
    ["black shoes", 30],
    ["nike", 10],
    ["size medium black tank top", 21],
  ];
  for (const [q, expected] of goldens) {
    const d = await search(q);
    check(
      `gender-less "${q}" exact unchanged (${expected})`,
      d.exactCount === expected,
      `exact=${d.exactCount} expected=${expected}`
    );
  }
}

console.log(`\n=== RESULT: ${passed}/${passed + failed} passed ===`);
process.exit(failed === 0 ? 0 : 1);