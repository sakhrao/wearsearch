"use client";

import { useMemo, useState } from "react";

type ProductAttribute = {
  value: string;
  attribute: {
    name: string;
  };
};

type ProductVariant = {
  id: string;
  sku: string | null;
  price: string | number;
  currency: string;
  availability: string;

  color: {
    id: string;
    name: string;
    slug: string;
    hex: string | null;
  } | null;

  size: {
    id: string;
    value: string;
    normalizedValue: string;
    system: string;
  } | null;
};

type Product = {
  id: string;
  name: string;
  description: string | null;
  price: string | number;
  currency: string;
  productUrl: string;
  imageUrl: string | null;
  gender: string | null;

  brand: {
    id: string;
    name: string;
    slug: string;
  };

  category: {
    id: string;
    name: string;
    slug: string;
  };

  variants: ProductVariant[];

  attributes: ProductAttribute[];

  score: number;
  exactMatch: boolean;
  similarMatch: boolean;

  matchedWords: number;
  totalQueryWords: number;
  matchedColors: number;
  matchedCategories: number;
  matchedAttributes: number;

  structuredMatches: {
    brand: boolean | null;
    category: boolean | null;
    color: boolean | null;
    size: boolean | null;
    gender: boolean | null;
    attributes: boolean | null;
  };
};

type StructuredQuery = {
  brand: string | null;
  category: string | null;
  color: string | null;
  size: string | null;
  gender: "MEN" | "WOMEN" | "UNISEX" | null;

  attributes: {
    attributeName: string;
    value: string;
  }[];
};

type CategoryStatus = {
  requested: string;
  productCount: number;
  siblings: string[];
} | null;

type FacetKey =
  | "gender"
  | "category"
  | "color"
  | "size"
  | "brand";

type ActiveFilters = Record<
  FacetKey,
  Set<string>
>;

const EMPTY_FILTERS: ActiveFilters = {
  gender: new Set(),
  category: new Set(),
  color: new Set(),
  size: new Set(),
  brand: new Set(),
};

const FACET_LABELS: Record<FacetKey, string> = {
  gender: "Gender",
  category: "Category",
  color: "Color",
  size: "Size",
  brand: "Brand",
};

type SearchResponse = {
  success: boolean;
  query: string;

  structuredQuery: StructuredQuery;

  categoryStatus: CategoryStatus;

  exactCount: number;
  similarCount: number;

  exactProducts: Product[];
  similarProducts: Product[];
};

/* ============================================================
   FACET HELPERS (display-level filtering only)
============================================================ */

const FACET_KEYS: FacetKey[] = [
  "gender",
  "category",
  "color",
  "size",
  "brand",
];

type FacetEntry = {
  value: string;
  label: string;
};

