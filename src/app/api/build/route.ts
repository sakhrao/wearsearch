/* Build an Outfit — API.

   The user-facing counterpart to /api/outfits (which generates a whole
   look around an anchor). Here the USER picks one piece per step and
   the server answers with the real next-step options:

     - the category options for `slot` (taxonomy-driven, gender
       compatible, marked with live stock);
     - the real candidate pool for the chosen category (or the whole
       slot), gated like the outfit engine (real product page, not
       out of stock, at least one AVAILABLE variant, shared gender
       policy, slot membership);
     - optional search / colour / size / brand / price filters that
       genuinely restrict the pool (never fake-matched, never
       fallback-replaced — an empty result is returned honestly);
     - 4-8 context-fit recommendations that only REORDER the pool;
     - semantic size options (category vocabulary, independent of
       inventory) plus the real sizes/colours/brands in stock.

   Gender compatibility per category mirrors /api/meta exactly
   (planGendersForLeaf + live Product.gender, UNISEX expanded to both
   adult audiences). The category lists are derived from the shared
   canonical taxonomy + real catalog leaves — never hardcoded. */

import { prisma } from "@/lib/prisma";
import { getFxRate, priceWithinBudget } from "@/lib/currency";
import {
  computeCatalogFingerprint,
  getCatalogMemo,
} from "@/lib/catalog-memo";
import { loadOutfitCatalog } from "@/lib/outfit/catalog";
import { hasRealProductPage } from "@/lib/product-url";
import {
  genderMatches,
  normalizeGender,
} from "@/lib/outfit/candidate-generator";
import { GROUP_OF_SLOT, groupOfCategory } from "@/lib/outfit/category-rules";
import type { OutfitProduct, SlotName } from "@/lib/outfit/types";
import {
  buildQuestionnaireCategories,
  mergeCategoryGenders,
  planGendersForLeaf,
  type CategoryGender,
} from "@/lib/catalog/category-display";
import { vocabularyForCategory } from "@/lib/catalog/size-vocabulary";
import {
  canonicalCategoriesForSlot,
  genderCompatible,
  isOnePieceTopSlug,
  type BuildGender,
  type SlotCategoryOption,
} from "@/lib/build/flow-rules";
import {
  rankByContext,
  type ContextChoice,
} from "@/lib/build/context";
import {
  availableColors,
  availableSizes,
  serializeBuildContextItem,
  serializeBuildProduct,
} from "@/lib/build/serialize";

export const dynamic = "force-dynamic";

const SLOTS: SlotName[] = ["top", "bottom", "footwear", "layer", "accessory"];
const GENDERS: BuildGender[] = ["MEN", "WOMEN", "KIDS"];
const RECOMMEND_COUNT = 8;
const BROWSE_LIMIT_DEFAULT = 12;
const BROWSE_LIMIT_MAX = 40;

type FilterState = {
  colors: string[];
  size: string;
  brands: string[];
  priceMin: number | null;
  priceMax: number | null;
};

function parseGender(v: unknown): BuildGender | null {
  if (typeof v === "string" && (GENDERS as string[]).includes(v)) {
    return v as BuildGender;
  }
  return null;
}

function parseSlot(v: unknown): SlotName | null {
  if (typeof v === "string" && (SLOTS as string[]).includes(v)) {
    return v as SlotName;
  }
  return null;
}

function parseLimit(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return BROWSE_LIMIT_DEFAULT;
  return Math.max(1, Math.min(BROWSE_LIMIT_MAX, Math.floor(n)));
}

function parseOffset(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function parseFilters(body: Record<string, unknown> | null): FilterState {
  const f = (body?.filters ?? {}) as Record<string, unknown>;
  const colors = Array.isArray(f.colors)
    ? f.colors.filter((x): x is string => typeof x === "string")
    : [];
  const brands = Array.isArray(f.brands)
    ? f.brands.filter((x): x is string => typeof x === "string")
    : [];
  const size = typeof f.size === "string" ? f.size.trim() : "";
  const coerceBound = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    colors,
    size,
    brands,
    priceMin: coerceBound(f.priceMin),
    priceMax: coerceBound(f.priceMax),
  };
}

function parseContext(
  body: Record<string, unknown> | null
): Array<{ slot: SlotName; productId: string; color: string | null }> {
  if (!Array.isArray(body?.context)) return [];
  const out: Array<{ slot: SlotName; productId: string; color: string | null }> = [];
  for (const entry of body.context) {
    const e = (entry ?? {}) as Record<string, unknown>;
    const slot = parseSlot(e.slot);
    if (!slot) continue;
    if (typeof e.productId !== "string" || !e.productId) continue;
    out.push({
      slot,
      productId: e.productId,
      color: typeof e.color === "string" && e.color ? e.color : null,
    });
  }
  return out;
}

