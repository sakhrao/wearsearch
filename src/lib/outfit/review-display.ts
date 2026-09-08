/* Review display — thin, pure projection helpers for the Review page.

   Keeps the "what the review page shows" decisions testable + shared:
     - the ordered display list (builder slot order, accessories last);
     - the exact API request built from the carried URL state.

   Pure module: no DB / network / I-O. */

import { reviewSlotOrder } from "@/lib/outfit/review-state";
import type { UrlPiece } from "@/lib/build/url-state";

export type OrderedReviewPiece = UrlPiece & { slot: string };

/* Display order identical to the builder flow (Top, Bottoms, Shoes,
   Outerwear, then every accessory). One source of truth. */
export function orderedReviewPieces(
  selected: Record<string, UrlPiece>,
  accessories: UrlPiece[]
): OrderedReviewPiece[] {
  const out: OrderedReviewPiece[] = [];
  for (const slot of reviewSlotOrder()) {
    if (slot === "accessory") {
      for (const a of accessories) out.push({ ...a, slot });
    } else {
      const p = selected[slot];
      if (p) out.push({ ...p, slot });
    }
  }
  return out;
}

/* The POST /api/outfit/review body for the carried state. */
export type ReviewApiPiece = {
  slot: string;
  productId: string;
  color: { name: string; hex: string | null } | null;
};

export function reviewApiPiecesFor(
  selected: Record<string, UrlPiece>,
  accessories: UrlPiece[]
): ReviewApiPiece[] {
  const pieces: ReviewApiPiece[] = [];
  for (const [slot, p] of Object.entries(selected)) {
    pieces.push({
      slot,
      productId: p.product.id,
      color: p.color ? { name: p.color, hex: null } : null,
    });
  }
  for (const p of accessories) {
    pieces.push({
      slot: "accessory",
      productId: p.product.id,
      color: p.color ? { name: p.color, hex: null } : null,
    });
  }
  return pieces;
}