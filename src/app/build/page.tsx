"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { isOnePieceTopSlug } from "@/lib/build/flow-rules";

const SLOT_LABELS: Record<string, string> = {
  top: "Top",
  bottom: "Bottoms",
  footwear: "Shoes",
  layer: "Outerwear",
  accessory: "Accessories",
};

type Gender = "MEN" | "WOMEN" | "KIDS";
const GENDERS: { value: Gender; label: string }[] = [
  { value: "MEN", label: "Men" },
  { value: "WOMEN", label: "Women" },
  { value: "KIDS", label: "Kids" },
];

type BuildProduct = {
  id: string;
  name: string;
  price: string;
  currency: string | null;
  imageUrl: string | null;
  productUrl: string;
  brand: string | null;
  categorySlug: string;
  categoryName: string | null;
  gender: string | null;
  colors: string[];
  sizes: string[];
  fitScore?: number;
};

type CategoryOption = {
  slug: string;
  name: string;
  root: string;
  group: string;
  hasProducts: boolean;
  onePiece: boolean;
  legacy: boolean;
  genders: ("MEN" | "WOMEN" | "KIDS" | "UNISEX")[];
};

type ContextItem = {
  slot: string;
  color: { name: string; hex: string | null } | null;
  product: BuildProduct;
};

type BuildResponse = {
  mode: "recommend" | "browse";
  catalogVersion: string;
  gender: Gender;
  slot: string;
  category: string | null;
  categoryName: string | null;
  onePieceTop: boolean;
  optionsAreOnePiece: boolean;
  categories: CategoryOption[];
  sizeOptions: string[];
  availableSizes: string[];
  colors: string[];
  brands: string[];
  total: number;
  hasMore: boolean;
  offset: number;
  limit: number;
  emptyReason: string | null;
  context: ContextItem[];
  recommended?: BuildProduct[];
  products?: BuildProduct[];
};

type Piece = {
  product: BuildProduct;
  color: string | null;
};

const buildGender = (g: string | null): Gender =>
  g === "WOMEN" || g === "KIDS" ? g : "MEN";

function parsePieces(raw: string | null): Record<string, Piece> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (typeof v !== "object" || v === null) return {};
    const out: Record<string, Piece> = {};
    for (const [key, value] of Object.entries(v)) {
      const piece = (value ?? {}) as Partial<Piece>;
      if (piece.product && typeof piece.product.id === "string") {
        out[key] = {
          product: piece.product as BuildProduct,
          color: typeof piece.color === "string" ? piece.color : null,
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function parseAccessories(raw: string | null): Piece[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter(
      (x): x is Piece =>
        Boolean(x) &&
        typeof (x as Piece).product?.id === "string"
    );
  } catch {
    return [];
  }
}

async function fetchBuild(
  req: Record<string, unknown>,
  signal?: AbortSignal
): Promise<BuildResponse> {
  const res = await fetch("/api/build", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify(req),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error ?? `Request failed (${res.status})`);
  }
  return json as BuildResponse;
}

function money(v: string): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : v;
}

function ProductImage({ src, alt }: { src: string | null; alt: string }) {
  if (!src) {
    return (
      <div className="grid aspect-square w-full place-items-center bg-paper-soft text-sm text-ink-faint">
        No image
      </div>
    );
  }
  return (
    <div className="aspect-square w-full overflow-hidden bg-paper-soft">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className="h-full w-full object-contain"
      />
    </div>
  );
}

