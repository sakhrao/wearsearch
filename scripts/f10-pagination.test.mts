/* =========================================================
   F10 - RESULT PAGINATION & PROGRESSIVE RENDERING

   The production /api/search payload is bounded to one ranked
   page (PAGE_SIZE=30, offset/limit). exactCount/similarCount are
   TOTAL matches; exactHasMore/similarHasMore drive Load more.
   ?debug=1 bypasses pagination (full envelope, hasMore=false)
   so ordering/count contract suites keep a stable baseline.

   F10-C: the facets block is computed server-side over the FULL
   ranked result set (exact + similar, F1-filtered) with EMPTY
   active filters. This suite proves it equals a recomputation
   over the full envelope alone (no page dependency, no drift),
   i.e. paging can never truncate or rescope the facet truth.

   Run against a live dev server:  npm run dev
   Execute:  npx tsx scripts/f10-pagination.test.mts
========================================================= */

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  countProductsForFacetValue,
  getProductFacets,
  type FacetProduct,
  type FacetKey,
  type ActiveFacetFilters,
} from "../src/lib/search-facets";

const SEARCH = "http://localhost:3000/api/search";
const PAGE_SIZE = 30;

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

function objEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

type WireColor = { id: string; name: string; hex: string | null };
type WireSize = { value: string | null };
type WireVariant = {
  price: string;
  currency: string | null;
  availability: string | null;
  color: WireColor | null;
  size: WireSize | null;
};
type WireProduct = {
  id: string;
  gender: string | null;
  category: { name: string | null } | null;
  brand: { name: string | null } | null;
  variants: WireVariant[];
};

type WireFacetOption = {
  value: string;
  label: string;
  count: number;
};
type WireResponse = {
  exactCount: number;
  similarCount: number;
  exactHasMore: boolean;
  similarHasMore: boolean;
  facets: Record<
    "gender" | "category" | "color" | "size" | "brand",
    WireFacetOption[]
  >;
  diagnostics: unknown[];
  structuredQuery: unknown;
  categoryStatus: unknown;
  similarMessage: string | null;
  exactProducts: WireProduct[];
  similarProducts: WireProduct[];
};

