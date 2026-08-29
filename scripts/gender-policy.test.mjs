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

function everyGenderIn(products, allowed) {
  return [...genderSet(products)].every((g) => allowed.includes(g));
}

/* Spec §2/§12: explicit Men/Women/Kids admits UNISEX into Exact,
   ranked after same-gender products; hard isolation preserved
   (no WOMEN into MEN and vice versa).

   PR2-F1 re-baseline (2026-08-28): the real (non-demo) catalog is
   MEN 11 / WOMEN 493 / UNISEX 0. Every UNISEX product (including the
   ones that previously filled men/kids/unisex jeans) belonged to the
   79 excluded demo/placeholder items. UNISEX-admission therefore holds
   VACUOUSLY: queries surface their own gender only, and honest empties
   appear where no real product fits. Isolation, detection, and the
   same-gender-before-UNISEX ordering rule are still asserted wherever
   data allows, plus an honest-empty diagnostic guard. */

/* 1. men jeans -> MEN detection; only MEN/UNISEX admitted; honest
   empty today (no real MEN/UNISEX jeans) */
{
  const d = await search("men jeans");
  check(
    "men jeans -> detected as MEN",
    d.structuredQuery.gender === "MEN",
    `gender=${d.structuredQuery.gender}`
  );
  check(
    "men jeans -> every result is MEN or UNISEX (no WOMEN ever)",
    everyGenderIn([...d.exactProducts, ...d.similarProducts], ["MEN", "UNISEX"]),
    `genders=${[...new Set([...d.exactProducts, ...d.similarProducts].map((p) => p.gender))].join(",")}`
  );
  if (d.exactProducts.some((p) => p.gender === "UNISEX")) {
    const firstUnisex = d.exactProducts.findIndex((p) => p.gender === "UNISEX");
    const menBlocked = d.exactProducts
      .slice(firstUnisex)
      .some((p) => p.gender === "MEN");
    check(
      "men jeans -> MEN ordered before UNISEX when equality admits UNISEX",
      firstUnisex > 0 && !menBlocked,
      `first UNISEX at ${firstUnisex}`
    );
  }
  check(
    "men jeans -> no real MEN jeans: honest empty with diagnostic",
    d.exactCount > 0 || (d.diagnostics ?? []).length > 0,
    `exact=${d.exactCount} diag=[${(d.diagnostics ?? []).join(" | ")}]`
  );
}

/* 2. women jeans -> WOMEN detection; exact holds the real WOMEN jean;
   no MEN anywhere */
{
  const d = await search("women jeans");
  check(
    "women jeans -> detected as WOMEN",
    d.structuredQuery.gender === "WOMEN",
    `gender=${d.structuredQuery.gender}`
  );
  const exactGenders = genderSet(d.exactProducts);
  check(
    "women jeans -> Exact contains WOMEN and no MEN",
    exactGenders.has("WOMEN") && !exactGenders.has("MEN"),
    `exact genders=${[...exactGenders].join(",")}`
  );
  const similarGenders = genderSet(d.similarProducts);
  check(
    "women jeans -> Similar contains no MEN either",
    !similarGenders.has("MEN"),
    `similar genders=${[...similarGenders].join(",")}`
  );
}

/* 3. men sneakers -> MEN detection; no WOMEN in Exact or Similar */
{
  const d = await search("men sneakers");
  const exactGenders = genderSet(d.exactProducts);
  check(
    "men sneakers -> detected as MEN",
    d.structuredQuery.gender === "MEN",
    `gender=${d.structuredQuery.gender}`
  );
  check(
    "men sneakers -> Exact is MEN/UNISEX only (no WOMEN)",
    !exactGenders.has("WOMEN") && exactGenders.has("MEN"),
    `exact genders=${[...exactGenders].join(",")}`
  );
  const similarGenders = genderSet(d.similarProducts);
  check(
    "men sneakers -> Similar contains no WOMEN",
    !similarGenders.has("WOMEN"),
    `similar genders=${[...similarGenders].join(",")}`
  );
}

/* 4. kids jeans -> KIDS detection; only KIDS/UNISEX shape; honest
   empty today (no real KIDS/UNISEX jeans) */
{
  const d = await search("kids jeans");
  check(
    "kids jeans -> detected as KIDS",
    d.structuredQuery.gender === "KIDS",
    `gender=${d.structuredQuery.gender}`
  );
  check(
    "kids jeans -> no MEN/WOMEN leak into Exact or Similar",
    everyGenderIn([...d.exactProducts, ...d.similarProducts], ["KIDS", "UNISEX"]),
    `genders=${[...new Set([...d.exactProducts, ...d.similarProducts].map((p) => p.gender))].join(",")}`
  );
  check(
    "kids jeans -> honest empty with diagnostic (no real UNISEX jeans)",
    d.exactCount > 0 || (d.diagnostics ?? []).length > 0,
    `exact=${d.exactCount} diag=[${(d.diagnostics ?? []).join(" | ")}]`
  );
}

/* 5. explicit UNISEX search admits UNISEX only; honest empty today */
{
  const d = await search("unisex jeans");
  check(
    "unisex jeans -> detected as UNISEX",
    d.structuredQuery.gender === "UNISEX",
    `gender=${d.structuredQuery.gender}`
  );
  check(
    "unisex jeans -> Exact is UNISEX only (no MEN/WOMEN)",
    everyGenderIn([...d.exactProducts, ...d.similarProducts], ["UNISEX"]),
    `genders=${[...new Set([...d.exactProducts, ...d.similarProducts].map((p) => p.gender))].join(",")}`
  );
  check(
    "unisex jeans -> honest empty with diagnostic (no real UNISEX jeans)",
    d.exactCount > 0 || (d.diagnostics ?? []).length > 0,
    `exact=${d.exactCount} diag=[${(d.diagnostics ?? []).join(" | ")}]`
  );
}

/* 6. gender-less queries: demo-free counts (PR2-F1 re-based) */
{
  const goldens = [
    ["sneakers", 14],
    ["jeans", 1],
    ["black shoes", 23],
    ["nike", 1],
    ["size medium black tank top", 14],
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