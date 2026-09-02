/* Offers + canonical Product mirror (Phase 0).

   The store side of the source-agnostic architecture. For every
   accepted NormalizedListing under a registered source:

    1. resolve identity (dedup) if possible;
    2. upsert ProductOffer (one row per source listing - source price,
       currency, availability and buy URLs preserved verbatim);
    3. re-compare ALL offers of that product and pick the PRIMARY
       display offer by the agreed order:
         official brand flag -> priority asc -> AVAILABLE beaters
         -> lower normalized price -> newer sync wins;
    4. mirror the primary offer onto the canonical Product row so
       Search (which never reads offers) sees exactly one authoritative
       price/availability/purchase-url/image, with PREORDER/BACKORDER
       demoted to OUT_OF_STOCK.

   The legacy provider path (providers/sync.ts) writes Product rows
   directly and is untouched. This module only writes through the new
   canonical+offers path used by the import harness and future adapters. */

import type { PrismaClient } from "../../generated/prisma/client";
import type { Prisma } from "../../generated/prisma/client";
import { roundMoney } from "../currency";
import { productAvailabilityOf } from "./types";
import type { NormalizedListing, NormalizedVariant, OfferAvailability } from "./types";
import { slugToken, normalizePriceToEurValue, variantKeyFor, normalizeColorName, parseCurrency } from "./normalize";
import {
  findProductByGtin,
  findProductByMpn,
  replaceGtinRecords,
  replaceMpnRecords,
} from "./registry";

/* Buyability rank for the resolver. AVAILABLE always outranks every
   non-buyable state so an OUT_OF_STOCK/UNKNOWN offer can NEVER become
   the effective buy target while a valid (buyable) alternative exists
   - regardless of source priority. PREORDER/BACKORDER are orderable
   now and stay above hard-out states. */
export function offerAvailabilityRank(availability: string): number {
  switch (availability as OfferAvailability) {
    case "AVAILABLE":
      return 0;
    case "PREORDER":
    case "BACKORDER":
      return 1;
    case "OUT_OF_STOCK":
      return 2;
    case "UNKNOWN":
    default:
      return 3;
  }
}

const offerTuple = (o: OfferResolveRow): [number, number, number, number, number] => [
  offerAvailabilityRank(o.availability),
  o.official ? 0 : 1,
  o.priority,
  roundMoney(o.normalizedEur),
  -o.updatedAt.getTime(),
];

/* Pure: given the product's offers + owning source info, pick the
   primary one. Order (by customer outcome, not by source priority):
     1. buyability (AVAILABLE over everything; PREORDER/BACKORDER over
        hard out-of-stock/unknown) - so an unavailable official offer
        never becomes the effective buy target while an available
        retailer offer exists;
     2. official flag (never let a marketplace masquerade as official);
     3. source priority (official>authorized>affiliate>marketplace);
     4. lower normalized EUR price; 5. newer sync wins.
   When ALL offers are unavailable, priority still governs so the
   canonical "least bad" primary exists and the Product mirror shows a
   determinate OUT_OF_STOCK instead of a random pick. Kept pure so the
   resolver is unit-testable without DB. */
export type OfferResolveRow = {
  offerId: string;
  official: boolean;
  priority: number;
  availability: string;
  normalizedEur: number;
  updatedAt: Date;
};

export function resolvePrimaryOffer(offers: OfferResolveRow[]): string | null {
  if (offers.length === 0) return null;
  const sorted = [...offers].sort((a, b) => {
    const ta = offerTuple(a);
    const tb = offerTuple(b);
    for (let i = 0; i < ta.length; i++) {
      if (ta[i] !== tb[i]) return ta[i] - tb[i];
    }
    return 0;
  });
  return sorted[0].offerId;
}

export type ApplyListingResult = {
  productId: string;
  offerId: string;
  action: "created" | "updated";
  isPrimary: boolean;
  createdProduct: boolean;
};

/* Store one accepted listing. Callers must have already resolved the
   canonical brand/category and computed normalizedEur (validation
   ensures it is non-null). */
