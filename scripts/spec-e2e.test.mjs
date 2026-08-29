/* Targeted end-to-end checks for the new spec behaviors:
   multi-color subset Exact, Budget hard + ±35% Similar,
   soft-details ranking, expanded taxonomy, empty diagnostics,
   catalog size groups, KIDS gender integration. */

const SEARCH = "http://localhost:3000/api/search";
const META = "http://localhost:3000/api/meta";

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

async function search(params) {
  const qs = new URLSearchParams();
  qs.set("debug", "1");
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) {
      qs.set(key, value);
    }
  }
  const res = await fetch(`${SEARCH}?${qs.toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const colorNamesOf = (product) => [
  ...new Set(
    (product.variants ?? [])
      .map((variant) => variant.color?.name)
      .filter(Boolean)
  ),
];

/* ============ MULTI-COLOR (subset Exact) ============ */

const mc = await search({ q: "white black tank top" });
const mcColors = mc.structuredQuery?.colors ?? [];
check(
  "M1 multi-color query detects both colors",
  mcColors.includes("Black") && mcColors.includes("White"),
  `colors=[${mcColors.join(",")}] outerColor=${mc.structuredQuery?.color}`
);
check(
  "M2 subset Exact: every exact product's palette is inside the selected colors",
  mc.exactCount > 0 &&
    (mc.exactProducts ?? []).every((product) => {
      const palette = colorNamesOf(product);
      return (
        palette.length > 0 &&
        palette.every((c) => mcColors.includes(c))
      );
    }),
  `exact=${mc.exactCount} palettes=${(mc.exactProducts ?? [])
    .slice(0, 4)
    .map((p) => `${p.name}:${colorNamesOf(p).join("+")}`)
    .join(" / ")}`
);
check(
  "M3 legacy single-color field kept for compatibility",
  mc.structuredQuery?.color === "Black",
  `color=${mc.structuredQuery?.color}`
);

/* White+Red: strict subset in Exact; off-palette combos (e.g.
   Black+Multi variants) are confined to Similar */
const tankTotal = await search({ q: "tank top" });
const wr = await search({ q: "white red tank top" });
const wrColors = wr.structuredQuery?.colors ?? [];
check(
  "M4 White+Red query detects both colors",
  wrColors.includes("White") && wrColors.includes("Red"),
  `colors=[${wrColors.join(",")}]`
);
check(
  "M5 White+Red Exact is a strict subset (no out-of-palette, strictly fewer than all tank tops)",
  wr.exactCount > 0 &&
    wr.exactCount < tankTotal.exactCount &&
    (wr.exactProducts ?? []).every((product) => {
      const palette = colorNamesOf(product);
      return (
        palette.length > 0 &&
        palette.every((c) => wrColors.includes(c))
      );
    }),
  `exact=${wr.exactCount} total=${tankTotal.exactCount}`
);
check(
  "M6 out-of-palette combinations land in Similar only",
  (wr.similarProducts ?? []).length > 0 &&
    (wr.similarProducts ?? []).some((product) =>
      colorNamesOf(product).some(
        (c) => !wrColors.includes(c)
      )
    ),
  `similar=${(wr.similarProducts ?? []).length}`
);

/* ============ BUDGET (hard Exact + ±35% Similar) ============ */

/* K2: budgets are compared in the EUR reference currency while
   stored prices keep their original currency (EUR seeds, USD
   providers). Normalize every stored price with the SAME rate
   the engine used (meta.fx, the documented env-first →
   Frankfurter source) before asserting the bounds. */
const budgetMeta = await fetch(META).then((r) => r.json());
const fxRate = budgetMeta?.fx?.rate ?? null;

const toEur = (product) => {
  const raw = Number(product.price);
  if (
    fxRate &&
    typeof product.currency === "string" &&
    product.currency.trim().toUpperCase() === "USD"
  ) {
    return Math.round((raw / fxRate) * 100) / 100;
  }
  return raw;
};

const budget = await search({
  q: "sneakers",
  priceMin: "50",
  priceMax: "80",
});
const exactOut = (budget.exactProducts ?? []).filter(
  (p) => {
    const px = toEur(p);
    return px < 50 || px > 80;
  }
);
const similarOut = (budget.similarProducts ?? []).filter(
  (p) => {
    const px = toEur(p);
    return px < 32.5 || px > 108;
  }
);
check(
  "B1 products inside a hard budget pass the Exact gate",
  budget.exactCount > 0 && exactOut.length === 0,
  `exact=${budget.exactCount} outside=${exactOut.length} rate=${fxRate ?? "none"}`
);
check(
  "B2 similar products stay within the ±35% band",
  budget.similarCount > 0 && similarOut.length === 0,
  `similar=${budget.similarCount} outside=${similarOut.length} rate=${fxRate ?? "none"}`
);
check(
  "B3 budget echoed in structuredQuery",
  budget.structuredQuery?.budget &&
    budget.structuredQuery.budget.min === 50 &&
    budget.structuredQuery.budget.max === 80,
  JSON.stringify(budget.structuredQuery?.budget)
);

/* ============ SOFT DETAILS (ranking-only) ============ */

/* PR2-F1 re-baseline (2026-08-28): attribute data exists ONLY on the
   79 excluded demo/placeholder products, so soft="Cotton" cannot match
   any real product today. Soft semantics stay ranking-only (never a
   gate, proven by S1/S3), and S2 pins the vacuous state so a future
   attribute back-fill (F6) is forced to re-enable the positive path. */
const soft = await search({ q: "tank top", soft: "Cotton" });
const softProducts = soft.exactProducts ?? [];
const withSoft = softProducts.filter((p) => p.softMatched);
const withoutSoft = softProducts.filter((p) => !p.softMatched);
const minSoftScore = Math.min(...withSoft.map((p) => p.score));
const maxPlainScore = Math.max(...withoutSoft.map((p) => p.score));
check(
  "S1 soft preferences rank matching products first (never gate)",
  softProducts.length > 0 &&
    (withSoft.length > 0
      ? minSoftScore > maxPlainScore
      : withSoft.length === 0),
  `soft=${withSoft.length} hard=${withoutSoft.length} minSoft=${minSoftScore} maxPlain=${maxPlainScore}`
);
check(
  "S2 softMatched flag exposed; pin: vacuous (real catalog carries no attributes)",
  withSoft.length === 0 && withoutSoft.length === softProducts.length,
  `soft=${withSoft.length} hard=${withoutSoft.length}`
);

const plainTank = await search({ q: "tank top" });
check(
  "S3 soft preferences never exclude from Exact (same count as plain search)",
  plainTank.exactCount === soft.exactCount &&
    soft.exactCount > 0,
  `plain=${plainTank.exactCount} soft=${soft.exactCount}`
);

/* ============ EXPANDED TAXONOMY ============ */

const hoodie = await search({ q: "men hoodie" });
check(
  "T1 'hoodie' resolves to the new Hoodies category",
  hoodie.structuredQuery?.category === "Hoodies",
  `category=${hoodie.structuredQuery?.category}`
);

const plainHoodie = await search({ q: "hoodie" });
const pluralHoodie = await search({ q: "hoodies" });
check(
  "T1b PR2-F2: 'hoodie'/'hoodies' return the real stocked Hoodies (37 from sync), never an empty stub",
  plainHoodie.exactCount > 0 &&
    plainHoodie.structuredQuery?.category === "Hoodies" &&
    plainHoodie.exactCount === pluralHoodie.exactCount,
  `hoodie=${plainHoodie.exactCount} hoodies=${pluralHoodie.exactCount} cat=${plainHoodie.structuredQuery?.category}`
);

check(
  "T2 PR2-F2: Hoodies is stocked, so a MEN-scoped query is an honest empty with the gender-scoped diagnostic",
  hoodie.exactCount === 0 &&
    hoodie.similarCount === 0 &&
    (hoodie.diagnostics ?? []).some((m) =>
      m.includes("No men products are currently available in hoodies")
    ),
  `exact=${hoodie.exactCount} diag=[${(hoodie.diagnostics ?? []).join(" | ")}]`
);

const suit = await search({ q: "suit" });
check(
  "T3 unsupported 'suit' never maps to a wrong category",
  suit.structuredQuery?.category === null &&
    suit.exactCount === 0 &&
    (suit.diagnostics ?? []).some((m) =>
      m.includes('No products in the catalog for "suit"')
    ),
  `category=${suit.structuredQuery?.category} diag=[${(suit.diagnostics ?? []).join(" | ")}]`
);

/* ============ PR2 F2-A: UNSUPPORTED-VOCAB + SWEATPANTS ALIAS ============ */

const hooded = await search({ q: "hooded" });
check(
  "T4 F2-A 'hooded' is unsupported intent (was free-text match-all), never a flood",
  hooded.exactCount === 0 &&
    hooded.similarCount === 0 &&
    hooded.structuredQuery?.category === null &&
    (hooded.diagnostics ?? []).some((m) =>
      m.includes('No products in the catalog for "hooded"')
    ),
  `exact=${hooded.exactCount} cat=${hooded.structuredQuery?.category} diag=[${(hooded.diagnostics ?? []).join(" | ")}]`
);

const sweatshirt = await search({ q: "sweatshirt" });
const pluralSweatshirt = await search({ q: "sweatshirts" });
check(
  "T5 PR2-F2: 'sweatshirt'/'sweatshirts' are a stocked category (34 real from sync), never a free-text flood",
  sweatshirt.exactCount > 0 &&
    sweatshirt.structuredQuery?.category === "Sweatshirts" &&
    sweatshirt.exactCount === pluralSweatshirt.exactCount,
  `sweatshirt=${sweatshirt.exactCount} sweatshirts=${pluralSweatshirt.exactCount} cat=${sweatshirt.structuredQuery?.category}`
);

const sweatpants = await search({ q: "sweatpants" });
const joggers = await search({ q: "joggers" });
check(
  "T6 F2-A 'sweatpants' aliases to the Joggers category (exact parity with 'joggers')",
  sweatpants.exactCount === joggers.exactCount &&
    joggers.exactCount > 0 &&
    sweatpants.structuredQuery?.category === "Joggers",
  `sweatpants=${sweatpants.exactCount} joggers=${joggers.exactCount} cat=${sweatpants.structuredQuery?.category}`
);

/* ============ DIAGNOSTICS ============ */

const pants = await search({ q: "pants" });
check(
  "D1 unsupported category words get an explicit diagnostic",
  pants.exactCount === 0 &&
    (pants.diagnostics ?? []).some((m) =>
      m.includes('No products in the catalog for "pants"')
    ),
  `exact=${pants.exactCount} diag=[${(pants.diagnostics ?? []).join(" | ")}]`
);

const budgetMiss = await search({
  q: "sneakers",
  priceMin: "5",
  priceMax: "10",
});
check(
  "D2 budget-constrained empty result names the budget range",
  budgetMiss.exactCount === 0 &&
    (budgetMiss.diagnostics ?? []).some((m) =>
      m.includes("budget range")
    ),
  `exact=${budgetMiss.exactCount} diag=[${(budgetMiss.diagnostics ?? []).join(" | ")}]`
);

/* Re-based P1/P5: size 44 became available (livostyle EU
   sizes restored from "NN(USx)" source strings), so the
   unavailable-size probe now uses 45, which exists in the
   size taxonomy but fits no sneaker. */
const sizeMiss = await search({ q: "size 45 sneakers" });
check(
  "D3 unavailable size names the exact size value in the diagnostic",
  sizeMiss.structuredQuery?.size === "45" &&
    sizeMiss.exactCount === 0 &&
    (sizeMiss.diagnostics ?? []).some(
      (m) =>
        m.includes("Size 45") &&
        m.includes("unavailable")
    ),
  `size=${sizeMiss.structuredQuery?.size} diag=[${(sizeMiss.diagnostics ?? []).join(" | ")}]`
);

/* ============ KIDS GENDER INTEGRATION ============ */

/* PR2-F1 re-baseline: all KIDS/UNISEX-compatible jeans were demo
   products (real catalog: MEN 11 / WOMEN 493 / UNISEX 0) -> the query
   is now an honest empty with a diagnostic instead of demo jeans. */
const kids = await search({ q: "kids jeans" });
check(
  "G1 'kids' detects the KIDS gender on the Jeans category",
  kids.structuredQuery?.gender === "KIDS" &&
    kids.structuredQuery?.category === "Jeans",
  `gender=${kids.structuredQuery?.gender} cat=${kids.structuredQuery?.category}`
);
check(
  "G2 no KIDS/UNISEX jeans remain -> honest empty with diagnostic",
  kids.exactCount === 0 &&
    kids.similarCount === 0 &&
    (kids.diagnostics ?? []).length > 0,
  `exact=${kids.exactCount} similar=${kids.similarCount} diag=[${(kids.diagnostics ?? []).join(" | ")}]`
);

/* ============ CATALOG SIZE GROUPS (spec §6/§13) ============ */

const metaRes = await fetch(META);
const meta = await metaRes.json();
const alpha = meta.sizeGroups?.clothing ?? [];
const numeric = meta.sizeGroups?.shoes ?? [];
const isNumeric = (v) => /^\d+(?:\.\d+)?$/.test(v);
check(
  "Z1 clothing size group is alphabetic (shape guard)",
  alpha.length > 0 &&
    alpha.includes("S") &&
    alpha.every((v) => !isNumeric(v)),
  `clothing=[${alpha.join(",")}]`
);
check(
  "Z2 shoe size group is numeric and free of S/M/L",
  numeric.length > 0 &&
    numeric.every((v) => isNumeric(v)),
  `shoes=[${numeric.join(",")}]`
);
check(
  "Z3 shoe size group covers both US and EU scale values",
  numeric.includes("7") && numeric.includes("42"),
  `shoes=[${numeric.join(",")}]`
);
check(
  "Z4 empty categories are flagged via hasProducts, stocked ones report true (PR2-F2: Hoodies now stocked)",
  meta.categories.some(
    (c) => c.name === "Jumpers" && !c.hasProducts
  ) &&
    meta.categories.some(
      (c) => c.name === "Hoodies" && c.hasProducts
    ) &&
    meta.categories.some(
      (c) => c.name === "Jeans" && c.hasProducts
    ),
  `categories=${meta.categories.map((c) => `${c.name}(${c.hasProducts})`).join(",")}`
);
check(
  "Z5 taxonomy includes Socks and Underwear (with empty-catalog flag)",
  meta.categories.some(
    (c) => c.name === "Socks" && !c.hasProducts
  ) &&
    meta.categories.some(
      (c) => c.name === "Underwear" && !c.hasProducts
    ),
  `hasSocks=${meta.categories.some((c) => c.name === "Socks")} hasUnderwear=${meta.categories.some((c) => c.name === "Underwear")}`
);
check(
  "Z6 no Suits anywhere in the taxonomy",
  !meta.categories.some((c) =>
    c.name.toLowerCase().includes("suit")
  ),
  meta.categories.map((c) => c.name).join(",")
);

/* ============ FX SURFACE (EUR->USD, never invented) ============ */

const fx = meta.fx ?? null;
check(
  "X1 meta exposes a EUR->USD fx descriptor",
  fx !== null &&
    fx.from === "EUR" &&
    fx.to === "USD" &&
    ["ecb-frankfurter", "env", "none"].includes(fx.source),
  JSON.stringify(fx)
);
if (fx && fx.rate !== null) {
  check(
    "X2 available rate is a positive number with a date",
    Number.isFinite(fx.rate) &&
      fx.rate > 0 &&
      /^\d{4}-\d{2}-\d{2}$/.test(fx.asOf ?? ""),
    JSON.stringify(fx)
  );
} else {
  check(
    "X2 no rate: source reported as 'none' (nothing invented)",
    fx && fx.source === "none",
    JSON.stringify(fx)
  );
}

console.log(`\n=== RESULT: ${passed}/${passed + failed} passed ===`);
process.exit(failed === 0 ? 0 : 1);