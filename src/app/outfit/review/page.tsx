/* Review your outfit — the professional final page.

   A real, honest review of the look the builder handed over:
     - Selected items: real products only — image, name, brand, price
       in the original currency, and a real productUrl for Buy/View;
       Change takes you back to that builder slot; Remove updates the
       look (and the URL) in place;
     - Outfit status: the builder's own flow rules (required vs
       optional, one-piece Top) computed through the shared
       review-state module;
     - Outfit summary: item count, compatibility from the outfit
       engine's own scorer, and the TOTAL in EUR only when it is truly
       reliable (real prices + real fx for USD).

   The products are read from the canonical catalog via
   /api/outfit/review — nothing here is invented or eBay-coupled.

   (The 3D Avatar and AvatarProfile were retired from FitWear. A future
   image-based Virtual Try-On will add the model preview back purely
   as a provider-pluggable surface, never via a 3D scene.) */

"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  reviewStatusFor,
  reviewStepsFor,
  fixedLookScore,
} from "@/lib/outfit/review-state";
import {
  orderedReviewPieces,
  reviewApiPiecesFor,
} from "@/lib/outfit/review-display";
import {
  parseUrlState,
  type UrlPiece,
} from "@/lib/build/url-state";
import { SLOT_LABELS } from "@/lib/build/flow-rules";
import type { FashionCompatibilityResult } from "@/lib/outfit/fashion-compatibility";

type ReviewItem = {
  slot: string;
  product: {
    id: string;
    name: string;
    price: string;
    currency: string | null;
    imageUrl: string | null;
    productUrl: string;
    brand: string | null;
    categorySlug: string;
    categoryName: string | null;
  };
  color: { name: string; hex: string | null } | null;
};

type ReviewServer = {
  catalogVersion: string;
  topSlug: string | null;
  onePiece: boolean;
  items: ReviewItem[];
  status: {
    complete: boolean;
    missingRequired: string[];
    skippedOptional: string[];
  };
  price: {
    totalEur: number;
    reliable: boolean;
    hasUsd: boolean;
    hasOtherCurrency: boolean;
  };
  score: number | null;
  fashion: FashionCompatibilityResult | null;
  missingIds: string[];
  fx: { rate: number | null; source: string; asOf: string | null } | null;
};

function money(v: string): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : v;
}

function ProductImage({ src, alt }: { src: string | null; alt: string }) {
  if (!src) {
    return (
      <div className="grid aspect-[4/3] w-full place-items-center bg-paper-soft text-xs text-ink-faint">
        No image
      </div>
    );
  }
  return (
    <div className="aspect-[4/3] w-full overflow-hidden bg-paper-soft">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} loading="lazy" decoding="async" className="h-full w-full object-contain" />
    </div>
  );
}

function SlotChip({ slot }: { slot: string }) {
  return (
    <span className="rounded-full bg-accent-tint px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-accent-deep">
      {SLOT_LABELS[slot as keyof typeof SLOT_LABELS] ?? slot}
    </span>
  );
}

function ReviewInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const init = useMemo(
    () =>
      parseUrlState(
        searchParams.get("gender"),
        searchParams.get("selected"),
        searchParams.get("accs")
      ),
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const [selected, setSelected] = useState<Record<string, UrlPiece>>(init.selected);
  const [accessories, setAccessories] = useState<UrlPiece[]>(init.accessories);
  const [review, setReview] = useState<ReviewServer | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const aborterRef = useRef<AbortController | null>(null);

  /* persist pieces in the URL so Refresh/Back/Share keep state */
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("selected", JSON.stringify(selected));
    url.searchParams.set("accs", JSON.stringify(accessories));
    /* retired 3D Avatar: never keep its URL params around */
    url.searchParams.delete("avatar");
    url.searchParams.delete("avatarDebug");
    window.history.replaceState({}, "", url.toString());
  }, [selected, accessories]);

  const topSlug = selected.top?.product.categorySlug ?? null;

  /* ordered display list, exactly like the builder flow */
  const ordered = useMemo(
    () => orderedReviewPieces(selected, accessories),
    [selected, accessories]
  );

  /* authoritative review from the canonical catalog */
  useEffect(() => {
    aborterRef.current?.abort();
    const controller = new AbortController();
    aborterRef.current = controller;

    const pieces = reviewApiPiecesFor(selected, accessories);

    fetch("/api/outfit/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ pieces, topSlug }),
    })
      .then(async (res) => {
        const json = await res.json();
        if (controller.signal.aborted) return;
        if (!res.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
        setReviewError(null);
        setReview(json as ReviewServer);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setReviewError(String(e));
      });

    return () => controller.abort();
  }, [selected, accessories, topSlug]);

  const missingSet = useMemo(() => new Set(review?.missingIds ?? []), [review]);

  /* local status fallback while the server loads (same shared rules) */
  const localStatus = useMemo(
    () =>
      reviewStatusFor(
        ordered.map((p) => ({ slot: p.slot as never, productId: p.product.id })),
        topSlug
      ),
    [ordered, topSlug]
  );

  const status = review?.status ?? {
    complete: localStatus.complete,
    missingRequired: localStatus.missingRequired,
    skippedOptional: localStatus.skippedOptional,
  };

  const score = useMemo(() => {
    if (review?.score != null) return review.score;
    if (ordered.length === 0) return null;
    return fixedLookScore({
      items: ordered.map((p) => ({
        slot: p.slot as never,
        product: {
          id: p.product.id,
          name: p.product.name,
          price: p.product.price,
          currency: p.product.currency,
          productUrl: p.product.productUrl,
          imageUrl: p.product.imageUrl,
          availability: null,
          gender: p.product.gender as never,
          brand: null,
          category: {
            id: `cat-${p.product.categorySlug}`,
            slug: p.product.categorySlug,
            name: p.product.categoryName ?? p.product.categorySlug,
          },
          variants: [],
          attributes: [],
        },
      })),
    });
  }, [review, ordered]);

  const editAt = useCallback(
    (slot?: string) => {
      const sp = new URLSearchParams();
      sp.set("gender", init.gender);
      sp.set("selected", JSON.stringify(selected));
      sp.set("accs", JSON.stringify(accessories));
      const steps = reviewStepsFor(topSlug);
      const idx = slot ? steps.findIndex((s) => s.slot === slot) : 0;
      sp.set("step", String(Math.max(0, idx)));
      router.push(`/build?${sp.toString()}`);
    },
    [router, init.gender, selected, accessories, topSlug]
  );

  const removePiece = useCallback((slot: string, productId: string) => {
    if (slot === "accessory") {
      setAccessories((prev) => prev.filter((x) => x.product.id !== productId));
    } else {
      setSelected((prev) => {
        const next = { ...prev };
        delete next[slot];
        return next;
      });
    }
  }, []);

  const scorePct =
    score === null ? null : Math.round(Math.min(1, Math.max(0, score)) * 100);
  const scoreLabel =
    scorePct === null
      ? "—"
      : scorePct >= 72
        ? `${scorePct}% — strong`
        : scorePct >= 50
          ? `${scorePct}% — solid`
          : `${scorePct}% — mixed`;

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-deep">
              Review your outfit
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink">
              Review your look
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-ink-soft">
              Check the look on real products and buy them directly.
              Nothing here is invented — every product is live in the catalog.
            </p>
          </div>
          <Link
            href="/"
            className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink-soft transition hover:border-accent-deep hover:text-ink"
          >
            Back to home
          </Link>
        </div>

        {ordered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-surface p-10 text-center">
            <p className="text-sm text-ink-faint">
              No pieces to review yet. Build an outfit first.
            </p>
            <Link
              href="/build"
              className="mt-4 inline-block rounded-full bg-ink px-6 py-2.5 text-sm font-semibold text-paper transition hover:bg-ink-soft"
            >
              Build an outfit
            </Link>
          </div>
        ) : (
          <>
            <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
              {/* selected items */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-ink">
                    Selected items
                  </h2>
                  <p className="text-xs text-ink-soft">
                    {ordered.length} piece{ordered.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                    {ordered.map((p) => {
                      const gone = missingSet.has(p.product.id);
                      return (
                        <div
                          key={`${p.slot}-${p.product.id}`}
                          className="overflow-hidden rounded-2xl border border-line bg-surface"
                        >
                          {gone ? (
                            <div className="grid aspect-[4/3] w-full place-items-center bg-red-50 px-6 text-center text-xs text-red-600">
                              This product left the catalog and could not be
                              re-verified.
                            </div>
                          ) : (
                            <ProductImage
                              src={p.product.imageUrl}
                              alt={p.product.name}
                            />
                          )}
                          <div className="p-4">
                            <SlotChip slot={p.slot} />
                            <h3 className="mt-2 text-base font-semibold leading-snug text-ink">
                              {p.product.name}
                            </h3>
                            <p className="mt-1 text-sm text-ink-soft">
                              {p.product.brand ? `${p.product.brand} · ` : ""}
                              {p.color ?? ""}
                            </p>
                            <p className="mt-1.5 text-base font-semibold text-ink">
                              {money(p.product.price)}{" "}
                              {p.product.currency ?? ""}
                            </p>
                            <div className="mt-4 flex flex-wrap gap-2">
                              <a
                                href={p.product.productUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-paper transition hover:bg-ink-soft"
                              >
                                Buy / View
                              </a>
                              <button
                                type="button"
                                onClick={() => editAt(p.slot)}
                                className="rounded-full border border-line px-4 py-2 text-xs font-medium text-ink-soft transition hover:border-accent-deep hover:text-ink"
                              >
                                Change
                              </button>
                              <button
                                type="button"
                                onClick={() => removePiece(p.slot, p.product.id)}
                                className="rounded-full border border-line px-4 py-2 text-xs font-medium text-red-500 transition hover:bg-red-50"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

              {/* outfit status + summary */}
              <aside className="lg:sticky lg:top-6 lg:self-start lg:space-y-4">
                <div className="rounded-2xl border border-line bg-surface p-5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                    Outfit status
                  </p>
                  <div className="mt-3 flex items-center gap-3">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                        status.complete
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-800"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          status.complete ? "bg-emerald-600" : "bg-amber-500"
                        }`}
                      />
                      {status.complete ? "Complete" : "Incomplete"}
                    </span>
                    {reviewError && status.complete && (
                      <span className="text-xs text-amber-700">(best effort)</span>
                    )}
                  </div>
                  <div className="mt-3 space-y-1.5 text-sm">
                    {status.missingRequired.map((slot) => (
                      <p key={slot} className="flex items-center justify-between text-amber-700">
                        <span>Missing: {SLOT_LABELS[slot as keyof typeof SLOT_LABELS] ?? slot}</span>
                        <button type="button" onClick={() => editAt(slot)} className="text-xs font-medium underline underline-offset-2">
                          Fill it
                        </button>
                      </p>
                    ))}
                    {status.skippedOptional.map((slot) => (
                      <p key={slot} className="flex items-center justify-between text-ink-faint">
                        <span>Skipped: {SLOT_LABELS[slot as keyof typeof SLOT_LABELS] ?? slot}</span>
                        <button type="button" onClick={() => editAt(slot)} className="text-xs font-medium text-accent-deep underline underline-offset-2">
                          Add
                        </button>
                      </p>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-line bg-surface p-5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                      Look verdict
                    </p>
                    {review?.fashion && (
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                          review.fashion.verdict === "strong"
                            ? "bg-emerald-50 text-emerald-700"
                            : review.fashion.verdict === "valid"
                              ? "bg-blue-50 text-blue-700"
                              : review.fashion.verdict === "soft-mismatch"
                                ? "bg-amber-50 text-amber-800"
                                : "bg-red-50 text-red-700"
                        }`}
                      >
                        {review.fashion.verdict === "hard-invalid"
                          ? "Needs fixing"
                          : review.fashion.verdict === "soft-mismatch"
                            ? "Soft mismatch"
                            : review.fashion.verdict === "valid"
                              ? "Valid"
                              : "Strong"}
                      </span>
                    )}
                  </div>

                  {review?.fashion ? (
                    <>
                      <div className="mt-3">
                        <div className="h-2 w-full overflow-hidden rounded-full bg-paper-soft">
                          <div
                            className="h-full rounded-full bg-accent-deep transition-all"
                            style={{ width: `${Math.round(review.fashion.score * 100)}%` }}
                          />
                        </div>
                        <p className="mt-1 text-right text-xs font-semibold text-ink">
                          {Math.round(review.fashion.score * 100)}%
                        </p>
                      </div>

                      <div className="mt-3 space-y-2">
                        {review.fashion.factors.map((f) => (
                          <div key={f.key} className="text-xs">
                            <div className="flex items-center justify-between">
                              <span className="text-ink-soft">{f.label}</span>
                              <span
                                className={`font-semibold ${
                                  f.score >= 0.8
                                    ? "text-emerald-700"
                                    : f.score >= 0.5
                                      ? "text-amber-700"
                                      : "text-red-600"
                                }`}
                              >
                                {Math.round(f.score * 100)}%
                              </span>
                            </div>
                            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-paper-soft">
                              <div
                                className="h-full rounded-full bg-accent-deep"
                                style={{ width: `${Math.round(f.score * 100)}%` }}
                              />
                            </div>
                            <p className="mt-1 text-[11px] text-ink-faint">{f.detail}</p>
                          </div>
                        ))}
                      </div>

                      {review.fashion.issues.length > 0 && (
                        <div className="mt-3 space-y-1.5">
                          {review.fashion.issues.map((i) => (
                            <p
                              key={i}
                              className="flex items-start gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-[11px] leading-snug text-red-700"
                            >
                              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                              {i}
                            </p>
                          ))}
                        </div>
                      )}

                      {review.fashion.highlights.length > 0 && (
                        <div className="mt-3 space-y-1.5">
                          {review.fashion.highlights.map((h) => (
                            <p
                              key={h}
                              className="flex items-start gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-[11px] leading-snug text-emerald-700"
                            >
                              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                              {h}
                            </p>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="mt-3 text-xs text-ink-faint">
                      Verdict appears once the server checks the look.
                    </p>
                  )}
                </div>

                <div className="rounded-2xl border border-line bg-surface p-5">
                  <dl className="mt-3 space-y-2.5 text-sm">
                    <div className="flex items-center justify-between">
                      <dt className="text-ink-soft">Pieces</dt>
                      <dd className="font-semibold text-ink">{ordered.length}</dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-ink-soft">Compatibility</dt>
                      <dd className="font-semibold text-ink">{scoreLabel}</dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-ink-soft">Total</dt>
                      <dd className="font-semibold text-ink">
                        {review?.price.reliable
                          ? `€${review.price.totalEur.toFixed(2)}`
                          : "—"}
                      </dd>
                    </div>
                  </dl>
                  {review?.price && !review.price.reliable && (
                    <p className="mt-2 rounded-xl bg-paper-soft px-3 py-2 text-xs text-ink-soft">
                      Total unavailable — prices are in mixed currencies
                      {review.price.hasUsd ? " (USD can't be converted right now)" : ""}.
                      Each price below is shown in its real currency.
                    </p>
                  )}
                  <p className="mt-3 border-t border-line pt-3 text-[11px] text-ink-faint">
                    Compatibility comes from the same scorer the outfit
                    engine uses; total converts through the live fx layer.
                  </p>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => editAt()}
                    className="flex-1 rounded-full border border-line py-2.5 text-sm font-medium text-ink-soft transition hover:border-accent-deep hover:text-ink"
                  >
                    Edit outfit
                  </button>
                  <Link
                    href="/"
                    className="flex-1 rounded-full bg-ink py-2.5 text-center text-sm font-semibold text-paper transition hover:bg-ink-soft"
                  >
                    Done
                  </Link>
                </div>
              </aside>
            </div>
          </>
        )}
        </div>
      </main>
    );
  }

export default function Page() {
  return (
    <Suspense
      fallback={<div className="min-h-screen bg-paper p-12 text-ink">Loading…</div>}
    >
      <ReviewInner />
    </Suspense>
  );
}