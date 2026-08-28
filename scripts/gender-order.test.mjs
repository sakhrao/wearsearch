const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

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

/*
  Spec §1: gender priority is a PRIMARY ordering key for Exact,
  before score comparison. For an explicit Men/Women/Kids request:
    - all same-gender products come BEFORE every UNISEX product
    - this holds even when a UNISEX product's score is higher
    - within each gender bucket, score stays descending
*/

const MIXED_QUERIES = [
  ["men jeans", "MEN"],
  ["women jeans", "WOMEN"],
  ["ladies jeans", "WOMEN"],
  ["womens jeans", "WOMEN"],
  ["mens jeans", "MEN"],
  ["men sneakers", "MEN"],
  ["women sneakers", "WOMEN"],
  ["men tshirt", "MEN"],
  ["women tshirt", "WOMEN"],
];

for (const [q, expectedGender] of MIXED_QUERIES) {
  const d = await search(q);
  const req = d.structuredQuery.gender;

  check(
    `"${q}" detected as ${expectedGender}`,
    req === expectedGender,
    `gender=${req}`
  );

  if (req !== expectedGender) continue;

  const exact = d.exactProducts;
  const sameIndexes = [];
  const unisexIndexes = [];
  exact.forEach((p, i) => {
    if (p.gender === req) sameIndexes.push(i);
    else if (p.gender === "UNISEX") unisexIndexes.push(i);
  });

  const hasSame = sameIndexes.length > 0;
  const hasUnisex = unisexIndexes.length > 0;

  check(
    `"${q}" Exact contains ${req} and UNISEX`,
    hasSame && hasUnisex,
    `genders=[${[...new Set(exact.map((p) => p.gender))].join(",")}]`
  );

  if (hasSame && hasUnisex) {
    const lastSame = sameIndexes[sameIndexes.length - 1];
    const firstUnisex = unisexIndexes[0];

    check(
      `"${q}" -> all ${req} before every UNISEX in Exact`,
      lastSame < firstUnisex,
      `last ${req} at ${lastSame}, first UNISEX at ${firstUnisex}`
    );

    const worseOrderedUnisex = exact.some((p, i) => {
      if (p.gender !== "UNISEX") return false;
      const worseSame = sameIndexes.some(
        (si) => exact[si].score < p.score
      );
      return worseSame && i <= lastSame;
    });
    check(
      `"${q}" -> UNISEX stays after ${req} even when its score is higher`,
      !worseOrderedUnisex,
      "a higher-scoring UNISEX product ordered before a lower-scoring same-gender product"
    );
  }

  if (hasUnisex && hasSame) {
    const genderKeys = new Map();
    exact.forEach((p, i) => genderKeys.set(i, p.gender === req ? 0 : 1));
    let bucketOk = true;
    for (let i = 1; i < exact.length; i++) {
      if (genderKeys.get(i) < genderKeys.get(i - 1)) bucketOk = false;
    }
    for (let i = 1; i < exact.length; i++) {
      if (
        genderKeys.get(i) === genderKeys.get(i - 1) &&
        exact[i - 1].score < exact[i].score
      ) {
        bucketOk = false;
      }
    }
    check(
      `"${q}" -> buckets ordered (gender then score desc within bucket)`,
      bucketOk,
      "ordering violation inside Exact"
    );
  }
}

/* KIDS: catalog has no KIDS-gendered products; the invariant holds
   vacuously (Exact is UNISEX-only, no same-gender bucketing). */
{
  const d = await search("kids jeans");
  check(
    "kids jeans -> detected as KIDS",
    d.structuredQuery.gender === "KIDS",
    `gender=${d.structuredQuery.gender}`
  );
  const exactGenders = [...new Set(d.exactProducts.map((p) => p.gender))];
  check(
    "kids jeans -> Exact UNISEX-only (invariant vacuous, no KIDS products)",
    exactGenders.length === 1 && exactGenders[0] === "UNISEX",
    `genders=${exactGenders.join(",")}`
  );
}

/* Gender-less queries: ordering falls back to score descending
   (gender keys are all 0 -> no UNISEX promotion). */
{
  const queries = ["sneakers", "jeans", "tank top", "tshirt", "nike"];
  for (const q of queries) {
    const d = await search(q);
    let ok = true;
    for (let i = 1; i < d.exactProducts.length; i++) {
      if (d.exactProducts[i - 1].score < d.exactProducts[i].score) ok = false;
    }
    check(
      `gender-less "${q}" -> Exact score descending`,
      ok,
      "ordering violation"
    );
  }
}

console.log(`\n=== RESULT: ${passed}/${passed + failed} passed ===`);
process.exit(failed === 0 ? 0 : 1);