export async function applyListingToCatalog(
  db: PrismaClient,
  input: {
    sourceId: string;
    canonicalBrandId: string;
    canonicalCategoryId: string;
    listing: NormalizedListing;
    fxRate?: number | null;
  }
): Promise<ApplyListingResult> {
  const { sourceId, canonicalBrandId, canonicalCategoryId, listing, fxRate } = input;

  /* Display price for the product mirror: original price always wins
     over salePrice as the stored canonical value contract currently
     expects base price in Product.price. */
  const price = roundMoney(listing.originalPrice);
  const currency = listing.originalCurrency;
  const normalizedEur = normalizePriceToEurValue(price, currency, fxRate ?? null);
  if (normalizedEur === null) {
    throw new Error(
      `no normalizedEur derivable for ${currency} ${price} (fx unavailable)`
    );
  }

  /* ---- identity (dedup) ---- */
  let productId: string | null = null;
  for (const gtin of listing.gtins) {
    const hit = await findProductByGtin(db, gtin.gtin);
    if (hit) {
      productId = hit;
      break;
    }
  }
  if (!productId && listing.mpn) {
    productId = await findProductByMpn(db, canonicalBrandId, listing.mpn);
  }
  /* Re-sync of an identity-less listing must UPDATE its own row (the
     source's listing id is the product's stable key), never re-create. */
  if (!productId) {
    const byListing = await db.product.findFirst({
      where: { sourceId, externalId: listing.externalListingId },
    });
    if (byListing) productId = byListing.id;
  }

  let action: "created" | "updated";
  if (productId) {
    action = "updated";
  } else {
    /* Fresh canonical product. slug uniqueness is keyed on the listing
       name; collisions are cosmetic and allowed (slug is not unique). */
    const created = await db.product.create({
      data: {
        sourceId,
        externalId: listing.externalListingId,
        brandId: canonicalBrandId,
        categoryId: canonicalCategoryId,
        name: listing.name,
        slug: slugToken(listing.name).slice(0, 100) || "product",
        description: listing.description,
        price,
        currency: listing.originalCurrency,
        productUrl: listing.purchaseUrl || listing.sourceProductUrl,
        imageUrl: listing.imageUrl,
        gender: (listing.gender ?? null) as Prisma.ProductCreateInput["gender"],
        availability: productAvailabilityOf(listing.availability),
        lastSyncedAt: new Date(),
        dedupKey:
          listing.gtins.length > 0
            ? `gtin:${listing.gtins[0].gtinType}:${listing.gtins[0].gtin}`
            : listing.mpn
              ? `brandmpn:${canonicalBrandId}:${listing.mpn.toUpperCase()}`
              : null,
        identityLayer: listing.gtins.length > 0 ? 1 : listing.mpn ? 2 : null,
      },
    });
    productId = created.id;
    action = "created";
  }

  /* ---- offer row (verbatim source data) ---- */
  const priceUpdatedAt = new Date();
  const offer = await db.productOffer.upsert({
    where: {
      sourceId_externalListingId: {
        sourceId,
        externalListingId: listing.externalListingId,
      },
    },
    update: {
      productId,
      externalTitle: listing.name,
      sourceProductUrl: listing.sourceProductUrl,
      purchaseUrl: listing.purchaseUrl || listing.sourceProductUrl,
      originalPrice: roundMoney(listing.originalPrice),
      originalCurrency: listing.originalCurrency,
      salePrice:
        listing.salePrice !== null ? roundMoney(listing.salePrice) : null,
      normalizedEur,
      availability: listing.availability,
      imageUrl: listing.imageUrl,
      priceUpdatedAt,
      availabilityUpdatedAt: priceUpdatedAt,
      lastSyncedAt: priceUpdatedAt,
    },
    create: {
      productId,
      sourceId,
      externalListingId: listing.externalListingId,
      externalTitle: listing.name,
      sourceProductUrl: listing.sourceProductUrl,
      purchaseUrl: listing.purchaseUrl || listing.sourceProductUrl,
      originalPrice: roundMoney(listing.originalPrice),
      originalCurrency: listing.originalCurrency,
      salePrice:
        listing.salePrice !== null ? roundMoney(listing.salePrice) : null,
      normalizedEur,
      availability: listing.availability,
      imageUrl: listing.imageUrl,
      isPrimary: false,
    },
  });

  /* ---- persist identity records for cross-source dedup ---- */
  await replaceGtinRecords(db, productId, listing.gtins);
  await replaceMpnRecords(db, productId, canonicalBrandId, listing.mpn);

  /* ---- persist offer-level variation rows (identity preserved) ----
     A multi-variation listing is NEVER flattened: every variation keeps
     its own sku/gtin/color/size/size-system/availability/price/url under
     the offer, keyed on the strongest identity the source gave. Listings
     without a variation dimension simply have no variant rows. */
  if (listing.variants && listing.variants.length > 0) {
    for (const variant of listing.variants) {
      await upsertOfferVariant(db, offer.id, listing, variant, fxRate);
    }
  }

  /* ---- re-resolve primary over ALL offers of this product ---- */
  const offers = await db.productOffer.findMany({
    where: { productId },
    include: { source: true },
  });
  const resolvable = offers.map((row): OfferResolveRow => ({
    offerId: row.id,
    official: row.source.official,
    priority: row.source.priority,
    availability: row.availability,
    normalizedEur: Number(row.normalizedEur),
    updatedAt: row.updatedAt,
  }));
  const primaryId = resolvePrimaryOffer(resolvable);
  const isPrimary = offer.id === primaryId;

  await db.productOffer.updateMany({
    where: { productId },
    data: { isPrimary: false },
  });
  if (primaryId) {
    await db.productOffer.update({
      where: { id: primaryId },
      data: { isPrimary: true },
    });
  }

  /* ---- mirror the primary offer onto the canonical Product ---- */
  if (primaryId) {
    const primary = offers.find((row) => row.id === primaryId);
    if (primary) {
      await db.product.update({
        where: { id: productId },
        data: {
          price: primary.originalPrice,
          currency: primary.originalCurrency,
          productUrl: primary.purchaseUrl,
          imageUrl: primary.imageUrl,
          availability: productAvailabilityOf(
            primary.availability as NormalizedListing["availability"]
          ),
          lastSyncedAt: primary.lastSyncedAt,
        },
      });
    }
  }

  return {
    productId,
    offerId: offer.id,
    action,
    isPrimary,
    createdProduct: action === "created",
  };
}

