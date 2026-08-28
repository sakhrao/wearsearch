import {
  countProductsForFacetValue,
  getProductFacets,
  productMatchesFilters,
  type ActiveFacetFilters,
  type FacetKey,
  type FacetProduct,
} from "../src/lib/search-facets";

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

const EMPTY: ActiveFacetFilters = {
  gender: new Set(),
  category: new Set(),
  color: new Set(),
  size: new Set(),
  brand: new Set(),
};

function filter(
  key: FacetKey,
  values: string[]
): ActiveFacetFilters {
  return { ...EMPTY, [key]: new Set(values) };
}
function filters(
  ...pairs: [FacetKey, string[]][]
): ActiveFacetFilters {
  const f = { ...EMPTY };
  for (const [key, values] of pairs) {
    f[key] = new Set(values);
  }
  return f;
}

function product(
  gender: string | null,
  category: { id: string; name: string },
  variants: {
    color: string | null;
    size: string | null;
  }[]
): FacetProduct {
  return {
    gender,
    category,
    brand: { id: "b" + category.id, name: category.name },
    variants: variants.map(({ color, size }) => ({
      color: color ? { id: "c-" + color, name: color } : null,
      size: size ? { value: size } : null,
    })),
  };
}

const womenRedTshirt = product("WOMEN", { id: "tshirts", name: "T-Shirts" }, [
  { color: "Red", size: "M" },
  { color: "Red", size: "L" },
]);
const womenBlueJeans = product("WOMEN", { id: "jeans", name: "Jeans" }, [
  { color: "Blue", size: "32" },
]);
const unisexBlackHoodie = product("UNISEX", { id: "hoodies", name: "Hoodies" }, [
  { color: "Black", size: "XL" },
]);
const menRedHoodie = product("MEN", { id: "hoodies", name: "Hoodies" }, [
  { color: "Red", size: "L" },
]);

const products = [
  womenRedTshirt,
  womenBlueJeans,
  unisexBlackHoodie,
  menRedHoodie,
];

/* --- regression: no filters -> plain per-value counts --- */

const redEntriesNoFilter = countProductsForFacetValue(
  "color",
  "c-Red",
  EMPTY,
  products
);
const redOwnCount = products.filter((p) =>
  getProductFacets(p).color.some((e) => e.value === "c-Red")
).length;
check(
  "R1 no-filter color count equals plain per-value count",
  redEntriesNoFilter === redOwnCount && redOwnCount === 2,
  `count=${redEntriesNoFilter} own=${redOwnCount}`
);
check(
  "R2 no-filter gender counts match click yield (UNISEX included)",
  countProductsForFacetValue("gender", "WOMEN", EMPTY, products) === 3 &&
    countProductsForFacetValue("gender", "MEN", EMPTY, products) === 2 &&
    countProductsForFacetValue("gender", "UNISEX", EMPTY, products) === 1,
  `women=${countProductsForFacetValue("gender", "WOMEN", EMPTY, products)} men=${countProductsForFacetValue("gender", "MEN", EMPTY, products)} unisex=${countProductsForFacetValue("gender", "UNISEX", EMPTY, products)}`
);

/* --- P9: faceted counting under an active selection --- */

const genderWomen = filter("gender", ["WOMEN"]);

check(
  "D1 gender=Women -> color counts shrink to women+unisex products",
  countProductsForFacetValue("color", "c-Red", genderWomen, products) === 1 &&
    countProductsForFacetValue("color", "c-Blue", genderWomen, products) === 1 &&
    countProductsForFacetValue("color", "c-Black", genderWomen, products) === 1,
  `red=${countProductsForFacetValue("color", "c-Red", genderWomen, products)} blue=${countProductsForFacetValue("color", "c-Blue", genderWomen, products)} black=${countProductsForFacetValue("color", "c-Black", genderWomen, products)}`
);
check(
  "D2 gender=Women -> size counts reflect the women+unisex universe",
  countProductsForFacetValue("size", "M", genderWomen, products) === 1 &&
    countProductsForFacetValue("size", "L", genderWomen, products) === 1 &&
    countProductsForFacetValue("size", "XL", genderWomen, products) === 1 &&
    countProductsForFacetValue("size", "32", genderWomen, products) === 1,
  `M=${countProductsForFacetValue("size", "M", genderWomen, products)} L=${countProductsForFacetValue("size", "L", genderWomen, products)} XL=${countProductsForFacetValue("size", "XL", genderWomen, products)} 32=${countProductsForFacetValue("size", "32", genderWomen, products)}`
);

/* --- D3: AND across sections --- */

const womenAndJeans = filters(["gender", ["WOMEN"]], ["category", ["jeans"]]);
check(
  "D3 category count is AND-ed with an active gender filter",
  countProductsForFacetValue("category", "tshirts", womenAndJeans, products) === 1 &&
    countProductsForFacetValue("category", "jeans", womenAndJeans, products) === 1 &&
    countProductsForFacetValue("category", "hoodies", womenAndJeans, products) === 1,
  `tshirts=${countProductsForFacetValue("category", "tshirts", womenAndJeans, products)} jeans=${countProductsForFacetValue("category", "jeans", womenAndJeans, products)} hoodies=${countProductsForFacetValue("category", "hoodies", womenAndJeans, products)}`
);
check(
  "D4 selected section does not auto-dismiss its own options",
  countProductsForFacetValue("color", "c-Red", genderWomen, products) === 1 &&
    countProductsForFacetValue("color", "c-Black", genderWomen, products) === 1,
  `red=${countProductsForFacetValue("color", "c-Red", genderWomen, products)} black=${countProductsForFacetValue("color", "c-Black", genderWomen, products)}`
);

/* --- consistency: a chip count equals what selecting it returns --- */

for (const [key, value] of [
  ["color", "c-Red"],
  ["color", "c-Black"],
  ["size", "L"],
  ["size", "XL"],
  ["gender", "WOMEN"],
] as [FacetKey, string][]) {
  const count = countProductsForFacetValue(
    key,
    value,
    genderWomen,
    products
  );
  const simulated = {
    gender:
      key === "gender"
        ? new Set([value])
        : genderWomen.gender,
    category: genderWomen.category,
    color:
      key === "color"
        ? new Set([value])
        : genderWomen.color,
    size:
      key === "size"
        ? new Set([value])
        : genderWomen.size,
    brand: genderWomen.brand,
  };
  const yielded = products.filter((p) =>
    productMatchesFilters(p, simulated)
  ).length;
  check(
    `C "${key}=${value}" count matches click yield`,
    count === yielded,
    `count=${count} yield=${yielded}`
  );
}

console.log(`\n=== RESULT: ${passed}/${passed + failed} passed ===`);
process.exit(failed === 0 ? 0 : 1);