/* Catalog snapshot loader for the outfit engine.
   Reads the live catalog in the exact shape the builder consumes.
   Reused by the integration tests and the /api/outfits route so
   both reason over the same snapshot. Read-only; never writes. */

import type { PrismaClient } from "@/generated/prisma/client";
import type { OutfitProduct } from "./types";

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
      attributes: {
        select: { value: true, attribute: { select: { name: true } } },
      },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    price: String(r.price),
    currency: r.currency,
    productUrl: r.productUrl,
    imageUrl: r.imageUrl,
    availability: r.availability,
    gender: (r.gender as OutfitProduct["gender"]) ?? null,
    brand: r.brand,
    category: r.category
      ? { id: r.category.id, slug: r.category.slug, name: r.category.name }
      : null,
    variants: (r.variants ?? []).map((v) => ({
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
    })),
    attributes: (r.attributes ?? []).map((a) => ({
      value: a.value,
      attribute: { name: a.attribute.name },
    })),
  }));
}
