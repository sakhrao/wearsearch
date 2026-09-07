/* Build an Outfit — API-safe product projection.
   Same guarantees as the search/outfit serializers: only real fields
   from the catalog snapshot, real productUrl (never invented), price
   kept in its original currency, and the AVAILABLE offer/legacy
   variant colours + sizes exposed as real canonical chips so the
   builder's chips are always honour-able. */

import { canonicalColorFromOffer } from "@/lib/catalog/offer-vocab";
import type { OutfitProduct } from "@/lib/outfit/types";

export type BuildProduct = {
  id: string;
  name: string;
  price: string;
  currency: string | null;
  imageUrl: string | null;
  productUrl: string;
  brand: string | null;
  categorySlug: string;
  categoryName: string | null;
  gender: OutfitProduct["gender"];
  colors: string[];
  sizes: string[];
};

/* Canonical colours carried by AVAILABLE variants (offer variants were
   already folded through canonicalColorFromOffer by the catalog loader;
   legacy variants carry dictionary colours). */
export function availableColors(p: OutfitProduct): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of p.variants) {
    if (v.availability !== "AVAILABLE") continue;
    const name = v.color?.name;
    if (!name || seen.has(name)) continue;
    const canonical = canonicalColorFromOffer(name) ?? name;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/* Size values carried by AVAILABLE variants. */
export function availableSizes(p: OutfitProduct): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of p.variants) {
    if (v.availability !== "AVAILABLE") continue;
    const value = v.size?.value;
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function serializeBuildProduct(
  p: OutfitProduct
): BuildProduct {
  return {
    id: p.id,
    name: p.name,
    price: p.price,
    currency: p.currency,
    imageUrl: p.imageUrl,
    productUrl: p.productUrl,
    brand: p.brand?.name ?? null,
    categorySlug: p.category?.slug?.toLowerCase() ?? "",
    categoryName: p.category?.name ?? null,
    gender: p.gender,
    colors: availableColors(p),
    sizes: availableSizes(p),
  };
}

export function serializeBuildContextItem(
  item: {
    slot: string;
    product: OutfitProduct;
    color: { name: string; hex: string | null } | null;
  }
) {
  return {
    slot: item.slot,
    color: item.color ? { ...item.color } : null,
    product: serializeBuildProduct(item.product),
  };
}