function normalizeAudience(raw: unknown): CategoryGender | null {
  const value = String(raw ?? "").trim().toUpperCase();
  return (
    ["MEN", "WOMEN", "KIDS", "UNISEX"] as const
  ).includes(value as CategoryGender)
    ? (value as CategoryGender)
    : null;
}

export type BuildRequestBody = {
  gender: BuildGender;
  slot: SlotName;
  category?: string | null;
  mode?: "recommend" | "browse";
  search?: string | null;
  filters?: FilterState;
  context?: Array<{ slot: SlotName; productId: string; color?: string | null }>;
  limit?: number;
  offset?: number;
};

export async function POST(request: Request) {
  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }

    const gender = parseGender(body?.gender);
    if (!gender) {
      return Response.json({ error: "gender must be MEN, WOMEN or KIDS" }, { status: 400 });
    }
    const slot = parseSlot(body?.slot);
    if (!slot) {
      return Response.json({ error: "slot is required and must be one of top/bottom/footwear/layer/accessory" }, { status: 400 });
    }
    const category =
      typeof body?.category === "string" && body.category.trim()
        ? body.category.trim().toLowerCase()
        : null;
    const mode = body?.mode === "browse" ? "browse" : "recommend";
    const search =
      typeof body?.search === "string" ? body.search.trim() : "";
    const filters = parseFilters(body);
    const rawContext = parseContext(body);
    const limit = parseLimit(body?.limit ?? (mode === "browse" ? BROWSE_LIMIT_DEFAULT : RECOMMEND_COUNT));
    const offset = parseOffset(body?.offset);

    const [rate, fingerprint] = await Promise.all([
      getFxRate(),
      computeCatalogFingerprint(prisma),
    ]);

    const catalog = await getCatalogMemo<OutfitProduct[]>(
      prisma,
      fingerprint,
      "build-catalog",
      () => loadOutfitCatalog(prisma)
    );

    /* ---- resolve already-chosen pieces (context) ---- */
    const productsById = new Map(catalog.map((p) => [p.id, p]));
    const contextChoices: ContextChoice[] = [];
    for (const c of rawContext) {
      const product = productsById.get(c.productId);
      if (!product) continue;
      contextChoices.push({
        slot: c.slot,
        product,
        color: c.color
          ? { name: c.color, hex: null }
          : null,
      });
    }

    /* ---- gender compatibility per category (mirror /api/meta) ---- */
    const dbRows = (
      await prisma.category.findMany({
        select: {
          id: true,
          name: true,
          slug: true,
          parent: { select: { name: true } },
        },
        orderBy: { name: "asc" },
      })
    ).map((r) => ({
      slug: r.slug,
      name: r.name,
      id: r.id,
      parentName: r.parent?.name ?? null,
    }));

    const usedCategoryIds = new Set(
      catalog
        .map((p) => p.category?.id)
        .filter((id): id is string => Boolean(id))
    );
    const usedCategorySlugs = new Set(
      dbRows
        .filter((r) => usedCategoryIds.has(r.id))
        .map((r) => r.slug)
    );
    const questionnaireCategories = buildQuestionnaireCategories({
      dbRows,
      usedProductCategoryIds: usedCategoryIds,
    });

    const productGendersBySlug = new Map<string, Set<CategoryGender>>();
    for (const p of catalog) {
      const slug = p.category?.slug?.toLowerCase();
      if (!slug) continue;
      const audience = normalizeAudience(p.gender);
      if (!audience) continue;
      let set = productGendersBySlug.get(slug);
      if (!set) {
        set = new Set<CategoryGender>();
        productGendersBySlug.set(slug, set);
      }
      set.add(audience);
    }
    const gendersBySlug = new Map<string, CategoryGender[]>();
    for (const c of questionnaireCategories) {
      gendersBySlug.set(
        c.slug,
        mergeCategoryGenders({
          planGenders:
            c.source === "legacy"
              ? new Set<CategoryGender>()
              : planGendersForLeaf(c.slug),
          productGenders:
            productGendersBySlug.get(c.slug) ??
            new Set<CategoryGender>(),
          isLegacy: c.source === "legacy",
        })
      );
    }

    /* ---- slot category options (taxonomy + real catalog leaf) ---- */
    const canonicalOptions = canonicalCategoriesForSlot(slot);
    const canonicalSlugs = new Set(canonicalOptions.map((o) => o.slug));
    const extraOptions: SlotCategoryOption[] = [];
    for (const c of questionnaireCategories) {
      if (canonicalSlugs.has(c.slug)) continue;
      const g = groupOfCategory(c.slug);
      if (slot === "top") {
        if (g !== "tops" && !isOnePieceTopSlug(c.slug)) continue;
      } else if (g !== GROUP_OF_SLOT[slot]) {
        continue;
      }
      extraOptions.push({
        slug: c.slug,
        name: c.name,
        root: c.root,
        group: c.group,
        rowSlug: c.slug,
        hasProducts: usedCategorySlugs.has(c.slug),
        onePiece: isOnePieceTopSlug(c.slug),
        legacy: c.source === "legacy",
      });
    }

    /* merge + stock flag + gender compatibility */
    const options: SlotCategoryOption[] = [
      ...canonicalOptions,
      ...extraOptions,
    ].map((o) => ({
      ...o,
        hasProducts:
          o.hasProducts ||
          usedCategorySlugs.has(o.slug),
    }));

    const visibleOptions = options
      .map((o, index) => ({
        ...o,
        genders: gendersBySlug.get(o.slug) ?? ([] as CategoryGender[]),
        index,
      }))
      .filter((o) =>
        genderCompatible(o.genders, gender)
      )
      .sort((a, b) => {
        if (a.hasProducts !== b.hasProducts) return a.hasProducts ? -1 : 1;
        if (a.index !== b.index) return a.index - b.index;
        if (a.name < b.name) return -1;
        if (a.name > b.name) return 1;
        return 0;
      });

    const isOnePieceFlow =
      contextChoices.length > 0
        ? // one-piece is decided by the chosen TOP piece's category
          (() => {
            const topPick = [...contextChoices].find((c) => c.slot === "top");
            return topPick
              ? isOnePieceTopSlug(topPick.product.category?.slug)
              : false;
          })()
        : category !== null && isOnePieceTopSlug(category);

    /* resolved category selection (honesty check) */
    const selectedOption = category
      ? visibleOptions.find((o) => o.slug === category) ?? null
      : null;
    const categoryUnknown =
      category !== null && selectedOption === null;

    /* ---- candidate pool ---- */
    const gates = {
      realPage: (p: OutfitProduct) => hasRealProductPage(p.productUrl),
      inStock: (p: OutfitProduct) =>
        p.availability !== "OUT_OF_STOCK" &&
        p.variants.some((v) => v.availability === "AVAILABLE"),
      genderOk: (p: OutfitProduct) =>
        genderMatches(gender, normalizeGender(p.gender)),
      inSlot: (p: OutfitProduct) => {
        const slug = p.category?.slug?.toLowerCase() ?? "";
        if (category) return slug === category;
        if (slot === "top") {
          const g = groupOfCategory(slug);
          return g === "tops" || isOnePieceTopSlug(slug);
        }
        return groupOfCategory(slug) === GROUP_OF_SLOT[slot];
      },
    };

    let pool = catalog.filter(
      (p) =>
        gates.realPage(p) &&
        gates.inStock(p) &&
        gates.genderOk(p) &&
        gates.inSlot(p)
    );

    /* ---- filters (each genuinely restricts; no fake fallback) ---- */
    let emptyReason: string | null = null;
    if (categoryUnknown) {
      emptyReason = emptyReason ?? "category-not-supported";
    }
    if (search.trim() !== "") {
      const q = search.toLowerCase();
      const next = pool.filter((p) => {
        const hay = [
          p.name,
          p.brand?.name ?? "",
          p.category?.name ?? "",
          p.category?.slug ?? "",
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
      if (next.length === 0 && emptyReason === null) {
        emptyReason = "search-no-match";
      }
      pool = next;
    }
    if (filters.colors.length > 0) {
      const wanted = new Set(
        filters.colors.map((c) => c.trim().toLowerCase())
      );
      const next = pool.filter((p) =>
        p.variants.some(
          (v) =>
            v.availability === "AVAILABLE" &&
            v.color?.name &&
            wanted.has(v.color.name.trim().toLowerCase())
        )
      );
      if (next.length === 0 && emptyReason === null) {
        emptyReason = "color-unavailable";
      }
      pool = next;
    }
    if (filters.size) {
      const wanted = filters.size.trim().toLowerCase();
      const next = pool.filter((p) =>
        p.variants.some(
          (v) =>
            v.availability === "AVAILABLE" &&
            v.size?.value &&
            v.size.value.trim().toLowerCase() === wanted
        )
      );
      if (next.length === 0 && emptyReason === null) {
        emptyReason = "size-unavailable";
      }
      pool = next;
    }
    if (filters.brands.length > 0) {
      const wanted = new Set(
        filters.brands.map((b) => b.trim().toLowerCase())
      );
      const next = pool.filter(
        (p) => p.brand?.name && wanted.has(p.brand.name.trim().toLowerCase())
      );
      if (next.length === 0 && emptyReason === null) {
        emptyReason = "brand-unavailable";
      }
      pool = next;
    }
    if (filters.priceMin !== null || filters.priceMax !== null) {
      const next = pool.filter((p) =>
        priceWithinBudget(
          Number(p.price),
          p.currency,
          filters.priceMin,
          filters.priceMax,
          rate.rate
        )
      );
      if (next.length === 0 && emptyReason === null) {
        emptyReason = "price-unavailable";
      }
      pool = next;
    }
    if (pool.length === 0 && emptyReason === null) {
      emptyReason = category
        ? "no-stock-in-category"
        : visibleOptions.length > 0
          ? "no-stock-in-slot"
          : "no-categories";
    }

    /* ---- deterministic ordering: taxonomy group order then name ---- */
    const optionIndex = new Map<string, number>();
    visibleOptions.forEach((o, i) => optionIndex.set(o.slug, i));
    const ordered = [...pool].sort((a, b) => {
      const ia = a.category?.slug?.toLowerCase() ?? "";
      const ib = b.category?.slug?.toLowerCase() ?? "";
      const pa = optionIndex.get(ia) ?? 9999;
      const pb = optionIndex.get(ib) ?? 9999;
      if (pa !== pb) return pa - pb;
      if (a.name < b.name) return -1;
      if (a.name > b.name) return 1;
      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
      return 0;
    });

    /* ---- metadata (real, from the filtered pool; sizes split into
       the semantic vocabulary + what's actually in stock) ---- */
    const sizeSources =
      selectedOption
        ? [selectedOption]
        : visibleOptions.filter((o) => o.hasProducts).slice(0, 6);
    const sizeOptions = [
      ...new Set(
        sizeSources.flatMap((o) => {
          try {
            const vocab = vocabularyForCategory({
              slug: o.slug,
              name: o.name,
              rootSlug: o.root.toLowerCase(),
              group: o.group,
            });
            return vocab.systems.flatMap((s) => s.values);
          } catch {
            return [] as string[];
          }
        })
      ),
    ];
    const availableSizeSet = new Set<string>();
    const colorSet = new Set<string>();
    const brandSet = new Set<string>();
    for (const p of ordered) {
      for (const s of availableSizes(p)) availableSizeSet.add(s);
      for (const c of availableColors(p)) colorSet.add(c);
      if (p.brand?.name) brandSet.add(p.brand.name);
    }

    /* ---- response body ---- */
    const bodyOut: {
      catalogVersion: string;
      gender: BuildGender;
      slot: SlotName;
      category: string | null;
      categoryName: string | null;
      onePieceTop: boolean;
      optionsAreOnePiece: boolean;
      categories: SlotCategoryOption[];
      sizeOptions: string[];
      availableSizes: string[];
      colors: string[];
      brands: string[];
      total: number;
      hasMore: boolean;
      offset: number;
      limit: number;
      emptyReason: string | null;
      context: ReturnType<typeof serializeBuildContextItem>[];
    } = {
      catalogVersion: fingerprint,
      gender,
      slot,
      category,
      categoryName: selectedOption?.name ?? null,
      onePieceTop: isOnePieceFlow,
      optionsAreOnePiece: category !== null && isOnePieceTopSlug(category),
      categories: visibleOptions,
      sizeOptions,
      availableSizes: [...availableSizeSet].sort((a, b) => a.localeCompare(b)),
      colors: [...colorSet],
      brands: [...brandSet].sort((a, b) => a.localeCompare(b)),
      total: ordered.length,
      hasMore: false,
      offset,
      limit,
      emptyReason,
      context: contextChoices.map(serializeBuildContextItem),
    };

    if (mode === "recommend") {
      const recommended = rankByContext(
        ordered,
        slot,
        contextChoices,
        rate.rate,
        RECOMMEND_COUNT
      );
      bodyOut.hasMore = ordered.length > recommended.length;
      return Response.json({
        ...bodyOut,
        mode,
        recommended: recommended.map((r) => ({
          ...serializeBuildProduct(r.product),
          fitScore: Math.round(r.score * 1000) / 1000,
        })),
      });
    }

    const page = ordered.slice(offset, offset + limit);
    bodyOut.hasMore = offset + page.length < ordered.length;
    return Response.json({
      ...bodyOut,
      mode,
      products: page.map(serializeBuildProduct),
    });
  } catch (e) {
    console.error("Build failed:", e);
    return Response.json(
      { error: "failed to load build options", detail: String(e) },
      { status: 500 }
    );
  }
}