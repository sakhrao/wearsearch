/* Review your outfit — API.

   Turns the builder's URL puzzle state into a real, honest review:
     - rehydrates every piece through the SAME canonical catalog the
       builder (and outfit engine) read, so a product that vanished is
       reported as missing instead of re-invented;
     - computes the builder's own completion status;
     - computes the total in the engine's EUR reference only when it is
       reliable (real prices + real fx when USD is present);
     - scores the fixed look with the outfit engine's own scorer;
     - projects each item to a generic GarmentVisual for the 3D avatar
       (canonical slug + attributes + color — never source fields).

   The look itself (pieces) is source-agnostic by construction: the
   builder's user picks were canonical products, and that is all this
   route reads. */

import { prisma } from "@/lib/prisma";
import { getFxRate } from "@/lib/currency";
import {
  computeCatalogFingerprint,
  getCatalogMemo,
} from "@/lib/catalog-memo";
import { loadOutfitCatalog } from "@/lib/outfit/catalog";
import { serializeBuildProduct } from "@/lib/build/serialize";
import { garmentVisualFor } from "@/lib/outfit/garment";
import {
  fixedLookScore,
  isOnePieceTopSlug,
  priceReliabilityFor,
  reviewSlotOrder,
  reviewStatusFor,
} from "@/lib/outfit/review-state";
import type {
  OutfitProduct,
  SlotName,
} from "@/lib/outfit/types";

const SLOTS = new Set<SlotName>([
  "top",
  "bottom",
  "footwear",
  "layer",
  "accessory",
]);

type PieceInput = {
  slot: unknown;
  productId: unknown;
  color?: unknown;
};

function parsePieces(body: unknown): {
  pieces: { slot: SlotName; productId: string; color: { name: string; hex: string | null } | null }[];
  invalid: string[];
} {
  const pieces: {
    slot: SlotName;
    productId: string;
    color: { name: string; hex: string | null } | null;
  }[] = [];
  const invalid: string[] = [];
  if (!Array.isArray(body)) return { pieces, invalid };
  for (const raw of body) {
    const p = (raw ?? {}) as PieceInput;
    const slot = typeof p.slot === "string" && SLOTS.has(p.slot as SlotName)
      ? (p.slot as SlotName)
      : null;
    const productId =
      typeof p.productId === "string" && p.productId.trim().length > 0
        ? p.productId.trim()
        : null;
    if (!slot || !productId) {
      invalid.push(typeof p.productId === "string" ? p.productId : "<missing>");
      continue;
    }
    const color =
      p.color && typeof p.color === "object"
        ? {
            name:
              typeof (p.color as { name?: unknown }).name === "string"
                ? (p.color as { name: string }).name
                : "",
            hex:
              typeof (p.color as { hex?: unknown }).hex === "string"
                ? (p.color as { hex: string }).hex
                : null,
          }
        : null;
    pieces.push({
      slot,
      productId,
      color: color && color.name ? color : null,
    });
  }
  return { pieces, invalid };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      pieces?: unknown;
      topSlug?: unknown;
      occasion?: unknown;
      style?: unknown;
      budget?: unknown;
    };
    const { pieces, invalid } = parsePieces(body?.pieces ?? null);

    const topSlug =
      typeof body?.topSlug === "string" && body.topSlug.trim().length > 0
        ? body.topSlug.trim()
        : null;

    const [rate, fingerprint] = await Promise.all([
      getFxRate(),
      computeCatalogFingerprint(prisma),
    ]);

    const catalog = await getCatalogMemo<OutfitProduct[]>(
      prisma,
      fingerprint,
      "outfit-catalog",
      () => loadOutfitCatalog(prisma)
    );

    const byId = new Map(catalog.map((p) => [p.id, p]));

    /* Rehydrate through the canonical catalog. Products that are no
       longer in the catalog are reported as missing, never rebuilt. */
    const found: OutfitProduct[] = [];
    const missingIds: string[] = [];
    const slots = reviewSlotOrder();
    const items: {
      slot: SlotName;
      product: OutfitProduct;
      color: { name: string; hex: string | null } | null;
      garment: ReturnType<typeof garmentVisualFor>;
    }[] = [];

    for (const slot of slots) {
      /* accessory is multi-slot: EVERY picked accessory is shown,
         preserving the user's own order */
      const piecesForSlot =
        slot === "accessory"
          ? pieces.filter((p) => p.slot === slot)
          : pieces.filter((p) => p.slot === slot).slice(0, 1);
      for (const piece of piecesForSlot) {
        const product = byId.get(piece.productId);
        if (!product) {
          missingIds.push(piece.productId);
          continue;
        }
        found.push(product);
        items.push({
          slot,
          product,
          color: piece.color,
          garment: garmentVisualFor({ product, slot, color: piece.color }),
        });
      }
    }

    const status = reviewStatusFor(
      pieces.map((p) => ({ slot: p.slot, productId: p.productId })),
      topSlug
    );
    const price = priceReliabilityFor(found.map((p) => ({ product: p })), rate.rate);
    const score = fixedLookScore({
      items: items.map((it) => ({ slot: it.slot, product: it.product })),
      rate: rate.rate,
    });

    return Response.json({
      catalogVersion: fingerprint,
      topSlug,
      onePiece: topSlug !== null && isOnePieceTopSlug(topSlug),
      items: items.map((it) => ({
        slot: it.slot,
        product: serializeBuildProduct(it.product),
        color: it.color,
        garment: it.garment,
      })),
      status,
      price,
      score,
      missingIds,
      invalidPieces: invalid,
      fx: { rate: rate.rate, source: rate.source, asOf: rate.asOf },
    });
  } catch (e) {
    return Response.json(
      { error: "failed to build review", detail: String(e) },
      { status: 500 }
    );
  }
}