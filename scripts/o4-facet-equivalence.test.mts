/* O4 facet-block equivalence guard.

   The server facet block must stay EXACTLY what the previous
   per-option simulation produced (same option order, labels and
   counts), computed now in a single pass. These tests bind that
   contract to the PUBLIC, UNCHANGED helpers
   (getProductFacets / countProductsForFacetValue), which is the
   old semantics, so any future drift in option order/labels/counts
   fails deterministically.

   Part 1: pure fixture, no server.
   Part 2: live API (?debug=1) on several intents, requires the
   dev server on :3000. */

import {
  buildServerFacetBlock,
  countProductsForFacetValue,
  getProductFacets,
  type FacetKey,
  type FacetProduct,
  type FacetsBlock,
} from "../src/lib/search-facets";

const FACET_KEYS: FacetKey[] = [
  "gender",
  "category",
  "color",
  "size",
  "brand",
];

const EMPTY = {
  gender: new Set<string>(),
  category: new Set<string>(),
  color: new Set<string>(),
  size: new Set<string>(),
  brand: new Set<string>(),
};

function legacyBlock(products: FacetProduct[]): FacetsBlock {
  const options: Record<FacetKey, Map<string, { value: string; label: string; count: number }>> = {
    gender: new Map(),
    category: new Map(),
    color: new Map(),
    size: new Map(),
    brand: new Map(),
  };

  for (const key of FACET_KEYS) {
    for (const product of products) {
      for (const entry of getProductFacets(product)[key]) {
        if (!options[key].has(entry.value)) {
          options[key].set(entry.value, {
            value: entry.value,
            label: entry.label,
            count: 0,
          });
        }
      }
    }
    for (const entry of options[key].values()) {
      entry.count = countProductsForFacetValue(key, entry.value, EMPTY, products);
    }
  }

  return {
    gender: [...options.gender.values()],
    category: [...options.category.values()],
    color: [...options.color.values()],
    size: [...options.size.values()],
    brand: [...options.brand.values()],
  };
}

const json = (b: FacetsBlock) => JSON.stringify(b);

