import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  computeCatalogFingerprint,
  createCatalogStore,
  getCatalogMemo,
} from "@/lib/catalog-memo";
import {
  getFxRate,
  priceWithinBudget,
  priceWithinBudgetBand,
} from "@/lib/currency";
import {
  buildSearchDiagnostics,
  type DiagStrictVector,
} from "@/lib/search-diagnostics";
import { hasRealProductPage } from "@/lib/product-url";
import {
  buildServerFacetBlock,
  type FacetsBlock,
} from "@/lib/search-facets";

/* F1 (Post-Audit Product Readiness): demo/playground items have
   no real product page, so they must never surface in
   production-facing results as if they were real products
   (placeholder images, dead-end "View product", fake brands).
   The catalog keeps them (tests + data integrity), the engine
   still scores/ranks every product exactly as before, and only
   the final serialized result lists (plus inventory counts and
   the diagnostics empty gate) exclude them. Search/Ranking
   logic itself is untouched. */
const hasRealPage = (product: {
  productUrl: string;
}): boolean => hasRealProductPage(product.productUrl);

/* F8-A (variant availability contract): the single source of
   truth for "purchasable" invariance. Used everywhere the engine
   reasons about what is buyable - the candidate pool, matching/
   scoring, diagnostics presence and response serialization - so an
   OUT_OF_STOCK size or color can never surface as a match. */
const availVariants = <
  T extends { availability: string | null }
>(
  product: { variants: T[] }
): T[] =>
  product.variants.filter(
    (variant) =>
      variant.availability ===
      "AVAILABLE"
  );

/* F10 (result pagination): the production payload is bounded to
   one ranked page. Ranking is computed in full on every request,
   and slicing happens at serialization only. exactCount/similarCount
   keep their meaning of TOTAL matches; exactHasMore/similarHasMore
   drive the Load-more UI. ?debug=1 bypasses pagination entirely so
   the ordering/count contract suites keep reading the full envelope.

   FACET_TRUTH (F10): the page's facet options + counts are computed
   server-side over the FULL ranked result set (exact + similar, F1-
   filtered) using the same lib the client uses, so truncating the
   payload can never truncate the facet options or their counts. */
const RESULT_PAGE_SIZE = 30;
const RESULT_PAGE_CAP = 100;

const EMPTY_FACETS: FacetsBlock = {
  gender: [],
  category: [],
  color: [],
  size: [],
  brand: [],
};

const toFacetCount = (
  value: number,
  fallback: number
): number =>
  Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;

const parsePageParams = (
  searchParams: URLSearchParams
): { limit: number; offset: number } => {
  const rawLimit = searchParams.get("limit");
  const rawOffset = searchParams.get("offset");

  const limit =
    rawLimit === null
      ? RESULT_PAGE_SIZE
      : toFacetCount(Number(rawLimit), RESULT_PAGE_SIZE);

  const cappedLimit = Math.min(
    Math.max(limit, 1),
    RESULT_PAGE_CAP
  );

  const offset =
    rawOffset === null
      ? 0
      : toFacetCount(Number(rawOffset), 0);

  return {
    limit: cappedLimit,
    offset: Math.max(offset, 0),
  };
};

/* F9 (response projection): the production payload is an explicit
   whitelist of the fields page.tsx actually renders (verified by a
   full consumption audit - the client never reads description,
   ids/slugs/sku/normalizedValue or any scoring internal).
   variant.size.system is serialized for F19b: the client splits
   a shoes result into US/EU sections from the stored system, never
   from the numeric value.
   The scoring internals are re-attached ONLY under ?debug=1 so the
   ranking contract stays directly verifiable by the test suites;
   debug is a narrow channel, never a dump of the full scored object.
   Projection happens at serialization only: matching, scoring,
   ranking, diagnostics and counts are untouched. */
const PROJECTED_INTERNAL_KEYS = [
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
] as const;

type ProjectedProduct = {
  id: string;
  name: string;
  price: string | null;
  currency: string | null;
  productUrl: string | null;
  imageUrl: string | null;
  availability: string | null;
  gender: string | null;
  brand: { id: string | null; name: string | null } | null;
  category: { id: string | null; name: string | null } | null;
  variants: {
    price: string | null;
    currency: string | null;
    availability: string | null;
    color: { id: string; name: string; hex: string | null } | null;
    size: {
      value: string | null;
      system: string | null;
    } | null;
  }[];
  attributes: {
    value: string;
    attribute: { name: string };
  }[];

  score?: number;
  exactMatch?: boolean;
  similarMatch?: boolean;
  matchedWords?: number;
  totalQueryWords?: number;
  matchedColors?: number;
  matchedCategories?: number;
  matchedAttributes?: number;
  softMatched?: number;
  structuredMatches?: Record<string, boolean | null>;
};

const pickProjectedInternals = <T>(
  product: T
): Partial<ProjectedProduct> => {
  const internals: Partial<
    ProjectedProduct
  > = {};

  const source =
    product as unknown as Record<
      string,
      unknown
    >;

  for (const key of PROJECTED_INTERNAL_KEYS) {
    if (source[key] !== undefined) {
      (
        internals as Record<
          string,
          unknown
        >
      )[key] = source[key];
    }
  }

  return internals;
};

const projectProduct = (
  product: {
    id: string;
    name: string;
    price: { toString(): string };
    currency: string | null;
    productUrl: string | null;
    imageUrl: string | null;
    availability: string | null;
    gender: string | null;
    brand: { id: string | null; name: string | null } | null;
    category: { id: string | null; name: string | null } | null;
    variants: {
      price: { toString(): string };
      currency: string | null;
      availability: string | null;
      color: { id: string; name: string; hex: string | null } | null;
      size: {
        value: string | null;
        system: string | null;
      } | null;
    }[];
    attributes: {
      value: string;
      attribute: { name: string };
    }[];
  },
  includeInternals: boolean
): ProjectedProduct => {
  const projected: ProjectedProduct = {
    id: product.id,
    name: product.name,
    price: String(product.price),
    currency: product.currency,
    productUrl: product.productUrl,
    imageUrl: product.imageUrl,
    availability: product.availability,
    gender: product.gender,
    brand: product.brand
      ? { id: product.brand.id, name: product.brand.name }
      : null,
    category: product.category
      ? { id: product.category.id, name: product.category.name }
      : null,
    variants: availVariants(
      product
    ).map((variant) => ({
      price: String(variant.price),
      currency: variant.currency,
      availability:
        variant.availability,
      color: variant.color
        ? {
            id: variant.color.id,
            name: variant.color.name,
            hex: variant.color.hex,
          }
        : null,
      size: variant.size
        ? {
            value: variant.size.value,
            system:
              variant.size.system ?? null,
          }
        : null,
    })),
    attributes:
      product.attributes.map(
        (attribute) => ({
          value: attribute.value,
          attribute: {
            name: attribute.attribute
              .name,
          },
        })
      ),
  };

  if (includeInternals) {
    return {
      ...projected,
      ...pickProjectedInternals(
        product
      ),
    };
  }

  return projected;
};

/* =========================================================
   TEXT HELPERS
========================================================= */

