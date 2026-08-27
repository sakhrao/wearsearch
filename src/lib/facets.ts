export const SHOE_CATEGORY_NAMES = [
  "Sneakers",
  "Formal Shoes",
  "Boots",
  "Loafers",
  "Sandals",
  "Heels",
];

export type Discipline = "shoes" | "clothing";

const NUMERIC_SIZE = /^\d+(?:\.\d+)?$/;

export function isNumericSize(value: string): boolean {
  return NUMERIC_SIZE.test(value);
}

export function categoryDiscipline(
  categoryName: string | null
): Discipline {
  if (
    categoryName &&
    SHOE_CATEGORY_NAMES.includes(categoryName)
  ) {
    return "shoes";
  }
  return "clothing";
}

export type SizeFacetMap = Map<
  string,
  { label: string; count: number }
>;

export type SizeFacetGroups = {
  clothing: SizeFacetMap;
  shoes: SizeFacetMap;
};

type FacetableProduct = {
  category: { name: string };
  variants: { size: { value: string } | null }[];
};

export function buildSizeFacets(
  products: FacetableProduct[]
): SizeFacetGroups {
  const groups: SizeFacetGroups = {
    clothing: new Map(),
    shoes: new Map(),
  };

  for (const product of products) {
    const discipline = categoryDiscipline(
      product.category.name
    );
    const group = groups[discipline];
    const seen = new Set<string>();

    for (const variant of product.variants) {
      const size = variant.size;

      if (!size || seen.has(size.value)) {
        continue;
      }

      seen.add(size.value);

      const numeric = isNumericSize(size.value);

      if (
        (discipline === "shoes" && !numeric) ||
        (discipline === "clothing" && numeric)
      ) {
        continue;
      }

      const existing = group.get(size.value);

      group.set(size.value, {
        label: size.value,
        count: (existing?.count ?? 0) + 1,
      });
    }
  }

  return groups;
}