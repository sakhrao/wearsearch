"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  type SearchIntent,
  buildSearchQueryString,
  decodeSearchUrl,
  parseSearchUrl,
  searchIntentKey,
} from "@/lib/search-url";
import {
  hasRealProductPage,
  productStoreLabel,
} from "@/lib/product-url";
import {
  FACET_KEYS,
  buildWindowFacetCounts,
  productMatchesFilters,
  type FacetKey,
} from "@/lib/search-facets";
import {
  type QuestionnaireAnswers,
} from "@/lib/questionnaire";
import { buildEditAnswers } from "@/lib/questionnaire-restore";

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
  colors: string[] | null;
  size: string | null;
  gender: "MEN" | "WOMEN" | "KIDS" | "UNISEX" | null;

  attributes: {
    attributeName: string;
    value: string;
  }[];

  budget: {
    min: number | null;
    max: number | null;
  } | null;
};

type CategoryStatus = {
  requested: string;
  productCount: number;
  siblings: string[];
} | null;

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

const FX_MAX_ATTEMPTS = 3;
const FX_BACKOFF_MS = [500, 1500];

type SearchResponse = {
  success: boolean;
  query: string;

  structuredQuery: StructuredQuery;

  categoryStatus: CategoryStatus;

  exactCount: number;
  similarCount: number;

  /* F10: totals stay totals; the UI loads one ranked page at a
     time and appends (Load more) while hasMore is true. */
  exactHasMore: boolean;
  similarHasMore: boolean;

  /* F10: server-side facet truth over the full ranked result set
     (exact + similar), so a bounded payload never truncates the
     facet options or their counts. */
  facets: FacetsBlock;

  similarMessage: string | null;

  diagnostics: string[];

  exactProducts: Product[];
  similarProducts: Product[];
};

/* F10: page-level values come straight from the API. Value
   identity is unchanged vs the lib (category.id, brand.id,
   color.id, size.value, gender). */
type FacetOption = {
  value: string;
  label: string;
  count: number;
};

type FacetsBlock = {
  gender: FacetOption[];
  category: FacetOption[];
  color: FacetOption[];
  size: FacetOption[];
  brand: FacetOption[];
};

type CatalogSizeGroups = {
  clothing: string[];
  shoes: string[];
};

/* Facet helpers are shared pure logic in @/lib/search-facets. */

const EMPTY_SEARCH_PARAMS: SearchIntent["params"] = {
  priceMin: null,
  priceMax: null,
  soft: null,
  budgetCurrency: null,
  budgetDisplayMin: null,
  budgetDisplayMax: null,
};

export default function HomePage() {
  return (
    <Suspense fallback={<HomeFallback />}>
      <Home />
    </Suspense>
  );
}

function HomeFallback() {
  return <main className="min-h-screen bg-white text-black" />;
}

