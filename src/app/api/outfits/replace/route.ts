import { prisma } from "@/lib/prisma";
import { getFxRate } from "@/lib/currency";
import {
  computeCatalogFingerprint,
  getCatalogMemo,
} from "@/lib/catalog-memo";
import { loadOutfitCatalog } from "@/lib/outfit/catalog";
import { replaceSlot } from "@/lib/outfit/outfit-builder";
import { slotOfCategory } from "@/lib/outfit/category-rules";
import { resolveCandidateColor } from "@/lib/outfit/compatibility";
import { serializeAnchor, serializeOutfit } from "@/lib/outfit/serialize";
import { hasRealProductPage } from "@/lib/product-url";
import type {
  OutfitProduct,
  Occasion,
  PlacedItem,
  SlotName,
  StyleLabel,
} from "@/lib/outfit/types";

const SLOTS = new Set<SlotName>([
  "bottom",
  "top",
  "layer",
  "footwear",
  "accessory",
]);

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      anchorProductId?: unknown;
      slot?: unknown;
      lockedProductIds?: unknown;
      occasion?: unknown;
      style?: unknown;
      budget?: unknown;
      size?: unknown;
      excludeProductIds?: unknown;
    };

    const anchorProductId =
      typeof body?.anchorProductId === "string" &&
      body.anchorProductId.trim().length > 0
        ? body.anchorProductId.trim()
        : null;
    const slot =
      typeof body?.slot === "string" && SLOTS.has(body.slot as SlotName)
        ? (body.slot as SlotName)
        : null;

    if (!anchorProductId) {
      return Response.json({ error: "anchorProductId is required" }, { status: 400 });
    }
    if (!slot) {
      return Response.json({ error: "valid slot is required" }, { status: 400 });
    }

    const lockedIds: string[] = Array.isArray(body?.lockedProductIds)
      ? body.lockedProductIds.filter((x): x is string => typeof x === "string")
      : [];

    const occasion = parseOccasion(body?.occasion);
    const style = parseStyle(body?.style);
    const budget = parseBudget(body?.budget);
    const size = parseSize(body?.size);
    const excludeProductIds: string[] = Array.isArray(body?.excludeProductIds)
      ? body.excludeProductIds.filter((x): x is string => typeof x === "string")
      : [];

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

    const anchor = catalog.find((p) => p.id === anchorProductId);
    if (!anchor) {
      return Response.json({ error: "anchor product not found" }, { status: 404 });
    }
    if (
      !hasRealProductPage(anchor.productUrl) ||
      anchor.availability === "OUT_OF_STOCK" ||
      !anchor.variants.some((v) => v.availability === "AVAILABLE")
    ) {
      return Response.json(
        { error: "anchor product is not purchasable or not available" },
        { status: 400 }
      );
    }

    const anchorSlug = anchor.category?.slug?.toLowerCase() ?? "";
    const anchorSlot = slotOfCategory(anchorSlug);
    if (slot === anchorSlot) {
      return Response.json(
        { error: "cannot replace the anchor's own slot" },
        { status: 400 }
      );
    }
    const anchorColor = resolveCandidateColor(anchor, null);

    // Reconstruct the current outfit: anchor + locked products, each in
    // its natural category slot.
    const currentItems: PlacedItem[] = [
      { slot: anchorSlot, product: anchor, color: anchorColor },
    ];
    const seen = new Set<string>([anchor.id]);
    for (const id of lockedIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const p = catalog.find((x) => x.id === id);
      if (!p) continue;
      const slug = p.category?.slug?.toLowerCase() ?? "";
      currentItems.push({
        slot: slotOfCategory(slug),
        product: p,
        color: resolveCandidateColor(p, anchorColor?.name ?? null),
      });
    }

    const replacements = replaceSlot({
      anchor,
      slot,
      currentItems,
      products: catalog,
      occasion,
      style,
      budget,
      size,
      rate: rate.rate,
      max: 3,
      excludeProductIds,
    });

    return Response.json({
      anchor: serializeAnchor(anchor),
      slot,
      catalogVersion: fingerprint,
      outfits: replacements.map(serializeOutfit),
    });
  } catch (e) {
    return Response.json(
      { error: "failed to replace", detail: String(e) },
      { status: 500 }
    );
  }
}

function parseOccasion(v: unknown): Occasion | null {
  if (
    typeof v === "string" &&
    ["Everyday", "University", "Work", "Date", "Party", "Formal", "Sport", "Travel"].includes(v)
  ) {
    return v as Occasion;
  }
  return null;
}
function parseStyle(v: unknown): StyleLabel | null {
  if (
    typeof v === "string" &&
    ["casual", "sporty", "streetwear", "smart-casual", "formal", "classic", "bohemian", "minimalist"].includes(v)
  ) {
    return v as StyleLabel;
  }
  return null;
}
function parseBudget(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function parseSize(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 && s.length <= 20 ? s : null;
}
