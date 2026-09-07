/* Review your outfit — pure state logic.

   Ordinally, Review is a VIEW over the builder's own decisions: which
   piece fills which slot, what the builder's flow-rules call required
   vs optional, and the outfit engine's existing scorer. Building a
   second, competing rule-set here would let Review drift out of sync
   with Build — so everything below REUSES the builder + scorer, and
   only adds the "status of a fixed, user-picked look" semantics.

   Pure module: no DB / network / I-O. */

import {
  flowSteps,
  isOnePieceTopSlug,
  type BuildStep,
} from "@/lib/build/flow-rules";
import { scoreOutfit } from "@/lib/outfit/scoring";
import { deriveStyleProfile } from "@/lib/outfit/style-profile";
import { productPriceEur } from "@/lib/outfit/outfit-builder";
import type {
  GroundTruth,
  OutfitProduct,
  PlacedItem,
  SlotName,
} from "@/lib/outfit/types";

export type ReviewPiece = {
  slot: SlotName;
  productId: string;
  /* optional: the color the user fixed for this placement */
  color?: { name: string; hex: string | null } | null;
};

export type ReviewStatus = {
  /* every required slot for this look is filled */
  complete: boolean;
  missingRequired: SlotName[];
  skippedOptional: SlotName[];
};

/* The builder's own steps for this look. A one-piece Top (dress /
   jumpsuit) drops the Bottoms step — same rule the builder runs on. */
export function reviewStepsFor(topSlug: string | null | undefined): BuildStep[] {
  return flowSteps(isOnePieceTopSlug(topSlug));
}

/* Status of a fixed set of user-picked pieces under the builder's
   flow rules. Never blocks finishing — it states gaps honestly. */
export function reviewStatusFor(
  pieces: ReviewPiece[],
  topSlug: string | null | undefined
): ReviewStatus {
  const steps = reviewStepsFor(topSlug);
  const covered = new Set(pieces.map((p) => p.slot));
  const missingRequired: SlotName[] = [];
  const skippedOptional: SlotName[] = [];
  for (const step of steps) {
    if (!covered.has(step.slot)) {
      if (step.required) missingRequired.push(step.slot);
      else skippedOptional.push(step.slot);
    }
  }
  return {
    complete: missingRequired.length === 0,
    missingRequired,
    skippedOptional,
  };
}

/* Display order for the review item list (same as the builder flow:
   Top, Bottoms, Shoes, Outerwear, Accessories). */
export function reviewSlotOrder(): SlotName[] {
  return flowSteps(false).map((s) => s.slot);
}

export type PriceReliability = {
  totalEur: number;
  /* true only when every price is a real number AND (no USD is
     present OR a real fx rate was available). Mixed/unknown currency
     prices pass through the same way the engine treats them: stored
     values as-is — never invented exchange. */
  reliable: boolean;
  hasUsd: boolean;
  hasOtherCurrency: boolean;
};

export function priceReliabilityFor(
  items: { product: OutfitProduct }[],
  rate: number | null
): PriceReliability {
  if (items.length === 0) {
    return { totalEur: 0, reliable: false, hasUsd: false, hasOtherCurrency: false };
  }
  let total = 0;
  let hasUsd = false;
  let hasOther = false;
  let numbersOk = true;
  for (const it of items) {
    const price = Number(it.product.price);
    if (!Number.isFinite(price)) {
      numbersOk = false;
      continue;
    }
    const code = (it.product.currency ?? "EUR").trim().toUpperCase();
    if (code === "USD") hasUsd = true;
    else if (code !== "EUR") hasOther = true;
    total += productPriceEur(it.product, rate);
  }
  const reliable =
    numbersOk && !(hasUsd && (rate === null || !Number.isFinite(rate)));
  return {
    totalEur: Math.round(total * 100) / 100,
    reliable,
    hasUsd,
    hasOtherCurrency: hasOther,
  };
}

/* Score a FIXED, user-picked look with the outfit engine's own scorer
   (same weights; occasion/style/budget left neutral unless provided).
   Returns null when there are no items to judge. */
export function fixedLookScore(args: {
  items: { slot: SlotName; product: OutfitProduct }[];
  truth?: Pick<GroundTruth, "occasion" | "style" | "budgetEur">;
  rate?: number | null;
}): number | null {
  const { items, rate = null } = args;
  if (items.length === 0) return null;
  const placed: PlacedItem[] = items.map((it) => ({
    slot: it.slot,
    product: it.product,
    color: null,
  }));
  const anchor = items[0].product;
  const profiles = placed.map((p) => deriveStyleProfile(p.product));
  const totalPriceEur = placed.reduce(
    (sum, p) => sum + productPriceEur(p.product, rate),
    0
  );
  const truth: GroundTruth = {
    anchorId: anchor.id,
    occasion: args.truth?.occasion ?? null,
    style: args.truth?.style ?? null,
    budgetEur: args.truth?.budgetEur ?? null,
  };
  const scores = scoreOutfit({
    anchor,
    items: placed,
    profiles,
    truth,
    totalPriceEur,
  });
  return Math.round(scores.total * 100) / 100;
}

/* One-piece helper reused by the review page + API. */
export { isOnePieceTopSlug };