function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState("");

  const [exactProducts, setExactProducts] = useState<Product[]>([]);
  const [similarProducts, setSimilarProducts] = useState<Product[]>([]);

  const [similarMessage, setSimilarMessage] = useState<
    string | null
  >(null);

  const [diagnostics, setDiagnostics] = useState<
    string[]
  >([]);

  const [intentBudget, setIntentBudget] = useState<{
    min: string | null;
    max: string | null;
    currency: "USD" | "EUR" | null;
  } | null>(null);

  const [catalogSizes, setCatalogSizes] =
    useState<CatalogSizeGroups | null>(null);

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

  /* F10: server-side facet truth + page state. */
  const [facets, setFacets] =
    useState<FacetsBlock>({
      gender: [],
      category: [],
      color: [],
      size: [],
      brand: [],
    });

  const [exactTotal, setExactTotal] =
    useState<number>(0);
  const [similarTotal, setSimilarTotal] =
    useState<number>(0);
  const [exactHasMore, setExactHasMore] =
    useState<boolean>(false);
  const [similarHasMore, setSimilarHasMore] =
    useState<boolean>(false);
  const [loadingMore, setLoadingMore] =
    useState<boolean>(false);

  /* Loaded offsets drive the next Load-more fetch. */
  const exactOffsetRef = useRef<number>(0);
  const similarOffsetRef = useRef<number>(0);

  const resultsRef =
    useRef<HTMLElement | null>(null);

  /* Keeps the last executed search so a URL change that
     resolves to the same /api/search call is not re-run. */
  const lastUrlSearchKeyRef = useRef<string | null>(null);

  /* Keeps the last executed intent so the error-state
     "Try again" re-runs the same search. */
  const lastSearchIntentRef =
    useRef<SearchIntent | null>(null);

  /* F11: monotonically increasing epoch so a stale search /
     load-more response can never mutate newer results. */
  const searchSeqRef = useRef<number>(0);

  const [fxRate, setFxRate] = useState<number | null>(null);
  const [fxError, setFxError] = useState(false);
  const [fxLoading, setFxLoading] = useState(false);
  const fxChainRef = useRef<Promise<boolean> | null>(null);
  const fxMountedRef = useRef(true);

  /* F14-C1: a USD budget URL cannot resolve until the fx rate
     arrives (parseSearchUrl -> "wait-fx"), and the rate only
     comes from the single /api/meta fetch on mount. A transient
     meta failure used to be swallowed, leaving the page silently
     frozen with no results, no error and no retry. This fetch is
     retried FX_MAX_ATTEMPTS times with a short backoff, one
     chain shared across StrictMode's double mount, and on final
     failure raises fxError so the wait-fx branch renders an
     explicit error + Retry. The API contract is untouched and
     /api/search is never called while the rate is unknown. */
  const loadFxRate = useCallback((): Promise<boolean> => {
    const existing = fxChainRef.current;
    if (existing) {
      return existing;
    }

    const run = async (): Promise<boolean> => {
      for (
        let attempt = 0;
        attempt < FX_MAX_ATTEMPTS;
        attempt += 1
      ) {
        if (attempt > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, FX_BACKOFF_MS[attempt - 1] ?? 1500)
          );
        }
        if (!fxMountedRef.current) {
          return false;
        }
        setFxLoading(true);
        try {
          const response = await fetch("/api/meta");
          if (!response.ok) {
            throw new Error(`Meta failed: ${response.status}`);
          }
          const data = await response.json();
          if (!fxMountedRef.current) {
            return false;
          }
          const rate = data?.fx?.rate;
          if (
            typeof rate === "number" &&
            Number.isFinite(rate) &&
            rate > 0
          ) {
            if (data.success && data.sizeGroups) {
              setCatalogSizes(data.sizeGroups);
            }
            setFxRate(rate);
            setFxError(false);
            return true;
          }
        } catch {
          /* fall through to the next attempt */
        }
      }
      if (fxMountedRef.current) {
        setFxError(true);
      }
      return false;
    };

    const chain = run().finally(() => {
      if (fxMountedRef.current) {
        setFxLoading(false);
      }
      fxChainRef.current = null;
    });
    fxChainRef.current = chain;
    return chain;
  }, []);

  const retryFx = () => {
    if (fxLoading) {
      return;
    }
    setFxError(false);
    fxChainRef.current = null;
    void loadFxRate();
  };

  /* Loads the catalog size surfaces and the fx rate once. */
  useEffect(() => {
    fxMountedRef.current = true;
    void loadFxRate();
    return () => {
      fxMountedRef.current = false;
    };
  }, [loadFxRate]);

  /* The URL is the single source of truth for the basic
     search state. Runs on mount (refresh / direct link),
     on query-string-only navigation (back / forward) and
     after the fx rate arrives for a USD budget. Exactly
     one search per resolved URL search. */
  const urlSearchKey = searchParams.toString();

  /* The urlSearchKey that was current when the running search was
     launched (set in handleSearch). F15-C2 must tell a real new
     navigation apart from the router's own settling of a Search
     button push: while a search is in flight, router.push /
     useSearchParams can re-commit the pre-push urlSearchKey (here
     populated, or an empty "/") several times. Those re-commits are
     that search's own churn — urlSearchKey === searchStartUrlKeyRef —
     and must not bump the F11 epoch, or the bar search would discard
     its own response while the previous results stayed under the new
     URL. A urlSearchKey that actually differs from it is a genuine
     navigation, so the in-flight response is deferred and the newest
     URL intent runs once the search settles. */
  const searchStartUrlKeyRef = useRef<string>(urlSearchKey);

  /* While router.push from the Search button is settling, the effect can
     re-run with the PRE-PUSH urlSearchKey (fxRate syncs, loading flips)
     even after the launched search already finished: lastUrlSearchKeyRef
     now holds the new intent, so the old key would look like a new URL
     to run and re-execute the previous query. The arm is set on launch
     and cleared the moment a urlSearchKey other than the start key is
     acted on; while armed, the effect treats the start key itself as
     non-actionable — it belongs to the search just launched. */
  const searchLaunchArmedRef = useRef(false);

  /* F14-C1: is the current URL stuck waiting for the fx rate?
     Drives the wait/error/retry surface only; parsing is
     unchanged and the URL effect still owns wait-fx. */
  const waitFxActive =
    parseSearchUrl(searchParams, fxRate).kind === "wait-fx";

  useEffect(() => {
    /* The router can commit a render whose useSearchParams still
       carries a PREVIOUS url while the address bar already shows the
       pushed URL (and vice-versa during settle). Acting on that stale
       report re-executes a previous intent after its search finished
       and can paint it back under the new URL. Only process the
       urlSearchKey that matches the live location; the router catches
       up on the final commit and this effect re-runs for the match. */
    if (urlSearchKey !==
      new URLSearchParams(window.location.search).toString()) {
      return;
    }

    const search = new URLSearchParams(urlSearchKey);
    const parsed = parseSearchUrl(search, fxRate);

    /* While the Search button's push is still settling, the effect can
       re-run with the pre-push urlSearchKey (fxRate sync, loading flip)
       after the launched search already executed: lastUrlSearchKeyRef
       holds the NEW intent now, so this OLD key would read as a fresh
       URL to run and re-execute the previous query under the pending
       URL. Skipping it keeps the churn inert; any urlSearchKey other
       than the launch key is still processed normally below. */
    if (
      searchLaunchArmedRef.current &&
      urlSearchKey === searchStartUrlKeyRef.current &&
      (parsed.intent === null ||
        lastUrlSearchKeyRef.current !==
          searchIntentKey(parsed.intent))
    ) {
      return;
    }

    if (parsed.kind === "wait-fx") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- URL-driven restore while engine bounds wait for the fx rate
      setQuery(decodeSearchUrl(search).query);
      return;
    }

    /* A transient empty urlSearchKey with a search in flight is the
       router settling a Search-bar push (the pre-push "/" re-commit).
       Running resetResults there would bump the F11 epoch and discard
       the very search the bar just launched. When loading settles the
       effect re-runs; if the URL really is empty the reset proceeds. */
    if (parsed.kind === "empty") {
      if (loading) {
        return;
      }
      searchLaunchArmedRef.current = false;
      resetResults();
      return;
    }

    if (lastUrlSearchKeyRef.current ===
      searchIntentKey(parsed.intent)) {
      searchLaunchArmedRef.current = false;
      return;
    }

    /* F15-C2: a URL change while a search is in flight must not
       be recorded as resolved — handleSearch would bail on
       `loading` and the old response would then paint under the
       new URL. Defer instead: mark the in-flight response stale
       through the F11 epoch and let this effect re-run once the
       search settles (loading flips), so the latest URL intent
       executes exactly once.
       The defer fires ONLY on a genuine navigation: urlSearchKey
       differs from the one the running search was launched under
       (searchStartUrlKeyRef) AND the parsed intent is not the
       search already in flight. The Search button / Enter launches
       a search directly and pushes its own URL; the router settling
       that push re-commits the pre-push urlSearchKey — never a new
       navigation — and bumping the epoch there (or on the key-match
       early-return) would reject the search it launched and keep
       the previous results under the new query. */
    if (
      loading &&
      urlSearchKey !== searchStartUrlKeyRef.current &&
      lastUrlSearchKeyRef.current !==
        searchIntentKey(parsed.intent)
    ) {
      searchSeqRef.current += 1;
      searchLaunchArmedRef.current = false;
      return;
    }
    if (loading) {
      return;
    }

    searchLaunchArmedRef.current = false;
    setQuery(parsed.intent.query);
    void handleSearch(parsed.intent, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSearchKey, fxRate, loading]);

  function resetResults() {
    searchSeqRef.current += 1;
    setSearched(false);
    setLoading(false);
    setErrorMessage(null);
    setIntentBudget(null);
    setExactProducts([]);
    setSimilarProducts([]);
    setSimilarMessage(null);
    setDiagnostics([]);
    setStructuredQuery(null);
    setCategoryStatus(null);
    setFacets({
      gender: [],
      category: [],
      color: [],
      size: [],
      brand: [],
    });
    setExactTotal(0);
    setSimilarTotal(0);
    setExactHasMore(false);
    setSimilarHasMore(false);
    setLoadingMore(false);
    exactOffsetRef.current = 0;
    similarOffsetRef.current = 0;
    setActiveFilters({
      gender: new Set(),
      category: new Set(),
      color: new Set(),
      size: new Set(),
      brand: new Set(),
    });
    lastUrlSearchKeyRef.current = null;
  }

  async function handleSearch(
    intent: SearchIntent,
    syncUrl = false
  ) {
    const trimmedQuery = intent.query.trim();

    if (!trimmedQuery || loading) {
      return;
    }

    searchSeqRef.current += 1;
    const mySeq = searchSeqRef.current;

    lastUrlSearchKeyRef.current =
      searchIntentKey(intent);
    lastSearchIntentRef.current = intent;

    /* Anchor the defer: this search corresponds to the urlSearchKey
       that is current right now (the pre-push searchParams), so the
       router re-committing that same key while the push settles is
       this search's own churn, not a new navigation. */
    searchStartUrlKeyRef.current = urlSearchKey;
    searchLaunchArmedRef.current = true;

    if (syncUrl) {
      void router.push(
        `/?${buildSearchQueryString(intent)}`
      );
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
      const params = new URLSearchParams({
        q: trimmedQuery,
      });

      const priceMin =
        intent.params.priceMin ?? null;
      const priceMax =
        intent.params.priceMax ?? null;
      const soft =
        intent.params.soft ?? null;

      if (priceMin) {
        params.set("priceMin", priceMin);
      }
      if (priceMax) {
        params.set("priceMax", priceMax);
      }
      if (soft) {
        params.set("soft", soft);
      }

      const response = await fetch(
        `/api/search?${params.toString()}&limit=30&offset=0`
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

      if (mySeq !== searchSeqRef.current) {
        return;
      }

      setIntentBudget(
        intent.params.budgetDisplayMin != null ||
          intent.params.budgetDisplayMax != null
          ? {
              min: intent.params.budgetDisplayMin,
              max: intent.params.budgetDisplayMax,
              currency: intent.params.budgetCurrency,
            }
          : null
      );

      setExactProducts(data.exactProducts ?? []);
      setSimilarProducts(data.similarProducts ?? []);
      setSimilarMessage(data.similarMessage ?? null);
      setDiagnostics(data.diagnostics ?? []);
      setStructuredQuery(data.structuredQuery ?? null);
      setCategoryStatus(data.categoryStatus ?? null);

      /* F10: page-1 fetch resets the Load-more state. */
      setExactTotal(data.exactCount ?? 0);
      setSimilarTotal(data.similarCount ?? 0);
      setExactHasMore(
        data.exactHasMore ?? false
      );
      setSimilarHasMore(
        data.similarHasMore ?? false
      );
      setFacets(
        data.facets ?? {
          gender: [],
          category: [],
          color: [],
          size: [],
          brand: [],
        }
      );
      exactOffsetRef.current =
        data.exactProducts?.length ?? 0;
      similarOffsetRef.current =
        data.similarProducts?.length ?? 0;

      resultsRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    } catch (error) {
      console.error("Search failed:", error);

      if (mySeq !== searchSeqRef.current) {
        return;
      }

      setExactProducts([]);
      setSimilarProducts([]);
      setSimilarMessage(null);
      setDiagnostics([]);
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

  /* F10: Load more fetches the next ranked page for one list
     (exact or similar) and appends in rank order. The URL stays
     the intent only - paging lives at the fetch layer. */
  async function loadMore(
    list: "exact" | "similar"
  ) {
    if (
      loading ||
      loadingMore ||
      !lastSearchIntentRef.current
    ) {
      return;
    }

    const intent = lastSearchIntentRef.current;
    const offset =
      list === "exact"
        ? exactOffsetRef.current
        : similarOffsetRef.current;
    const hasMore =
      list === "exact" ? exactHasMore : similarHasMore;

    if (!hasMore) {
      return;
    }

    const mySeq = searchSeqRef.current;

    setLoadingMore(true);

    try {
      const params = new URLSearchParams({
        q: intent.query.trim(),
        limit: "30",
        offset: String(offset),
      });

      const priceMin =
        intent.params.priceMin ?? null;
      const priceMax =
        intent.params.priceMax ?? null;
      const soft = intent.params.soft ?? null;

      if (priceMin) {
        params.set("priceMin", priceMin);
      }
      if (priceMax) {
        params.set("priceMax", priceMax);
      }
      if (soft) {
        params.set("soft", soft);
      }

      const response = await fetch(
        `/api/search?${params.toString()}`
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

      if (mySeq !== searchSeqRef.current) {
        return;
      }

      if (list === "exact") {
        setExactProducts((current) => [
          ...current,
          ...(data.exactProducts ?? []),
        ]);
        setExactHasMore(
          data.exactHasMore ?? false
        );
        exactOffsetRef.current =
          exactOffsetRef.current +
          (data.exactProducts?.length ?? 0);
      } else {
        setSimilarProducts((current) => [
          ...current,
          ...(data.similarProducts ?? []),
        ]);
        setSimilarHasMore(
          data.similarHasMore ?? false
        );
        similarOffsetRef.current =
          similarOffsetRef.current +
          (data.similarProducts?.length ?? 0);
      }
    } catch (error) {
      console.error("Load more failed:", error);
    } finally {
      setLoadingMore(false);
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

    const colors =
      structuredQuery.colors ?? [];

    if (colors.length > 0) {
      parts.push(`Colors: ${colors.join(" + ")}`);
    }

    if (structuredQuery.size) {
      parts.push(`Size: ${structuredQuery.size}`);
    }

    const budget = structuredQuery.budget;

    if (budget) {
      const min = intentBudget?.min ?? budget.min;
      const max = intentBudget?.max ?? budget.max;
      const unit = intentBudget?.currency ?? "EUR";
      parts.push(
        `Budget: ${min ?? "any"} - ${max ?? "any"} ${unit}`
      );
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

  /* F13-1: the option set (values + labels) stays exactly the
     server block's; only the COUNTS are re-derived per render
     from the currently loaded window via buildWindowFacetCounts. */
  const facetOptions = useMemo(() => {
    const options: Record<
      FacetKey,
      Map<string, { label: string }>
    > = {
      gender: new Map(),
      category: new Map(),
      color: new Map(),
      size: new Map(),
      brand: new Map(),
    };

    for (const key of FACET_KEYS) {
      for (const entry of facets[key]) {
        options[key].set(entry.value, {
          label: entry.label,
        });
      }
    }

    return options;
  }, [facets]);

  /* F13-1: counts are scoped to the loaded window and recomputed
     whenever more results are appended (Load more) or the active
     filters change. A value with no match in the window renders
     as (0) + disabled, so choosing it can never empty the page. */
  const windowCounts = useMemo(() => {
    const optionValues: Record<FacetKey, string[]> = {
      gender: [...facetOptions.gender.keys()],
      category: [...facetOptions.category.keys()],
      color: [...facetOptions.color.keys()],
      size: [
        ...(catalogSizes?.clothing ?? []),
        ...(catalogSizes?.shoes ?? []),
      ],
      brand: [...facetOptions.brand.keys()],
    };

    return buildWindowFacetCounts(
      allProducts,
      activeFilters,
      optionValues
    );
  }, [
    allProducts,
    activeFilters,
    facetOptions,
    catalogSizes,
  ]);

  const sizeOptionGroups = useMemo(() => {
    const build = (
      values: string[]
    ): {
      value: string;
      label: string;
      count: number;
    }[] =>
      values.map((value) => ({
        value,
        label: value,
        count: windowCounts.size.get(value) ?? 0,
      }));

    return {
      clothing: build(catalogSizes?.clothing ?? []),
      shoes: build(catalogSizes?.shoes ?? []),
    };
  }, [catalogSizes, windowCounts]);

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

  const filtersHidEverything =
    hasActiveFilters &&
    allProducts.length > 0 &&
    filteredExactProducts.length === 0 &&
    filteredSimilarProducts.length === 0;

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

  /* P6: from a true no-results state, let users refine
     the same search via the questionnaire. F4: restoration
     is the pure buildEditAnswers helper (dedup + budget). */
  function questionnaireAnswersFromSearch(): QuestionnaireAnswers {
    return buildEditAnswers(query, structuredQuery, intentBudget);
  }

  function handleEditSearch() {
    if (!structuredQuery || loading) {
      return;
    }

    sessionStorage.setItem(
      "wearsearch-find-answers",
      JSON.stringify(questionnaireAnswersFromSearch())
    );
    void router.push("/find");
  }

  function handleBackToQuestionnaire() {
    sessionStorage.removeItem("wearsearch-find-answers");
    void router.push("/find");
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

        <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row">
          <input
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                if (query.trim()) {
                  handleSearch(
                    { query, params: EMPTY_SEARCH_PARAMS },
                    true
                  );
                } else if (searchParams.size > 0) {
                  /* C4: an empty query + Enter must not leave the
                     input blank while the old URL and results stay.
                     Route to the empty landing state through the URL
                     effect (its "empty" branch resets results); this
                     matches the Search button for a blank query. */
                  void router.push("/");
                }
              }
            }}
            placeholder="Search for clothes..."
            aria-label="Search for clothes"
            className="flex-1 rounded-xl border border-gray-300 px-5 py-4 outline-none transition focus:border-black"
          />

          <button
            type="button"
            onClick={() =>
              handleSearch(
                { query, params: EMPTY_SEARCH_PARAMS },
                true
              )
            }
            disabled={loading || !query.trim()}
            aria-label="Run search"
            className="w-full rounded-xl bg-black px-7 py-4 font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:min-w-[150px]"
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </div>

        <div className="mx-auto mt-4 max-w-3xl text-center">
          <Link
            href="/find"
            className="text-sm font-medium text-gray-500 underline-offset-4 transition hover:text-black hover:underline"
          >
            Not sure what to search? Find your perfect clothing →
          </Link>
        </div>

        {/* F14-C1: a USD budget URL waits for the fx rate before
            the URL effect can search. While the rate fetch is
            retrying, show progress; once the retries are
            exhausted, surface an explicit error + Retry instead
            of a silent, stuck page. */}
        {waitFxActive && !fxError && (
          <div className="mx-auto mt-4 max-w-3xl text-center text-sm text-gray-400">
            Looking up the exchange rate…
          </div>
        )}

        {waitFxActive && fxError && (
          <div className="mx-auto mt-8 max-w-3xl rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
            <h2 className="text-xl font-semibold text-red-700">
              Couldn&apos;t load the exchange rate
            </h2>

            <p className="mt-2 text-sm text-red-600">
              Your budget is set in USD, so we need today&apos;s
              exchange rate to search within it. The rate service
              is unavailable right now — please try again.
            </p>

            <button
              type="button"
              onClick={retryFx}
              disabled={fxLoading}
              className="mt-6 rounded-xl bg-red-600 px-5 py-3 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-wait disabled:opacity-60"
            >
              Retry
            </button>
          </div>
        )}

        {/* RESULTS */}

        {searched && (
          <section
            ref={resultsRef}
            className={`mt-12 scroll-mt-6 transition-opacity ${
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
                  onClick={() =>
                    handleSearch(
                      lastSearchIntentRef.current ?? {
                        query,
                        params: EMPTY_SEARCH_PARAMS,
                      },
                      false
                    )
                  }
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
                        if (key === "size") {
                          const sections: {
                            label: string;
                            options: {
                              value: string;
                              label: string;
                              count: number;
                            }[];
                          }[] = sizeOptionGroups.clothing.length > 0 ||
                            sizeOptionGroups.shoes.length > 0
                            ? [
                                {
                                  label: "Clothing Size",
                                  options:
                                    sizeOptionGroups.clothing,
                                },
                                {
                                  label: "Shoe Size",
                                  options:
                                    sizeOptionGroups.shoes,
                                },
                              ].filter(
                                (section) =>
                                  section.options.length > 0
                              )
                            : [];

                          if (sections.length === 0) {
                            return null;
                          }

                          return (
                            <div key={key}>
                              <p className="text-xs font-semibold text-gray-400">
                                {FACET_LABELS[key]}
                              </p>

                              <div className="mt-2 flex flex-col gap-3">
                                {sections.map((section) => {
                                  return (
                                    <div key={section.label}>
                                      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
                                        {section.label}
                                      </p>

                                      <div className="mt-1 flex flex-wrap gap-2">
                                        {section.options.map(
                                          ({
                                            value,
                                            label,
                                            count,
                                          }) => {
                                            const disabled =
                                              count === 0;
                                            const selected =
                                              activeFilters[
                                                key
                                              ].has(value);

                                            return (
                                              <button
                                                key={value}
                                                type="button"
                                                disabled={disabled}
                                                onClick={() =>
                                                  toggleFilter(
                                                    key,
                                                    value
                                                  )
                                                }
                                                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                                                  selected
                                                    ? "bg-black text-white"
                                                    : disabled
                                                      ? "cursor-not-allowed bg-gray-50 text-gray-300"
                                                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                                                }`}
                                              >
                                                {label}{" "}
                                                {count > 0
                                                  ? `(${count})`
                                                  : "(0)"}
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
                          );
                        }

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
                                  { label },
                                ]) => {
                                  const count =
                                    windowCounts[
                                      key
                                    ].get(value) ??
                                    0;
                                  const disabled =
                                    count === 0;
                                  const selected =
                                    activeFilters[
                                      key
                                    ].has(value);

                                  return (
                                    <button
                                      key={value}
                                      type="button"
                                      disabled={disabled}
                                      onClick={() =>
                                        toggleFilter(
                                          key,
                                          value
                                        )
                                      }
                                      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                                        selected
                                          ? "bg-black text-white"
                                          : disabled
                                            ? "cursor-not-allowed bg-gray-50 text-gray-300"
                                            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                                      }`}
                                    >
                                      {label}{" "}
                                      {count > 0
                                        ? `(${count})`
                                        : "(0)"}
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

                      {exactHasMore && (
                        <p className="mt-1 text-xs text-gray-400">
                          Showing {exactProducts.length}{" "}
                          of {exactTotal} exact
                          matches
                        </p>
                      )}
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

                    {exactHasMore && (
                      <div className="mt-8 flex justify-center">
                        <button
                          type="button"
                          onClick={() =>
                            void loadMore("exact")
                          }
                          disabled={loadingMore}
                          className="rounded-xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-wait disabled:opacity-60"
                        >
                          {loadingMore
                            ? "Loading more…"
                            : "Load more exact matches"}
                        </button>
                      </div>
                    )}
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

                      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                        <button
                          type="button"
                          onClick={handleEditSearch}
                          className="rounded-xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:bg-gray-800"
                        >
                          Edit search
                        </button>

                        <button
                          type="button"
                          onClick={handleBackToQuestionnaire}
                          className="rounded-xl border border-gray-300 px-5 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                        >
                          Back to questionnaire
                        </button>
                      </div>
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

                      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                        <button
                          type="button"
                          onClick={handleEditSearch}
                          className="rounded-xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:bg-gray-800"
                        >
                          Edit search
                        </button>

                        <button
                          type="button"
                          onClick={handleBackToQuestionnaire}
                          className="rounded-xl border border-gray-300 px-5 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                        >
                          Back to questionnaire
                        </button>
                      </div>
                    </div>
                  )}

                {diagnostics.length > 0 &&
                  !filtersHidEverything && (
                    <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5">
                    <h3 className="text-sm font-semibold text-amber-800">
                      Why is this empty?
                    </h3>

                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-700">
                      {diagnostics.map((message) => (
                        <li key={message}>{message}</li>
                      ))}
                    </ul>
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

                      {similarHasMore && (
                        <p className="mt-1 text-xs text-gray-400">
                          Showing{" "}
                          {similarProducts.length} of{" "}
                          {similarTotal} similar
                          products
                        </p>
                      )}
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

                    {similarHasMore && (
                      <div className="mt-8 flex justify-center">
                        <button
                          type="button"
                          onClick={() =>
                            void loadMore("similar")
                          }
                          disabled={loadingMore}
                          className="rounded-xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-wait disabled:opacity-60"
                        >
                          {loadingMore
                            ? "Loading more…"
                            : "Load more similar products"}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* SIMILAR GATED EMPTY (80%) */}

                {similarMessage &&
                  exactProducts.length === 0 &&
                  similarProducts.length === 0 && (
                    <div className="mt-6 rounded-2xl border border-dashed border-gray-300 p-10 text-center">
                      <h2 className="text-2xl font-semibold">
                        Similar options
                      </h2>

                      <p className="mt-3 text-gray-500">
                        {similarMessage}
                      </p>

                      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                        <button
                          type="button"
                          onClick={handleEditSearch}
                          className="rounded-xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:bg-gray-800"
                        >
                          Edit search
                        </button>

                        <button
                          type="button"
                          onClick={handleBackToQuestionnaire}
                          className="rounded-xl border border-gray-300 px-5 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                        >
                          Back to questionnaire
                        </button>
                      </div>
                    </div>
                  )}

                {/* FILTERS HIDE EVERYTHING */}

                {filtersHidEverything && (
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
                  similarProducts.length === 0 &&
                  !similarMessage && (
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

                      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                        <button
                          type="button"
                          onClick={handleEditSearch}
                          className="rounded-xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:bg-gray-800"
                        >
                          Edit search
                        </button>

                        <button
                          type="button"
                          onClick={handleBackToQuestionnaire}
                          className="rounded-xl border border-gray-300 px-5 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                        >
                          Back to questionnaire
                        </button>
                      </div>
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

/* ============================================================
   PRODUCT CARD
============================================================ */

function ProductCard({
  product,
}: {
  product: Product;
}) {
  const storeName = productStoreLabel(
    product.productUrl
  );

  const hasProductPage = hasRealProductPage(
    product.productUrl
  );

  const hasVariantPriceRange =
    product.variants.some(
      (variant) =>
        Number(variant.price) !==
        Number(product.price)
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

  const outOfStock =
    product.variants.length > 0 &&
    !product.variants.some(
      (variant) =>
        variant.availability === "AVAILABLE"
    );

  return (
    <article className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white transition hover:shadow-lg">

      {/* IMAGE */}

      {product.imageUrl ? (
        <img
          src={product.imageUrl}
          alt={product.name}
          loading="lazy"
          decoding="async"
          className="h-80 w-full object-cover"
        />
      ) : (
        <div className="flex h-80 w-full items-center justify-center bg-gray-100 text-gray-400">
          No image
        </div>
      )}

      {/* AVAILABILITY BADGE */}

      {outOfStock && (
        <span className="absolute right-3 top-3 rounded-full bg-white/95 px-3 py-1 text-xs font-semibold text-red-600 shadow">
          Out of stock
        </span>
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
            {hasVariantPriceRange
              ? "From "
              : ""}
            {product.price} {product.currency}
          </span>

          {hasProductPage ? (
            <a
              href={product.productUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800"
            >
              View product
            </a>
          ) : (
            <span className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-400">
              Product page unavailable
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