let passed = 0;
let failed = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name} :: ${detail}`);
  }
};

/* ---------- Part 1: pure fixture (UNISEX + multi-variant) ---------- */

const fixture: FacetProduct[] = [
  {
    gender: "WOMEN",
    category: { id: "tshirts", name: "T-Shirts" },
    brand: { id: "b1", name: "Brand A" },
    variants: [
      { color: { id: "red", name: "Red" }, size: { value: "M" } },
      { color: { id: "red", name: "Red" }, size: { value: "L" } },
      { color: { id: "blue", name: "Blue" }, size: { value: "L" } },
    ],
  },
  {
    gender: "WOMEN",
    category: { id: "jeans", name: "Jeans" },
    brand: { id: "b1", name: "Brand A" },
    variants: [{ color: { id: "blue", name: "Blue" }, size: { value: "32" } }],
  },
  {
    gender: "UNISEX",
    category: { id: "hoodies", name: "Hoodies" },
    brand: { id: "b2", name: "Brand B" },
    variants: [
      { color: { id: "black", name: "Black" }, size: { value: "XL" } },
      { color: { id: "red", name: "Red" }, size: { value: "L" } },
    ],
  },
  {
    gender: "MEN",
    category: { id: "hoodies", name: "Hoodies" },
    brand: { id: "b2", name: "Brand B" },
    variants: [{ color: { id: "red", name: "Red" }, size: { value: "M" } }],
  },
  {
    gender: null,
    category: { id: "tshirts", name: "T-Shirts" },
    brand: { id: "b3", name: "Brand C" },
    variants: [],
  },
];

const newBlock = buildServerFacetBlock(fixture);
const oldBlock = legacyBlock(fixture);

check(
  "P1 fixture: block is deep-equal to the legacy simulation",
  json(newBlock) === json(oldBlock),
  `new=${json(newBlock)} old=${json(oldBlock)}`
);

const optionsOf = (key: FacetKey) => newBlock[key].map((e) => e.value);
for (const key of FACET_KEYS) {
  const values = optionsOf(key);
  for (const value of values) {
    const entry = newBlock[key].find((e) => e.value === value)!;
    const expected = countProductsForFacetValue(key, value, EMPTY, fixture);
    check(
      `P1 ${key}=${value} count equals public countProductsForFacetValue`,
      entry.count === expected,
      `count=${entry.count} expected=${expected}`
    );
  }
}

check(
  "P1 per-key option order preserved (fixture)",
  json(newBlock) === json(oldBlock),
  "covered by P1 deep-equal"
);

const allValues = (b: FacetsBlock, key: FacetKey) =>
  new Set(b[key].map((e) => e.value));

check(
  "P1 attribute-less product contributes no facet sections",
  newBlock.color.length === 3 &&
    newBlock.size.length === 4 &&
    newBlock.gender.length === 3,
  `color=${newBlock.color.length} size=${newBlock.size.length} gender=${newBlock.gender.length}`
);

/* ---------- Part 2: function equivalence on live API shapes ----------
   The transmitted packet is built from the RAW ranked products (all
   variants), while ?debug=1 serializes only AVAILABLE variants, so
   the packet cannot be reconstructed from the payload. What CAN be
   guarded deterministically over live data:
   (a) both functions must stay interchangeable when fed the SAME
       product pool, and every option count must match the public
       countProductsForFacetValue, exactly reproducing the old
       semantics on real catalog shapes;
   (b) the packet's option set must CONTAIN every option of the
       projected (avail-only) pool, which is a subset of the raw
       pool that produced it. */

const INTENTS = ["clothing", "jeans", "dress", "shoes"];

type DebugVariant = {
  color: { id: string; name: string } | null;
  size: { value: string } | null;
};
type DebugProduct = {
  gender: string | null;
  category: { id: string; name: string };
  brand: { id: string; name: string };
  variants: DebugVariant[];
};
type DebugResponse = {
  exactProducts: DebugProduct[];
  similarProducts: DebugProduct[];
  facets: FacetsBlock;
};

for (const intent of INTENTS) {
  const url = `http://localhost:3000/api/search?q=${encodeURIComponent(intent)}&limit=30&debug=1`;
  let data: DebugResponse;
  try {
    const res = await fetch(url);
    data = (await res.json()) as DebugResponse;
  } catch (err) {
    check(
      `L ${intent}: dev server reachable`,
      false,
      `${url} -> ${err instanceof Error ? err.message : String(err)}`
    );
    continue;
  }

  const pool: FacetProduct[] = [
    ...data.exactProducts,
    ...data.similarProducts,
  ].map((p: DebugProduct) => ({
    gender: p.gender,
    category: p.category,
    brand: p.brand,
    variants: p.variants.map((v: DebugVariant) => ({
      color: v.color ? { id: v.color.id, name: v.color.name } : null,
      size: v.size ? { value: v.size.value } : null,
    })),
  }));

  const newOnPool = buildServerFacetBlock(pool);
  const legacyOnPool = legacyBlock(pool);

  check(
    `L ${intent}: buildServerFacetBlock deep-equals legacy simulation (${pool.length} projected products)`,
    json(newOnPool) === json(legacyOnPool),
    `new=${json(newOnPool).slice(0, 260)} legacy=${json(legacyOnPool).slice(0, 260)}`
  );

  for (const key of FACET_KEYS) {
    for (const entry of newOnPool[key]) {
      const expected = countProductsForFacetValue(key, entry.value, EMPTY, pool);
      check(
        `L ${intent} ${key}=${entry.value} count matches public helper`,
        entry.count === expected,
        `count=${entry.count} expected=${expected}`
      );
    }
  }

  const packet = {
    gender: data.facets.gender,
    category: data.facets.category,
    color: data.facets.color,
    size: data.facets.size,
    brand: data.facets.brand,
  } as FacetsBlock;

  for (const key of FACET_KEYS) {
    const packetValues = allValues(packet, key);
    let missing = 0;
    for (const value of allValues(newOnPool, key)) {
      if (!packetValues.has(value)) missing += 1;
    }
    check(
      `L ${intent}: packet option set covers projected pool (${key})`,
      missing === 0,
      `${missing} projected value(s) absent from packet ${key}`
    );
  }
}

console.log(`\nO4 equivalence: ${passed} passed, ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;