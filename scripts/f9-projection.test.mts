import "dotenv/config";

/* PR4 F9 - Response Projection contract.
   The production payload is a strict whitelist of what page.tsx
   renders; the scoring internals exist ONLY under ?debug=1.
   The two modes must be semantically identical (same counts, ids,
   order, diagnostics, structuredQuery, categoryStatus) - projection
   is serialization-only, never a behavior change. */

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

const INTERNALS = [
  "score",
  "exactMatch",
  "similarMatch",
  "matchedWords",
  "totalQueryWords",
  "matchedColors",
  "matchedCategories",
  "matchedAttributes",
  "softMatched",
  "structuredMatches",
];

const BLOAT_PROD = ["description", "exactMatch"];
const BLOAT_BRAND = ["id", "slug"];
const BLOAT_CATEGORY = ["id", "slug"];
const BLOAT_VARIANT = ["id", "sku"];
const BLOAT_COLOR = ["slug"];
const BLOAT_SIZE = ["id", "normalizedValue", "system"];

type WireObject = Record<string, unknown>;
type WireProduct = WireObject & { id?: unknown };
type WireResponse = {
  exactProducts?: WireProduct[];
  similarProducts?: WireProduct[];
  exactCount?: number;
  similarCount?: number;
  diagnostics?: unknown;
  structuredQuery?: unknown;
  categoryStatus?: unknown;
  similarMessage?: unknown;
};

const asProducts = (value: unknown): WireProduct[] =>
  Array.isArray(value) ? (value as WireProduct[]) : [];

const asObject = (
  value: unknown
): WireObject | null =>
  value !== null && typeof value === "object"
    ? (value as WireObject)
    : null;

async function go(
  q: string
): Promise<[WireResponse, WireResponse]> {
  const base = `${SEARCH}?q=${encodeURIComponent(q)}`;
  const [d, dbg] = await Promise.all([
    fetch(base).then((r) => r.json()),
    fetch(`${base}&debug=1`).then((r) => r.json()),
  ]);
  return [d, dbg];
}

const QUERIES = [
  "tank top",
  "black tank top",
  "clothing",
  "size small blouse",
  "tank top xl",
  "blue xyzzy",
  "xyzzy",
  "silk",
  "black shoes",
  "women's black cotton tank top size S",
  "hoodies",
  "jeans",
  "leather shoes",
  "size medium black tank top",
];