function ProductTile({
  product,
  onPick,
  highlight,
}: {
  product: BuildProduct;
  onPick: () => void;
  highlight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`group flex flex-col overflow-hidden rounded-2xl border bg-surface text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${
        highlight ? "border-accent-deep" : "border-line"
      }`}
    >
      <ProductImage src={product.imageUrl} alt={product.name} />
      <div className="flex flex-1 flex-col p-4">
        {product.brand && (
          <p className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
            {product.brand}
          </p>
        )}
        <h4 className="mt-1 line-clamp-2 text-sm font-medium leading-snug text-ink">
          {product.name}
        </h4>
        {product.categoryName && (
          <p className="mt-1 text-xs text-ink-faint">{product.categoryName}</p>
        )}
        <p className="mt-2 text-base font-semibold text-ink">
          {money(product.price)} {product.currency}
        </p>
        {typeof product.fitScore === "number" && (
          <p className="mt-1 text-xs font-medium text-accent-deep">
            {Math.round(product.fitScore * 100)}% match
          </p>
        )}
        <span className="mt-3 inline-flex w-fit rounded-full border border-line bg-paper-soft px-3 py-1 text-xs font-medium text-ink-soft transition group-hover:bg-accent-tint">
          Choose
        </span>
      </div>
    </button>
  );
}

const EMPTY_REASON_TEXT: Record<string, string> = {
  "category-not-supported":
    "This category isn't part of this step's available taxonomy.",
  "search-no-match": "No product matched your search.",
  "color-unavailable": "No in-stock product in this step is available in that color.",
  "size-unavailable": "No in-stock product in this step carries that size.",
  "brand-unavailable": "No in-stock product in this step is from that brand.",
  "price-unavailable": "No in-stock product in this step is in that price range.",
  "no-stock-in-category": "No in-stock product is available in this category yet.",
  "no-stock-in-slot": "No in-stock product is available in this step yet.",
  "no-categories":
    "No categories are available for this gender and step yet.",
};

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-4"
    >
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}

function ArrowIcon({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-4"
    >
      {dir === "left" ? (
        <path d="M19 12H5m6 6-6-6 6-6" />
      ) : (
        <path d="M5 12h14m-6-6 6 6-6 6" />
      )}
    </svg>
  );
}

