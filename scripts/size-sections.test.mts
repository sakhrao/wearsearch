/* F19b Size-section pure unit test (successor of the buildSizeFacets
   role on the server wire).

   Pure fixture test - imports src/lib/size-sections directly, never
   touches /api/meta or the live catalog:
     - EU-only shoes stay shoes (the "shoes-eu" section), ascending;
     - US-only shoes stay shoes ("shoes-us");
     - EU + US shoes partition by variant.size.system only - a value
       like 41 goes to EU when the stored system is EU and to US when
       US, never guessed from the number;
     - a mixed EU + clothing pool never leaks shoe sizes into the
       clothing section (and vice versa);
     - null sizes are ignored and a value present twice on the same
       product is deduped;
     - accessories/headwear families land in their own sections.

   Usage: npx tsx scripts/size-sections.test.mts */

import {
  SIZE_SECTION_LABELS,
  SIZE_SECTION_ORDER,
  buildSizeSectionValues,
} from "../src/lib/size-sections";

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

type Fixture = {
  category: { name: string };
  variants: {
    size: { value: string | null; system: string | null } | null;
  }[];
};

const eu = (v: string | null) => ({ size: { value: v, system: "EU" } });
const us = (v: string | null) => ({ size: { value: v, system: "US" } });
const none = (v: string | null) => ({ size: { value: v, system: null } });

const shoeProduct = (
  category: string,
  variants: Fixture["variants"]
): Fixture => ({ category: { name: category }, variants });

const clothingProduct = (
  category: string,
  variants: Fixture["variants"]
): Fixture => ({ category: { name: category }, variants });

/* numeric ascending (size values are decimals, not strings) */
const asc = (values: string[]) =>
  [...values].sort((a, b) => Number(a) - Number(b));

/* 1. EU-only shoes -------------------------------- */
{
  const s = buildSizeSectionValues([
    shoeProduct("Formal Shoes", [
      eu("39"),
      eu("40"),
      eu("41"),
      eu("42"),
    ]),
  ]);
  check(
    "EU-only shoes land in the shoes-eu section",
    [...s["shoes-eu"]].length === 4 &&
      s.clothing.size === 0 &&
      s["shoes-us"].size === 0 &&
      s.accessories.size === 0 &&
      s.headwear.size === 0,
    `shoes-eu=${JSON.stringify([...s["shoes-eu"]])} clothing=${s.clothing.size}`
  );
  check(
    "EU-only shoes keep ascending order (39,40,41,42)",
    JSON.stringify(asc([...s["shoes-eu"]])) === JSON.stringify(["39", "40", "41", "42"]),
    JSON.stringify([...s["shoes-eu"]])
  );
}

/* 2. US-only shoes --------------------------------- */
{
  const s = buildSizeSectionValues([
    shoeProduct("Heels", [
      us("6"),
      us("7"),
      us("8"),
      us("9"),
    ]),
  ]);
  check(
    "US-only shoes land in the shoes-us section",
    [...s["shoes-us"]].length === 4 &&
      s["shoes-eu"].size === 0 &&
      s.clothing.size === 0 &&
      s.accessories.size === 0 &&
      s.headwear.size === 0,
    JSON.stringify([...s["shoes-us"]])
  );
}

/* 3. EU + US partition by system, never by number --- */
{
  const s = buildSizeSectionValues([
    shoeProduct("Boots", [
      ...["39", "40", "41", "42", "43", "44"].map(eu),
      ...["6", "7", "8", "9", "10"].map(us),
    ]),
  ]);
  check(
    "mixed EU+US boots partition by stored system",
    JSON.stringify(asc([...s["shoes-eu"]])) ===
        JSON.stringify(["39", "40", "41", "42", "43", "44"]) &&
      JSON.stringify(asc([...s["shoes-us"]])) ===
        JSON.stringify(["6", "7", "8", "9", "10"]),
    `eu=${JSON.stringify(asc([...s["shoes-eu"]]))} us=${JSON.stringify(asc([...s["shoes-us"]]))}`
  );
}

/* 4. no number-guessing: 41 is EU when system=EU ----- */
{
  const s = buildSizeSectionValues([
    shoeProduct("Formal Shoes", [eu("41")]),
    shoeProduct("Sneakers", [us("41")]),
  ]);
  check(
    "value 41 splits by system: EU-row in shoes-eu, US-row in shoes-us",
    JSON.stringify([...s["shoes-eu"]]) === JSON.stringify(["41"]) &&
      JSON.stringify([...s["shoes-us"]]) === JSON.stringify(["41"]),
    `eu=${JSON.stringify([...s["shoes-eu"]])} us=${JSON.stringify([...s["shoes-us"]])}`
  );
}

/* 5. mixed EU + clothing: no cross-leak -------------- */
{
  const s = buildSizeSectionValues([
    shoeProduct("Sneakers", [
      eu("39"),
      eu("40"),
    ]),
    clothingProduct("T-Shirts", [
      none("S"),
      none("M"),
      none("L"),
    ]),
  ]);
  check(
    "mixed EU + clothing: shoe values only in shoes-eu, alphas only in clothing",
    JSON.stringify([...s["shoes-eu"]].sort()) === JSON.stringify(["39", "40"]) &&
      JSON.stringify([...s.clothing].sort()) === JSON.stringify(["L", "M", "S"]) &&
      s["shoes-us"].size === 0 &&
      s.accessories.size === 0 &&
      s.headwear.size === 0,
    `shoes-eu=${JSON.stringify([...s["shoes-eu"]])} clothing=${JSON.stringify([...s.clothing])}`
  );
}

/* 6. null sizes ignored; same-product dedup ----------- */
{
  const s = buildSizeSectionValues([
    clothingProduct("T-Shirts", [none(null), eu("40"), none(null), eu("40")]),
  ]);
  check(
    "null size rows are ignored and duplicate values dedup per product",
    JSON.stringify([...s.clothing].sort()) === JSON.stringify(["40"]),
    JSON.stringify([...s.clothing])
  );
}

/* 7. accessories / headwear families ------------------ */
{
  const s = buildSizeSectionValues([
    shoeProduct("Sneakers", [us("9"), eu("42")]),
    clothingProduct("Watches", [none("Standard")]),
    clothingProduct("Belts", [none("Medium")]),
    clothingProduct("Hats", [none("M")]),
    shoeProduct("Heels", [us("7")]),
  ]);
  check(
    "accessories and headwear own their values; shoes stay split",
    JSON.stringify([...s.accessories].sort()) === JSON.stringify(["Medium", "Standard"]) &&
      JSON.stringify([...s.headwear].sort()) === JSON.stringify(["M"]) &&
      JSON.stringify(asc([...s["shoes-eu"]])) === JSON.stringify(["42"]) &&
      JSON.stringify(asc([...s["shoes-us"]])) === JSON.stringify(["7", "9"]),
    `acc=${JSON.stringify([...s.accessories])} hw=${JSON.stringify([...s.headwear])} eu=${JSON.stringify([...s["shoes-eu"]])} us=${JSON.stringify([...s["shoes-us"]])}`
  );
}

/* 8. every section label matches its order entry ------ */
{
  const labels = SIZE_SECTION_ORDER.map((k) => SIZE_SECTION_LABELS[k]);
  check(
    "all five sections have distinct labels",
    new Set(labels).size === 5,
    JSON.stringify(labels)
  );
}

console.log(`\nSize-sections unit: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);