"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

import { Reveal } from "@/components/reveal";
import type { FeaturedProduct } from "@/lib/discovery";

type BrandRef = { id: string; name: string };
type CategoryRef = { id: string; name: string; slug?: string | null };

type ProductSummary = {
  id: string;
  name: string;
  price: string;
  currency: string;
  imageUrl: string | null;
  productUrl: string;
  brand: BrandRef | string;
  category: CategoryRef | string;
  gender: string | null;
};

type Item = {
  slot: string;
  product: ProductSummary;
  color: { name: string; hex: string | null } | null;
};

type Look = {
  id: string;
  complete: boolean;
  score: number;
  totalPriceEur: number;
  missingSlots: string[];
  items: Item[];
  explanations: Record<string, { text: string; code: string; value?: number | string }[]>;
};

type OutfitsResult = {
  anchor: ProductSummary;
  request?: { size?: string | null };
  outfits: Look[];
};

type ReplaceResult = {
  outfits: Look[];
};

const SLOT_LABEL: Record<string, string> = {
  top: "Top",
  bottom: "Bottoms",
  layer: "Layer",
  footwear: "Footwear",
  accessory: "Accessories",
};

const SLOT_ORDER = ["top", "bottom", "layer", "footwear", "accessory"];

const BUDGET_PRESETS = [100, 150, 200, 300];

const SAVE_KEY = "wearsearch-outfit-saved";
const SHARE_KEY = "wearsearch-outfit-share-url";

function money(v: string | number): string {
  const n = typeof v === "string" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : String(v);
}

function refName<T>(ref: T | string | null | undefined): string {
  if (ref === null || ref === undefined) return "";
  if (typeof ref === "string") return ref;
  const name = (ref as { name?: string }).name;
  return typeof name === "string" ? name : String(ref);
}

