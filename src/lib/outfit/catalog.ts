/* Catalog snapshot loader for the outfit engine.
   Reads the live catalog in the exact shape the builder consumes.
   Reused by the integration tests and the /api/outfits route so
   both reason over the same snapshot. Read-only; never writes.

   Phase-0 catalogs keep their sellable data in ProductOffer ->
   ProductOfferVariant (no legacy ProductVariant rows), so the loader
   ALSO synthesizes variant-like entries from the AVAILABLE offer
   lines: the color collapses through the same canonical fold and the
   size through the same chip expander /api/meta + /api/search use,
   so a real purchasable line is a real variant candidate. The product
   price mirrors the primary offer when the mirror is missing. */

import type { PrismaClient } from "@/generated/prisma/client";
import type { OutfitProduct, OutfitVariantSize } from "./types";
import {
  canonicalColorFromOffer,
  expandOfferSizeChips,
} from "@/lib/catalog/offer-vocab";
import {
  pickCanonicalFields,
  readCanonicalSize,
  type SizeCanonicalFields,
} from "@/lib/size-domain";

/* G1 — the application-level size read for an outfit variant. The raw
   legacy label stays authoritative for matching/display; the canonical
   boundary supplies the state and (when resolved) the identity. No local
   `if (!canonical) use legacy` branching exists here: the centralized
   fallback inside `readCanonicalSize` decides. */

export type LegacyVariantSizeRow = SizeCanonicalFields & {
  size: {
    system: string | null;
    value: string | null;
    normalizedValue?: string | null;
    productType?: string | null;
  } | null;
};

export function projectVariantSize(
  row: LegacyVariantSizeRow
): OutfitVariantSize | null {
  if (!row.size) return null;
  const read = readCanonicalSize({
    canonical: pickCanonicalFields(row),
    legacy: {
      sourceSizeLabel: row.size.value,
      legacySystem: row.size.system,
    },
  });
  return {
    state: read.state,
    canonicalSizeOptionId: read.canonicalSizeOptionId,
    value: row.size.value,
    /* Canonical system when known, otherwise the legacy system fallback. */
    system: read.system,
    normalizedValue: row.size.normalizedValue ?? null,
    productType: row.size.productType ?? null,
  };
}

export function projectOfferVariantSize(
  canonical: SizeCanonicalFields,
  chip: string | null,
  legacySystem: string | null
): OutfitVariantSize | null {
  if (!chip) return null;
  const read = readCanonicalSize({
    canonical: pickCanonicalFields(canonical),
    legacy: { sourceSizeLabel: chip, legacySystem },
  });
  return {
    state: read.state,
    canonicalSizeOptionId: read.canonicalSizeOptionId,
    value: chip,
    system: read.system,
    normalizedValue: null,
    productType: null,
  };
}

export async function loadOutfitCatalog(
  prisma: PrismaClient
): Promise<OutfitProduct[]> {
  const rows = await prisma.product.findMany({
    select: {
      id: true,
      name: true,
      price: true,
      currency: true,
      productUrl: true,
      imageUrl: true,
      availability: true,
      gender: true,
      brand: { select: { id: true, name: true } },
      category: { select: { id: true, slug: true, name: true } },
      variants: {
        select: {
          price: true,
          currency: true,
          availability: true,
          color: { select: { name: true, hex: true } },
          canonicalSizeOptionId: true,
          sizeResolutionStatus: true,
          sizeResolutionProvenance: true,
          sizeResolutionSystem: true,
          size: {
            select: {
              system: true,
              value: true,
              normalizedValue: true,
              productType: true,
            },
          },
        },
      },
      offers: {
        orderBy: [{ isPrimary: "desc" }, { normalizedEur: "asc" }],
        select: {
          originalPrice: true,
          originalCurrency: true,
          imageUrl: true,
          variants: {
            where: { availability: "AVAILABLE" },
            select: {
              color: true,
              sizeValue: true,
              sizeSystem: true,
              availability: true,
              originalPrice: true,
              originalCurrency: true,
              canonicalSizeOptionId: true,
              sizeResolutionStatus: true,
              sizeResolutionProvenance: true,
              sizeResolutionSystem: true,
            },
          },
        },
      },
      attributes: {
        select: { value: true, attribute: { select: { name: true } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return rows.map((r) => {
    const offers = r.offers ?? [];
    const primaryOffer = offers[0] ?? null;

    /* Legacy variants, verbatim source + canonical read state. */
    const legacyVariants = (r.variants ?? []).map((v) => ({
      price: String(v.price),
      currency: v.currency,
      availability: v.availability,
      color: v.color,
      size: projectVariantSize(v),
    }));

    /* Phase-0 offer lines, synthesized as product variants so the
       builder's F8 availability gate, color resolution and size
       matching see the real sellable lines. Colors and sizes collapse
       through the shared offer fold (same chips that round-trip the
       questionnaire and the search engine). */
    const offerVariants: OutfitProduct["variants"] = [];
    for (const offer of offers) {
      for (const ov of offer.variants) {
        offerVariants.push({
          price: String(ov.originalPrice ?? offer.originalPrice),
          currency: ov.originalCurrency ?? offer.originalCurrency,
          availability: ov.availability,
          color: (() => {
            const chip = canonicalColorFromOffer(ov.color);
            return chip ? { name: chip, hex: null } : null;
          })(),
          size: (() => {
            const chips = expandOfferSizeChips(ov.sizeValue);
            return projectOfferVariantSize(
              ov,
              chips.length > 0 ? chips[0] : null,
              ov.sizeSystem ?? null
            );
          })(),
        });
      }
    }

    const variants = [...legacyVariants, ...offerVariants];

    /* Effective price: the Product mirror when present, else the best
       offer's price (cheapest per normalizedEur when no primary flag is
       reliable). The builder only reads product-level price. */
    const storedPrice = Number(r.price);
    const price =
      Number.isFinite(storedPrice) && storedPrice > 0
        ? r.price
        : (primaryOffer?.originalPrice ?? r.price) ?? "0";
    const currency =
      r.currency ??
      primaryOffer?.originalCurrency ??
      null;

    return {
      id: r.id,
      name: r.name,
      price: String(price),
      currency,
      productUrl: r.productUrl,
      imageUrl: r.imageUrl ?? primaryOffer?.imageUrl ?? null,
      availability: r.availability,
      gender: (r.gender as OutfitProduct["gender"]) ?? null,
      brand: r.brand,
      category: r.category
        ? { id: r.category.id, slug: r.category.slug, name: r.category.name }
        : null,
      variants,
      attributes: (r.attributes ?? []).map((a) => ({
        value: a.value,
        attribute: { name: a.attribute.name },
      })),
    };
  });
}