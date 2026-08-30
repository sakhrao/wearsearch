export type FacetKey =
  | "gender"
  | "category"
  | "color"
  | "size"
  | "brand";

export type FacetEntry = {
  value: string;
  label: string;
};

export type ActiveFacetFilters = Record<
  FacetKey,
  ReadonlySet<string>
>;

/* The minimal product surface the facet logic needs. The
   search page's Product shape is structurally compatible. */
export type FacetProduct = {
  gender: string | null;
  category: { id: string; name: string };
  brand: { id: string; name: string };
  variants: {
    color: { id: string; name: string } | null;
    size: { value: string } | null;
  }[];
};

export const FACET_KEYS: FacetKey[] = [
  "gender",
  "category",
  "color",
  "size",
  "brand",
];

export function getProductFacets(
  product: FacetProduct
): Record<FacetKey, FacetEntry[]> {
  const entries: Record<FacetKey, FacetEntry[]> = {
    gender: [],
    category: [],
    color: [],
    size: [],
    brand: [],
  };

  if (product.gender) {
    entries.gender.push({
      value: product.gender,
      label: product.gender,
    });
  }

  entries.category.push({
    value: product.category.id,
    label: product.category.name,
  });

  for (const variant of product.variants) {
    if (
      variant.color &&
      !entries.color.some(
        (entry) => entry.value === variant.color!.id
      )
    ) {
      entries.color.push({
        value: variant.color.id,
        label: variant.color.name,
      });
    }

    if (
      variant.size &&
      !entries.size.some(
        (entry) => entry.value === variant.size!.value
      )
    ) {
      entries.size.push({
        value: variant.size.value,
        label: variant.size.value,
      });
    }
  }

  entries.brand.push({
    value: product.brand.id,
    label: product.brand.name,
  });

  return entries;
}

/* Filtering semantics are preserved exactly:
   - OR within a section,
   - AND across sections,
   - gender special-cases UNISEX (a UNISEX product matches
     any selected gender). */
export function productMatchesFilters(
  product: FacetProduct,
  activeFilters: ActiveFacetFilters
): boolean {
  const facets = getProductFacets(product);

  for (const key of FACET_KEYS) {
    const selected = activeFilters[key];

    if (selected.size === 0) {
      continue;
    }

    const values = facets[key].map((entry) => entry.value);

    const matches =
      key === "gender"
        ? values.some(
            (value) =>
              selected.has(value) ||
              value === "UNISEX"
          )
        : values.some((value) =>
            selected.has(value)
          );

    if (!matches) {
      return false;
    }
  }

  return true;
}

/* Dynamic faceted count for a single option: how many
   products would actually be returned if the option were
   selected, combined with the current filters of every
   OTHER section. Simulating the click makes the number
   truthful even where matching rules create overlap (for
   example UNISEX products match any selected gender). */
export function countProductsForFacetValue(
  key: FacetKey,
  value: string,
  activeFilters: ActiveFacetFilters,
  products: FacetProduct[]
): number {
  const simulated: ActiveFacetFilters = {
    gender:
      key === "gender"
        ? new Set([value])
        : activeFilters.gender,
    category:
      key === "category"
        ? new Set([value])
        : activeFilters.category,
    color:
      key === "color"
        ? new Set([value])
        : activeFilters.color,
    size:
      key === "size"
        ? new Set([value])
        : activeFilters.size,
    brand:
      key === "brand"
        ? new Set([value])
        : activeFilters.brand,
  };

  let count = 0;

  for (const product of products) {
    if (productMatchesFilters(product, simulated)) {
      count += 1;
    }
  }

  return count;
}

/* F13-1: window-scoped facet counts. The caller supplies the
   option VALUE sets (server facet block values + catalog sizes);
   each count is re-derived over the currently LOADED window
   through the exact same predicate the card filtering uses
   (countProductsForFacetValue + productMatchesFilters). A value
   absent from the window gets 0, which the UI renders disabled,
   so no clickable option can ever empty the page. */
export function buildWindowFacetCounts(
  products: FacetProduct[],
  activeFilters: ActiveFacetFilters,
  optionValues: Record<FacetKey, readonly string[]>
): Record<FacetKey, ReadonlyMap<string, number>> {
  const counts: Record<FacetKey, Map<string, number>> = {
    gender: new Map(),
    category: new Map(),
    color: new Map(),
    size: new Map(),
    brand: new Map(),
  };

  for (const key of FACET_KEYS) {
    for (const value of optionValues[key]) {
      counts[key].set(
        value,
        countProductsForFacetValue(
          key,
          value,
          activeFilters,
          products
        )
      );
    }
  }

  return counts;
}