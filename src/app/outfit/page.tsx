"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

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

function money(v: string | number): string {
  const n =
    typeof v === "string" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : String(v);
}

function refName<T>(ref: T | string | null | undefined): string {
  if (ref === null || ref === undefined) return "";
  if (typeof ref === "string") return ref;
  const name = (ref as { name?: string }).name;
  return typeof name === "string" ? name : String(ref);
}

function OutfitPage() {
  const searchParams = useSearchParams();
  const productId =
    searchParams.get("anchor") ?? searchParams.get("productId") ?? "";

  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; result: OutfitsResult }
  >({ status: "loading" });

  const [activeIndex, setActiveIndex] = useState(0);
  const [occasion, setOccasion] = useState("Everyday");
  const [style, setStyle] = useState("");
  const [budget, setBudget] = useState("");
  const [replacingSlot, setReplacingSlot] = useState<string | null>(null);
  const [replaceError, setReplaceError] = useState<string | null>(null);

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
  }, [productId, occasion, style, budget]);

  const replace = async (lookIndex: number, slot: string) => {
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

  return (
    <main className="min-h-screen bg-white text-black">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight">
            Style this item
          </h1>
          <Link
            href="/"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            Back to search
          </Link>
        </div>

        {!productId && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
            <h2 className="text-xl font-semibold text-red-700">No product selected</h2>
            <p className="mt-2 text-sm text-red-600">
              Choose &quot;Style this item&quot; on a product to build an outfit.
            </p>
            <Link
              href="/"
              className="mt-6 inline-block rounded-xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:bg-gray-800"
            >
              Back to search
            </Link>
          </div>
        )}

        {state.status === "loading" && (
          <p className="text-gray-500">Building outfits…</p>
        )}

        {state.status === "error" && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
            <h2 className="text-xl font-semibold text-red-700">Something went wrong</h2>
            <p className="mt-2 text-sm text-red-600">{state.message}</p>
            <Link
              href="/"
              className="mt-6 inline-block rounded-xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:bg-gray-800"
            >
              Back to search
            </Link>
          </div>
        )}

        {state.status === "ready" && (
          <>
            {/* REFINE BAR */}
            <div className="mb-8 flex flex-wrap items-end gap-4 rounded-2xl border border-gray-200 p-5">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Occasion
                </label>
                <select
                  value={occasion}
                  onChange={(e) => setOccasion(e.target.value)}
                  className="mt-1 block rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-black"
                >
                  {["Everyday", "University", "Work", "Date", "Party", "Formal", "Sport", "Travel"].map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Style
                </label>
                <select
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  className="mt-1 block rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-black"
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
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Budget (EUR)
                </label>
                <input
                  type="number"
                  min="1"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="Optional"
                  className="mt-1 block w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-black"
                />
              </div>
            </div>

            {/* ANCHOR */}
            <div className="mb-8 flex items-center gap-5 rounded-2xl border border-gray-200 p-5">
              {state.result.anchor.imageUrl ? (
                <img
                  src={state.result.anchor.imageUrl}
                  alt={state.result.anchor.name}
                  className="h-24 w-24 rounded-xl object-cover"
                />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-xl bg-gray-100 text-gray-400">
                  No
                </div>
              )}
              <div>
                <p className="text-sm text-gray-500">{refName(state.result.anchor.brand)}</p>
                <h2 className="text-xl font-semibold">{state.result.anchor.name}</h2>
                <p className="mt-1 text-sm text-gray-500">
                  {refName(state.result.anchor.category)} · {state.result.anchor.gender}
                </p>
              </div>
            </div>

            {/* LOOK TABS */}
            {state.result.outfits.length > 0 && (
              <div className="mb-6 flex flex-wrap gap-2">
                {state.result.outfits.map((look, i) => (
                  <button
                    key={look.id}
                    type="button"
                    onClick={() => setActiveIndex(i)}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                      i === activeIndex
                        ? "bg-black text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    Look {i + 1}
                    {!look.complete && " (partial)"}
                  </button>
                ))}
              </div>
            )}

            {/* ACTIVE LOOK */}
            {state.result.outfits[activeIndex] && (
              <OutfitLook
                look={state.result.outfits[activeIndex]}
                lookIndex={activeIndex}
                anchorId={state.result.anchor.id}
                replacingSlot={replacingSlot}
                replaceError={replaceError}
                onReplace={replace}
              />
            )}

            {state.result.outfits.length === 0 && (
              <div className="rounded-2xl border border-dashed border-gray-300 p-10 text-center">
                <p className="text-gray-500">
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
  replacingSlot,
  replaceError,
  onReplace,
}: {
  look: Look;
  lookIndex: number;
  anchorId: string;
  replacingSlot: string | null;
  replaceError: string | null;
  onReplace: (lookIndex: number, slot: string) => void;
}) {
  const [showWhy, setShowWhy] = useState(false);
  const itemExplanations =
    look.explanations ?? {};

  return (
    <div className="rounded-2xl border border-gray-200 p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-gray-500">
            Look score: {Math.round(look.score * 100)} / 100
          </p>
          <p className="mt-1 text-lg font-bold">
            Total: €{look.totalPriceEur.toFixed(2)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowWhy((s) => !s)}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          {showWhy ? "Hide" : "Why these items?"}
        </button>
      </div>

      {look.missingSlots.length > 0 && (
        <p className="mb-4 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Missing: {look.missingSlots.map((s) => SLOT_LABEL[s] ?? s).join(", ")} — no
          matching product in the catalog for this look.
        </p>
      )}

      {look.missingSlots.length === 0 &&
        !look.items.some((it) => it.slot === "accessory") && (
          <p className="mb-4 rounded-lg bg-gray-50 px-4 py-2 text-sm text-gray-500">
            Accessories unavailable for this look — the outfit is complete without them.
          </p>
        )}

      {replaceError && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
          {replaceError}
        </p>
      )}

      {/* ITEMS GRID */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {look.items.map((item) => (
          <div
            key={item.product.id}
            className="overflow-hidden rounded-2xl border border-gray-200"
          >
            {item.product.imageUrl ? (
              <img
                src={item.product.imageUrl}
                alt={item.product.name}
                loading="lazy"
                className="h-56 w-full object-cover"
              />
            ) : (
              <div className="flex h-56 w-full items-center justify-center bg-gray-100 text-gray-400">
                No image
              </div>
            )}

            <div className="p-4">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                {item.product.id === anchorId ? "Anchor" : SLOT_LABEL[item.slot] ?? item.slot}
              </span>
              <h3 className="mt-1 text-sm font-semibold">{item.product.name}</h3>
              <p className="mt-1 text-sm text-gray-500">
                {item.color ? item.color.name : "—"} · {money(item.product.price)}{" "}
                {item.product.currency}
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href={item.product.productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white transition hover:bg-gray-800"
                >
                  View product
                </a>
                {item.product.id !== anchorId && (
                  <button
                    type="button"
                    onClick={() => onReplace(lookIndex, item.slot)}
                    disabled={replacingSlot !== null}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
                  >
                    {replacingSlot === item.slot ? "Swapping…" : "Replace"}
                  </button>
                )}
              </div>

              {showWhy &&
                itemExplanations[item.product.id] && (
                  <ul className="mt-3 space-y-1 border-t border-gray-100 pt-3 text-xs text-gray-500">
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

      {/* SHOP THE LOOK */}
      {look.items.length > 0 && (
        <details className="mt-6 rounded-2xl border border-gray-200">
          <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 rounded-2xl px-5 py-3">
            <p className="text-sm font-medium text-gray-700">
              {look.items.length} items · {look.complete ? "Full outfit" : "Partial outfit"} ·{" "}
              <span className="font-bold">€{look.totalPriceEur.toFixed(2)}</span>
            </p>
            <span className="text-sm text-black">Shop the Look</span>
          </summary>
          <div className="border-t border-gray-100 px-5 py-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Everything in this look — open each item to buy
            </p>
            <ul className="divide-y divide-gray-100">
              {look.items.map((item) => (
                <li key={item.product.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-gray-800">{item.product.name}</p>
                    <p className="text-xs text-gray-500">
                      {SLOT_LABEL[item.slot] ?? item.slot}
                      {item.color ? ` · ${item.color.name}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-sm text-gray-600">
                      {money(item.product.price)} {item.product.currency}
                    </span>
                    <a
                      href={item.product.productUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white transition hover:bg-gray-800"
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

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white p-12 text-black">Loading…</div>}>
      <OutfitPage />
    </Suspense>
  );
}
