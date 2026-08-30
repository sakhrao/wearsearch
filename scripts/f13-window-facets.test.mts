import {
  buildWindowFacetCounts,
  countProductsForFacetValue,
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

function product(
  gender: string | null,
  category: string,
  color: string,
  brand: { id: string; name: string },
  size = "M"
): FacetProduct {
  return {
    gender,
    category: { id: category, name: category },
    brand,
    variants: [
      {
        color: { id: "c-" + color, name: color },
        size: { value: size },
      },
    ],
  };
}

/* 30 loaded window products + 2 beyond it (page 2). */
const windowProducts: FacetProduct[] = [];
for (let i = 0; i < 30; i += 1) {
  windowProducts.push(
    product(
      "WOMEN",
      i % 2 === 0 ? "tshirts" : "jeans",
      "Red",
      { id: "b" + i, name: "Brand " + i }
    )
  );
}
const casualComfort = product("WOMEN", "tshirts", "Black", {
  id: "casual-comfort",
  name: "Casual Comfort",
});
const unisexHoodie = product("UNISEX", "hoodies", "Green", {
  id: "uni",
  name: "Uni",
}, "XL");

const page2Products = [casualComfort, unisexHoodie];
const allProducts = [...windowProducts, ...page2Products];

const optionValues: Record<FacetKey, string[]> = {
  gender: ["WOMEN", "MEN", "UNISEX"],
  category: ["tshirts", "jeans", "hoodies", "dresses"],
  color: ["c-Red", "c-Black", "c-Green", "c-Blue"],
  size: ["M", "L", "XL"],
  brand: [
    ...windowProducts.map((p) => p.brand.id),
    "casual-comfort",
    "uni",
    "absent-brand",
  ],
};

/* F13-1 core: a value whose only matches sit beyond the current
   window counts 0 (disabled); loading the next page brings its
   real count in automatically — no re-search involved. */
const windowCounts = buildWindowFacetCounts(
  windowProducts,
  EMPTY,
  optionValues
);
check(
  "window: out-of-window value -> 0",
  (windowCounts.brand.get("casual-comfort") ?? -1) === 0,
  `casual-comfort count over 30 loaded = ${windowCounts.brand.get("casual-comfort")}`
);
check(
  "window: unknown value -> 0, not undefined",
  windowCounts.brand.get("absent-brand") === 0,
  `absent-brand = ${windowCounts.brand.get("absent-brand")}`
);
check(
  "window: in-window value keeps its count",
  windowCounts.color.get("c-Red") === 30 &&
    windowCounts.category.get("tshirts") === 15,
  `red=${windowCounts.color.get("Red")} tshirts=${windowCounts.category.get("tshirts")}`
);
check(
  "window: absent categories render 0",
  windowCounts.category.get("dresses") === 0 &&
    windowCounts.category.get("hoodies") === 0,
  `dresses=${windowCounts.category.get("dresses")} hoodies=${windowCounts.category.get("hoodies")}`
);

const bootCounts = buildWindowFacetCounts(
  allProducts,
  EMPTY,
  optionValues
);
check(
  "full window: value becomes selectable after load",
  (bootCounts.brand.get("casual-comfort") ?? -1) === 1 &&
    bootCounts.color.get("c-Black") === 1,
  `casual-comfort=${bootCounts.brand.get("casual-comfort")} black=${bootCounts.color.get("c-Black")}`
);

/* AND across sections mirrors what the click would do: with
   category=tshirts active, brand counts re-scope truthfully. */
const tshirtsOnly = buildWindowFacetCounts(
  allProducts,
  filter("category", ["tshirts"]),
  optionValues
);
check(
  "multi-filter AND: counts re-scope under other-section filters",
  tshirtsOnly.color.get("c-Red") === 15 &&
    tshirtsOnly.color.get("c-Black") === 1 &&
    tshirtsOnly.category.get("jeans") === 15,
  `red=${tshirtsOnly.color.get("c-Red")} black=${tshirtsOnly.color.get("c-Black")} jeans=${tshirtsOnly.category.get("jeans")}`
);

/* UNISEX: with gender=MEN active, a UNISEX product still counts
   (same rule productMatchesFilters applies on the click side). */
const menOnly = buildWindowFacetCounts(
  allProducts,
  filter("gender", ["MEN"]),
  optionValues
);
check(
  "UNISEX: unisex product matches a selected gender",
  menOnly.category.get("hoodies") === 1 &&
    menOnly.brand.get("uni") === 1 &&
    menOnly.category.get("tshirts") === 0,
  `hoodies=${menOnly.category.get("hoodies")} uni=${menOnly.brand.get("uni")} tshirts=${menOnly.category.get("tshirts")}`
);

/* No-dead-end by construction: for every option whose window count
   is >0, the exact simulated filter it represents keeps >=1 product
   visible (independently recomputed via de productMatchesFilters). */
{
  const counts = buildWindowFacetCounts(
    allProducts,
    EMPTY,
    optionValues
  );
  const keys = Object.keys(optionValues) as FacetKey[];
  let allSafe = true;
  let totalEnabled = 0;
  let firstBad = "";
  for (const key of keys) {
    for (const value of optionValues[key]) {
      const count = counts[key].get(value) ?? 0;
      if (count === 0) {
        continue;
      }
      totalEnabled += 1;
      const simulated: ActiveFacetFilters = {
        ...EMPTY,
        [key]: new Set([value]),
      };
      const visible = allProducts.filter((p) =>
        productMatchesFilters(p, simulated)
      ).length;
      if (visible < 1) {
        allSafe = false;
        firstBad = `${key}=${value}`;
      }
    }
  }
  check(
    "no-dead-end: every enabled option keeps >=1 product visible",
    allSafe && totalEnabled > 0,
    `enabled=${totalEnabled} firstBad=${firstBad}`
  );
}

/* The helper stays in sync with the page's click predicate: the
   per-option count equals countProductsForFacetValue called the
   same way. */
check(
  "window count == countProductsForFacetValue (same result path)",
  windowCounts.color.get("c-Red") ===
    countProductsForFacetValue("color", "c-Red", EMPTY, windowProducts) &&
    bootCounts.brand.get("casual-comfort") ===
      countProductsForFacetValue(
        "brand",
        "casual-comfort",
        EMPTY,
        allProducts
      ),
  "count divergence between helpers"
);

console.log(
  `F13 window-facets: ${passed} passed, ${failed} failed`
);
process.exit(failed > 0 ? 1 : 0);