/* Build an Outfit — context-aware recommendations.
   Rank the real candidate pool for the current step by how well each
   product fits the pieces already chosen. This is a clean reuse of the
   outfit engine's deterministic weighted scorer (category, color
   harmony, style, formality, global coherence) over the accumulated
   context + the candidate: the exact same ranking /api/outfits uses,
   but for a single user-driven addition instead of a whole look.

   Recommendations REORDER the pool; they never restrict it. The pool
   itself is the real catalog only. No state, no occasion, no budget —
   the builder's behaviour is deterministic and offline-testable. */

import { resolveCandidateColor } from "@/lib/outfit/compatibility";
import { productPriceEur } from "@/lib/outfit/outfit-builder";
import { scoreOutfit } from "@/lib/outfit/scoring";
import { deriveStyleProfile } from "@/lib/outfit/style-profile";
import type {
  OutfitProduct,
  SlotName,
} from "@/lib/outfit/types";

export type ContextChoice = {
  slot: SlotName;
  product: OutfitProduct;
  color: { name: string; hex: string | null } | null;
};

export type RankedCandidate = {
  product: OutfitProduct;
  score: number;
};

/* Context-fit score of one candidate against the completed context:
   every context item plus the candidate are scored as one coherent
   outfit (deterministic, weighted, bounded [0,1]). */
export function contextFitScore(args: {
  product: OutfitProduct;
  slot: SlotName;
  context: ContextChoice[];
  rate: number | null;
}): number {
  const { product, slot, context, rate } = args;
  /* colour resolution anchors on the first context piece (typically
     the Top), mirroring the outfit builder's resolveCandidateColor */
  const anchorColor = context[0]?.color?.name ?? null;
  const color = resolveCandidateColor(product, anchorColor);

  const items = [
    ...context.map((c) => ({
      slot: c.slot,
      product: c.product,
      color: c.color,
    })),
    { slot, product, color },
  ];
  const profiles = items.map((it) => deriveStyleProfile(it.product));
  const totalPriceEur = items.reduce(
    (sum, it) => sum + productPriceEur(it.product, rate),
    0
  );

  const scores = scoreOutfit({
    anchor: product,
    items,
    profiles,
    truth: {
      anchorId: product.id,
      occasion: null,
      style: null,
      budgetEur: null,
    },
    totalPriceEur,
  });
  return scores.total;
}

/* Rank the pool by context fit (desc). Deterministic: ties break on
   name then id. Returns at most `limit` candidates. */
export function rankByContext(
  products: OutfitProduct[],
  slot: SlotName,
  context: ContextChoice[],
  rate: number | null,
  limit?: number
): RankedCandidate[] {
  const scored = products.map((product) => ({
    product,
    score: contextFitScore({ product, slot, context, rate }),
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.product.name < b.product.name) return -1;
    if (a.product.name > b.product.name) return 1;
    if (a.product.id < b.product.id) return -1;
    if (a.product.id > b.product.id) return 1;
    return 0;
  });
  return limit !== undefined ? scored.slice(0, limit) : scored;
}