/* A4-part helper: identity between default and debug. */
const scalarCompare = (a: unknown, b: unknown) => {
  if (typeof a === "object" || typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return a === b;
};

{
  let modeLeak = 0;
  let bloatProd = 0;
  let bloatBrand = 0;
  let bloatCategory = 0;
  let bloatVariant = 0;
  let bloatColor = 0;
  let bloatSize = 0;
  let missingClient = 0;

  for (const q of QUERIES) {
    const [d] = await go(q);
    const products = [
      ...asProducts(d.exactProducts),
      ...asProducts(d.similarProducts),
    ];
    for (const p of products) {
      /* A1: no scoring internal leaks into the default payload. */
      for (const key of INTERNALS) {
        if (key in p) {
          modeLeak += 1;
        }
      }
      for (const key of BLOAT_PROD) {
        if (key in p) bloatProd += 1;
      }
      const brand = asObject(p.brand);
      const category = asObject(p.category);
      if (brand && BLOAT_BRAND.some((k) => k in brand)) bloatBrand += 1;
      if (category && BLOAT_CATEGORY.some((k) => k in category)) bloatCategory += 1;
      for (const v of asProducts(p.variants)) {
        for (const key of BLOAT_VARIANT) {
          if (key in v) bloatVariant += 1;
        }
        const color = asObject(v.color);
        const size = asObject(v.size);
        if (color && BLOAT_COLOR.some((k) => k in color)) bloatColor += 1;
        if (size && BLOAT_SIZE.some((k) => k in size)) bloatSize += 1;
      }

      /* A2: every client-consumed field is present. */
      const needed = [
        "id",
        "name",
        "price",
        "currency",
        "productUrl",
        "imageUrl",
        "availability",
        "gender",
        "variants",
        "attributes",
      ].filter((k) => !(k in p)).length;
      if (
        needed > 0 ||
        !brand ||
        !("name" in brand) ||
        !category ||
        !("name" in category)
      ) {
        missingClient += 1;
      }
      for (const v of asProducts(p.variants)) {
        if (
          !("price" in v) ||
          !("currency" in v) ||
          !("availability" in v) ||
          !("color" in v) ||
          !("size" in v)
        ) {
          missingClient += 1;
        }
        const color = asObject(v.color);
        const size = asObject(v.size);
        if (
          color &&
          (!("id" in color) || !("name" in color) || !("hex" in color))
        ) {
          missingClient += 1;
        }
        if (size && !("value" in size)) {
          missingClient += 1;
        }
      }
    }
  }

  check(
    "A1 no scoring internal in the default payload (any product)",
    modeLeak === 0,
    `leaks=${modeLeak}`
  );
  check(
    "A1 no bloat product fields (description/... ) in the default payload",
    bloatProd === 0,
    `bloat=${bloatProd}`
  );
  check(
    "A1 no bloat brand/category fields (id/slug)",
    bloatBrand === 0 && bloatCategory === 0,
    `brand=${bloatBrand} category=${bloatCategory}`
  );
  check(
    "A1 no bloat variant/color/size fields (id/sku/slug/system/normalizedValue)",
    bloatVariant === 0 && bloatColor === 0 && bloatSize === 0,
    `variant=${bloatVariant} color=${bloatColor} size=${bloatSize}`
  );
  check(
    "A2 all client-consumed fields present in the default payload",
    missingClient === 0,
    `missing=${missingClient}`
  );
}

/* A3: debug payload carries all ten scoring internals. */
{
  let missingInternals = 0;
  const [, dbg] = await go("tank top");
  const products = [
    ...asProducts(dbg.exactProducts),
    ...asProducts(dbg.similarProducts),
  ];
  for (const p of products) {
    for (const key of INTERNALS) {
      if (!(key in p)) missingInternals += 1;
    }
    if (
      p.structuredMatches !== undefined &&
      (p.structuredMatches === null ||
        typeof p.structuredMatches !== "object")
    ) {
      missingInternals += 1;
    }
    if (typeof p.score !== "number" || Number.isNaN(p.score)) {
      missingInternals += 1;
    }
  }
  check(
    "A3 ?debug=1 restores all ten scoring internals",
    missingInternals === 0,
    `missing=${missingInternals}`
  );
}

/* A4: default and debug are semantically identical. */
{
  let mismatches = 0;
  let checkedProducts = 0;
  for (const q of QUERIES) {
    const [d, dbg] = await go(q);
    if (
      d.exactCount !== dbg.exactCount ||
      d.similarCount !== dbg.similarCount ||
      !scalarCompare(d.diagnostics ?? [], dbg.diagnostics ?? []) ||
      !scalarCompare(d.structuredQuery ?? null, dbg.structuredQuery ?? null) ||
      !scalarCompare(d.categoryStatus ?? null, dbg.categoryStatus ?? null) ||
      !scalarCompare(d.similarMessage ?? null, dbg.similarMessage ?? null)
    ) {
      mismatches += 1;
    }
    const idsOf = (arr: WireProduct[] | undefined) =>
      (arr ?? []).map((p) => String(p.id)).join(",");
    if (idsOf(d.exactProducts) !== idsOf(dbg.exactProducts)) mismatches += 1;
    if (idsOf(d.similarProducts) !== idsOf(dbg.similarProducts)) mismatches += 1;
    checkedProducts +=
      (d.exactProducts?.length ?? 0) + (d.similarProducts?.length ?? 0);
  }
  check(
    "A4 default == debug for counts, ids, diagnostics, structuredQuery, categoryStatus",
    mismatches === 0,
    `mismatches=${mismatches} over ${checkedProducts} products`
  );
}

/* A5: the whitelist is smaller than the debug envelope. */
{
  const [d, dbg] = await go("clothing");
  const bytes = {
    full: JSON.stringify(dbg).length,
    slim: JSON.stringify(d).length,
  };
  check(
    "A5 default payload smaller than debug for 'clothing'",
    bytes.slim < bytes.full,
    `slim=${bytes.slim}B full=${bytes.full}B (-${Math.round((1 - bytes.slim / bytes.full) * 100)}%)`
  );
  console.log(
    `INFO clothing payload: default=${bytes.slim.toLocaleString()}B debug=${bytes.full.toLocaleString()}B (-${Math.round((1 - bytes.slim / bytes.full) * 100)}%)`
  );
}

console.log(`\n=== RESULT: ${passed}/${passed + failed} passed ===`);
process.exit(failed === 0 ? 0 : 1);