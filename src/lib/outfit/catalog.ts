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
import type { OutfitProduct } from "./types";
import {
  canonicalColorFromOffer,
  expandOfferSizeChips,
} from "@/lib/catalog/offer-vocab";

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

    /* Legacy variants, verbatim (pre-Phase-0). */
    const legacyVariants = (r.variants ?? []).map((v) => ({
      price: String(v.price),
      currency: v.currency,
      availability: v.availability,
      color: v.color,
      size: v.size
        ? {
            system: v.size.system,
            value: v.size.value,
            normalizedValue: v.size.normalizedValue,
            productType: v.size.productType,
          }
        : null,
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
            return chips.length > 0
              ? {
                  system: ov.sizeSystem ?? null,
                  value: chips[0],
                  normalizedValue: null,
                  productType: null,
                }
              : null;
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