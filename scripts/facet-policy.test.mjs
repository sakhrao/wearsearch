import {
  buildSizeFacets,
  categoryDiscipline,
  isNumericSize,
} from "../src/lib/facets";

const BASE = "http://localhost:3000/api/search";

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

const ALPHABETIC = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"];
const NUMERIC_ONLY = (values) => values.every((v) => isNumericSize(v));
const ALPHA_ONLY = (values) =>
  values.length > 0 && values.every((v) => ALPHABETIC.includes(v));

/* ============ PURE UNIT TESTS ============ */

check(
  "U1 categoryDiscipline maps shoe subtree to shoes",
  categoryDiscipline("Sneakers") === "shoes" &&
    categoryDiscipline("Boots") === "shoes",
  `Sneakers=${categoryDiscipline("Sneakers")}`
);
check(
  "U2 categoryDiscipline maps clothing categories to clothing",
  categoryDiscipline("Jeans") === "clothing" &&
    categoryDiscipline("T-Shirts") === "clothing",
  `Jeans=${categoryDiscipline("Jeans")}`
);
check(
  "U3 isNumericSize accepts shoe sizes only",
  isNumericSize("41") && isNumericSize("7.5") && !isNumericSize("S") && !isNumericSize("XL"),
  `41=${isNumericSize("41")}, S=${isNumericSize("S")}`
);

const clothingProducts = [
  {
    category: { name: "Jeans" },
    variants: [
      { size: { value: "S" } },
      { size: { value: "M" } },
      { size: { value: "30" } },
    ],
  },
];
const clothingOnly = buildSizeFacets(clothingProducts);
check(
  "U4 clothing-only products feed the clothing group, numeric sizes rejected",
  clothingOnly.clothing.size === 2 &&
    clothingOnly.shoes.size === 0 &&
    clothingOnly.clothing.has("S") &&
    clothingOnly.clothing.has("M") &&
    !clothingOnly.clothing.has("30"),
  `clothing=[${[...clothingOnly.clothing.keys()].join(",")}] shoes=[${[...clothingOnly.shoes.keys()].join(",")}]`
);

const shoeProducts = [
  {
    category: { name: "Sneakers" },
    variants: [
      { size: { value: "41" } },
      { size: { value: "42" } },
    ],
  },
];
const shoesOnly = buildSizeFacets(shoeProducts);
check(
  "U5 shoe-only products feed the shoes group with numerics",
  shoesOnly.shoes.size === 2 &&
    shoesOnly.clothing.size === 0 &&
    shoesOnly.shoes.has("41"),
  `clothing=[${[...shoesOnly.clothing.keys()].join(",")}] shoes=[${[...shoesOnly.shoes.keys()].join(",")}]`
);

const misclassified = buildSizeFacets([
  {
    category: { name: "Sneakers" },
    variants: [
      { size: { value: "S" } },
      { size: { value: "M" } },
      { size: { value: "L" } },
      { size: { value: "XL" } },
    ],
  },
]);
check(
  "U6 a misclassified Sneakers product with S/M/L sizes pollutes NEITHER group",
  misclassified.shoes.size === 0 && misclassified.clothing.size === 0,
  `clothing=[${[...misclassified.clothing.keys()].join(",")}] shoes=[${[...misclassified.shoes.keys()].join(",")}]`
);

const mixed = buildSizeFacets([
  ...clothingProducts,
  ...shoeProducts,
]);
check(
  "U7 mixed results produce two disjoint, discipline-correct groups",
  NUMERIC_ONLY([...mixed.shoes.keys()]) &&
    ALPHA_ONLY([...mixed.clothing.keys()]) &&
    [...mixed.clothing.keys()].every(
      (k) => !mixed.shoes.has(k)
    ),
  `clothing=[${[...mixed.clothing.keys()].join(",")}] shoes=[${[...mixed.shoes.keys()].join(",")}]`
);

/* ============ INTEGRATION TESTS (live API) ============ */

async function search(q) {
  const res = await fetch(`${BASE}?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for "${q}"`);
  return res.json();
}

