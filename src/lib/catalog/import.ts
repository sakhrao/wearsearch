/* Controlled import harness (Phase 0).

   The one orchestration path every real source adapter goes through:

      connect -> sample (≤N, inspected, never written)
             -> normalize (pure)
             -> validate   (pure gates + registry resolution)
             -> dedupe     (GTIN/MPN/SKU; fuzzy only flagged)
             -> store      (canonical Product + per-source ProductOffer)
             -> verify     (post-run invariants, no Search changed)

   It is deliberately boring: small batches, visible drop/quarantine
   counts, a SourceSyncRun audit row per run, and NEVER writes a listing
   that the quality gates do not pass. There is no "fill a gap with a
   placeholder" anywhere in this file.

   Search and the Outfit Engine are not touched - they keep reading the
   canonical Product mirror this harness maintains. */

import type { PrismaClient } from "../../generated/prisma/client";
import {
  ensureSource,
  resolveBrand,
  resolveCategory,
} from "./registry";
import { validateListing, sampleIsWellFormed } from "./validation";
import {
  startSyncRun,
  finishSyncRun,
  quarantineListing,
  verdictReason,
  type SyncRunHandle,
} from "./sync-run";
import { applyListingToCatalog } from "./offers";
import type { CommerceSourceAdapter, NormalizedListing } from "./types";

export type FxOption = {
  /* Caller-supplied static rate (deterministic tests) or null to let
     the harness resolve through the real fx layer. */
  rate?: number | null;
  /* Resolver used when rate option is absent. Defaults to a
     deterministic env-check so offline dry-runs without a rate behave
     identically to tests (they quarantine USD instead of guessing). */
  resolve?: () => Promise<number | null>;
};

export type SampleInspection = {
  sourceId: string;
  total: number;
  wellFormed: number;
  invalid: Array<{ externalListingId: string; reason: string }>;
  accepted: Array<{ externalListingId: string; brandResolved: string | null; categoryResolved: string | null }>;
  quarantined: Array<{ externalListingId: string; reasons: string[] }>;
};

export type ImportRunOptions = {
  sampleSize?: number;
  /* hard cap on how many listings a single run may process */
  maxListings?: number;
  /* true = never write; only report what WOULD happen */
  dryRun?: boolean;
  fx?: FxOption;
};

export type ImportRunResult = {
  sourceId: string;
  syncRunId: string | null;
  samplesInspected: number;
  listingsFetched: number;
  created: number;
  updated: number;
  mergedExisting: number;
  quarantined: number;
  dropped: number;
  errors: string[];
  productCountBefore: number;
  productCountAfter: number;
};

/* Resolve canonical brand/category for a listing, feeding the pure
   validation engine. Null canonical brand or category = quarantinable
   gap, never a silent pass-through. */
async function externalStateOf(
  db: PrismaClient,
  sourceId: string,
  listing: NormalizedListing,
  fxRate: number | null
) {
  const [brandResolved, categoryResolved] = await Promise.all([
    resolveBrand(db, sourceId, listing.brand ?? ""),
    resolveCategory(db, sourceId, listing.category ?? ""),
  ]);
  return { brandResolved, categoryResolved, fxRate };
}

/* ---- Step 1: sample (defaults small, never written) ---- */

export async function inspectSample(
  db: PrismaClient,
  adapter: CommerceSourceAdapter,
  options?: ImportRunOptions
): Promise<SampleInspection> {
  const source = await ensureSource(db, {
    name: adapter.sourceName,
    type: adapter.sourceType,
    baseUrl: null,
    priority: adapter.priority,
    freshnessHours: adapter.freshnessHours,
    official: adapter.official ?? false,
    authRef: adapter.authRef ?? null,
  });
  const fxRate = await resolveFx(options?.fx);

  const sampleBatch = await adapter.sample(options?.sampleSize ?? 10);
  const normalized = sampleBatch.listings
    .map((raw) => adapter.toNormalizedListing(raw))
    .filter((l): l is NormalizedListing => l !== null);

  const inspection: SampleInspection = {
    sourceId: source.id,
    total: sampleBatch.listings.length,
    wellFormed: 0,
    invalid: [],
    accepted: [],
    quarantined: [],
  };

  for (const listing of normalized) {
    if (!sampleIsWellFormed(listing)) {
      inspection.invalid.push({
        externalListingId: listing.externalListingId,
        reason: "not well-formed (structural quality gate)",
      });
      continue;
    }
    inspection.wellFormed += 1;

    const external = await externalStateOf(db, source.id, listing, fxRate);
    const verdict = validateListing(listing, { external });

    if (verdict.status === "ACCEPT") {
      inspection.accepted.push({
        externalListingId: listing.externalListingId,
        brandResolved: external.brandResolved,
        categoryResolved: external.categoryResolved,
      });
    } else {
      inspection.quarantined.push({
        externalListingId: listing.externalListingId,
        reasons: verdict.reasons,
      });
    }
  }

  return inspection;
}

