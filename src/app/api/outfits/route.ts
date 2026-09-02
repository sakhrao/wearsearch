import { prisma } from "@/lib/prisma";
import { getFxRate } from "@/lib/currency";
import {
  computeCatalogFingerprint,
  getCatalogMemo,
} from "@/lib/catalog-memo";
import { loadOutfitCatalog } from "@/lib/outfit/catalog";
import { buildOutfits } from "@/lib/outfit/outfit-builder";
import { hasRealProductPage } from "@/lib/product-url";
import { serializeAnchor, serializeOutfit } from "@/lib/outfit/serialize";
import type {
  OutfitRequest,
  OutfitProduct,
  Occasion,
  StyleLabel,
} from "@/lib/outfit/types";

const OCCASIONS = new Set<Occasion>([
  "Everyday",
  "University",
  "Work",
  "Date",
  "Party",
  "Formal",
  "Sport",
  "Travel",
]);

const STYLES = new Set<StyleLabel>([
  "casual",
  "sporty",
  "streetwear",
  "smart-casual",
  "formal",
  "classic",
  "bohemian",
  "minimalist",
]);

function parseOccasion(v: unknown): Occasion | null {
  if (typeof v === "string" && OCCASIONS.has(v as Occasion)) {
    return v as Occasion;
  }
  return null;
}

function parseStyle(v: unknown): StyleLabel | null {
  if (typeof v === "string" && STYLES.has(v as StyleLabel)) {
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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<OutfitRequest>;
    const anchorProductId =
      typeof body?.anchorProductId === "string" &&
      body.anchorProductId.trim().length > 0
        ? body.anchorProductId.trim()
        : null;

    if (!anchorProductId) {
      return Response.json(
        { error: "anchorProductId is required" },
        { status: 400 }
      );
    }

    const occasion = parseOccasion(body?.occasion ?? null);
    const style = parseStyle(body?.style ?? null);
    const budget = parseBudget(body?.budget ?? null);
    const size = parseSize(body?.size ?? null);

    // Optional pre-locked product ids for exact reconstruction of a
    // saved/shared outfit (additive: empty when building fresh).
    const lockIds: string[] = Array.isArray(body?.lockProductIds)
      ? body.lockProductIds.filter((x): x is string => typeof x === "string")
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
      return Response.json(
        { error: "anchor product not found" },
        { status: 404 }
      );
    }

    // Anchor eligibility: must be purchasable + available + gender set.
    if (
      !hasRealProductPage(anchor.productUrl) ||
      anchor.availability === "OUT_OF_STOCK" ||
      anchor.variants.length === 0 ||
      !anchor.variants.some((v) => v.availability === "AVAILABLE")
    ) {
      return Response.json(
        { error: "anchor product is not purchasable or not available" },
        { status: 400 }
      );
    }

    const lockProducts = lockIds
      .map((id) => catalog.find((p) => p.id === id))
      .filter((p): p is OutfitProduct => Boolean(p))
      .filter((p) => p && p.id !== anchor.id);

    const outfits = buildOutfits({
      anchor,
      occasion,
      style,
      budget,
      size,
      products: catalog,
      rate: rate.rate,
      lockProducts,
    });

    return Response.json({
      anchor: serializeAnchor(anchor),
      request: {
        occasion,
        style,
        budget,
        size,
      },
      catalogVersion: fingerprint,
      outfits: outfits.map(serializeOutfit),
    });
  } catch (e) {
    return Response.json(
      { error: "failed to build outfits", detail: String(e) },
      { status: 500 }
    );
  }
}
