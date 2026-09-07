/* Offer-vocab canonicalisation tests.

   The promise of the shared helpers: a chip surfaced by the
   questionnaire (/api/meta) matches the search engine's detection and
   product evidence (/api/search). These offline tests lock the folds so
   the pick -> search round trip cannot silently break:

     - colors: raw offer colorways collapse to ONE known chip ("Blacks",
       "Black - Medium", "Black / Powder Teal / Blue" -> "Black" / "Grey"),
       and unknowns never pass through as fake verbatim chips ("Biege",
       "Buyer Choice" -> null).
     - sizes: messy raw strings expand to the canonical members the
       engine matches (S/M L/XL 2XL/3XL -> six chips, 6-12 -> six
       numbers, One Size, 36B, brake "6-" -> "6", noise -> nothing). */

import {
  canonicalColorFromOffer,
  expandOfferSizeChips,
} from "../src/lib/catalog/offer-vocab";
import {
  foldToken,
  knownColorChip,
} from "../src/lib/catalog/normalize";

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

const same = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/* 1. Colors collapse to one known chip or null */
{
  const cases: Array<[string | null | undefined, string | null]> = [
    ["Black", "Black"],
    ["Blacks", "Black"],
    ["black", "Black"],
    ["Black - Medium", "Black"],
    ["Black / Powder Teal / Blue", "Black"],
    ["Black | White", "Black"],
    ["Grey", "Grey"],
    ["Gray", "Grey"],
    ["Beiges", "Beige"],
    ["Navy", "Navy"],
    ["navy blue", "Blue"],
    ["Multi Color", "Multi"],
    ["multicolor", "Multi"],
    ["Biege", null],
    ["Buyer Choice", null],
    [null, null],
    [undefined, null],
    ["", null],
  ];
  for (const [input, expected] of cases) {
    check(
      `color "${String(input)}"` +
        (expected === null ? " -> null" : ` -> ${expected}`),
      canonicalColorFromOffer(input) === expected,
      `got ${JSON.stringify(canonicalColorFromOffer(input))}`
    );
  }
}

/* 2. Color round-trip: every non-null chip is either Multi or a known
   chip the search engine's color detection dictionary resolves. */
{
  const raw = [
    "Black",
    "Blacks",
    "Black medium",
    "Black / White",
    "Grey",
    "Gray",
    "Navy",
    "White",
    "Brown",
    "Beiges",
    "Olive",
    "Biege",
    "Buyer Choice",
    "multi",
  ];
  const bad = raw
    .map(canonicalColorFromOffer)
    .filter(
      (chip): chip is string =>
        chip !== null &&
        chip !== "Multi" &&
        knownColorChip(foldToken(chip)) === null
    );
  check(
    "every color chip is search-recognized (no verbatim passthrough)",
    bad.length === 0,
    `non-round-trippable chips: ${bad.join(", ")}`
  );
}

/* 3. Size expansion */
{
  const cases: Array<[string | null | undefined, string[]]> = [
    ["M", ["M"]],
    ["Medium", ["M"]],
    ["S/M L/XL 2XL/3XL", ["S", "M", "L", "XL", "2XL", "3XL"]],
    ["XS, S, M, L, XL, 2XL", ["XS", "S", "M", "L", "XL", "2XL"]],
    ["6-12", ["6", "7", "8", "9", "10", "11", "12"]],
    ["6-", ["6"]],
    ["One Size", ["One Size"]],
    ["36B", ["36B"]],
    ["Variation", []],
    ["n/a", []],
    [null, []],
    ["", []],
  ];
  for (const [input, expected] of cases) {
    check(
      `size "${input}" -> ${JSON.stringify(expected)}`,
      same(expandOfferSizeChips(input), expected),
      `got ${JSON.stringify(expandOfferSizeChips(input))}`
    );
  }
}

console.log(`\n=== RESULT: ${passed}/${passed + failed} passed ===`);
process.exit(failed === 0 ? 0 : 1);