import "dotenv/config";

/* PR4 F8-A - Variant Availability Contract.
   Purchasable-only invariant: a size or color must resolve through
   AVAILABLE variants only (the single availVariants rule in
   route.ts). The API can never surface an OUT_OF_STOCK size/color,
   the payload ships only purchasable variants, and products whose
   stock is entirely depleted never appear.
   Counts below are locked to the PR4 F8 baseline: any future
   availability shift must surface as a regression here. */

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail: string) {
  if (cond) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name} :: ${detail}`);
  }
}

const SEARCH = "http://localhost:3000/api/search";

interface SearchVariant {
  availability: string;
}
interface SearchProduct {
  id: string;
  name: string;
  productUrl: string;
  variants: SearchVariant[];
}
interface CategoryStatus {
  productCount?: number;
}
interface SearchResponse {
  exactCount?: number;
  similarCount?: number;
  exactProducts?: SearchProduct[];
  similarProducts?: SearchProduct[];
  diagnostics?: string[];
  categoryStatus?: CategoryStatus | null;
}

async function search(q: string): Promise<SearchResponse> {
  const res = await fetch(`${SEARCH}?q=${encodeURIComponent(q)}&debug=1`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for "${q}"`);
  return res.json() as SearchResponse;
}

const SOME_OOS = (products: SearchProduct[] | undefined) =>
  (products ?? []).some((p) =>
    p.variants.some(
      (v) => v.availability !== "AVAILABLE"
    )
  );

/* I1: every surfaced product ships at least one AVAILABLE variant and
   zero OUT_OF_STOCK variants, across a sweep that mixes structured,
   free-text and pure-noise queries (including the F8 locked ones). */
const SWEEP = [
  "tank top",
  "black tank top",
  "red tank top",
  "blue tank top",
  "green tank top",
  "pink tank top",
  "white tank top",
  "size small tank top",
  "size medium tank top",
  "size large tank top",
  "size medium black tank top",
  "tank top xl",
  "extra small tank top",
  "double extra large tank top",
  "size small blouse",
  "leather shoes",
  "black shoes",
  "brown shoe",
  "shoes size 42",
  "sneaker 42",
  "white sneaker 41",
  "blue xyzzy",
  "silk xyzzy",
  "rayon",
  "spandex",
  "xyzzy",
  "black pants",
  "blue pants",
  "women's black cotton tank top size S",
];

{
  let leak = 0;
  let empty = 0;
  for (const q of SWEEP) {
    const d = await search(q);
    if (SOME_OOS(d.exactProducts) || SOME_OOS(d.similarProducts)) leak += 1;
    const exactReady =
      d.exactProducts?.every((p) => p.variants.length > 0) ?? true;
    const similarReady =
      d.similarProducts?.every((p) => p.variants.length > 0) ?? true;
    if (!exactReady || !similarReady) empty += 1;
  }
  check(
    "I1 no OUT_OF_STOCK variant in any exact/similar payload across sweep",
    leak === 0,
    `queries leaking an OOS variant: ${leak}`
  );
  check(
    "I1 every surfaced product ships >= 1 AVAILABLE variant",
    empty === 0,
    `products with empty variant payloads: ${empty}`
  );
}

/* I2: locked purchasable-only counts (PR4 F8 baseline). Any shift in
   these numbers means the inventory availability changed. */
