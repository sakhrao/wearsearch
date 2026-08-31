/* Size grouping guards (spec §6 / questionnaire quarter).

   groupShoesBySystem splits shoe sizes by their stored sizing
   system (EU, US, ...) so the questionnaire can present EU and US
   columns ascending instead of one mixed alphabetical-free list.
   The system column is the catalog truth: a value tagged US stays
   in the US bucket even if its magnitude looks European, and
   non-numeric / blank rows never pollute a system bucket.

   Pure unit guard - no server required. */

import {
  groupShoesBySystem,
  categorizeSizeList,
} from "../src/lib/sizes";

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

/* Fixture shaped like the real catalog rows: EU 39-45, a US range
   that also carries European-looking magnitudes, one non-numeric
   US row, one blank, and a clothing row. */
const FIXTURE = [
  { category: "shoes", value: "40", system: "EU" },
  { category: "shoes", value: "41", system: "EU" },
  { category: "shoes", value: "39", system: "EU" },
  { category: "shoes", value: "42", system: "EU" },
  { category: "shoes", value: "7", system: "US" },
  { category: "shoes", value: "8", system: "US" },
  { category: "shoes", value: "8.5", system: "US" },
  { category: "shoes", value: "45", system: "US" },
  { category: "shoes", value: "M", system: "US" },
  { category: "shoes", value: "  ", system: "EU" },
  { category: "clothing", value: "S", system: "INTERNATIONAL" },
  { category: "clothing", value: "One Size", system: "INTERNATIONAL" },
];

const buckets = groupShoesBySystem(FIXTURE);

check(
  "S1 buckets are per system (EU and US present)",
  Object.keys(buckets).sort().join(",") === "EU,US",
  Object.keys(buckets).join(",")
);

check(
  "S2 EU bucket rises numerically (not alphabetically)",
  JSON.stringify(buckets.EU) ===
    JSON.stringify(["39", "40", "41", "42"]),
  buckets.EU.join(",")
);

check(
  "S3 a European-looking magnitude tagged US stays in US",
  JSON.stringify(buckets.US) ===
    JSON.stringify(["7", "8", "8.5", "45"]),
  buckets.US.join(",")
);

check(
  "S4 non-numeric rows never enter a system bucket",
  Object.values(buckets).flat().includes("M") === false &&
    Object.values(buckets).flat().includes("S") === false,
  JSON.stringify(Object.values(buckets).flat())
);

check(
  "S5 blank rows are excluded",
  Object.values(buckets).flat().filter((v) => v.trim() === "").length === 0,
  JSON.stringify(Object.values(buckets).flat())
);

check(
  "S6 clothing sizes are never shoe buckets",
  Object.values(buckets)
    .flat()
    .some((v) => v === "S" || v === "One Size") === false,
  JSON.stringify(Object.values(buckets).flat())
);

/* readymade fixture: an unmatched system appears once it has values */
const extra = groupShoesBySystem([
  { category: "shoes", value: "9", system: "UK" },
  { category: "shoes", value: "10", system: "UK" },
]);
check(
  "S7 extra systems appear dynamically, sorted ascending",
  JSON.stringify(extra.UK) === JSON.stringify(["9", "10"]),
  JSON.stringify(extra.UK)
);

const empty = groupShoesBySystem([
  { category: "shoes", value: "M", system: "US" },
  { category: "clothing", value: "S", system: "INTERNATIONAL" },
]);
check("S8 no numeric shoe values -> no buckets at all",
  Object.keys(empty).length === 0,
  JSON.stringify(empty));

/* year the legacy flat grouping is untouched */
const flat = categorizeSizeList(FIXTURE);
check(
  "S9 legacy categorizeSizeList still splits clothing/shoes",
  flat.clothing.includes("S") &&
    flat.clothing.includes("One Size") &&
    flat.shoes.includes("39") &&
    flat.shoes.includes("45"),
  `clothing=[${flat.clothing.join(",")}] shoes=[${flat.shoes.join(",")}]`
);

console.log(`\n=== RESULT: ${passed}/${passed + failed} passed ===`);
process.exit(failed === 0 ? 0 : 1);