function normalizeText(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/['’]s(?=\s|$)/gi, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getWords(text: string): string[] {
  return normalizeText(text)
    .split(/[\s-]+/)
    .filter((word) => word.length > 1);
}

function looseNormalize(
  text: string | null | undefined
): string {
  return normalizeText(text).replace(/-/g, " ");
}

function buildFlexiblePattern(
  normalizedValue: string,
  allowPluralFlex = true
): string {
  return normalizedValue
    .split(" ")
    .map((word) =>
      allowPluralFlex && /^[a-z]{3,}s$/.test(word)
        ? `${word.slice(0, -1)}s?`
        : word
    )
    .join("[\\s-]");
}

/* Values whose plural spelling collides with a common
   adjective (e.g. "shorts" vs "short"). Detection requires
   the exact dictionary spelling; the trailing-s elasticity
   is disabled so "short sleeve" can never be mistaken for
   the Shorts category. */
const STRICT_PLURAL_VALUES = new Set([
  "shorts",
]);

function findMatch(
  query: string,
  values: string[]
): string | null {
  const normalizedQuery = looseNormalize(query);

  const sortedValues = [...new Set(values)]
    .filter(Boolean)
    .sort(
      (a, b) =>
        looseNormalize(b).length -
        looseNormalize(a).length
    );

  for (const value of sortedValues) {
    const normalizedValue =
      looseNormalize(value);

    if (!normalizedValue) {
      continue;
    }

    const escaped = normalizedValue.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

    const allowedPluralFlex =
      !STRICT_PLURAL_VALUES.has(
        normalizedValue
      );

    const regex = new RegExp(
      `(^|\\s)${buildFlexiblePattern(escaped, allowedPluralFlex)}($|\\s)`,
      "i"
    );

    if (regex.test(normalizedQuery)) {
      return value;
    }
  }

  return null;
}

function findMatchSpan(
  query: string,
  values: string[]
): { value: string; index: number; length: number } | null {
  const normalizedQuery = looseNormalize(query);

  const sortedValues = [...new Set(values)]
    .filter(Boolean)
    .sort(
      (a, b) =>
        looseNormalize(b).length -
        looseNormalize(a).length
    );

  for (const value of sortedValues) {
    const normalizedValue =
      looseNormalize(value);

    if (!normalizedValue) {
      continue;
    }

    const escaped = normalizedValue.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

    const allowedPluralFlex =
      !STRICT_PLURAL_VALUES.has(
        normalizedValue
      );

    const regex = new RegExp(
      `(^|\\s)${buildFlexiblePattern(escaped, allowedPluralFlex)}($|\\s)`,
      "i"
    );

    const match = regex.exec(normalizedQuery);

    if (match && match.index !== undefined) {
      return {
        value,
        index: match.index,
        length: match[0].length,
      };
    }
  }

  return null;
}

function maskValue(
  queryText: string,
  value: string
): string {
  const escaped = looseNormalize(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );

  const allowedPluralFlex =
    !STRICT_PLURAL_VALUES.has(
      looseNormalize(value)
    );

  const regex = new RegExp(
    `(^|\\s)${buildFlexiblePattern(escaped, allowedPluralFlex)}(?=$|\\s)`,
    "gi"
  );

  return queryText.replace(
    regex,
    (matched) => " ".repeat(matched.length)
  );
}

/* =========================================================
   GENDER
========================================================= */

const SIZE_ALIAS_WORDS: Record<
  string,
  string
> = {
  "extra small": "XS",
  small: "S",
  medium: "M",
  large: "L",
  "extra large": "XL",
  "double extra large": "XXL",
};

/* Stage 3-C: explicit size-system words. A token becomes a size
   system constraint ONLY when a size value is also detected and the
   token sits adjacent to it (see detectSizeSystem): otherwise the
   word remains plain query text, so legacy bare-size behavior is
   untouched. EU/US/UK/IT/FR pin the exact stored column; a system
   column that does not exist in the catalog can therefore never
   invent a match (evidence-based empty + diagnostics). */
const SIZE_SYSTEM_WORDS: Record<
  string,
  string
> = {
  eu: "EU",
  us: "US",
  uk: "UK",
  it: "IT",
  fr: "FR",
  international: "INTERNATIONAL",
};

/* Stage 3-C: given the size span in the normalized query, find a
   system token adjacent to it. Adjacency is measured on tokens:
   EU/US/UK/INTERNATIONAL may be at most one token from the size
   value; the ambiguous two-letter forms IT/FR only match as a
   direct neighbour (so "it" as a pronoun cannot consume a distant
   size). Returns the system name; the caller masks the token from
   the free-text remainder. */
function detectSizeSystem(
  normalizedQuery: string,
  sizeSpan: { index: number; length: number }
): { system: string; word: string } | null {
  const tokenAt: Array<{
    start: number;
    end: number;
    text: string;
  }> = [];

  for (const match of normalizedQuery.matchAll(
    /[^\s-]+/g
  )) {
    const start = match.index ?? 0;
    tokenAt.push({
      start,
      end: start + match[0].length,
      text: match[0],
    });
  }

  if (tokenAt.length === 0) {
    return null;
  }

  const sizeStart = sizeSpan.index;
  const sizeEnd = sizeSpan.index + sizeSpan.length;

  let sizeLastTokenIndex = -1;
  for (let i = 0; i < tokenAt.length; i++) {
    const token = tokenAt[i];
    if (
      token.start < sizeEnd &&
      token.end > sizeStart
    ) {
      sizeLastTokenIndex = i;
    }
  }

  if (sizeLastTokenIndex < 0) {
    return null;
  }

  for (let i = 0; i < tokenAt.length; i++) {
    const token = tokenAt[i];
    const system = token.text
      ? SIZE_SYSTEM_WORDS[token.text]
      : undefined;

    if (!system) {
      continue;
    }

    const distance = Math.abs(
      i - sizeLastTokenIndex
    );
    const directOnly =
      system === "IT" || system === "FR";

    if (directOnly ? distance === 1 : distance <= 2) {
      return { system, word: token.text };
    }
  }

  return null;
}

/* Stage 3-C: strict identity match for a system-qualified size
   constraint. An explicit system never folds across columns: EU 42
   matches EU 42 only, US 42 matches US 42 only, and INTERNATIONAL
   matches the stored INTERNATIONAL column only. A variant without
   a system is never assumed to satisfy an explicit system. */
function variantMatchesSizeSystem(
  size: {
    value: string | null;
    system: string | null;
  } | null,
  value: string,
  system: string
): boolean {
  if (!size || !size.value) {
    return false;
  }

  if (
    normalizeText(size.value) !==
    normalizeText(value)
  ) {
    return false;
  }

  const variantSystem = normalizeText(
    size.system ?? ""
  );

  if (system === "INTERNATIONAL") {
    return variantSystem === "international";
  }

  return variantSystem === system.toLowerCase();
}

const CATEGORY_ALIAS_WORDS: Record<
  string,
  string
> = {
  tee: "T-Shirts",
  tees: "T-Shirts",
  tshirt: "T-Shirts",
  tshirts: "T-Shirts",
  trainer: "Sneakers",
  trainers: "Sneakers",
  tank: "Tank Tops",
  tanks: "Tank Tops",
  tanktop: "Tank Tops",
  tanktops: "Tank Tops",
  hoodie: "Hoodies",
  hoodies: "Hoodies",
  sweatshirt: "Sweatshirts",
  sweatshirts: "Sweatshirts",
  jumper: "Jumpers",
  jumpers: "Jumpers",
  jacket: "Jackets",
  jackets: "Jackets",
  heel: "Heels",
  heels: "Heels",
  "running trainer": "Running Trainers",
  "running trainers": "Running Trainers",
  sunglasses: "Sunglasses",
  sunglass: "Sunglasses",
  watch: "Watches",
  watches: "Watches",
  belt: "Belts",
  belts: "Belts",
  tie: "Ties",
  ties: "Ties",
  beanie: "Beanies",
  beanies: "Beanies",
  hat: "Hats",
  hats: "Hats",
  cap: "Caps",
  caps: "Caps",
  sweatpants: "Joggers",
  /* Stage 3-C: blouse/blouses resolve to the Blouses category
     explicitly (already reachable via plural-flex on the catalog
     name; the alias makes the lexicon self-documenting). */
  blouse: "Blouses",
  blouses: "Blouses",
};

type Gender =
  | "MEN"
  | "WOMEN"
  | "KIDS"
  | "UNISEX"
  | null;

function normalizeGender(
  value: string | null | undefined
): Gender {
  const gender = normalizeText(value);

  if (
    gender === "men" ||
    gender === "man" ||
    gender === "male" ||
    gender === "mens" ||
    gender === "gentleman" ||
    gender === "gentlemen"
  ) {
    return "MEN";
  }

  if (
    gender === "women" ||
    gender === "woman" ||
    gender === "female" ||
    gender === "womens" ||
    gender === "ladies" ||
    gender === "lady"
  ) {
    return "WOMEN";
  }

  if (
    gender === "kids" ||
    gender === "kid" ||
    gender === "children" ||
    gender === "child" ||
    gender === "boys" ||
    gender === "boy" ||
    gender === "girls" ||
    gender === "girl"
  ) {
    return "KIDS";
  }

  if (gender === "unisex") {
    return "UNISEX";
  }

  return null;
}

/*
  MEN search:
    MEN    ✓
    UNISEX ✓
    WOMEN  ✗

  WOMEN search:
    WOMEN  ✓
    UNISEX ✓
    MEN    ✗

  KIDS search:
    KIDS   ✓
    UNISEX ✗  (Stage 3-C: UNISEX never folds into KIDS --
                same unified rule as Questionnaire/Refine)
    MEN    ✗
    WOMEN  ✗

  UNISEX search:
    UNISEX ✓
    MEN    ✗
    WOMEN  ✗
*/

function genderMatches(
  requested: Gender,
  product: Gender
): boolean {
  if (!requested) {
    return true;
  }

  if (!product) {
    return false;
  }

  if (requested === "MEN") {
    return (
      product === "MEN" ||
      product === "UNISEX"
    );
  }

  if (requested === "WOMEN") {
    return (
      product === "WOMEN" ||
      product === "UNISEX"
    );
  }

  if (requested === "KIDS") {
    /* Stage 3-C: KIDS matches KIDS products only. UNISEX is a
       MEN/WOMEN admission; it never folds into a KIDS search
       (unified with Questionnaire + Refine). */
    return product === "KIDS";
  }

  return product === "UNISEX";
}

/* Explicit-gender admission is the same compatibility
   rule used throughout (spec §2/§12): a Men/Women/Kids
   search allows UNISEX products into Exact, but they are
   ranked after same-gender products (see the exact-product
   sorting key below). Hard isolation is preserved: no WOMEN
   product ever enters a MEN search and vice versa. */

/* RC-2/O1 (load-more pipeline cache): one in-process store
   per server process. Each entry is keyed by the full search
   intent the pipeline consumed (query, price bounds, effective
   conversion rate, soft attributes) PLUS the catalog fingerprint.
   An entry is only served while its stored fingerprint matches the
   current catalog, so a product/dictionary mutation invalidates
   the cache on the very next request - cached results can never go
   stale against a newer catalog. Serialization (projection, page
   slice, hasMore, totals) runs per request, so ?debug=1 and
   pagination behavior are unchanged. */
type SearchEnvelope = {
  structuredQuery: {
    brand: string | null;
    category: string | null;
    color: string | null;
    colors: string[];
    size: string | null;
    /* Stage 3-C (additive): present only when the query carried an
       explicit size system (EU/US/UK/IT/FR/INTERNATIONAL) next to
       a size value. size stays the abstract value; the system is
       the stored column the engine matched against and sizeAudience
       is the audience the engine derived for it. */
    sizeSystem: string | null;
    sizeAudience: string | null;
    gender: string | null;
    attributes: Array<{
      attributeName: string;
      value: string;
    }>;
    budget: {
      min: number | null;
      max: number | null;
    } | null;
  };
  categoryStatus: {
    requested: string;
    productCount: number;
    siblings: string[];
  } | null;
  similarMessage: string | null;
  facets: FacetsBlock;
  diagnostics: unknown[];
  serializableExactProducts: Array<
    Parameters<typeof projectProduct>[0]
  >;
  serializableSimilarProducts: Array<
    Parameters<typeof projectProduct>[0]
  >;
  exactTotal: number;
  similarTotal: number;
};

const searchPipelineStore =
  createCatalogStore<SearchEnvelope>({
    cap: 80,
    slot: "wearsearchSearchPipeline",
  });

const respondFromEnvelope = (
  envelope: SearchEnvelope,
  options: {
    query: string;
    debug: boolean;
    limit: number;
    offset: number;
  }
): NextResponse => {
  const { query, debug, limit, offset } =
    options;

  /* F10: the serialized lists are bounded to one ranked page
     (limit/offset) except under ?debug=1, which returns the
     full envelope. exactCount/similarCount stay TOTAL matches;
     exactHasMore/similarHasMore drive Load-more. The facet
     truth block (computed during the pipeline, cached) comes
     from the full ranked set before slicing, so truncating the
     payload can never truncate facet options or their counts. */
  const fullExactProducts =
    envelope.serializableExactProducts.map(
      (product) =>
        projectProduct(product, debug)
    );

  const fullSimilarProducts =
    envelope.serializableSimilarProducts.map(
      (product) =>
        projectProduct(product, debug)
    );

  const returnedExactProducts = debug
    ? fullExactProducts
    : fullExactProducts.slice(
        offset,
        offset + limit
      );

  const returnedSimilarProducts = debug
    ? fullSimilarProducts
    : fullSimilarProducts.slice(
        offset,
        offset + limit
      );

  const exactHasMore =
    !debug &&
    offset + returnedExactProducts.length <
      envelope.exactTotal;

  const similarHasMore =
    !debug &&
    offset + returnedSimilarProducts.length <
      envelope.similarTotal;

  return NextResponse.json({
    success: true,

    query,

    structuredQuery:
      envelope.structuredQuery,

    categoryStatus: envelope.categoryStatus,

    exactCount: envelope.exactTotal,

    similarCount: envelope.similarTotal,

    exactHasMore,

    similarHasMore,

    facets: envelope.facets,

    similarMessage: envelope.similarMessage,

    diagnostics: envelope.diagnostics,

    exactProducts: returnedExactProducts,

    similarProducts: returnedSimilarProducts,
  });
};

/* =========================================================
   GET
========================================================= */

export async function GET(
  request: NextRequest
) {
  try {
    const { searchParams } =
      new URL(request.url);

    const query =
      searchParams.get("q")?.trim() ?? "";

    /* F9: debug is the only channel that restores the scoring
       internals onto the serialized products. Production requests
       (including every URL-state / find flow) never set it, so the
       default payload stays a strict whitelist.

       F10: debug also bypasses result pagination - it always
       returns the full ranked envelope, so ordering/count contract
       tests keep comparing directly against today's behavior. */
    const debug =
      searchParams.get("debug") === "1";

    /* F10: production pagination. Parsed once, applied at the
       serialization boundary only (never to matching/scoring/rank/
       diagnostics/categoryStatus). */
    const { limit, offset } =
      parsePageParams(searchParams);

    const parsePriceParam = (
      raw: string | null
    ): number | null => {
      if (raw === null || raw.trim() === "") {
        return null;
      }
      const value = Number(raw);
      return Number.isFinite(value) && value >= 0
        ? value
        : null;
    };

    const priceMin = parsePriceParam(
      searchParams.get("priceMin")
    );

    const priceMax = parsePriceParam(
      searchParams.get("priceMax")
    );

    const hasBudget =
      priceMin !== null ||
      priceMax !== null;

    /* K2: budgets are compared in a single EUR reference
       currency. Fetch the documented rate once per request
       (env override first, then Frankfurter/ECB; may be
       null, in which case stored values are compared as-is
       - a documented degraded mode, never an invented
       rate). Original stored prices and currencies are
       never rewritten.

       F12 (lazy fx): the rate is only needed inside the
       hasBudget-gated predicates (budgetMatches, budgetCompatible,
       presence.budget), so a search without a budget must not
       trigger the optional Frankfurter fetch. No budget = no
       rate lookup; the client still gets the rate via /api/meta. */
    const priceRate = hasBudget
      ? (await getFxRate()).rate
      : null;

    const softAttributes =
      (searchParams.get("soft") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => normalizeText(value));

    /* =====================================================
       EMPTY QUERY
    ===================================================== */

    if (!query) {
      return NextResponse.json({
        success: true,
        query: "",
        structuredQuery: {
          brand: null,
          category: null,
          color: null,
          size: null,
          gender: null,
          attributes: [],
        },
        exactCount: 0,
        similarCount: 0,
        exactHasMore: false,
        similarHasMore: false,
        facets: EMPTY_FACETS,
        exactProducts: [],
        similarProducts: [],
      });
    }

    /* RC-2/O1: cache key covers everything the pipeline consumed
       (query, price bounds, effective rate, soft hints). The
       fingerprint is recomputed on every request from cheap DB
       aggregates; a hit is only served while the catalog is
       bit-identical, so page/offset requests that re-run the full
       catalog pipeline on their own share one computed envelope. */
    const intentFingerprint =
      await computeCatalogFingerprint(prisma);

    const intentKey = JSON.stringify({
      q: query,
      priceMin,
      priceMax,
      rate: hasBudget ? priceRate : null,
      soft: softAttributes,
    });

    let envelope: SearchEnvelope | null =
      searchPipelineStore.get(
        intentKey,
        intentFingerprint
      );

    if (!envelope) {
    /* =====================================================
       LOAD SEARCH DICTIONARIES
    ===================================================== */

    const [
      brands,
      categories,
      colors,
      sizes,
    ] = await getCatalogMemo(
      prisma,
      intentFingerprint,
      "search-dicts",
      () =>
        Promise.all([
          prisma.brand.findMany({
            select: {
              name: true,
            },
          }),

          prisma.category.findMany({
            select: {
              id: true,
              name: true,
              parentId: true,
            },
          }),

          prisma.color.findMany({
            select: {
              name: true,
            },
          }),

          prisma.size.findMany({
            select: {
              value: true,
            },
          }),
        ])
    );

    const brandNames = brands.map(
      (item) => item.name
    );

    const categoryNames = categories.map(
      (item) => item.name
    );

    const categoryNameById = new Map<
      string,
      string
    >();

    const categoryParentIdById = new Map<
      string,
      string | null
    >();

    for (const category of categories) {
      categoryNameById.set(
        category.id,
        category.name
      );

      categoryParentIdById.set(
        category.id,
        category.parentId
      );
    }

    const getCategoryChainNames = (
      categoryId: string
    ): string[] => {
      const names: string[] = [];

      const visitedIds = new Set<string>();

      let currentId: string | null =
        categoryId;

      while (
        currentId &&
        !visitedIds.has(currentId)
      ) {
        visitedIds.add(currentId);

        const name =
          categoryNameById.get(currentId);

        if (name) {
          names.push(name);
        }

        currentId =
          categoryParentIdById.get(
            currentId
          ) ?? null;
      }

      return names;
    };

    const colorNames = colors.map(
      (item) => item.name
    );

    const sizeValues = sizes.map(
      (item) => item.value
    );

    /* =====================================================
       DETECT STRUCTURED QUERY
       (sequential detection with span masking: each matched
       entity is consumed before the next dictionary runs)
    ===================================================== */

    const normalizedQuery =
      looseNormalize(query);

    let workingQuery = normalizedQuery;

    const detectEntity = (
      values: string[]
    ): string | null => {
      const hit = findMatchSpan(
        workingQuery,
        values
      );

      if (!hit) {
        return null;
      }

      workingQuery = maskValue(
        workingQuery,
        hit.value
      );

      return hit.value;
    };

    const detectEntities = (
      values: string[]
    ): string[] => {
      const found: string[] = [];

      for (;;) {
        const hit = findMatchSpan(
          workingQuery,
          values
        );

        if (!hit) {
          break;
        }

        workingQuery = maskValue(
          workingQuery,
          hit.value
        );

        found.push(hit.value);
      }

      return found;
    };

    const detectedBrand =
      detectEntity(brandNames);

    const detectedCategoryRaw =
      detectEntity([
        ...categoryNames,
        ...Object.keys(
          CATEGORY_ALIAS_WORDS
        ),
      ]);

    const detectedCategory =
      detectedCategoryRaw
        ? (CATEGORY_ALIAS_WORDS[
            looseNormalize(
              detectedCategoryRaw
            )
          ] ?? detectedCategoryRaw)
        : null;

    const detectedColors =
      detectEntities(colorNames);

    const detectedColor =
      detectedColors[0] ?? null;

    const sizeValueHit = findMatchSpan(
      workingQuery,
      [
        ...sizeValues,
        ...Object.keys(
          SIZE_ALIAS_WORDS
        ),
      ]
    );

    if (sizeValueHit) {
      workingQuery = maskValue(
        workingQuery,
        sizeValueHit.value
      );
    }

    const detectedSizeRaw =
      sizeValueHit?.value ?? null;

    const detectedSize =
      detectedSizeRaw
        ? (SIZE_ALIAS_WORDS[
            looseNormalize(
              detectedSizeRaw
            )
          ] ?? detectedSizeRaw)
        : null;

    /* Stage 3-C: an explicit system token becomes a size-system
       constraint ONLY when a size value is also present and the
       token sits adjacent to it (detectSizeSystem). Otherwise the
       system word stays plain query text - legacy bare-size
       queries behave exactly as before. The system token is then
       masked so it cannot leak into free-text scoring. */
    const detectedSizeSystem =
      sizeValueHit && detectedSize
        ? detectSizeSystem(
            normalizedQuery,
            {
              index: sizeValueHit.index,
              length: sizeValueHit.length,
            }
          )
        : null;

    if (detectedSizeSystem) {
      workingQuery = maskValue(
        workingQuery,
        detectedSizeSystem.word
      );
    }

    const genderWords = [
      "women",
      "woman",
      "womens",
      "ladies",
      "lady",
      "female",
      "men",
      "man",
      "mens",
      "gentleman",
      "gentlemen",
      "male",
      "kids",
      "kid",
      "children",
      "child",
      "boys",
      "boy",
      "girls",
      "girl",
      "unisex",
    ];

    const detectedGenderRaw =
      detectEntity(genderWords);

    const detectedGender =
      normalizeGender(
        detectedGenderRaw
      );

    /* =====================================================
       LOAD PRODUCTS
    ===================================================== */

    /* F7-S2: the results contract covers purchasable inventory
       only. OUT_OF_STOCK products are excluded at the candidate
       level (before scoring), so Exact, Similar, ranking, category
       presence and diagnostics are all consistent and a result can
       never surface as purchasable.

       F8-A: the pool additionally requires at least one AVAILABLE
       variant, so a product whose stock is entirely depleted cannot
       be advertised through any size/color/category path. */
    const products =
      await prisma.product.findMany({
        where: {
          availability: { not: "OUT_OF_STOCK" },

          /* Compatibility bridge (Phase-0 commerce): a product is
             searchable when it has a valid AVAILABLE purchasing path
             through EITHER the legacy ProductVariant (pre-Phase-0
             catalog) OR the commerce chain Product -> ProductOffer ->
             ProductOfferVariant (eBay and other Phase-0 sources). The
             existing `availability != OUT_OF_STOCK` rule is unchanged,
             and F1 real-product URL validation plus ranking run exactly
             as before. Commerce variant size/color do NOT yet
             participate in size/color filters or serialization (eBay
             products simply carry no size/color data), documented rather
             than inventing behavior. */
          OR: [
            {
              variants: {
                some: { availability: "AVAILABLE" },
              },
            },
            {
              offers: {
                some: {
                  variants: {
                    some: { availability: "AVAILABLE" },
                  },
                },
              },
            },
          ],
        },
        select: {
          id: true,
          name: true,
          description: true,
          price: true,
          currency: true,
          productUrl: true,
          imageUrl: true,
          gender: true,
          availability: true,

          brand: {
            select: {
              id: true,
              name: true,
            },
          },

          category: {
            select: {
              id: true,
              name: true,
            },
          },

          variants: {
            select: {
              price: true,
              currency: true,
              availability: true,

              color: {
                select: {
                  id: true,
                  name: true,
                  hex: true,
                },
              },

              size: {
                select: {
                  value: true,
                  system: true,
                },
              },
            },
          },

          attributes: {
            select: {
              value: true,

              attribute: {
                select: {
                  name: true,
                },
              },
            },
          },
        },

        orderBy: {
          createdAt: "desc",
        },
      });

    /* =====================================================
       BUILD ATTRIBUTE DICTIONARY
    ===================================================== */

    const attributeValues: string[] = [];

    for (const product of products) {
      for (const item of product.attributes) {
        const value = normalizeText(
          item.value
        );

        if (!value) {
          continue;
        }

        if (
          value === "n a" ||
          value === "n/a"
        ) {
          continue;
        }

        attributeValues.push(
          item.value
        );
      }
    }

    /* =====================================================
       DETECT ATTRIBUTES
    ===================================================== */

    const detectedAttributes: {
      attributeName: string;
      value: string;
    }[] = [];

    const uniqueAttributes =
      new Map<
        string,
        {
          attributeName: string;
          value: string;
        }
      >();

    for (const product of products) {
      for (const item of product.attributes) {
        if (!item.value) {
          continue;
        }

        const value =
          normalizeText(item.value);

        if (
          value === "n a" ||
          value === "n/a"
        ) {
          continue;
        }

        const key =
          `${normalizeText(
            item.attribute.name
          )}::${value}`;

        if (
          !uniqueAttributes.has(key)
        ) {
          uniqueAttributes.set(key, {
            attributeName:
              item.attribute.name,
            value: item.value,
          });
        }
      }
    }

    for (const item of uniqueAttributes.values()) {
      const attributeHit = findMatchSpan(
        workingQuery,
        [item.value]
      );

      if (attributeHit) {
        workingQuery = maskValue(
          workingQuery,
          item.value
        );

        detectedAttributes.push({
          attributeName:
            item.attributeName,
          value: item.value,
        });
      }
    }

    /* =====================================================
       STRUCTURED QUERY
    ===================================================== */

    const structuredQuery = {
      brand: detectedBrand,
      category: detectedCategory,
      color: detectedColor,
      colors: detectedColors,
      size: detectedSize,
      /* Stage 3-C additive fields. size stays the abstract value
         for every query; sizeSystem/sizeAudience are non-null only
         when the query carried an explicit size system. */
      sizeSystem:
        detectedSizeSystem?.system ??
        null,
      sizeAudience:
        detectedSizeSystem
          ? detectedGender
          : null,
      gender: detectedGender,
      attributes: detectedAttributes,
      budget: hasBudget
        ? { min: priceMin, max: priceMax }
        : null,
    };

    /* =====================================================
       QUERY WORDS
    ===================================================== */

    const SEARCH_STOP_WORDS = new Set([
      "size",
      "sizes",
      "for",
    ]);

    /* =====================================================
       CATEGORY INTENT VOCABULARY (Phase 6.4.2)
       Known clothing categories that do NOT exist in the
       catalog taxonomy. A query token from this list is
       recognized as category intent and consumed, but it
       makes Exact impossible regardless of remaining
       constraint matches. Purely subtractive: it never
       adds score, strength, or candidates.
    ===================================================== */

    const UNSUPPORTED_CATEGORY_WORDS =
      new Set([
        "pant",
        "pants",
        "coat",
        "dress",
        "skirt",
        "sweater",
        "hooded",
        "blazer",
        "suit",
        "suits",
      ]);

    const singularizeCategoryWord = (
      word: string
    ): string | null => {
      if (
        UNSUPPORTED_CATEGORY_WORDS.has(
          word
        )
      ) {
        return word;
      }

      if (
        word.endsWith("s") &&
        UNSUPPORTED_CATEGORY_WORDS.has(
          word.slice(0, -1)
        )
      ) {
        return word.slice(0, -1);
      }

      return null;
    };

    const unsupportedIntentWords =
      new Set<string>();

    const queryWords =
      getWords(query);

    const filteredQueryWords =
      queryWords.filter(
        (word) => !SEARCH_STOP_WORDS.has(word)
      );

    for (const word of filteredQueryWords) {
      if (singularizeCategoryWord(word)) {
        unsupportedIntentWords.add(word);
      }
    }

    /* =====================================================
       STRUCTURED WORDS
    ===================================================== */

    const structuredWords =
      new Set<string>();

    const addStructuredWords = (
      value: string | null
    ) => {
      if (!value) {
        return;
      }

      for (const word of getWords(value)) {
        structuredWords.add(word);
      }
    };

    addStructuredWords(detectedBrand);
    addStructuredWords(
      detectedCategoryRaw
    );
    addStructuredWords(detectedCategory);
    addStructuredWords(detectedColor);
    addStructuredWords(detectedSizeRaw);
    addStructuredWords(detectedSize);
    addStructuredWords(
      detectedSizeSystem?.system ??
        null
    );
    addStructuredWords(
      detectedGenderRaw
    );
    addStructuredWords(
      detectedGender
    );

    for (const attribute of detectedAttributes) {
      addStructuredWords(
        attribute.value
      );
    }

    const freeTextWords =
      filteredQueryWords.filter(
        (word) =>
          !structuredWords.has(word) &&
          !unsupportedIntentWords.has(
            word
          )
      );

    const hasStructuredFilterGlobal =
      Boolean(
        detectedBrand ||
          detectedCategory ||
          detectedColor ||
          detectedSize ||
          detectedGender ||
          detectedAttributes.length > 0
      );

    const hasStrongStructuredFilter =
      Boolean(
        detectedBrand ||
          detectedCategory ||
          detectedColor ||
          detectedSize ||
          detectedAttributes.length > 0
      );

    const corpusWords = new Set<string>();

    for (const product of products) {
      const corpusTexts = [
        product.name,
        product.description,
        product.brand?.name,
        product.category?.name,
        String(product.gender ?? ""),

        ...product.variants.map(
          (variant) =>
            variant.color?.name ?? ""
        ),

        ...product.variants.map(
          (variant) =>
            variant.size?.value ?? ""
        ),

        ...product.attributes.map(
          (attribute) => attribute.value
        ),

        ...product.attributes.map(
          (attribute) =>
            attribute.attribute.name
        ),
      ];

      for (const word of getWords(
        corpusTexts.join(" ")
      )) {
        corpusWords.add(word);
      }
    }

    const requiredFreeWords =
      freeTextWords.filter((word) =>
        corpusWords.has(word)
      );

    const requiredWordSet = new Set(
      requiredFreeWords
    );

    const hasSearchSignal =
      Boolean(detectedBrand) ||
      Boolean(detectedCategory) ||
      Boolean(detectedColor) ||
      Boolean(detectedSize) ||
      Boolean(detectedGender) ||
      detectedAttributes.length > 0 ||
      filteredQueryWords.length > 0;

    /* =====================================================
       CATEGORY STATUS METADATA + EMPTY-NODE POLICY STATE
       Describes the requested category node, how many
       products its subtree stocks, and which sibling
       nodes exist. The metadata itself is informational;
       the derived empty/sibling flags below feed ONLY
       the similar-path substitution policy (6.7.2).
    ===================================================== */

    let categoryStatus: {
      requested: string;
      productCount: number;
      siblings: string[];
    } | null = null;

    if (detectedCategory) {
      const requestedNode =
        categories.find(
          (category) =>
            category.name ===
            detectedCategory
        );

      if (requestedNode) {
        const subtreeIds = new Set([
          requestedNode.id,
        ]);

        let subtreeChanged = true;

        while (subtreeChanged) {
          subtreeChanged = false;

          for (const category of categories) {
            if (
              !subtreeIds.has(category.id) &&
              category.parentId !== null &&
              subtreeIds.has(category.parentId)
            ) {
              subtreeIds.add(category.id);
              subtreeChanged = true;
            }
          }
        }

        const productCount = products
          .filter(
            (product) =>
              product.category &&
              subtreeIds.has(product.category.id)
          )
          .filter(hasRealPage).length;

        const siblings = categories
          .filter(
            (category) =>
              requestedNode.parentId !==
                null &&
              category.id !==
                requestedNode.id &&
              category.parentId ===
                requestedNode.parentId
          )
          .map((category) => category.name)
          .sort();

        categoryStatus = {
          requested: detectedCategory,
          productCount,
          siblings,
        };
      }
    }

    /* B2-gated substitution trigger: the requested
       node exists in taxonomy but stocks nothing.
       Siblings may then stand in for it in the
       similar path only - never for Exact. */
    const requestedCategoryIsEmpty =
      categoryStatus !== null &&
      categoryStatus.productCount === 0;

    const siblingCategoryNames =
      new Set(
        categoryStatus
          ? categoryStatus.siblings
          : []
      );

    /* =====================================================
       SCORE PRODUCTS
    ===================================================== */

    const diagVectors: DiagStrictVector[] = [];

    const scoredProducts =
      products.map((product) => {
        const productGender =
          normalizeGender(
            String(product.gender ?? "")
          );

        const brandText =
          normalizeText(
            product.brand?.name
          );

        const categoryText =
          normalizeText(
            product.category?.name
          );

        const nameText =
          normalizeText(product.name);

        const descriptionText =
          normalizeText(
            product.description
          );

        /* F8-A: size/color/searchable evidence comes from the
           purchasable (AVAILABLE) variants only. */
        const purchasableVariants =
          availVariants(product);

        const productColors =
          purchasableVariants
            .map((variant) =>
              normalizeText(
                variant.color?.name
              )
            )
            .filter(Boolean);

        const productSizes =
          purchasableVariants
            .map((variant) =>
              normalizeText(
                variant.size?.value
              )
            )
            .filter(Boolean);

        const searchableText =
          normalizeText(
            [
              product.name,
              product.description,
              product.brand?.name,
              product.category?.name,
              String(
                product.gender ?? ""
              ),

              ...purchasableVariants.map(
                (variant) =>
                  variant.color?.name ??
                  ""
              ),

              ...purchasableVariants.map(
                (variant) =>
                  variant.size?.value ??
                  ""
              ),

              ...product.attributes.map(
                (attribute) =>
                  attribute.value
              ),

              ...product.attributes.map(
                (attribute) =>
                  attribute.attribute
                    .name
              ),
            ].join(" ")
          );

        /* ===============================================
           STRUCTURED MATCHES
        =============================================== */

        const brandMatches =
          !detectedBrand ||
          brandText ===
            normalizeText(
              detectedBrand
            );

        /* Budget (spec §8): Exact requires the price inside
           the requested bounds; a product within ±35% of the
           bounds is "close" and eligible for Similar only.
           The stored price (in its original currency, EUR for
           seeds and USD for provider rows) is normalized to
           the EUR reference via the single currency layer;
           product.price is the product's starting price (the
           lowest variant price, P3 / catalog integrity). */
        const budgetMatches =
          !hasBudget ||
          priceWithinBudget(
            Number(product.price),
            product.currency,
            priceMin,
            priceMax,
            priceRate
          );

        const budgetCompatible =
          !hasBudget ||
          priceWithinBudgetBand(
            Number(product.price),
            product.currency,
            priceMin,
            priceMax,
            priceRate
          );

        const productCategoryChainNames =
          product.category
            ? getCategoryChainNames(
                product.category.id
              )
            : [];

        const categoryMatches =
          !detectedCategory ||
          productCategoryChainNames.includes(
            detectedCategory
          );

        const selectedColorSet = new Set(
          detectedColors.map((color) =>
            normalizeText(color)
          )
        );

        const productColorSet = new Set(
          productColors
        );

        /* Color admission (spec §5):
           - no color requested: vacuous
           - one color: product must carry it (intersection)
           - two+: subset semantics — every product color must
             be inside the requested palette AND the product
             carries at least one requested color */
        const colorMatches =
          detectedColors.length === 0
            ? true
            : detectedColors.length === 1
              ? productColorSet.has(
                  normalizeText(
                    detectedColor!
                  )
                )
              : productColors.length > 0 &&
                  productColors.every(
                    (color) =>
                      selectedColorSet.has(color)
                  );

        /* Compatibility for the Similar path / 80% gate:
           a product sharing any requested color is a color
           companion, even when it also carries off-palette
           colors (e.g. a White/Red item for a White+Black
           palette). */
        const colorCompatible =
          detectedColors.length === 0
            ? true
            : productColors.some((color) =>
                selectedColorSet.has(color)
              );

        const sizeMatches =
          !detectedSize
            ? true
            : detectedSizeSystem
              ? purchasableVariants.some(
                  (variant) =>
                    variantMatchesSizeSystem(
                      variant.size,
                      detectedSize,
                      detectedSizeSystem.system
                    )
                )
              : productSizes.includes(
                  normalizeText(
                    detectedSize
                  )
                );

        const productGenderMatches =
          genderMatches(
            detectedGender,
            productGender
          );

        /* ===============================================
           ATTRIBUTE MATCHES
        =============================================== */

        let matchedAttributes = 0;

        for (
          const requested of
          detectedAttributes
        ) {
          const found =
            product.attributes.some(
              (attribute) =>
                normalizeText(
                  attribute.attribute.name
                ) ===
                  normalizeText(
                    requested.attributeName
                  ) &&
                normalizeText(
                  attribute.value
                ) ===
                  normalizeText(
                    requested.value
                  )
            );

          if (found) {
            matchedAttributes++;
          }
        }

        const allAttributesMatched =
          detectedAttributes.length === 0 ||
          matchedAttributes ===
            detectedAttributes.length;

        /* Soft preferences (spec §9): context-aware hints
           (Fit/Material/Style/…) nudge ranking inside Exact
           only; they never gate Exact or Similar admission. */
        const softMatchedCount =
          softAttributes.filter((hint) =>
            product.attributes.some(
              (attribute) =>
                normalizeText(
                  attribute.value
                ) === hint
            )
          ).length;

        /* ===============================================
           FREE TEXT
        =============================================== */

        let matchedFreeTextWords = 0;
        let matchedRequiredWords = 0;
        let score = 0;
        let freeTextPoints = 0;

        const applyWordMatch = (
          word: string,
          points: number
        ) => {
          matchedFreeTextWords++;

          if (requiredWordSet.has(word)) {
            matchedRequiredWords++;
          }

          freeTextPoints += points;
        };

        for (const word of freeTextWords) {
          if (nameText.includes(word)) {
            applyWordMatch(word, 100);
          } else if (
            categoryText.includes(word)
          ) {
            applyWordMatch(word, 80);
          } else if (
            brandText.includes(word)
          ) {
            applyWordMatch(word, 70);
          } else if (
            descriptionText.includes(word)
          ) {
            applyWordMatch(word, 40);
          } else if (
            searchableText.includes(word)
          ) {
            applyWordMatch(word, 20);
          }
        }

        /* ===============================================
           STRUCTURED SCORE
        =============================================== */

        if (detectedBrand) {
          score += brandMatches
            ? 240
            : -80;
        }

        if (hasBudget) {
          score += budgetMatches
            ? 180
            : budgetCompatible
              ? -30
              : -70;
        }

        /* B2 substitution credit: a sibling of an
           empty requested node that satisfies every
           other explicit structural constraint is
           scored as if the category matched, in the
           similar path only. */
        const categoryCredit =
          categoryMatches ||
          (requestedCategoryIsEmpty &&
            !categoryMatches &&
            product.category !== null &&
            siblingCategoryNames.has(
              product.category.name
            ) &&
            brandMatches &&
            colorMatches &&
            sizeMatches &&
            allAttributesMatched);

        if (detectedCategory) {
          score += categoryCredit
            ? 400
            : -220;
        }

        if (detectedColor) {
          score += colorMatches
            ? 320
            : -80;
        }

        if (detectedSize) {
          score += sizeMatches
            ? 140
            : -100;
        }

        if (detectedAttributes.length > 0) {
          score +=
            matchedAttributes * 160;

          score -=
            (detectedAttributes.length -
              matchedAttributes) *
            120;
        }

        if (softMatchedCount > 0) {
          score += softMatchedCount * 40;
        }

        const structuralMismatches = [
          Boolean(
            detectedBrand &&
              !brandMatches
          ),
          Boolean(
            detectedCategory &&
              !categoryMatches &&
              !categoryCredit
          ),
          Boolean(
            detectedColor &&
              !colorMatches
          ),
          Boolean(
            detectedSize &&
              !sizeMatches
          ),
          Boolean(
            hasBudget &&
              !budgetCompatible
          ),
          Boolean(
            detectedAttributes.length > 0 &&
              matchedAttributes <
                detectedAttributes.length
          ),
        ].filter(Boolean).length;

        /* ===============================================
           FREE TEXT APPLICATION
           Structured intent dominates: free-text and
           phrase bonuses only apply when the candidate
           has no structural mismatch against detected
           intent, or when the query had none.
        =============================================== */

        const normalizedQuery =
          normalizeText(query);

        const phraseBonus =
          normalizedQuery.length > 0 &&
          searchableText.includes(
            normalizedQuery
          )
            ? 100
            : 0;

        const freeTextAllowed =
          !hasStructuredFilterGlobal ||
          structuralMismatches === 0;

        if (freeTextAllowed) {
          score += freeTextPoints + phraseBonus;
        }

        /* ===============================================
           CATEGORY COHERENCE FACTOR
           The detected category is the spine of query
           intent. A candidate outside an explicitly
           requested category carries half relevance,
           so refinement stacks (brand/color) can never
           outrank on-category candidates.
        =============================================== */

        const categoryCoherent =
          !detectedCategory ||
          categoryMatches ||
          categoryCredit;

        if (!categoryCoherent) {
          score = Math.round(score * 0.5);
        }

        /* ===============================================
           EXACT MATCH
        =============================================== */

        const structuredFiltersMatch =
          brandMatches &&
          categoryMatches &&
          colorMatches &&
          sizeMatches &&
          genderMatches(
            detectedGender,
            productGender
          ) &&
          budgetMatches &&
          allAttributesMatched;

        /* Free-text words are relevance signals, never hard
           Exact gates, WHEN a strong structured filter exists
           (brand/category/color/size/attribute): a word that
           exists in catalog vocabulary but is absent from a
           candidate cannot veto a candidate whose structured
           intent is complete. But when the query's ONLY signal
           is free text (no strong structured filter), Exact has
           nothing else to carry, so a candidate must actually
           match at least one free-text word - otherwise every
           corpus-known word would admit the whole catalog
           (F7-S1: 'silk' -> 575). The unknown-noise guard still
           blocks pure gibberish. */
        const unknownOnlyNoise =
          requiredFreeWords.length === 0 &&
          freeTextWords.length > 0 &&
          !hasStrongStructuredFilter;

        const freeTextGate =
          freeTextWords.length > 0 &&
          !hasStrongStructuredFilter &&
          matchedFreeTextWords === 0;

        const allFreeTextMatched =
          !unknownOnlyNoise && !freeTextGate;

        const exactMatch =
          hasSearchSignal &&
          structuredFiltersMatch &&
          allFreeTextMatched &&
          unsupportedIntentWords.size ===
            0;

        /* ===============================================
           SIMILAR MATCH
        =============================================== */

        const hasAnyPositiveComponent =
          Boolean(
            detectedBrand &&
            brandMatches
          ) ||
          Boolean(
            detectedCategory &&
            (categoryMatches ||
              categoryCredit)
          ) ||
          Boolean(
            detectedColor &&
            colorMatches
          ) ||
          Boolean(
            detectedSize &&
            sizeMatches
          ) ||
          Boolean(
            hasBudget &&
            budgetCompatible
          ) ||
          matchedAttributes > 0;

        const hasFreeTextMatch =
          matchedFreeTextWords > 0;

        const meaningfulRelevance =
          hasAnyPositiveComponent ||
          (!hasStructuredFilterGlobal &&
            hasFreeTextMatch);

        const genderMismatch = Boolean(
          detectedGender &&
            !productGenderMatches
        );

        /* Category scope gate (Similar path only):
           with an explicit non-empty category intent,
           candidates must belong to the requested
           subtree, or qualify as empty-node sibling
           substitutions. Unrelated branches (e.g.
           Shoes for "white shirt") never enter. */
        const categoryScopeAllowed =
          !detectedCategory ||
          categoryMatches ||
          categoryCredit;

        const similarMatch =
          !exactMatch &&
          !genderMismatch &&
          categoryScopeAllowed &&
          structuralMismatches <= 2 &&
          meaningfulRelevance &&
          score > 0;

        /* ===============================================
           RESULT
        =============================================== */

        diagVectors.push({
          brand: detectedBrand ? brandMatches : null,
          category: detectedCategory
            ? categoryMatches
            : null,
          color: detectedColor ? colorMatches : null,
          size: detectedSize ? sizeMatches : null,
          gender: detectedGender
            ? productGenderMatches
            : null,
          budget: hasBudget ? budgetMatches : null,
          attributes:
            detectedAttributes.length > 0
              ? allAttributesMatched
              : null,
          hasAnySize: productSizes.length > 0,
        });

        return {
          ...product,

          score,

          exactMatch,

          similarMatch,

          matchedWords:
            matchedFreeTextWords,

          totalQueryWords:
            filteredQueryWords.length,

          matchedColors:
            detectedColors.length === 0
              ? 0
              : detectedColors.reduce(
                  (count, color) =>
                    count +
                    (productColorSet.has(
                      normalizeText(color)
                    )
                      ? 1
                      : 0),
                  0
                ),

          matchedCategories:
            detectedCategory &&
            categoryMatches
              ? 1
              : 0,

          matchedAttributes,

          softMatched: softMatchedCount,

          structuredMatches: {
            brand:
              detectedBrand
                ? brandMatches
                : null,

            category:
              detectedCategory
                ? categoryMatches
                : null,

            color:
              detectedColor
                ? colorCompatible
                : null,

            size:
              detectedSize
                ? sizeMatches
                : null,

            gender:
              detectedGender
                ? productGenderMatches
                : null,

            budget:
              hasBudget
                ? budgetCompatible
                : null,

            attributes:
              detectedAttributes.length > 0
                ? allAttributesMatched
                : null,
          },
        };
      });

    /* =====================================================
       EXACT PRODUCTS
       Gender priority is a PRIMARY sort key, not a
       tie-break: for an explicit Men/Women/Kids request,
       same-gender products always come before UNISEX
       products regardless of score, then (within each
       gender bucket) score descending (spec §1/§12).
    ===================================================== */

    const genderOrderKey = (
      product: (typeof scoredProducts)[number]
    ): number => {
      if (
        detectedGender !== "MEN" &&
        detectedGender !== "WOMEN" &&
        detectedGender !== "KIDS"
      ) {
        return 0;
      }

      const same =
        normalizeGender(
          String(product.gender ?? "")
        ) === detectedGender;

      return same ? 0 : 1;
    };

    const exactProducts =
      scoredProducts
        .filter(
          (product) =>
            product.exactMatch
        )
        .sort(
          (a, b) =>
            genderOrderKey(a) -
              genderOrderKey(b) ||
            b.score - a.score ||
            (a.id < b.id
              ? -1
              : a.id > b.id
                ? 1
                : 0)
        );

    /* =====================================================
       SIMILAR PRODUCTS
       (80% structured-constraint gate: similar candidates
       must match at least 80% of the structured
       constraints the parser actually detected. Compute
       the ratio independently from per-product
       structuredMatches; the internal score is not used.
       Exact is untouched.)
    ===================================================== */

    const structuredMatchKeys = [
      "brand",
      "category",
      "color",
      "size",
      "gender",
      "budget",
      "attributes",
    ] as const;

    const detectedConstraintCount =
      (() => {
        const sample = scoredProducts[0];
        if (!sample) {
          return 0;
        }
        return structuredMatchKeys.filter(
          (key) =>
            sample.structuredMatches[key] !==
            null
        ).length;
      })();

    const matchesAtLeast80Percent = (
      product: (typeof scoredProducts)[number]
    ): boolean => {
      if (detectedConstraintCount === 0) {
        return true;
      }

      const matchedCount =
        structuredMatchKeys.filter(
          (key) =>
            product.structuredMatches[key] ===
            true
        ).length;

      return (
        matchedCount * 5 >=
        detectedConstraintCount * 4
      );
    };

    const allSimilarProducts =
      scoredProducts
        .filter(
          (product) =>
            product.similarMatch &&
            product.score > 0
        )
        .sort(
          (a, b) =>
            b.score - a.score ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
        );

    const similarProducts =
      allSimilarProducts.filter((product) =>
        matchesAtLeast80Percent(product)
      );

    const similarMessage =
      detectedConstraintCount > 0 &&
      similarProducts.length === 0
        ? "No similar products match at least 80% of your preferences. Try fewer or less specific preferences."
        : null;

    /* F1: strip demo/placeholder products from the serialized
       result lists only (the engine's exact/similar sets and
       ranking stay untouched).

       F8-A: the serialized payload carries purchasable variants
       only, so the UI can build size/color options directly from
       what it receives - the page never shows an OUT_OF_STOCK
       size or color as available.

       F9: every serialized product passes through the strict
       whitelist projection; the scoring internals are restored
       exclusively under ?debug=1 (projectProduct).

       F10: the serialized lists are bounded to one ranked page
       (limit/offset) except under ?debug=1, which returns the
       full envelope. exactCount/similarCount stay TOTAL matches;
       exactHasMore/similarHasMore drive Load-more. The facet
       truth block is computed over the full ranked set (exact +
       similar, F1-filtered) BEFORE slicing, so truncating the
       payload can never truncate facet options or their counts. */
    const serializableExactProducts =
      exactProducts.filter(hasRealPage);

    const serializableSimilarProducts =
      similarProducts.filter(hasRealPage);

    const facets = buildServerFacetBlock([
      ...serializableExactProducts,
      ...serializableSimilarProducts,
    ]);

    const exactTotal =
      serializableExactProducts.length;

    const similarTotal =
      serializableSimilarProducts.length;

    /* =====================================================
       EMPTY-RESULT DIAGNOSTICS (spec §11)
       Evidence-based only. Distinguishes:
       A - a size constraint that has no results in scope;
       B - every constraint exists individually but no
           single product satisfies the combination;
       C - matching products carry no size data, so the
           requested size cannot be confirmed.
       Diagnostics only - never touches membership or
       ranking (all per-product evidence mirrors the exact
       gate predicates via diagVectors, built above).
    ===================================================== */

    const categoryClause = detectedCategory
      ? ` in ${detectedCategory.toLowerCase()}`
      : "";

    const scopeProducts = detectedCategory
      ? products.filter(
          (product) =>
            product.category &&
            getCategoryChainNames(
              product.category.id
            ).includes(
              detectedCategory
            )
        )
      : products;

    const scopeProductIds = new Set(
      scopeProducts.map((product) => product.id)
    );

    const scopedVectors = diagVectors.filter(
      (_, index) =>
        scopeProductIds.has(products[index].id)
    );

    const presence = {
      category: scopeProducts.length > 0,

      brand: detectedBrand
        ? scopeProducts.some(
            (product) =>
              normalizeText(
                product.brand?.name
              ) ===
              normalizeText(detectedBrand)
          )
        : true,

      color:
        detectedColors.length > 0
          ? scopeProducts.some(
              (product) =>
                availVariants(
                  product
                ).some(
                  (variant) =>
                    variant.color &&
                    detectedColors.some(
                      (color) =>
                        normalizeText(
                          variant.color!.name
                        ) ===
                        normalizeText(color)
                    )
                )
            )
          : true,

      size: detectedSize
        ? scopeProducts.some(
            (product) =>
              availVariants(
                product
              ).some((variant) =>
                detectedSizeSystem
                  ? variantMatchesSizeSystem(
                      variant.size,
                      detectedSize,
                      detectedSizeSystem.system
                    )
                  : Boolean(
                      variant.size &&
                        normalizeText(
                          variant.size.value
                        ) ===
                          normalizeText(
                            detectedSize
                          )
                    )
              )
          )
        : true,

      gender: detectedGender
        ? scopeProducts.some(
            (product) =>
              genderMatches(
                detectedGender,
                normalizeGender(
                  String(product.gender ?? "")
                )
              )
          )
        : true,

      budget: hasBudget
        ? scopeProducts.some(
            (product) =>
              priceWithinBudget(
                Number(product.price),
                product.currency,
                priceMin,
                priceMax,
                priceRate
              )
          )
        : true,

      attributes: scopedVectors.some(
        (vector) =>
          vector.attributes === true
      ),
    };

    const diagnostics =
      exactTotal === 0 &&
      scoredProducts.length > 0
        ? buildSearchDiagnostics({
            categoryClause,

            requestedCategoryIsEmpty,

            detected: {
              brand: detectedBrand,
              category: detectedCategory,
              colors: detectedColors,
              size: detectedSize,
              gender: detectedGender,
              hasBudget,
              budgetMin: priceMin,
              budgetMax: priceMax,
              attributes:
                detectedAttributes,
            },

            unsupportedIntentWords: [
              ...unsupportedIntentWords,
            ],

            presence,

            scopedVectors,

            allVectors: diagVectors,
          })
        : [];

    /* =====================================================
       RESPONSE
    ===================================================== */

      envelope = {
        structuredQuery,
        categoryStatus,
        similarMessage,
        facets,
        diagnostics,
        serializableExactProducts,
        serializableSimilarProducts,
        exactTotal,
        similarTotal,
      };

      searchPipelineStore.set(
        intentKey,
        intentFingerprint,
        envelope
      );
    }

    return respondFromEnvelope(envelope, {
      query,
      debug,
      limit,
      offset,
    });
  } catch (error) {
    console.error(
      "Search API error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error: "Failed to search products",
      },
      {
        status: 500,
      }
    );
  }
}