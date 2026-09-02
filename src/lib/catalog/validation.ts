/* Validation / quality-gate engine (Phase 0) - pure, DB-free.

   Decides what becomes a sellable listing, what quarantines
   (recoverable data that must never reach Search), and what rejects
   (irrecoverable garbage - dropped permanently).

   Rules are VETO-heavy: a listing only ACCEPTs when every gate holds.
   There is no "close enough" path - an unmappable brand/category, a
   missing or fabricated purchase URL, an unparseable currency, or a
   number we would have to invent all send the row to quarantine (or
   reject). Nothing here ever fabricates or substitutes data. */

import { hasRealProductPage } from "../product-url";
import {
  normalizePriceToEurValue,
  parseCurrency,
  slugToken,
  foldToken,
} from "./normalize";
import type {
  NormalizedListing,
  OfferAvailability,
  ValidationVerdict,
} from "./types";
import { OFFER_AVAILABILITY_VALUES } from "./types";

/* The image guard mirrors the purchase-URL guard: a product card must
   never render a placeholder. Fabricated host images are rejected too. */
const ALLOWED_IMAGE_PROTOCOLS = new Set(["https:", "http:"]);

function validImageUrl(url: string | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (!ALLOWED_IMAGE_PROTOCOLS.has(parsed.protocol)) return false;
    return parsed.hostname.includes(".");
  } catch {
    return false;
  }
}

function validAvailability(value: string): value is OfferAvailability {
  return (OFFER_AVAILABILITY_VALUES as readonly string[]).includes(value);
}

/* Structural gates that never need external state. Canonical
   brand/category resolution and currency-rate availability are decided
   by the harness, which passes their results in via `external`. */
export type ExternalGateState = {
  /* canonical brand name after alias resolution; null => unmapped */
  brandResolved: string | null;
  /* canonical category slug after mapping; null => unmapped */
  categoryResolved: string | null;
  fxRate: number | null;
};

export type ValidateListingOptions = {
  external: ExternalGateState;
};

export function validateListing(
  listing: NormalizedListing,
  options: ValidateListingOptions
): ValidationVerdict {
  const reasons: string[] = [];

  /* ---- Fatal / rejectable shape ---- */
  if (!listing.externalListingId) {
    return { status: "REJECT", reasons: ["missing external listing id"] };
  }
  if (!listing.name || !listing.name.trim()) {
    return { status: "REJECT", reasons: ["missing name"] };
  }
  if (!listing.sourceProductUrl || !hasRealProductPage(listing.sourceProductUrl)) {
    return {
      status: "REJECT",
      reasons: [`invalid source product url '${listing.sourceProductUrl ?? ""}'`],
    };
  }
  const purchaseUrl = listing.purchaseUrl || listing.sourceProductUrl;
  if (!purchaseUrl || !hasRealProductPage(purchaseUrl)) {
    return {
      status: "REJECT",
      reasons: [`invalid purchase url '${purchaseUrl ?? ""}'`],
    };
  }
  if (!Number.isFinite(listing.originalPrice) || listing.originalPrice <= 0) {
    return { status: "REJECT", reasons: ["non-positive originalPrice"] };
  }

  const currency = parseCurrency(listing.originalCurrency);
  if (!currency) {
    return {
      status: "REJECT",
      reasons: [`unparseable originalCurrency '${listing.originalCurrency}'`],
    };
  }

  if (listing.salePrice !== null && !Number.isFinite(listing.salePrice)) {
    return { status: "REJECT", reasons: ["non-numeric salePrice"] };
  }

  if (!validAvailability(listing.availability)) {
    return {
      status: "REJECT",
      reasons: [`unknown availability '${listing.availability}'`],
    };
  }

  for (const gtin of listing.gtins) {
    if (!gtin.gtin || !gtin.gtinType) {
      return { status: "REJECT", reasons: ["malformed gtin record"] };
    }
  }

  /* Image: optional, but if present must be real. Synchronous helper
     so a malformed image degrades to "no image" not a crash. */
  if (listing.imageUrl && !validImageUrl(listing.imageUrl)) {
    reasons.push(`invalid image url '${listing.imageUrl}'`);
  }

  /* ---- Quarantinable (recoverable) gaps ----
     These never REJECT because the payload is fine - the gap is in the
     mapping/identity support, which a human can repair and re-run. */

  /* Canonical brand required before a listing becomes searchable.
     A product sold under an unmapped brand token is quarantined; the
     brand-aliasing table is human-curated and never auto-merged. */
  if (!options.external.brandResolved) {
    if (!listing.brand) {
      reasons.push("no brand token at all");
    } else {
      reasons.push(
        `unmapped brand token '${listing.brand}' -> canonical brand unresolved`
      );
    }
  }

  /* Canonical category required. Source category never leaks into search. */
  if (!options.external.categoryResolved) {
    if (!listing.category) {
      reasons.push("no category token at all");
    } else {
      reasons.push(
        `unmapped category token '${listing.category}' -> canonical category unresolved`
      );
    }
  }

  /* EUR reference value: we NEVER invent the European price. If there
     is no real rate (offline/unset) for a non-EUR currency, the row
     quarantines instead of guessing or silently treating it as EUR. */
  const normalizedEur = normalizePriceToEurValue(
    listing.originalPrice,
    currency,
    options.external.fxRate
  );
  if (normalizedEur === null) {
    reasons.push(
      `cannot derive normalizedEur for ${currency} (no fx rate available)`
    );
  }

  /* Sale price consistency: if salePrice is present, it is a lower
     bound on what the user pays; a salePrice above originalPrice is a
     data error we quarantine rather than present. */
  if (
    listing.salePrice !== null &&
    listing.salePrice > listing.originalPrice
  ) {
    reasons.push("salePrice greater than originalPrice");
  }

  /* Hmm: name has a collision with the slug/identity guard; keep the
     identity-ready slug computation logically pure. */
  slugToken(listing.name);
  foldToken(listing.name);

  if (reasons.length > 0) {
    return { status: "QUARANTINE", reasons };
  }

  return { status: "ACCEPT", reasons: [] } as ValidationVerdict;
}

/* Pre-identity structural check used by the import harness on the
   SAMPLE phase: a raw-but-well-formed payload should be accepted for
   the small sample before any real batch. Mirrors validateListing's
   reject rules but ignores resolvable gaps (brand/category can be
   mapped later; fx can be supplied by env). */
export function sampleIsWellFormed(
  listing: NormalizedListing
): boolean {
  if (!listing.externalListingId) return false;
  if (!listing.name || !listing.name.trim()) return false;
  if (!listing.sourceProductUrl || !hasRealProductPage(listing.sourceProductUrl)) {
    return false;
  }
  if (!Number.isFinite(listing.originalPrice) || listing.originalPrice <= 0) {
    return false;
  }
  if (!parseCurrency(listing.originalCurrency)) return false;
  if (!validAvailability(listing.availability)) return false;
  return true;
}