function getProductFacets(
  product: Product
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

function productMatchesFilters(
  product: Product,
  activeFilters: ActiveFilters
) {
  const facets = getProductFacets(product);

  for (const key of FACET_KEYS) {
    const selected = activeFilters[key];

    if (selected.size === 0) {
      continue;
    }

    const values =
      facets[key].map((entry) => entry.value);

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

export default function Home() {
  const [query, setQuery] = useState("");

  const [exactProducts, setExactProducts] = useState<Product[]>([]);
  const [similarProducts, setSimilarProducts] = useState<Product[]>([]);

  const [structuredQuery, setStructuredQuery] =
    useState<StructuredQuery | null>(null);

  const [categoryStatus, setCategoryStatus] =
    useState<CategoryStatus>(null);

  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<
    string | null
  >(null);

  const [activeFilters, setActiveFilters] =
    useState<ActiveFilters>(EMPTY_FILTERS);

  async function handleSearch() {
    const trimmedQuery = query.trim();

    if (!trimmedQuery || loading) {
      return;
    }

    setLoading(true);
    setSearched(true);
    setErrorMessage(null);
    setActiveFilters({
      gender: new Set(),
      category: new Set(),
      color: new Set(),
      size: new Set(),
      brand: new Set(),
    });

    try {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(trimmedQuery)}`
      );

      if (!response.ok) {
        throw new Error(
          `Search request failed: ${response.status}`
        );
      }

      const data: SearchResponse = await response.json();

      if (!data.success) {
        throw new Error("Search API returned an error");
      }

      setExactProducts(data.exactProducts ?? []);
      setSimilarProducts(data.similarProducts ?? []);
      setStructuredQuery(data.structuredQuery ?? null);
      setCategoryStatus(data.categoryStatus ?? null);
    } catch (error) {
      console.error("Search failed:", error);

      setExactProducts([]);
      setSimilarProducts([]);
      setStructuredQuery(null);
      setCategoryStatus(null);
      setActiveFilters({
        gender: new Set(),
        category: new Set(),
        color: new Set(),
        size: new Set(),
        brand: new Set(),
      });
      setErrorMessage(
        "Something went wrong while searching. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  function getSearchDescription() {
    if (!structuredQuery) {
      return null;
    }

    const parts: string[] = [];

    if (structuredQuery.gender) {
      parts.push(`Gender: ${structuredQuery.gender}`);
    }

    if (structuredQuery.brand) {
      parts.push(`Brand: ${structuredQuery.brand}`);
    }

    if (structuredQuery.category) {
      parts.push(`Category: ${structuredQuery.category}`);
    }

    if (structuredQuery.color) {
      parts.push(`Color: ${structuredQuery.color}`);
    }

    if (structuredQuery.size) {
      parts.push(`Size: ${structuredQuery.size}`);
    }

    for (const attribute of structuredQuery.attributes ?? []) {
      parts.push(
        `${attribute.attributeName}: ${attribute.value}`
      );
    }

    if (parts.length === 0) {
      return null;
    }

    return parts.join(" • ");
  }

  const searchDescription = getSearchDescription();

  const allProducts = useMemo(
    () => [...exactProducts, ...similarProducts],
    [exactProducts, similarProducts]
  );

  const facetOptions = useMemo(() => {
    const options: Record<
      FacetKey,
      Map<string, { label: string; count: number }>
    > = {
      gender: new Map(),
      category: new Map(),
      color: new Map(),
      size: new Map(),
      brand: new Map(),
    };

    for (const product of allProducts) {
      const facets = getProductFacets(product);

      for (const key of FACET_KEYS) {
        for (const entry of facets[key]) {
          const existing = options[key].get(
            entry.value
          );

          options[key].set(entry.value, {
            label: entry.label,
            count: (existing?.count ?? 0) + 1,
          });
        }
      }
    }

    return options;
  }, [allProducts]);

  const filteredExactProducts = useMemo(
    () =>
      exactProducts.filter((product) =>
        productMatchesFilters(product, activeFilters)
      ),
    [exactProducts, activeFilters]
  );

  const filteredSimilarProducts = useMemo(
    () =>
      similarProducts.filter((product) =>
        productMatchesFilters(product, activeFilters)
      ),
    [similarProducts, activeFilters]
  );

  const hasActiveFilters = FACET_KEYS.some(
    (key) => activeFilters[key].size > 0
  );

  function toggleFilter(
    key: FacetKey,
    value: string
  ) {
    setActiveFilters((previous) => {
      const next = new Set(previous[key]);

      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }

      return { ...previous, [key]: next };
    });
  }

  function clearAllFilters() {
    setActiveFilters({
      gender: new Set(),
      category: new Set(),
      color: new Set(),
      size: new Set(),
      brand: new Set(),
    });
  }

  return (
    <main className="min-h-screen bg-white text-black">
      <div className="mx-auto max-w-6xl px-6 py-12">

        {/* HEADER */}

        <div className="mb-12 text-center">
          <h1 className="text-4xl font-bold tracking-tight">
            WearSearch
          </h1>

          <p className="mt-3 text-gray-600">
            Find the clothes you are looking for
          </p>
        </div>

        {/* SEARCH */}

        <div className="mx-auto flex max-w-3xl gap-3">
          <input
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                handleSearch();
              }
            }}
            placeholder="Search for clothes..."
            className="flex-1 rounded-xl border border-gray-300 px-5 py-4 outline-none transition focus:border-black"
          />

          <button
            type="button"
            onClick={handleSearch}
            disabled={loading || !query.trim()}
            className="rounded-xl bg-black px-7 py-4 font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </div>

        {/* RESULTS */}

        {searched && (
          <section
            className={`mt-12 transition-opacity ${
              loading
                ? "pointer-events-none opacity-50"
                : ""
            }`}
          >

            {/* ERROR STATE */}

            {errorMessage ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-10 text-center">
                <h2 className="text-xl font-semibold text-red-700">
                  Search failed
                </h2>

                <p className="mt-2 text-sm text-red-600">
                  {errorMessage}
                </p>

                <button
                  type="button"
                  onClick={handleSearch}
                  className="mt-6 rounded-xl bg-red-600 px-5 py-3 text-sm font-medium text-white transition hover:bg-red-700"
                >
                  Try again
                </button>
              </div>
            ) : (
              <>

                {/* SEARCH INTERPRETATION */}

                {searchDescription && (
                  <div className="mb-8 rounded-xl bg-gray-50 px-5 py-4">
                    <p className="text-sm font-medium text-gray-700">
                      Search interpreted as:
                    </p>

                    <p className="mt-1 text-sm text-gray-500">
                      {searchDescription}
                    </p>
                  </div>
                )}

                {/* FILTERS */}

                {allProducts.length > 0 && (
                  <div className="mb-10 rounded-2xl border border-gray-200 p-5">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                        Refine results
                      </h2>

                      {hasActiveFilters && (
                        <button
                          type="button"
                          onClick={clearAllFilters}
                          className="text-xs font-medium text-gray-500 underline transition hover:text-black"
                        >
                          Clear filters
                        </button>
                      )}
                    </div>

                    <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                      {FACET_KEYS.map((key) => {
                        const options = [
                          ...(facetOptions[key] ??
                            new Map()).entries(),
                        ].sort((a, b) =>
                          a[1].label.localeCompare(
                            b[1].label
                          )
                        );

                        if (options.length === 0) {
                          return null;
                        }

                        return (
                          <div key={key}>
                            <p className="text-xs font-semibold text-gray-400">
                              {FACET_LABELS[key]}
                            </p>

                            <div className="mt-2 flex flex-wrap gap-2">
                              {options.map(
                                ([
                                  value,
                                  { label, count },
                                ]) => {
                                  const selected =
                                    activeFilters[
                                      key
                                    ].has(value);

                                  return (
                                    <button
                                      key={value}
                                      type="button"
                                      onClick={() =>
                                        toggleFilter(
                                          key,
                                          value
                                        )
                                      }
                                      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                                        selected
                                          ? "bg-black text-white"
                                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                                      }`}
                                    >
                                      {label} ({count})
                                    </button>
                                  );
                                }
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* EXACT RESULTS */}

                {filteredExactProducts.length > 0 && (
                  <>
                    <div className="mb-6">
                      <h2 className="text-2xl font-semibold">
                        Exact matches
                      </h2>

                      <p className="mt-1 text-sm text-gray-500">
                        {filteredExactProducts.length}{" "}
                        exact{" "}
                        {filteredExactProducts.length ===
                        1
                          ? "match"
                          : "matches"}{" "}
                        found
                      </p>
                    </div>

                    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                      {filteredExactProducts.map(
                        (product) => (
                          <ProductCard
                            key={product.id}
                            product={product}
                          />
                        )
                      )}
                    </div>
                  </>
                )}

                {/* NO EXACT RESULTS CONTEXT */}

                {exactProducts.length === 0 &&
                  similarProducts.length > 0 &&
                  categoryStatus &&
                  categoryStatus.productCount === 0 && (
                    <div className="rounded-2xl border border-gray-200 p-10 text-center">
                      <EmptyStateIcon />

                      <h2 className="mt-4 text-xl font-semibold">
                        No{" "}
                        {categoryStatus.requested.toLowerCase()}
                        s found yet
                      </h2>

                      <p className="mt-2 text-gray-500">
                        We don&apos;t stock any{" "}
                        {categoryStatus.requested.toLowerCase()}
                        s right now. Here are similar
                        options from related categories.
                      </p>
                    </div>
                  )}

                {exactProducts.length === 0 &&
                  (!categoryStatus ||
                    categoryStatus.productCount >
                      0) &&
                  similarProducts.length > 0 && (
                    <div className="rounded-2xl border border-gray-200 p-10 text-center">
                      <EmptyStateIcon />

                      <h2 className="mt-4 text-xl font-semibold">
                        No exact matches found
                      </h2>

                      <p className="mt-2 text-gray-500">
                        We couldn&apos;t find any products
                        that exactly match your search,
                        but these are close.
                      </p>
                    </div>
                  )}

                {/* SIMILAR RESULTS */}

                {filteredSimilarProducts.length >
                  0 && (
                  <div
                    className={
                      filteredExactProducts.length >
                      0
                        ? "mt-16"
                        : "mt-12"
                    }
                  >
                    <div className="mb-6">
                      <h2 className="text-2xl font-semibold">
                        Similar options
                      </h2>

                      <p className="mt-1 text-sm text-gray-500">
                        {
                          filteredSimilarProducts.length
                        }{" "}
                        similar{" "}
                        {filteredSimilarProducts.length ===
                        1
                          ? "product"
                          : "products"}{" "}
                        from related matches
                      </p>
                    </div>

                    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                      {filteredSimilarProducts.map(
                        (product) => (
                          <ProductCard
                            key={product.id}
                            product={product}
                          />
                        )
                      )}
                    </div>
                  </div>
                )}

                {/* FILTERS HIDE EVERYTHING */}

                {hasActiveFilters &&
                  allProducts.length > 0 &&
                  filteredExactProducts.length ===
                    0 &&
                  filteredSimilarProducts.length ===
                    0 && (
                    <div className="rounded-2xl border border-gray-200 p-10 text-center">
                      <EmptyStateIcon />

                      <h2 className="mt-4 text-xl font-semibold">
                        No products match your
                        filters
                      </h2>

                      <p className="mt-2 text-gray-500">
                        Try removing one or more
                        filters to see more results.
                      </p>

                      <button
                        type="button"
                        onClick={clearAllFilters}
                        className="mt-6 rounded-xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:bg-gray-800"
                      >
                        Clear filters
                      </button>
                    </div>
                  )}

                {/* NOTHING FOUND */}

                {exactProducts.length === 0 &&
                  similarProducts.length === 0 && (
                    <div className="rounded-2xl border border-gray-200 p-10 text-center">
                      <EmptyStateIcon />

                      <h2 className="mt-4 text-xl font-semibold">
                        {categoryStatus &&
                        categoryStatus.productCount > 0
                          ? `Nothing matched your full ${categoryStatus.requested.toLowerCase()} search`
                          : "Nothing found"}
                      </h2>

                      <p className="mt-2 text-gray-500">
                        {categoryStatus &&
                        categoryStatus.productCount > 0
                          ? `We carry ${categoryStatus.requested.toLowerCase()}s, but none matched everything you asked for.`
                          : "We couldn't find any products matching your search."}
                      </p>

                      <p className="mt-4 text-sm text-gray-400">
                        Try searching for another color, brand,
                        category, size, or clothing type.
                      </p>
                    </div>
                  )}

              </>
            )}

          </section>
        )}
      </div>
    </main>
  );
}