export function OutfitClient({
  suggestions,
}: {
  suggestions: FeaturedProduct[];
}) {
  const searchParams = useSearchParams();
  const productId =
    searchParams.get("anchor") ?? searchParams.get("productId") ?? "";
  const initialIds = useMemo(() => {
    const ids = searchParams.get("ids");
    if (!ids) return [];
    return ids.split(",").filter((x) => x.length > 0);
  }, [searchParams]);
  /* Restored links (share / saved-outfit resume) carry the refine
     settings back so the session picks up exactly where it stopped. */
  const initialOccasion =
    searchParams.get("occasion") ?? "Everyday";
  const initialStyle = searchParams.get("style") ?? "";
  const initialBudget = searchParams.get("budget") ?? "";
  const initialSize = searchParams.get("size") ?? "";

  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; result: OutfitsResult }
  >({ status: "loading" });

  const [activeIndex, setActiveIndex] = useState(0);
  const [occasion, setOccasion] = useState(initialOccasion);
  const [style, setStyle] = useState(initialStyle);
  const [budget, setBudget] = useState(initialBudget);
  const [size, setSize] = useState(initialSize);
  const [replacingSlot, setReplacingSlot] = useState<string | null>(null);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!productId) {
      return;
    }
    let cancelled = false;

    const apply = async () => {
      setState({ status: "loading" });
      setActiveIndex(0);
      const body: Record<string, unknown> = { anchorProductId: productId };
      if (occasion) body.occasion = occasion;
      if (style) body.style = style;
      const b = Number(budget);
      if (budget.trim() !== "" && Number.isFinite(b) && b > 0) {
        body.budget = b;
      }
      if (size.trim() !== "") body.size = size.trim();
      if (initialIds.length > 0) body.lockProductIds = initialIds;
      try {
        const res = await fetch("/api/outfits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!res.ok) {
          setState({ status: "error", message: json?.error ?? `Request failed (${res.status})` });
          return;
        }
        if (!cancelled) setState({ status: "ready", result: json as OutfitsResult });
      } catch (e) {
        if (!cancelled) setState({ status: "error", message: String(e) });
      }
    };
    void apply();

    return () => {
      cancelled = true;
    };
  }, [productId, occasion, style, budget, size, initialIds]);

  const replace = async (
    lookIndex: number,
    slot: string,
    extra?: { excludeProductIds?: string[] }
  ) => {
    if (state.status !== "ready") return;
    const look = state.result.outfits[lookIndex];
    if (!look) return;
    const lockedProductIds = look.items
      .filter((it) => it.slot !== slot)
      .map((it) => it.product.id);
    setReplacingSlot(slot);
    setReplaceError(null);
    try {
      const res = await fetch("/api/outfits/replace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anchorProductId: state.result.anchor.id,
          slot,
          lockedProductIds,
          occasion,
          style: style || null,
          ...(extra?.excludeProductIds?.length
            ? { excludeProductIds: extra.excludeProductIds }
            : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setReplaceError(json?.error ?? `Replace failed (${res.status})`);
        return;
      }
      const repl = json as ReplaceResult;
      setState((prev) => {
        if (prev.status !== "ready") return prev;
        const next = {
          ...prev.result,
          outfits: prev.result.outfits.map((o, i) =>
            i === lookIndex ? repl.outfits[0] ?? o : o
          ),
        };
        return { status: "ready", result: next };
      });
    } catch (e) {
      setReplaceError(String(e));
    } finally {
      setReplacingSlot(null);
    }
  };

  // Remove an item from the active look (client-side edit).
  const removeItem = (slot: string) => {
    setState((prev) => {
      if (prev.status !== "ready") return prev;
      const look = prev.result.outfits[activeIndex];
      if (!look) return prev;
      const items = look.items.filter((it) => it.slot !== slot);
      if (items.length === look.items.length) return prev;
      const totalPriceEur =
        Math.round(items.reduce((s, it) => s + Number(it.product.price), 0) * 100) / 100;
      const missingSlots = [...look.missingSlots];
      if (!missingSlots.includes(slot)) missingSlots.push(slot);
      const outfits = prev.result.outfits.map((o, i) =>
        i === activeIndex
          ? {
              ...o,
              items,
              totalPriceEur,
              complete: false,
              missingSlots,
              score: o.score,
            }
          : o
      );
      return { status: "ready", result: { ...prev.result, outfits } };
    });
  };

  // Add an item into the first empty slot of the look.
  const addItem = async () => {
    if (state.status !== "ready") return;
    const look = state.result.outfits[activeIndex];
    if (!look) return;
    const present = new Set(look.items.map((it) => it.slot));
    const target = SLOT_ORDER.find((s) => !present.has(s));
    if (!target) {
      setReplaceError("The outfit is already complete — remove an item first.");
      return;
    }
    await replace(activeIndex, target);
  };

  const saveOutfit = () => {
    if (state.status !== "ready") return;
    const look = state.result.outfits[activeIndex];
    if (!look) return;
    const payload = {
      anchorId: state.result.anchor.id,
      occasion,
      style,
      budget,
      size,
      ids: look.items.map((it) => it.product.id),
      savedAt: new Date().toISOString(),
    };
    try {
      window.sessionStorage.setItem(SAVE_KEY, JSON.stringify(payload));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch {
      setReplaceError("Couldn't save — session storage unavailable.");
    }
  };

  const shareOutfit = async () => {
    if (state.status !== "ready") return;
    const look = state.result.outfits[activeIndex];
    if (!look) return;
    const ids = look.items.map((it) => it.product.id).join(",");
    const url = new URL(window.location.href);
    url.searchParams.set("anchor", state.result.anchor.id);
    url.searchParams.set("ids", ids);
    if (occasion) url.searchParams.set("occasion", occasion);
    if (style) url.searchParams.set("style", style);
    if (budget.trim()) url.searchParams.set("budget", budget);
    if (size.trim()) url.searchParams.set("size", size.trim());
    try {
      window.sessionStorage.setItem(SHARE_KEY, url.toString());
    } catch {
      /* session storage unavailable — the toast still signals a share attempt */
    }
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
    // Best-effort clipboard; fire-and-forget, never blocks the page
    // (headless-safe). The share link is persisted in session storage.
    navigator.clipboard?.writeText(url.toString()).catch(() => {});
  };

  const look = state.status === "ready" ? state.result.outfits[activeIndex] : null;
  const budgetNum = Number(budget);

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="font-display text-3xl font-medium tracking-tight">
            {productId ? "Style this item" : "Outfit Studio"}
          </h1>
          <div className="flex flex-wrap items-center gap-3">
            {state.status === "ready" && look && (
              <>
                <button
                  type="button"
                  onClick={saveOutfit}
                  className="rounded-lg border-ink-faint px-4 py-2 text-sm font-medium text-ink transition hover:bg-paper-soft"
                >
                  {saved ? "Saved" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={shareOutfit}
                  className="rounded-lg border-ink-faint px-4 py-2 text-sm font-medium text-ink transition hover:bg-paper-soft"
                >
                  {saved ? "Link copied" : "Share"}
                </button>
              </>
            )}
            <Link
              href="/"
              className="rounded-lg border-ink-faint px-4 py-2 text-sm font-medium text-ink transition hover:bg-paper-soft"
            >
              Back to search
            </Link>
          </div>
        </div>

        {!productId && <OutfitLanding suggestions={suggestions} />}

        {productId && state.status === "loading" && (
          <p className="text-ink-soft">Building outfits…</p>
        )}

        {productId && state.status === "error" && (
          <div className="rounded-2xl border border-error-border bg-error-bg p-8 text-center">
            <h2 className="text-xl font-semibold text-error">Something went wrong</h2>
            <p className="mt-2 text-sm text-error">{state.message}</p>
            <Link
              href="/"
              className="mt-6 inline-block rounded-xl bg-ink px-5 py-3 text-sm font-medium text-paper transition hover:bg-ink-soft"
            >
              Back to search
            </Link>
          </div>
        )}

        {productId && state.status === "ready" && (
          <>
            {/* REFINE BAR */}
            <div className="mb-8 flex flex-wrap items-end gap-4 rounded-2xl border border-line p-5">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                  Occasion
                </label>
                <select
                  value={occasion}
                  onChange={(e) => setOccasion(e.target.value)}
                  className="mt-1 block rounded-lg border border-ink-faint px-3 py-2 text-sm outline-none focus:border-ink"
                >
                  {["Everyday", "University", "Work", "Date", "Party", "Formal", "Sport", "Travel"].map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                  Style
                </label>
                <select
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  className="mt-1 block rounded-lg border border-ink-faint px-3 py-2 text-sm outline-none focus:border-ink"
                >
                  <option value="">Any style</option>
                  {["casual", "smart-casual", "sporty", "streetwear", "formal", "classic", "bohemian", "minimalist"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                  Your size
                </label>
                <input
                  type="text"
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                  placeholder="e.g. M or 42"
                  className="mt-1 block w-32 rounded-lg border border-ink-faint px-3 py-2 text-sm outline-none focus:border-ink"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                  Budget (EUR)
                </label>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {BUDGET_PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setBudget(String(p))}
                      className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                        Number(budget) === p
                          ? "bg-ink text-paper"
                          : "border-ink-faint text-ink-soft hover:bg-paper-soft"
                      }`}
                    >
                      €{p}
                    </button>
                  ))}
                  <input
                    type="number"
                    min="1"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    placeholder="Custom"
                    className="block w-28 rounded-lg border border-ink-faint px-3 py-1.5 text-sm outline-none focus:border-ink"
                  />
                </div>
              </div>
            </div>

            {/* ANCHOR */}
            <div className="mb-8 flex items-center gap-5 rounded-2xl border border-line p-5">
              {state.result.anchor.imageUrl ? (
                <img
                  src={state.result.anchor.imageUrl}
                  alt={state.result.anchor.name}
                  className="h-24 w-24 rounded-xl object-cover"
                />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-xl bg-paper-soft text-ink-faint">
                  No
                </div>
              )}
              <div>
                <p className="text-sm text-ink-soft">{refName(state.result.anchor.brand)}</p>
                <h2 className="text-xl font-semibold">{state.result.anchor.name}</h2>
                <p className="mt-1 text-sm text-ink-soft">
                  {refName(state.result.anchor.category)} · {state.result.anchor.gender}
                  {size.trim() ? ` · size ${size.trim()}` : ""}
                </p>
              </div>
            </div>

            {/* LOOK TABS */}
            {state.result.outfits.length > 0 && (
              <div className="mb-6 flex flex-wrap gap-2">
                {state.result.outfits.map((l, i) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setActiveIndex(i)}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                      i === activeIndex
                        ? "bg-ink text-paper"
                        : "bg-paper-soft text-ink hover:bg-line"
                    }`}
                  >
                    Look {i + 1}
                    {!l.complete && " (partial)"}
                  </button>
                ))}
              </div>
            )}

            {/* ACTIVE LOOK */}
            {look && (
              <OutfitLook
                look={look}
                lookIndex={activeIndex}
                anchorId={state.result.anchor.id}
                budget={Number.isFinite(budgetNum) ? budgetNum : null}
                replacingSlot={replacingSlot}
                replaceError={replaceError}
                onReplace={replace}
                onRemove={removeItem}
                onAdd={addItem}
              />
            )}

            {state.result.outfits.length === 0 && (
              <div className="rounded-2xl border border-dashed border-ink-faint p-10 text-center">
                <p className="text-ink-soft">
                  We couldn&apos;t build an outfit around this item right now.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function OutfitLook({
  look,
  lookIndex,
  anchorId,
  budget,
  replacingSlot,
  replaceError,
  onReplace,
  onRemove,
  onAdd,
}: {
  look: Look;
  lookIndex: number;
  anchorId: string;
  budget: number | null;
  replacingSlot: string | null;
  replaceError: string | null;
  onReplace: (lookIndex: number, slot: string, extra?: { excludeProductIds?: string[] }) => void;
  onRemove: (slot: string) => void;
  onAdd: () => void;
}) {
  const [showWhy, setShowWhy] = useState(false);
  const itemExplanations = look.explanations ?? {};

  const pieces = look.items.length;
  const totalPieces = pieces + look.missingSlots.length;
  const remaining =
    budget !== null ? Math.round((budget - look.totalPriceEur) * 100) / 100 : null;

  return (
    <div className="rounded-2xl border border-line p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-ink-soft">
            Look score: {Math.round(look.score * 100)} / 100
          </p>
          <p className="mt-1 text-lg font-bold">
            Total: €{look.totalPriceEur.toFixed(2)}
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            {pieces} of {Math.max(totalPieces, pieces)} pieces ·{" "}
            {look.complete ? "Full outfit" : "Partial outfit"}
          </p>
          {remaining !== null && (
            <p
              className={`mt-1 text-sm font-medium ${
                remaining < 0 ? "text-error" : "text-ink"
              }`}
            >
              {remaining === 0
                ? "On budget"
                : remaining > 0
                  ? `€${remaining.toFixed(2)} under budget`
                  : `€${Math.abs(remaining).toFixed(2)} over budget`}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowWhy((s) => !s)}
          className="rounded-lg border-ink-faint px-4 py-2 text-sm font-medium text-ink transition hover:bg-paper-soft"
        >
          {showWhy ? "Hide" : "Why these items?"}
        </button>
      </div>

      {look.missingSlots.length > 0 && (
        <p className="mb-4 rounded-lg bg-warning-bg px-4 py-2 text-sm text-warning">
          Missing: {look.missingSlots.map((s) => SLOT_LABEL[s] ?? s).join(", ")} — no
          matching product in the catalog for this look.
        </p>
      )}

      {look.missingSlots.length === 0 &&
        !look.items.some((it) => it.slot === "accessory") && (
          <p className="mb-4 rounded-lg bg-paper-soft px-4 py-2 text-sm text-ink-soft">
            Accessories unavailable for this look — the outfit is complete without them.
          </p>
        )}

      {replaceError && (
        <p className="mb-4 rounded-lg bg-error-bg px-4 py-2 text-sm text-error">
          {replaceError}
        </p>
      )}

      {/* ITEMS GRID */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {look.items.map((item) => (
          <div
            key={item.product.id}
            className="overflow-hidden rounded-2xl border border-line"
          >
            {item.product.imageUrl ? (
              <img
                src={item.product.imageUrl}
                alt={item.product.name}
                loading="lazy"
                className="h-56 w-full object-cover"
              />
            ) : (
              <div className="flex h-56 w-full items-center justify-center bg-paper-soft text-ink-faint">
                No image
              </div>
            )}

            <div className="p-4">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                {item.product.id === anchorId ? "Anchor" : SLOT_LABEL[item.slot] ?? item.slot}
              </span>
              <h3 className="mt-1 text-sm font-semibold">{item.product.name}</h3>
              <p className="mt-1 text-sm text-ink-soft">
                {item.color ? item.color.name : "—"} · {money(item.product.price)}{" "}
                {item.product.currency}
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href={item.product.productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-paper transition hover:bg-ink-soft"
                >
                  View product
                </a>
                {item.product.id !== anchorId && (
                  <>
                    <button
                      type="button"
                      onClick={() => onReplace(lookIndex, item.slot)}
                      disabled={replacingSlot !== null}
                      className="rounded-lg border border-ink-faint px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-paper-soft disabled:opacity-50"
                    >
                      {replacingSlot === item.slot ? "Swapping…" : "Replace"}
                    </button>
                    <button
                      type="button"
                      onClick={() => onReplace(lookIndex, item.slot, { excludeProductIds: [item.product.id] })}
                      disabled={replacingSlot !== null}
                      className="rounded-lg border border-ink-faint px-3 py-1.5 text-xs font-medium text-ink-soft transition hover:bg-paper-soft disabled:opacity-50"
                      title="Replace this piece with something different from your taste"
                    >
                      Not my style
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove(item.slot)}
                      className="rounded-lg border border-ink-faint px-3 py-1.5 text-xs font-medium text-error transition hover:bg-error-bg"
                    >
                      Remove
                    </button>
                  </>
                )}
              </div>

              {showWhy &&
                itemExplanations[item.product.id] && (
                  <ul className="mt-3 space-y-1 border-t border-line pt-3 text-xs text-ink-soft">
                    {itemExplanations[item.product.id].map(
                      (e, i) => (
                        <li key={i}>{e.text}</li>
                      )
                    )}
                  </ul>
                )}
            </div>
          </div>
        ))}
      </div>

      {/* ADD A PIECE */}
      {look.missingSlots.length > 0 && (
        <button
          type="button"
          onClick={onAdd}
          disabled={replacingSlot !== null}
          className="mt-5 rounded-xl border border-dashed border-ink-faint px-5 py-4 w-full text-sm font-medium text-ink-soft transition hover:bg-paper-soft disabled:opacity-50"
        >
          + Add an item
        </button>
      )}

      {/* SHOP THE LOOK */}
      {look.items.length > 0 && (
        <details className="mt-6 rounded-2xl border border-line">
          <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 rounded-2xl px-5 py-3">
            <p className="text-sm font-medium text-ink">
              {look.items.length} items · {look.complete ? "Full outfit" : "Partial outfit"} ·{" "}
              <span className="font-bold">€{look.totalPriceEur.toFixed(2)}</span>
            </p>
            <span className="text-sm text-black">Shop the Look</span>
          </summary>
          <div className="border-t border-line px-5 py-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Everything in this look — open each item to buy
            </p>
            <ul className="divide-y divide-gray-100">
              {look.items.map((item) => (
                <li key={item.product.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">{item.product.name}</p>
                    <p className="text-xs text-ink-soft">
                      {SLOT_LABEL[item.slot] ?? item.slot}
                      {item.color ? ` · ${item.color.name}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-sm text-ink-soft">
                      {money(item.product.price)} {item.product.currency}
                    </span>
                    <a
                      href={item.product.productUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-paper transition hover:bg-ink-soft"
                    >
                      Open
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}
    </div>
  );
}

function OutfitLanding({
  suggestions,
}: {
  suggestions: FeaturedProduct[];
}) {
  const [saved, setSaved] = useState<{
    anchorId: string;
    occasion: string;
    style: string;
    budget: string;
    size: string;
    ids: string[];
  } | null>(null);

  /* A saved outfit lives in session storage only. SSR-safe read in an
     effect so the landing never assumes browser state on first paint. */
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (
        typeof parsed.anchorId !== "string" ||
        !parsed.anchorId
      ) {
        return;
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading sessionStorage post-mount; initial state stays null for SSR parity
      setSaved({
        anchorId: parsed.anchorId,
        occasion:
          typeof parsed.occasion === "string"
            ? parsed.occasion
            : "Everyday",
        style:
          typeof parsed.style === "string"
            ? parsed.style
            : "",
        budget:
          typeof parsed.budget === "string"
            ? parsed.budget
            : "",
        size:
          typeof parsed.size === "string"
            ? parsed.size
            : "",
        ids: Array.isArray(parsed.ids)
          ? parsed.ids.filter(
              (x): x is string => typeof x === "string"
            )
          : [],
      });
    } catch {
      /* malformed saved outfit - treat as none */
    }
  }, []);

  const resumeHref = useMemo(() => {
    if (!saved) return "/";
    const params = new URLSearchParams();
    params.set("anchor", saved.anchorId);
    if (saved.ids.length > 0) {
      params.set("ids", saved.ids.join(","));
    }
    if (saved.size) params.set("size", saved.size);
    if (saved.occasion) params.set("occasion", saved.occasion);
    if (saved.style) params.set("style", saved.style);
    if (saved.budget) params.set("budget", saved.budget);
    return `/outfit?${params.toString()}`;
  }, [saved]);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="rounded-2xl border border-line bg-paper-soft p-8 text-center sm:p-10">
        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-ink">
          Outfit Engine
        </p>
        <h2 className="mx-auto mt-3 max-w-lg font-display text-3xl font-medium tracking-tight text-ink">
          Build a look around any piece
        </h2>
        <p className="mx-auto mt-3 max-w-md text-base leading-relaxed text-ink-soft">
          Start from a product you love and we&apos;ll complete the
          rest — style, occasion and palette handled for you.
        </p>
      </div>

      {saved && (
        <div className="mt-8 flex flex-col gap-4 rounded-2xl border border-ink/15 bg-surface p-6 shadow-[0_24px_48px_-24px_rgba(0,0,0,0.18)] sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-faint">
              Pick up where you left off
            </p>
            <p className="mt-1 text-lg font-semibold text-ink">
              Your last outfit is saved in this session
            </p>
          </div>
          <Link
            href={resumeHref}
            className="rounded-full bg-ink px-6 py-3 text-center text-sm font-medium text-paper transition hover:bg-ink-soft"
          >
            Continue saved outfit
          </Link>
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="mt-12">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-faint">
            Start from a featured piece
          </h2>
          <div className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {suggestions.map((product, index) => (
              <Reveal key={product.id} delay={index * 60} className="h-full">
                <Link
                  href={`/outfit?anchor=${encodeURIComponent(product.id)}`}
                  className="group flex h-full flex-col overflow-hidden rounded-2xl border border-ink/15 bg-surface transition duration-300 hover:-translate-y-0.5 hover:border-ink/30 hover:shadow-[0_24px_48px_-24px_rgba(0,0,0,0.22)]"
                >
                  <div className="relative aspect-[4/5] overflow-hidden bg-paper-soft">
                    {product.imageUrl ? (
                      <img
                        src={product.imageUrl}
                        alt={product.name}
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-sm text-ink-faint">
                        No image
                      </div>
                    )}
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col p-5">
                    <p className="truncate text-xs font-medium uppercase tracking-wide text-ink-faint">
                      {product.brand}
                    </p>
                    <h3 className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm text-ink">
                      {product.name}
                    </h3>
                    <p className="mt-1 text-sm font-semibold text-ink">
                      {money(product.price)} {product.currency}
                    </p>
                    <div className="mt-auto pt-4">
                      <span className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-paper transition group-hover:bg-ink-soft">
                        Style this item
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
                          <path d="M5 12h14m-6-6 6 6-6 6" />
                        </svg>
                      </span>
                    </div>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      )}

      <div className="mt-12 text-center">
        <p className="text-sm text-ink-soft">
          Looking for something specific?
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/"
            className="rounded-full border border-ink/25 bg-surface px-6 py-3 text-sm font-medium text-ink transition hover:border-ink hover:bg-paper-soft"
          >
            Search the catalog
          </Link>
          <Link
            href="/build"
            className="rounded-full border border-ink/25 bg-surface px-6 py-3 text-sm font-medium text-ink transition hover:border-ink hover:bg-paper-soft"
          >
            Build from scratch
          </Link>
        </div>
      </div>
    </div>
  );
}