function BuildPageInner() {
  const searchParams = useSearchParams();

  const [response, setResponse] = useState<BuildResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const [gender, setGender] = useState<Gender>(() =>
    buildGender(searchParams.get("gender"))
  );
  const [stepIndex, setStepIndex] = useState<number>(() => {
    const n = Number(searchParams.get("step"));
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  });
  const [category, setCategory] = useState<string | null>(
    searchParams.get("category")
  );
  const [pieces, setPieces] = useState<Record<string, Piece>>(() =>
    parsePieces(searchParams.get("selected"))
  );
  const [accessories, setAccessories] = useState<Piece[]>(() =>
    parseAccessories(searchParams.get("accs"))
  );

  /* filters / presentation per step */
  const [search, setSearch] = useState("");
  const [colorFilter, setColorFilter] = useState("");
  const [sizeFilter, setSizeFilter] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [mode, setMode] = useState<"recommend" | "browse">("recommend");
  const [browseOffset, setBrowseOffset] = useState(0);

  const aborterRef = useRef<AbortController | null>(null);
  const lastStateKey = useRef<string>(
    typeof window !== "undefined" ? window.location.href : ""
  );

  /* ---- URL state persistence (deep-link / refresh / back-forward) ---- */
  const persist = useCallback(
    (structureChanged: boolean) => {
      const url = new URL(window.location.href);
      url.searchParams.set("gender", gender);
      url.searchParams.set("step", String(stepIndex));
      if (category) url.searchParams.set("category", category);
      else url.searchParams.delete("category");
      url.searchParams.set("selected", JSON.stringify(pieces));
      url.searchParams.set("accs", JSON.stringify(accessories));
      url.searchParams.set("mode", mode);
      const key = url.toString();
      if (key !== lastStateKey.current) {
        lastStateKey.current = key;
        window.history[structureChanged ? "pushState" : "replaceState"](
          {},
          "",
          url.toString()
        );
      }
    },
    [gender, stepIndex, category, pieces, accessories, mode]
  );

  /* structural changes push a history entry so the browser Back button
     steps back through the wizard; filter keystrokes replace in place */
  useEffect(() => {
    persist(true);
  }, [gender, stepIndex, category, pieces, accessories, mode, persist]);

  /* ---- one-piece flow: a chosen dress/jumpsuit Top removes Bottoms ---- */
  const topPick = pieces.top;

  const data = response;
  const onePieceResolved =
    topPick != null
      ? isOnePieceTopSlug(topPick.product.categorySlug)
      : response?.slot === "top" && stepIndex === 0
        ? response.optionsAreOnePiece
        : false;

  const flow = useMemo(() => flowFor(onePieceResolved), [onePieceResolved]);
  const activeSlot =
    flow[Math.min(stepIndex, flow.length - 1)] ?? flow[flow.length - 1];

  /* ---- load the step's options from the server ---- */
  useEffect(() => {
    const slot = activeSlot?.slot ?? "top";
    aborterRef.current?.abort();
    const controller = new AbortController();
    aborterRef.current = controller;

    const contextList = [
      ...Object.entries(pieces).map(([slotKey, p]) => ({
        slot: slotKey,
        productId: p.product.id,
        color: p.color,
      })),
      ...accessories.map((p) => ({
        slot: "accessory",
        productId: p.product.id,
        color: p.color,
      })),
    ];

    fetchBuild(
      {
        gender,
        slot,
        category: category && category !== "any" ? category : null,
        mode,
        search: search || null,
        filters: {
          colors: colorFilter ? [colorFilter] : [],
          size: sizeFilter,
          brands: brandFilter ? [brandFilter] : [],
          priceMin: null,
          priceMax: priceMax ? Number(priceMax) : null,
        },
        context: contextList,
        offset: browseOffset,
      },
      controller.signal
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setResponse(result);
        setError(null);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setError(String(e));
      });

    return () => controller.abort();
  }, [gender, activeSlot?.slot, category, mode, search, colorFilter, sizeFilter, brandFilter, priceMax, browseOffset, pieces, accessories, retryNonce]);

  /* ---- actions ---- */
  const chooseCategory = useCallback((slug: string | null) => {
    setCategory(slug);
    setSearch("");
    setColorFilter("");
    setSizeFilter("");
    setBrandFilter("");
    setPriceMax("");
    setBrowseOffset(0);
    setMode("recommend");
  }, []);

  const setGenderAndPick = useCallback((g: Gender) => {
    setGender(g);
    setPieces({});
    setAccessories([]);
    setCategory(null);
  }, []);

  const pickProduct = useCallback(
    (product: BuildProduct) => {
      const slot = activeSlot?.slot ?? "top";
      const piece: Piece = {
        product,
        color: product.colors[0] ?? null,
      };
      if (slot === "accessory") {
        setAccessories((prev) => [...prev, piece]);
        setStepIndex((i) => i + 1);
        return;
      }
      setPieces((prev) => ({ ...prev, [slot]: piece }));
      setStepIndex((i) => i + 1);
    },
    [activeSlot]
  );

  const replaceAt = useCallback(
    (slot: string) => {
      const idx = flow.findIndex((s) => s.slot === slot);
      if (idx < 0) return;
      setCategory(null);
      setSearch("");
      setColorFilter("");
      setSizeFilter("");
      setBrandFilter("");
      setPriceMax("");
      setBrowseOffset(0);
      setMode("recommend");
      setStepIndex(idx);
    },
    [flow]
  );

  const skipStep = useCallback(() => {
    const slot = activeSlot?.slot ?? "top";
    if (slot === "accessory") setAccessories([]);
    else if (slot !== "top") {
      setPieces((prev) => {
        const next = { ...prev };
        delete next[slot];
        return next;
      });
    } else {
      setPieces((prev) => {
        const next = { ...prev };
        delete next.top;
        return next;
      });
    }
    setStepIndex((i) => i + 1);
  }, [activeSlot]);

  const back = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  const resolvedPieces = useMemo<Array<Piece & { slot: string }>>(() => {
    const out: Array<Piece & { slot: string }> = [];
    for (const s of flow) {
      const p = pieces[s.slot];
      if (p) out.push({ ...p, slot: s.slot });
    }
    for (const acc of accessories) {
      out.push({ ...acc, slot: "accessory" });
    }
    return out;
  }, [pieces, accessories, flow]);

  const atFinished = stepIndex >= flow.length;
  const completedCount = resolvedPieces.length;

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-deep">
            Build an outfit
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink">
            Style it your way
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-soft">
            Pick each piece of your look in your own order. We suggest the
            best matches from the live catalog for the pieces you already
            chose — you can always browse everything.
          </p>
        </div>

        {/* GENDER */}
        {stepIndex === 0 && activeSlot?.slot === "top" && (
          <div className="mb-10 step-animate">
            <p className="mb-3 text-sm font-semibold text-ink">
              Who is this outfit for?
            </p>
            <div className="flex flex-wrap gap-3">
              {GENDERS.map((g) => (
                <button
                  key={g.value}
                  type="button"
                  onClick={() => setGenderAndPick(g.value)}
                  aria-pressed={gender === g.value}
                  className={`min-h-12 rounded-2xl border px-6 py-3 text-sm font-semibold transition-all duration-200 ${
                    gender === g.value
                      ? "border-accent-deep bg-accent-tint text-ink"
                      : "border-line bg-surface text-ink-soft hover:-translate-y-px hover:border-accent/60 hover:text-ink"
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* PROGRESS */}
        {!atFinished && (
          <div className="mb-8 flex flex-wrap items-center gap-2">
            {flow.map((s, i) => {
              const picked =
                pieces[s.slot] != null ||
                (s.slot === "accessory" && accessories.length > 0);
              const isCurrent = i === stepIndex;
              const reachable = i <= stepIndex || picked;
              return (
                <button
                  key={s.slot}
                  type="button"
                  onClick={() => reachable && setStepIndex(i)}
                  aria-disabled={!reachable}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    isCurrent
                      ? "border-accent-deep bg-accent-tint text-ink"
                      : picked
                        ? "border-line bg-surface text-ink-soft hover:border-accent/60"
                        : "border-line bg-surface text-ink-faint"
                  }`}
                >
                  {picked ? (
                    <span className="text-accent-deep">
                      <CheckIcon />
                    </span>
                  ) : null}
                  {s.label}
                </button>
              );
            })}
          </div>
        )}

        {!response && !error && !atFinished && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton aspect-[3/4] rounded-2xl" />
            ))}
          </div>
        )}

        {error && !response && !atFinished && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
            <h2 className="text-lg font-semibold text-red-700">
              Something went wrong
            </h2>
            <p className="mt-2 text-sm text-red-600">{error}</p>
            <button
              type="button"
              onClick={() => setRetryNonce((n) => n + 1)}
              className="mt-4 rounded-full bg-ink px-5 py-2 text-sm font-medium text-paper"
            >
              Retry
            </button>
          </div>
        )}

        {data && !atFinished && (
          <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
            {/* LEFT: STEP CONTENT */}
            <div>
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-xl font-semibold text-ink">
                  {SLOT_LABELS[activeSlot.slot] ?? activeSlot.slot}
                </h2>
                {!activeSlot.required && (
                  <button
                    type="button"
                    onClick={skipStep}
                    className="rounded-full text-sm font-medium text-ink-faint transition hover:text-accent-deep"
                  >
                    Skip
                  </button>
                )}
              </div>
              <p className="mb-4 text-sm text-ink-soft">
                {activeSlot.required
                  ? "Pick the piece, or choose a category to narrow it down."
                  : "Optional — skip if you don't want this piece."}
              </p>

              {/* CATEGORIES */}
              {data.categories.length > 0 && (
                <div className="mb-6">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                    Category
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => chooseCategory(null)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                        !category
                          ? "border-accent-deep bg-accent-tint text-ink"
                          : "border-line bg-surface text-ink-soft hover:border-accent/60"
                      }`}
                    >
                      Any {SLOT_LABELS[activeSlot.slot]}
                    </button>
                    {data.categories.map((c) => (
                      <button
                        key={c.slug}
                        type="button"
                        onClick={() => chooseCategory(c.slug)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                          category === c.slug
                            ? "border-accent-deep bg-accent-tint text-ink"
                            : "border-line bg-surface text-ink-soft hover:border-accent/60"
                        } ${c.hasProducts ? "" : "opacity-70"}`}
                      >
                        {c.name}
                        {c.onePiece && (
                          <span
                            className="ml-1 text-accent-deep"
                            title="Dress / Jumpsuit — skips the Bottoms step"
                          >
                            •
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* SEARCH + FILTERS */}
              <div className="mb-6 flex flex-wrap items-center gap-3">
                <input
                  type="search"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setBrowseOffset(0);
                  }}
                  placeholder="Search products…"
                  className="h-10 min-w-0 flex-1 rounded-full border border-line bg-surface px-4 text-sm text-ink outline-none focus:border-accent-deep"
                />
                <select
                  value={sizeFilter}
                  onChange={(e) => {
                    setSizeFilter(e.target.value);
                    setBrowseOffset(0);
                  }}
                  className="h-10 rounded-full border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-accent-deep"
                >
                  <option value="">Size</option>
                  {(data.sizeOptions.length > 0
                    ? data.sizeOptions
                    : data.availableSizes
                  )
                    .filter((s, i, a) => a.indexOf(s) === i)
                    .map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                </select>
                <select
                  value={colorFilter}
                  onChange={(e) => {
                    setColorFilter(e.target.value);
                    setBrowseOffset(0);
                  }}
                  className="h-10 rounded-full border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-accent-deep"
                >
                  <option value="">Colour</option>
                  {data.colors.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <select
                  value={brandFilter}
                  onChange={(e) => {
                    setBrandFilter(e.target.value);
                    setBrowseOffset(0);
                  }}
                  className="h-10 rounded-full border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-accent-deep"
                >
                  <option value="">Brand</option>
                  {data.brands.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="0"
                  value={priceMax}
                  onChange={(e) => {
                    setPriceMax(e.target.value);
                    setBrowseOffset(0);
                  }}
                  placeholder="Max €"
                  className="h-10 w-24 rounded-full border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-accent-deep"
                />
              </div>

              {/* HONEST EMPTY STATE */}
              {data.emptyReason && (
                <div className="rounded-2xl border border-dashed border-accent/40 bg-accent-tint/40 p-8 text-center step-animate">
                  <p className="text-sm font-medium text-ink">
                    No matching products found
                  </p>
                  <p className="mt-1 text-sm text-ink-soft">
                    {EMPTY_REASON_TEXT[data.emptyReason] ?? data.emptyReason}
                  </p>
                  {(colorFilter ||
                    sizeFilter ||
                    brandFilter ||
                    priceMax ||
                    search) && (
                    <button
                      type="button"
                      onClick={() => chooseCategory(category)}
                      className="mt-4 rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-soft transition hover:border-accent-deep hover:text-ink"
                    >
                      Clear filters
                    </button>
                  )}
                  <div className="mt-3 flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => back()}
                      className="rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-soft transition hover:border-accent-deep hover:text-ink"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={() => chooseCategory(null)}
                      className="rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-soft transition hover:border-accent-deep hover:text-ink"
                    >
                      Browse whole {SLOT_LABELS[activeSlot.slot].toLowerCase()}
                    </button>
                  </div>
                </div>
              )}

              {/* RECOMMENDED */}
              {!data.emptyReason && mode === "recommend" && (
                <>
                  <p className="mb-3 text-sm font-semibold text-ink">
                    {recommendHeading(activeSlot.slot, resolvedPieces)}
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {(data.recommended ?? []).map((p) => (
                      <ProductTile
                        key={p.id}
                        product={p}
                        highlight={p.fitScore != null}
                        onPick={() => pickProduct(p)}
                      />
                    ))}
                  </div>
                  {(!data.recommended || data.recommended.length === 0) && (
                    <p className="rounded-2xl border border-dashed border-line bg-surface p-6 text-center text-sm text-ink-faint">
                      No products available for this step yet.
                    </p>
                  )}
                  {data.hasMore && (
                    <button
                      type="button"
                      onClick={() => setMode("browse")}
                      className="mt-5 w-full rounded-full border border-line bg-surface px-5 py-3 text-sm font-medium text-ink-soft transition hover:border-accent-deep hover:text-ink"
                    >
                      Browse all {data.total} products
                    </button>
                  )}
                </>
              )}

              {/* BROWSE ALL */}
              {!data.emptyReason && mode === "browse" && (
                <>
                  <p className="mb-3 text-sm font-semibold text-ink">
                    {data.total} product{data.total === 1 ? "" : "s"} in this step
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {(data.products ?? []).map((p) => (
                      <ProductTile
                        key={p.id}
                        product={p}
                        onPick={() => pickProduct(p)}
                      />
                    ))}
                  </div>
                  <div className="mt-6 flex flex-wrap items-center gap-3">
                    {browseOffset > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          setBrowseOffset((o) => Math.max(0, o - data.limit))
                        }
                        className="rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-soft transition hover:border-accent-deep hover:text-ink"
                      >
                        Previous
                      </button>
                    )}
                    {data.hasMore && (
                      <button
                        type="button"
                        onClick={() =>
                          setBrowseOffset((o) => o + data.limit)
                        }
                        className="rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-soft transition hover:border-accent-deep hover:text-ink"
                      >
                        Load more
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setMode("recommend")}
                      className="rounded-full text-sm font-medium text-ink-faint transition hover:text-accent-deep"
                    >
                      Back to recommendations
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* RIGHT: LIVE SUMMARY */}
            <aside className="lg:sticky lg:top-6 lg:self-start">
              <div className="rounded-2xl border border-line bg-surface p-5">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                  Your look
                </p>
                {resolvedPieces.length === 0 && (
                  <p className="text-sm text-ink-faint">
                    Pick pieces as you go — they appear here.
                  </p>
                )}
                <ul className="space-y-3">
                  {resolvedPieces.map((p) => (
                    <li key={`${p.slot}-${p.product.id}`} className="flex gap-3">
                      <div className="w-14 shrink-0">
                        <ProductImage src={p.product.imageUrl} alt={p.product.name} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                          {SLOT_LABELS[p.slot] ?? p.slot}
                        </p>
                        <p className="truncate text-sm font-medium text-ink">
                          {p.product.name}
                        </p>
                        <p className="truncate text-xs text-ink-faint">
                          {p.color ? `${p.color} · ` : ""}
                          {money(p.product.price)} {p.product.currency}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              p.slot === "accessory"
                                ? setAccessories((prev) => prev.filter((x) => x.product.id !== p.product.id))
                                : setPieces((prev) => {
                                    const next = { ...prev };
                                    delete next[p.slot];
                                    return next;
                                  })
                            }
                            className="text-xs font-medium text-red-500 transition hover:text-red-700"
                          >
                            Remove
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (p.slot === "accessory") {
                                const idx = flow.findIndex((f) => f.slot === "accessory");
                                setStepIndex(idx < 0 ? flow.length - 1 : idx);
                                setMode("recommend");
                                return;
                              }
                              replaceAt(p.slot);
                            }}
                            className="text-xs font-medium text-ink-faint transition hover:text-accent-deep"
                          >
                            Change
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>

                {completedCount > 0 && (
                  <div className="mt-4 border-t border-line pt-4">
                    {(() => {
                      let total = 0;
                      for (const p of resolvedPieces) {
                        const n = Number(p.product.price);
                        if (Number.isFinite(n)) total += n;
                      }
                      const currency =
                        resolvedPieces[0]?.product.currency ?? "";
                      return (
                        <p className="flex items-center justify-between">
                          <span className="text-sm text-ink-soft">Total</span>
                          <span className="text-lg font-semibold text-ink">
                            {money(String(Math.round(total * 100) / 100))} {currency}
                          </span>
                        </p>
                      );
                    })()}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setStepIndex(flow.length)}
                  className="mt-4 w-full rounded-full bg-ink py-2.5 text-sm font-semibold text-paper transition hover:bg-ink-soft"
                >
                  Review outfit
                </button>
              </div>

              <button
                type="button"
                onClick={back}
                disabled={stepIndex === 0}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-line py-2.5 text-sm font-medium text-ink-soft transition hover:border-accent-deep hover:text-ink disabled:opacity-40"
              >
                <ArrowIcon dir="left" /> Back
              </button>
            </aside>
          </div>
        )}

        {/* REVIEW */}
        {atFinished && (
          <div className="grid gap-8 lg:grid-cols-[1fr_340px] step-animate">
            <div>
              <h2 className="text-2xl font-semibold text-ink">
                Review your outfit
              </h2>
              {completedCount === 0 && (
                <div className="mt-6 rounded-2xl border border-dashed border-line bg-surface p-10 text-center">
                  <p className="text-sm text-ink-faint">
                    You haven&apos;t added any pieces yet. Start by picking a Top.
                  </p>
                  <button
                    type="button"
                    onClick={() => setStepIndex(0)}
                    className="mt-4 rounded-full bg-ink px-5 py-2 text-sm font-medium text-paper"
                  >
                    Start over
                  </button>
                </div>
              )}
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {resolvedPieces.map((p) => (
                  <div
                    key={`${p.slot}-${p.product.id}`}
                    className="overflow-hidden rounded-2xl border border-line bg-surface"
                  >
                    <ProductImage src={p.product.imageUrl} alt={p.product.name} />
                    <div className="p-4">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                        {SLOT_LABELS[p.slot] ?? p.slot}
                      </p>
                      <h4 className="mt-1 text-base font-semibold text-ink">
                        {p.product.name}
                      </h4>
                      <p className="mt-1 text-sm text-ink-soft">
                        {p.product.brand ? `${p.product.brand} · ` : ""}
                        {p.color ?? ""}
                      </p>
                      <p className="mt-2 text-base font-semibold text-ink">
                        {money(p.product.price)} {p.product.currency}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <a
                          href={p.product.productUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-paper transition hover:bg-ink-soft"
                        >
                          Buy / View product
                        </a>
                        <button
                          type="button"
                          onClick={() => {
                            if (p.slot === "accessory") {
                              setAccessories((prev) => prev.filter((x) => x.product.id !== p.product.id));
                            } else {
                              replaceAt(p.slot);
                            }
                          }}
                          className="rounded-full border border-line px-4 py-2 text-xs font-medium text-ink-soft transition hover:border-accent-deep hover:text-ink"
                        >
                          Replace
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (p.slot === "accessory") {
                              setAccessories((prev) => prev.filter((x) => x.product.id !== p.product.id));
                            } else {
                              setPieces((prev) => {
                                const next = { ...prev };
                                delete next[p.slot];
                                return next;
                              });
                            }
                          }}
                          className="rounded-full border border-line px-4 py-2 text-xs font-medium text-red-500 transition hover:bg-red-50"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <aside className="lg:sticky lg:top-6 lg:self-start">
              <div className="rounded-2xl border border-line bg-surface p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                  Summary
                </p>
                <ul className="mt-3 space-y-2">
                  {flow.map((s) => {
                    const picked =
                      s.slot === "accessory"
                        ? accessories.length > 0
                        : pieces[s.slot] != null;
                    const missing = s.required && !picked;
                    return (
                      <li
                        key={s.slot}
                        className="flex items-center justify-between gap-3 text-sm"
                      >
                        <span className="text-ink-soft">{s.label}</span>
                        <span
                          className={
                            picked
                              ? "font-medium text-accent-deep"
                              : missing
                                ? "font-medium text-amber-700"
                                : "text-ink-faint"
                          }
                        >
                          {picked
                            ? "Done"
                            : missing
                              ? `Missing: ${s.label}`
                              : "Skipped"}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                {completedCount > 0 && (
                  <div className="mt-4 border-t border-line pt-4">
                    {(() => {
                      let total = 0;
                      for (const p of resolvedPieces) {
                        const n = Number(p.product.price);
                        if (Number.isFinite(n)) total += n;
                      }
                      const currency = resolvedPieces[0]?.product.currency ?? "";
                      return (
                        <p className="flex items-center justify-between">
                          <span className="text-sm text-ink-soft">Total</span>
                          <span className="text-lg font-semibold text-ink">
                            {money(String(Math.round(total * 100) / 100))} {currency}
                          </span>
                        </p>
                      );
                    })()}
                  </div>
                )}

                {(() => {
                  const missingRequired = flow
                    .filter((f) => f.required)
                    .filter((f) =>
                      f.slot === "accessory"
                        ? accessories.length === 0
                        : pieces[f.slot] == null
                    )
                    .map((f) => f.label);
                  if (missingRequired.length === 0) return null;
                  return (
                    <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Almost complete — missing: {missingRequired.join(", ")}.
                      You can still finish without them.
                    </p>
                  );
                })()}

                {accessories.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const idx = flow.findIndex((f) => f.slot === "accessory");
                      setStepIndex(idx < 0 ? flow.length - 1 : idx);
                      setMode("recommend");
                    }}
                    className="mt-4 w-full rounded-full border border-dashed border-accent/50 py-2 text-sm font-medium text-accent-deep transition hover:bg-accent-tint"
                  >
                    + Add another accessory
                  </button>
                )}

                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={back}
                    className="flex-1 rounded-full border border-line py-2.5 text-sm font-medium text-ink-soft transition hover:border-accent-deep hover:text-ink"
                  >
                    Edit
                  </button>
                  <Link
                    href="/"
                    className="flex-1 rounded-full bg-ink py-2.5 text-center text-sm font-semibold text-paper transition hover:bg-ink-soft"
                  >
                    Done
                  </Link>
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}

function flowFor(
  onePiece: boolean
): { slot: string; label: string; required: boolean }[] {
  return [
    { slot: "top", label: SLOT_LABELS.top, required: true },
    ...(onePiece
      ? []
      : [{ slot: "bottom", label: SLOT_LABELS.bottom, required: true }]),
    { slot: "footwear", label: SLOT_LABELS.footwear, required: false },
    { slot: "layer", label: SLOT_LABELS.layer, required: false },
    { slot: "accessory", label: SLOT_LABELS.accessory, required: false },
  ];
}

function recommendHeading(
  slot: string,
  pieces: Array<{ slot: string; product: BuildProduct; color: string | null }>
): string {
  const priorLabel =
    pieces.find((p) => p.slot === "top")?.product.categoryName ?? null;
  if (slot === "top") return "Recommended tops";
  if (slot === "bottom") {
    return priorLabel
      ? `Recommended bottoms with your ${priorLabel} — these three pair first`
      : "Recommended bottoms";
  }
  const base: Record<string, string> = {
    footwear: "Recommended shoes with your outfit",
    layer: "Recommended outerwear",
    accessory: "Recommended accessories",
  };
  return base[slot] ?? "Recommended products";
}

export default function Page() {
  return (
    <Suspense
      fallback={<div className="min-h-screen bg-paper p-12 text-ink">Loading…</div>}
    >
      <BuildPageInner />
    </Suspense>
  );
}