/* Upsert one offer-level variation row. variantKeys derive from the
   STRONGEST identity (sku > variant gtin > source variant id >
   color+size), so re-syncs merge onto the same row. A variant with no
   expressible identity would flatten list-level; that case stays at
   the offer (no row) rather than fabricate a key. */
async function upsertOfferVariant(
  db: PrismaClient,
  offerId: string,
  listing: NormalizedListing,
  variant: NormalizedVariant,
  fxRate?: number | null
): Promise<void> {
  const key = variantKeyFor(variant);
  if (!key) return;

  const price = roundMoney(variant.price);
  const currency = parseCurrency(variant.currency) ?? listing.originalCurrency;
  const normalizedEur = normalizePriceToEurValue(price, currency, fxRate ?? null);
  const now = new Date();

  const data = {
    externalVariantId: cleanString(variant.id),
    sku: cleanString(variant.sku),
    gtin: cleanString(variant.gtin),
    gtinType: cleanString(variant.gtinType),
    color: variant.color ? normalizeColorName(variant.color) : null,
    sizeValue: cleanString(variant.size?.value),
    sizeSystem: cleanString(variant.size?.system),
    sizeProductType: cleanString(variant.size?.productType),
    sizeAudience: cleanString(variant.size?.audience),
    availability: variant.availability as string,
    originalPrice: price,
    originalCurrency: currency,
    salePrice: variant.salePrice !== undefined && variant.salePrice !== null
      ? roundMoney(variant.salePrice)
      : null,
    normalizedEur,
    purchaseUrl: cleanString(variant.purchaseUrl ?? null) ?? listing.purchaseUrl ?? listing.sourceProductUrl,
    priceUpdatedAt: now,
    availabilityUpdatedAt: now,
    lastSyncedAt: now,
  };

  await db.productOfferVariant.upsert({
    where: {
      offerId_variantKey: { offerId, variantKey: key },
    },
    update: data,
    create: { offerId, variantKey: key, ...data },
  });
}

/* null-safe trim helper for optional string columns. */
function cleanString(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/* Freshness policy: offers older than their source's window have their
   availability demoted to UNKNOWN (never deleted, never sold stale as
   fresh). Pure relative to the row; the harness runs it per source. */
export function isOfferStale(row: {
  availabilityUpdatedAt: Date;
  freshnessHours: number | null;
}): boolean {
  const hours = row.freshnessHours ?? 24;
  const ageMs = Date.now() - row.availabilityUpdatedAt.getTime();
  return ageMs > hours * 60 * 60 * 1000;
}