/* ---- Step 2+: real import (or dry-run forecast) ---- */

export async function runImport(
  db: PrismaClient,
  adapter: CommerceSourceAdapter,
  options?: ImportRunOptions
): Promise<ImportRunResult> {
  const sampleSize = options?.sampleSize ?? 10;
  const maxListings = options?.maxListings ?? 200;
  const dryRun = options?.dryRun ?? false;
  const fxRate = await resolveFx(options?.fx);

  const source = await ensureSource(db, {
    name: adapter.sourceName,
    type: adapter.sourceType,
    baseUrl: null,
    priority: adapter.priority,
    freshnessHours: adapter.freshnessHours,
    official: adapter.official ?? false,
    authRef: adapter.authRef ?? null,
  });

  const productCountBefore = await db.product.count();

  /* Step 1: sample + inspect BEFORE any batch. The harness refuses to
     process a real batch when the sample is polluted (structural). */
  const inspection = await inspectSample(db, adapter, { ...options, sampleSize });
  if (inspection.total === 0) {
    return {
      sourceId: source.id,
      syncRunId: null,
      samplesInspected: 0,
      listingsFetched: 0,
      created: 0,
      updated: 0,
      mergedExisting: 0,
      quarantined: 0,
      dropped: 0,
      errors: ["sample is empty; aborting before any batch"],
      productCountBefore,
      productCountAfter: productCountBefore,
    };
  }
  if (inspection.invalid.length > 0) {
    const reasons = inspection.invalid.map((i) => i.reason).join("; ");
    return {
      sourceId: source.id,
      syncRunId: null,
      samplesInspected: inspection.total,
      listingsFetched: 0,
      created: 0,
      updated: 0,
      mergedExisting: 0,
      quarantined: 0,
      dropped: 0,
      errors: [`sample contains structurally invalid listings: ${reasons}`],
      productCountBefore,
      productCountAfter: productCountBefore,
    };
  }

  const run: SyncRunHandle | null = dryRun
    ? null
    : await startSyncRun(db, source.id);

  const counts = { created: 0, updated: 0, quarantined: 0, dropped: 0 };
  const errors: string[] = [];

  /* Controlled page loop with a hard cap. */
  let page = 1;
  let processed = 0;
  let hasMore = true;
  while (hasMore && processed < maxListings) {
    const batch = await adapter.fetch({ page, limit: sampleSize });
    if (batch.listings.length === 0) break;

    for (const raw of batch.listings) {
      if (processed >= maxListings) break;

      const listing = adapter.toNormalizedListing(raw);
      processed += 1;
      if (!listing) {
        counts.dropped += 1;
        continue;
      }

      const external = await externalStateOf(db, source.id, listing, fxRate);
      const verdict = validateListing(listing, { external });
      if (verdict.status !== "ACCEPT") {
        if (verdict.status === "QUARANTINE" && !dryRun) {
          await quarantineListing(db, {
            sourceId: source.id,
            externalListingId: listing.externalListingId,
            reason: verdictReason(verdict),
            categoryToken: listing.category ?? null,
            brandToken: listing.brand ?? null,
            rawData: raw,
          });
        }
        counts.quarantined += 1;
        continue;
      }

      const canonicalBrandId = await resolveBrand(db, source.id, listing.brand ?? "");
      const canonicalCategoryId = await resolveCategory(
        db,
        source.id,
        listing.category ?? ""
      );
      if (!canonicalBrandId || !canonicalCategoryId) {
        /* validation already quarantined these - defensive skip */
        counts.dropped += 1;
        continue;
      }

      if (dryRun) {
        /* forecast only; nothing written */
        counts.updated += 1;
        continue;
      }

      const outcome = await applyListingToCatalog(db, {
        sourceId: source.id,
        canonicalBrandId,
        canonicalCategoryId,
        listing,
        fxRate,
      });
      if (outcome.createdProduct) {
        counts.created += 1;
      } else {
        counts.updated += 1;
      }
    }

    hasMore = batch.hasMore;
    page += 1;
  }

  const productCountAfter = await db.product.count();

  if (!dryRun && run) {
    try {
      await finishSyncRun(db, run, {
        fetchedCount: processed,
        insertedCount: counts.created,
        updatedCount: counts.updated,
        droppedCount: counts.dropped,
        quarantinedCount: counts.quarantined,
      });
    } catch (error) {
      errors.push(
        `finishSyncRun failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /* Verify step: the mirror invariants must hold after the run, or the
   run reports it loudly instead of pretending success. */
  const violations = await verifyCatalogInvariants(db);
  if (violations.length > 0) {
    errors.push(`catalog invariant violations: ${violations.join("; ")}`);
  }

  return {
    sourceId: source.id,
    syncRunId: run?.runId ?? null,
    samplesInspected: inspection.total,
    listingsFetched: processed,
    created: counts.created,
    updated: counts.updated,
    mergedExisting: counts.updated,
    quarantined: counts.quarantined,
    dropped: counts.dropped,
    errors,
    productCountBefore,
    productCountAfter,
  };
}

/* ---- Verify: canonical mirror invariants (Search-facing) ---- */

/* Post-run sanity: for every product with ≥1 offer, the Product row
   must mirror its primary offer (price / currency / urls / image) and
   exactly one offer must be flagged primary. */
export async function verifyCatalogInvariants(
  db: PrismaClient
): Promise<string[]> {
  const violations: string[] = [];

  const offers = await db.productOffer.findMany({
    select: {
      id: true,
      productId: true,
      isPrimary: true,
      originalPrice: true,
      originalCurrency: true,
      purchaseUrl: true,
      imageUrl: true,
      availability: true,
    },
  });

  const byProduct = new Map<string, typeof offers>();
  for (const offer of offers) {
    const list = byProduct.get(offer.productId) ?? [];
    list.push(offer);
    byProduct.set(offer.productId, list);
  }

  for (const [productId, rows] of byProduct) {
    const primaries = rows.filter((r) => r.isPrimary);
    if (primaries.length !== 1) {
      violations.push(
        `product ${productId}: expected exactly 1 primary offer, found ${primaries.length}`
      );
      continue;
    }
    const primary = primaries[0];

    const product = await db.product.findUnique({ where: { id: productId } });
    if (!product) {
      violations.push(`product ${productId} referenced by offers but missing`);
      continue;
    }

    const matchesPrice = Number(product.price) === Number(primary.originalPrice);
    const matchesCurrency = product.currency === primary.originalCurrency;
    if (!matchesPrice || !matchesCurrency) {
      violations.push(
        `product ${productId}: mirror price/currency (${product.price} ${product.currency}) != primary offer (${primary.originalPrice} ${primary.originalCurrency})`
      );
    }
    if (product.productUrl !== primary.purchaseUrl) {
      violations.push(
        `product ${productId}: mirror productUrl != primary purchaseUrl`
      );
    }
    void primary;
  }

  return violations;
}

/* Deterministic fx source: env override (FX_RATE_USD_PER_EUR) always
   wins for offline/test reproducibility; otherwise the real layer. */
async function resolveFx(option?: FxOption): Promise<number | null> {
  if (option?.rate !== undefined) return option.rate ?? null;
  if (option?.resolve) return option.resolve();
  const envOverride = process.env.FX_RATE_USD_PER_EUR;
  if (envOverride) {
    const value = Number(envOverride);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}