/* ============================================================
   EMPTY STATE ICON
============================================================ */

function EmptyStateIcon() {
  return (
    <svg
      className="mx-auto h-10 w-10 text-gray-300"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
      />
    </svg>
  );
}

/* ============================================================
   STORE NAME DERIVATION
============================================================ */

function getStoreName(productUrl: string) {
  try {
    return new URL(productUrl).hostname.replace(
      /^www\./,
      ""
    );
  } catch {
    return "";
  }
}

/* ============================================================
   PRODUCT CARD
============================================================ */

function ProductCard({
  product,
}: {
  product: Product;
}) {
  const storeName = getStoreName(
    product.productUrl
  );

  const variantColors: {
    id: string;
    name: string;
    hex: string | null;
  }[] = [];

  const seenColorIds = new Set<string>();

  for (const variant of product.variants) {
    if (
      variant.color &&
      !seenColorIds.has(variant.color.id)
    ) {
      seenColorIds.add(variant.color.id);

      variantColors.push({
        id: variant.color.id,
        name: variant.color.name,
        hex: variant.color.hex,
      });
    }
  }

  const variantSizes: string[] = [];

  const seenSizeValues = new Set<string>();

  for (const variant of product.variants) {
    const sizeValue = variant.size?.value;

    if (
      sizeValue &&
      !seenSizeValues.has(sizeValue)
    ) {
      seenSizeValues.add(sizeValue);

      variantSizes.push(sizeValue);
    }
  }

  return (
    <article className="overflow-hidden rounded-2xl border border-gray-200 bg-white transition hover:shadow-lg">

      {/* IMAGE */}

      {product.imageUrl ? (
        <img
          src={product.imageUrl}
          alt={product.name}
          className="h-80 w-full object-cover"
        />
      ) : (
        <div className="flex h-80 w-full items-center justify-center bg-gray-100 text-gray-400">
          No image
        </div>
      )}

      {/* CONTENT */}

      <div className="p-5">

        {/* BRAND + STORE */}

        <p className="text-sm text-gray-500">
          {product.brand.name}
          {storeName && (
            <span className="text-gray-400">
              {" "}
              • {storeName}
            </span>
          )}
        </p>

        {/* NAME */}

        <h3 className="mt-1 text-lg font-semibold">
          {product.name}
        </h3>

        {/* CATEGORY */}

        <p className="mt-2 text-sm text-gray-500">
          {product.category.name}
        </p>

        {/* GENDER */}

        {product.gender && (
          <span className="mt-3 inline-block rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
            {product.gender}
          </span>
        )}

        {/* COLORS */}

        {variantColors.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-600">
            <span className="flex gap-1">
              {variantColors.map((color) => (
                <span
                  key={color.id}
                  title={color.name}
                  className="inline-block h-3 w-3 rounded-full border border-gray-300"
                  style={{
                    backgroundColor:
                      color.hex || "transparent",
                  }}
                />
              ))}
            </span>

            <span>
              {variantColors
                .map((color) => color.name)
                .join(", ")}
            </span>
          </div>
        )}

        {/* SIZES */}

        {variantSizes.length > 0 && (
          <div className="mt-1 text-xs text-gray-600">
            Sizes: {variantSizes.join(", ")}
          </div>
        )}

        {/* ATTRIBUTES */}

        {product.attributes.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {product.attributes
              .filter(
                (attribute) => {
                  const normalizedValue =
                    attribute.value
                      .trim()
                      .toLowerCase();

                  return (
                    normalizedValue !== "" &&
                    normalizedValue !== "n/a" &&
                    normalizedValue !== "n a"
                  );
                }
              )
              .slice(0, 4)
              .map((attribute, index) => (
                <span
                  key={`${attribute.attribute.name}-${attribute.value}-${index}`}
                  className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600"
                >
                  {attribute.attribute.name}:{" "}
                  {attribute.value}
                </span>
              ))}
          </div>
        )}

        {/* PRICE */}

        <div className="mt-5 flex items-center justify-between">
          <span className="text-lg font-bold">
            {product.price} {product.currency}
          </span>

          <a
            href={product.productUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800"
          >
            View product
          </a>
        </div>
      </div>
    </article>
  );
}