async function ranks(q) {
  const d = await search(q);
  const products = [...d.exactProducts, ...d.similarProducts];
  const groups = buildSizeFacets(products);
  const brands = new Set(products.map((p) => p.brand.name));
  return { d, groups, brands };
}

const sneakers = await ranks("sneakers");
check(
  "I1 sneakers -> Shoe Size group only (numeric)",
  sneakers.groups.shoes.size > 0 &&
    sneakers.groups.clothing.size === 0 &&
    NUMERIC_ONLY([...sneakers.groups.shoes.keys()]),
  `clothing=[${[...sneakers.groups.clothing.keys()].join(",")}] shoes=[${[...sneakers.groups.shoes.keys()].join(",")}]`
);

const jeans = await ranks("jeans");
check(
  "I2 jeans -> Clothing Size group only (alphabetic)",
  jeans.groups.clothing.size > 0 &&
    jeans.groups.shoes.size === 0 &&
    ALPHA_ONLY([...jeans.groups.clothing.keys()]),
  `clothing=[${[...jeans.groups.clothing.keys()].join(",")}] shoes=[${[...jeans.groups.shoes.keys()].join(",")}]`
);

const nike = await ranks("nike");
check(
  "I3 nike -> sole real Nike (Air Jordan 1) is a sneaker WITHOUT size metadata -> both groups empty (data-reflecting; PR2-F1 re-based)",
  nike.groups.clothing.size === 0 && nike.groups.shoes.size === 0,
  `clothing=[${[...nike.groups.clothing.keys()].join(",")}] shoes=[${[...nike.groups.shoes.keys()].join(",")}]`
);

const blackShoes = await ranks("black shoes");
check(
  "I4 black shoes -> Shoe Size group only (numeric)",
  blackShoes.groups.shoes.size > 0 &&
    blackShoes.groups.clothing.size === 0 &&
    NUMERIC_ONLY([...blackShoes.groups.shoes.keys()]),
  `clothing=[${[...blackShoes.groups.clothing.keys()].join(",")}] shoes=[${[...blackShoes.groups.shoes.keys()].join(",")}]`
);

const tank = await ranks("size medium black tank top");
check(
  "I5 tank top -> Clothing Size group only (alphabetic)",
  tank.groups.clothing.size > 0 &&
    tank.groups.shoes.size === 0 &&
    ALPHA_ONLY([...tank.groups.clothing.keys()]),
  `clothing=[${[...tank.groups.clothing.keys()].join(",")}] shoes=[${[...tank.groups.shoes.keys()].join(",")}]`
);

/* Brand behavior unchanged: options derive from the current search context. */

check(
  "I6a jeans brands derive from context products (Trendsi real jean only; PR2-F1 re-based: demo Zara/H&M jeans excluded)",
  !jeans.brands.has("Nike") &&
    !jeans.brands.has("Adidas") &&
    !jeans.brands.has("Puma") &&
    !jeans.brands.has("Zara") &&
    !jeans.brands.has("H&M") &&
    jeans.brands.has("Trendsi"),
  `brands=${[...jeans.brands].sort().join(", ")}`
);
check(
  "I6b nike brands derive from context products (Nike only)",
  nike.brands.size === 1 && nike.brands.has("Nike"),
  `brands=${[...nike.brands].sort().join(", ")}`
);
check(
  "I6c sneakers brands derive from context products (Trendsi present)",
  sneakers.brands.has("Trendsi") && sneakers.brands.has("Nike"),
  `brands=${[...sneakers.brands].sort().join(", ")}`
);

/* Engine untouched goldens (PR2-F1 re-based: demo items excluded). */

const goldens = [
  ["sneakers", 14],
  ["jeans", 1],
  ["black shoes", 24],
  ["nike", 1],
  ["size medium black tank top", 18],
];
for (const [q, expected] of goldens) {
  const { d } = await ranks(q);
  const detail = `exact=${d.exactCount} expected=${expected}`;
  check(`G "${q}" exact count unchanged (${expected})`, d.exactCount === expected, detail);
}

console.log(`\n=== RESULT: ${passed}/${passed + failed} passed ===`);
process.exit(failed === 0 ? 0 : 1);