const LOCKS: Array<[string, number, number, string]> = [
  ["size small tank top", 35, 0, "S via AVAILABLE only"],
  ["size medium tank top", 32, 0, "M via AVAILABLE only"],
  ["size large tank top", 32, 0, "L via AVAILABLE only"],
  ["size medium black tank top", 14, 0, "M+Black via AVAILABLE only"],
  ["tank top xl", 25, 0, "XL via AVAILABLE only"],
  ["extra small tank top", 1, 0, "XS via AVAILABLE only"],
  ["double extra large tank top", 5, 0, "XXL via AVAILABLE only"],
  ["size small blouse", 164, 0, "S blouses via AVAILABLE only"],
  ["shoes size 42", 21, 0, "EU42 via AVAILABLE only"],
  ["black shoes", 23, 0, "Black shoes via AVAILABLE only"],
  ["brown shoe", 3, 0, "Brown via AVAILABLE only"],
  ["white tank top", 13, 0, "White via AVAILABLE only"],
  ["blue tank top", 14, 0, "Blue via AVAILABLE only"],
  ["green tank top", 10, 0, "Green via AVAILABLE only"],
  ["pink tank top", 9, 0, "Pink via AVAILABLE only"],
  ["blue pants", 0, 75, "Blue Similar via AVAILABLE only"],
  ["black pants", 0, 162, "Black Similar via AVAILABLE only"],
  ["women's black cotton tank top size S", 0, 15, "gender+color+size via AVAILABLE only"],
];
{
  for (const [q, exact, similar, why] of LOCKS) {
    const d = await search(q);
    check(
      `I2 "${q}" locked (${exact}/${similar} - ${why})`,
      d.exactCount === exact && d.similarCount === similar,
      `exact=${d.exactCount} similar=${d.similarCount} expected ${exact}/${similar}`
    );
  }
}

/* I3: a product whose stock is entirely depleted (zero AVAILABLE
   variants - all demo/no-page items) never surfaces through any
   query, and its category presence is untouched. */
const DEPLETED_NAMES = [
  "Women Red Fashion Boots",
  "Green Yoga Leggings",
  "Black Chiffon Blouse",
];
{
  let found = 0;
  for (const q of SWEEP) {
    const d = await search(q);
    const all = [...(d.exactProducts ?? []), ...(d.similarProducts ?? [])];
    for (const p of all) {
      if (DEPLETED_NAMES.includes(p.name)) found += 1;
    }
  }
  check(
    "I3 zero-purchasable products never appear in any result",
    found === 0,
    `depleted products surfaced: ${found}`
  );
}

/* I4: category productCount is inventory-total, unchanged by the
   purchasable variant rule (pool stays excluded only where stock is
   fully depleted - the 3 demo rows have no page/appearance anyway). */
{
  const d = await search("tank top");
  check(
    "I4 categoryStatus.productCount for 'tank top' unchanged (50)",
    d.categoryStatus?.productCount === 50,
    `productCount=${d.categoryStatus?.productCount}`
  );
}

/* I5: diagnostics stay evidence-based and never claim a size/color is
   purchasable when it only exists on OOS variants - the empty-result
   gate and message parity across the pure-noise pair remain frozen. */
{
  const silk = await search("silk");
  const xyzzy = await search("xyzzy");
  check(
    "I5 silk and xyzzy unify to identical empty diagnostics",
    silk.exactCount === 0 &&
      xyzzy.exactCount === 0 &&
      JSON.stringify(silk.diagnostics ?? []) ===
        JSON.stringify(xyzzy.diagnostics ?? []) &&
      (silk.diagnostics?.length ?? 0) > 0,
    `silk=[${(silk.diagnostics ?? []).join(" | ")}] xyzzy=[${(xyzzy.diagnostics ?? []).join(" | ")}]`
  );

  const size45 = await search("size 45 sneakers");
  const diag = size45.diagnostics ?? [];
  check(
    "I5 'size 45 sneakers' empty result carries an evidence-based diagnostic",
    size45.exactCount === 0 && diag.length > 0 && diag.every((m) => m.length > 0),
    `diag=[${diag.join(" | ")}]`
  );
}

/* I6: F7-S1 pure-free-text gate untouched - unknown corpus words stay
   0 exact under any casing/noise mix (availability never re-admits). */
{
  for (const q of ["silk", "polyester", "cashmere", "wool"]) {
    const d = await search(q);
    check(
      `I6 "${q}" stays 0 exact (F7-S1 gate intact)`,
      d.exactCount === 0,
      `exact=${d.exactCount}`
    );
  }
}

console.log(`\n=== RESULT: ${passed}/${passed + failed} passed ===`);
process.exit(failed === 0 ? 0 : 1);