async function get(
  q: string,
  extra: string
): Promise<WireResponse> {
  const res = await fetch(
    `${SEARCH}?q=${encodeURIComponent(q)}${extra}`
  );
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for "${q}" ${extra}`);
  }
  return (await res.json()) as WireResponse;
}

const ids = (arr: { id: string }[]): string =>
  arr.map((p) => String(p.id)).join(",");

/* Full ranked envelope (debug channel) for one query. */
async function fullEnvelope(q: string): Promise<WireResponse> {
  return get(q, "&debug=1");
}

/* Bounded window semantics */
{
  const prev = await get("clothing", "");
  check(
    "P1 default window is PAGE_SIZE rows (30)",
    prev.exactProducts.length === PAGE_SIZE,
    `exact=${prev.exactProducts.length}`,
  );
  check(
    "P1 default window smaller than total",
    prev.exactCount === 517 &&
      prev.exactProducts.length < prev.exactCount,
    `count=${prev.exactCount} page=${prev.exactProducts.length}`,
  );
  check(
    "P1 default hasMore=true when window < total",
    prev.exactHasMore === true,
    `hasMore=${prev.exactHasMore}`,
  );
}

/* limit/offset slicing mirrors the exact ranking order */
{
  const q = "clothing";
  const debug = await fullEnvelope(q);
  const page1 = await get(q, "&limit=30&offset=0");
  const page2 = await get(q, "&limit=30&offset=30");

  const expectedPage2 = ids(debug.exactProducts.slice(30, 60));
  const expectedPage1 = ids(debug.exactProducts.slice(0, 30));

  check(
    "P2 offset=0 window == debug[0..30) (same order)",
    ids(page1.exactProducts) === expectedPage1,
    `got=${ids(page1.exactProducts).slice(0, 60)}`,
  );
  check(
    "P2 offset=30 window == debug[30..60) (same order)",
    ids(page2.exactProducts) === expectedPage2,
    `got=${ids(page2.exactProducts).slice(0, 60)}`,
  );
  check(
    "P2 windows are disjoint",
    new Set(page1.exactProducts.map((p) => p.id)).size ===
      page1.exactProducts.length &&
      page1.exactProducts.every(
        (p) =>
          !page2.exactProducts.some(
            (p2) => p2.id === p.id,
          ),
      ),
  );
  check(
    "P2 offset=30 hasMore=true (60 < 517)",
    page2.exactHasMore === true,
    `hasMore=${page2.exactHasMore}`,
  );
}

/* concat(pages) === debug envelope, no gaps, no duplicates */
{
  const q = "tops";
  const debug = await fullEnvelope(q);

  const collectedExact: string[] = [];
  const collectedSimilar: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await get(q, `&limit=${PAGE_SIZE}&offset=${offset}`);
    if (page.exactProducts.length === 0 && page.similarProducts.length === 0) {
      break;
    }
    for (const p of page.exactProducts) {
      collectedExact.push(p.id);
      if (seen.has(p.id)) duplicates += 1;
      seen.add(p.id);
    }
    for (const p of page.similarProducts) {
      collectedSimilar.push(p.id);
      if (seen.has(p.id)) duplicates += 1;
      seen.add(p.id);
    }
    if (page.exactHasMore === false && offset + PAGE_SIZE >= debug.exactCount) {
      break;
    }
  }

  check(
    "P3 concat(pages) exact == debug exact (order + set)",
    collectedExact.join(",") === ids(debug.exactProducts),
    `got ${collectedExact.length} collected vs ${debug.exactProducts.length} debug`,
  );
  check(
    "P3 concat(pages) similar == debug similar (order + set)",
    collectedSimilar.join(",") === ids(debug.similarProducts),
    `got ${collectedSimilar.length} collected vs ${debug.similarProducts.length} debug`,
  );
  check(
    "P3 concat(pages) has no duplicate ids",
    duplicates === 0,
    `duplicates=${duplicates}`,
  );
  check(
    "P3 totals match debug envelope sizes",
    collectedExact.length === debug.exactCount &&
      collectedSimilar.length === debug.similarCount,
    `exact ${collectedExact.length}/${debug.exactCount} similar ${collectedSimilar.length}/${debug.similarCount}`,
  );
}

/* exact boundaries under hasMore */
{
  const small = await get("tank top xl", "");
  check(
    "P4 25-result query: one page of 25, hasMore=false",
    small.exactProducts.length === 25 && small.exactHasMore === false,
    `page=${small.exactProducts.length} hasMore=${small.exactHasMore}`,
  );

  const one = await get("nike", "");
  check(
    "P4 one-result query: page keeps the single product",
    one.exactProducts.length === 1 && one.exactHasMore === false,
    `page=${one.exactProducts.length} total=${one.exactCount}`,
  );
}

/* debug bypasses paging entirely */
{
  const q = "clothing";
  const debug = await get(q, "&debug=1&limit=5&offset=9999");
  check(
    "P6 debug=1 returns full envelope even with limit/offset",
    debug.exactProducts.length === debug.exactCount,
    `arr=${debug.exactProducts.length} total=${debug.exactCount}`,
  );
  check(
    "P6 debug=1 hasMore=false",
    debug.exactHasMore === false,
    `hasMore=${debug.exactHasMore}`,
  );
}

/* param clamps and invalid input fall back safely */
{
  const over = await get("clothing", "&limit=500");
  check(
    "P7 limit>100 clamps to 100",
    over.exactProducts.length === 100,
    `arr=${over.exactProducts.length}`,
  );
  const zero = await get("clothing", "&limit=0");
  check(
    "P7 limit=0 clamps up to 1",
    zero.exactProducts.length === 1,
    `arr=${zero.exactProducts.length}`,
  );
  const nan = await get("clothing", "&limit=abc");
  check(
    "P7 non-numeric limit falls back to PAGE_SIZE",
    nan.exactProducts.length === PAGE_SIZE,
    `arr=${nan.exactProducts.length}`,
  );
  const negOffset = await get("clothing", "&offset=-5");
  check(
    "P7 negative offset clamps to 0",
    negOffset.exactProducts.length === PAGE_SIZE,
    `arr=${negOffset.exactProducts.length}`,
  );
  const far = await get("clothing", "&offset=5170");
  check(
    "P7 offset past end returns empty window (totals intact)",
    far.exactProducts.length === 0 &&
      far.exactCount === 517 &&
      far.exactHasMore === false,
    `arr=${far.exactProducts.length} total=${far.exactCount}`,
  );
}

/* non-paging envelope fields are page-invariant and == debug */
{
  for (const q of ["clothing", "tops", "blue xyzzy", "xyzzy"]) {
    const page = await get(q, "");
    const debug = await fullEnvelope(q);
    check(
      `P8 meta invariants for "${q}"`,
      objEqual(page.structuredQuery, debug.structuredQuery) &&
        objEqual(page.categoryStatus, debug.categoryStatus) &&
        objEqual(page.diagnostics, debug.diagnostics) &&
        page.exactCount === debug.exactCount &&
        page.similarCount === debug.similarCount,
      `structured=${objEqual(page.structuredQuery, debug.structuredQuery)} ` +
        `category=${objEqual(page.categoryStatus, debug.categoryStatus)} ` +
        `diag=${objEqual(page.diagnostics, debug.diagnostics)}`,
    );
  }
}

/* F10-C: facets block == recomputation over the FULL ranked set
   (EMPTY active filters), built from the DATABASE rows that fed
   the server (all variants, incl. OUT_OF_STOCK), keyed by the
   debug-envelope ids. The wire itself only carries AVAILABLE
   variants (F9 projection), so size/color truth must be verified
   from the DB; gender/category/brand are additionally covered
   here in full value+label+count identity. Proves paging can
   never truncate or rescope the facet block. */

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
  }),
});

{
  const EMPTY: ActiveFacetFilters = {
    gender: new Set<string>(),
    category: new Set<string>(),
    color: new Set<string>(),
    size: new Set<string>(),
    brand: new Set<string>(),
  };

  const KEYS: FacetKey[] = [
    "gender",
    "category",
    "color",
    "size",
    "brand",
  ];

  const expectedBlocks = (
    products: FacetProduct[]
  ): Record<FacetKey, Map<string, { label: string; count: number }>> => {
    const map: Record<
      FacetKey,
      Map<string, { label: string; count: number }>
    > = {
      gender: new Map(),
      category: new Map(),
      color: new Map(),
      size: new Map(),
      brand: new Map(),
    };
    for (const key of KEYS) {
      for (const product of products) {
        for (const entry of getProductFacets(product)[key]) {
          if (!map[key].has(entry.value)) {
            map[key].set(entry.value, {
              label: entry.label,
              count: 0,
            });
          }
        }
      }
      for (const [value, meta] of map[key]) {
        meta.count = countProductsForFacetValue(
          key,
          value,
          EMPTY,
          products,
        );
      }
    }
    return map;
  };

  for (const q of [
    "clothing",
    "tops",
    "tank top xl",
    "black tank top",
    "size small blouse",
    "blue xyzzy",
    "xyzzy",
    "black shoes",
  ]) {
    const page = await get(q, "");
    const debug = await fullEnvelope(q);

    const unionIds = [
      ...debug.exactProducts.map((p) => p.id),
      ...debug.similarProducts.map((p) => p.id),
    ];

    const dbRows = await prisma.product.findMany({
      where: { id: { in: unionIds } },
      include: {
        brand: true,
        category: true,
        variants: { include: { color: true, size: true } },
      },
    });
    const byId = new Map(dbRows.map((row) => [row.id, row]));
    type DbRow = (typeof dbRows)[number];

    const unionFull: FacetProduct[] = unionIds
      .map((id) => byId.get(id))
      .filter((row): row is DbRow => Boolean(row))
      .map((row) => ({
        gender: row.gender ?? null,
        category: row.category
          ? { id: row.category.id, name: row.category.name }
          : { id: "__null__", name: "" },
        brand: row.brand
          ? { id: row.brand.id, name: row.brand.name }
          : { id: "__null__", name: "" },
        variants: (row.variants ?? []).map((v) => ({
          color: v.color
            ? { id: v.color.id, name: v.color.name }
            : null,
          size: v.size ? { value: v.size.value } : null,
        })),
      }));

    check(
      `C "${q}" paged facets == debug facets (page-independent)`,
      objEqual(page.facets, debug.facets),
    );

    check(
      `C "${q}" DB union size == wire union size`,
      unionFull.length === unionIds.length,
      `db=${unionFull.length} wire=${unionIds.length}`,
    );

    const expected = expectedBlocks(unionFull);
    const wireFacets = page.facets;

    for (const key of KEYS) {
      const wireByValue = new Map(
        wireFacets[key].map((o) => [o.value, o]),
      );
      let ok = true;
      const missing: string[] = [];
      for (const [value, meta] of expected[key]) {
        const w = wireByValue.get(value);
        if (!w) {
          ok = false;
          missing.push(`${value} (missing)`);
          continue;
        }
        if (w.label !== meta.label) {
          ok = false;
          missing.push(`${value} (label ${w.label} != ${meta.label})`);
        }
        if (w.count !== meta.count) {
          ok = false;
          missing.push(`${value} (count ${w.count} != ${meta.count})`);
        }
      }
      check(
        `C facets "${q}" ${key}: == DB recompute (full, value-keyed)`,
        ok && wireFacets[key].length === expected[key].size,
        missing.slice(0, 8).join(" ") ||
          `wire=${wireFacets[key].length} expected=${expected[key].size}`,
      );
    }
  }
}

await prisma.$disconnect();

console.log(`\nF10: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);