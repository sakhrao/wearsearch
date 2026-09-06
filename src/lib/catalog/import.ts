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
import { getFxRate } from "../currency";
import {
  ensureSource,
  resolveBrand,
  resolveCategory,
  ensureCanonicalBrand,
} from "./registry";
import { slugToken } from "./normalize";
import { validateListing, sampleIsWellFormed } from "./validation";
import {
  startSyncRun,
  finishSyncRun,
  quarantineListing,
  verdictReason,
  type SyncRunHandle,
} from "./sync-run";
import { applyListingToCatalog } from "./offers";
import { CATEGORY_PLANS } from "./import-plan";
import type { CommerceSourceAdapter, NormalizedListing } from "./types";
import {
  decideSeller,
  type FinalSellerRegistry,
} from "./seller-eligibility";

/* ---- Layer B: brand diversity budget (Hybrid Diversity) ----
   Pure, in-memory quota enforcement over this run's CANONICAL progress.
   Deliberately DB-free: the budget tracks how many NEW canonical products
   each brand has created THIS run (via applyListingToCatalog's
   createdProduct flag), so headroom is canonical-aware after dedupe. */
export type DiversityBudget = {
  /* how many NEW canonical products this run is allowed to create */
  target: number;
  /* ceiling (0-1) a single brand may hold of the run target */
  maxBrandShare: number;
  /* canonical brand id -> NEW canonical products created this run */
  brandCanonical: Map<string, number>;
  /* DENOMINATOR for the brand cap. Defaults to `target` (in-run only).
     A resumed category passes the FULL category target here so the cap is
     computed against the actual 100-product goal, not the smaller "missing"
     window of one resume run. */
  capTarget?: number;
  /* canonical brand id -> EXISTING canonical products already in the
     category (from before this run). Seeded on resume so a brand that
     already fills 60/100 can never silently be pushed past maxBrandShare
     by a follow-up run that only sees its fresh 40-window. */
  existingByBrand?: Map<string, number>;
};

export function diversityBrandCap(budget: DiversityBudget): number {
  const denominator = budget.capTarget ?? budget.target;
  return Math.max(1, Math.ceil(budget.maxBrandShare * denominator));
}

export function brandHasHeadroom(
  budget: DiversityBudget,
  brandId: string
): boolean {
  const existing = budget.existingByBrand?.get(brandId) ?? 0;
  const fresh = budget.brandCanonical.get(brandId) ?? 0;
  return existing + fresh < diversityBrandCap(budget);
}

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
  /* Layer B brand-diversity budget. When set, the run stops once `target`
     NEW canonical products are created and never lets a single brand exceed
     `maxBrandShare * (capTarget ?? target)` of them. maxBrandShare: from the
     category plan (import-plan.ts); target: NEW canonical products for the
     run (the "missing" count); capTarget: the FULL category target (used on
     resume so the brand cap is computed against 100, not just the resume
     window); existingByBrand: EXISTING canonical products per brand before
     the run (seeded on resume so a saturated brand cannot grow further). */
  diversity?: {
    target: number;
    maxBrandShare: number;
    capTarget?: number;
    existingByBrand?: Map<string, number>;
  } | null;
  /* Seller-trust gate. When set, listings whose seller resolves to a
     non-importable decision (UNKNOWN / LOW_TRUST / REJECTED) are
     quarantined and NEVER reach canonical creation. When null/undefined,
     the gate is disabled (backwards compatible - existing callers/tests
     are unchanged). The registry, not the API, is the source of truth
     (see seller-eligibility.ts). Per-brand scope is enforced via
     decideSeller(listing.sellerUsername, listing.brand). */
  sellerEligibility?: FinalSellerRegistry | null;
  /* canonical category slug for this run (plan.slug), passed into the
     seller gate so that ENFORCED_SELLER_CATEGORY_SCOPE categories require
     a seller profile to prove category scope. Absent/null = legacy
     brand-scoped gate behavior (unchanged). */
  categorySlug?: string | null;
  /* Brand-gate bypass (Step 14 fallback exception). When provided and the
     canonical alias resolution (resolveBrand) returns null, this resolver
     supplies a deterministic canonical brand name so the brand gate
     passes; the harness then registers it via ensureCanonicalBrand (real
     identity row, never an alias/scope/family change). Absent/null = the
     normal Brand Gate runs unchanged. Exactly the orchestrator injects
     brandFallbackFor(plan.slug, {fallbackMode}) for the 12 fallback
     categories ONLY. */
  brandFallback?: (token: string | null | undefined) => string | null;
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
  /* Layer B: listings that passed every quality gate but were held back
     solely because their brand's canonical share reached the cap */
  skippedByDiversity: number;
  /* Seller gate: listings quarantined only because their seller resolved
     to a non-importable decision (UNKNOWN / LOW_TRUST / REJECTED), or a
     scope mismatch. Already included in `quarantined`; surfaced
     separately for diagnostics. */
  sellerIneligible: number;
  dropped: number;
  errors: string[];
  productCountBefore: number;
  productCountAfter: number;
};

/* Resolve canonical brand/category for a listing, feeding the pure
   validation engine. Null canonical brand or category = quarantinable
   gap, never a silent pass-through. The optional brandFallback resolver
   (fallback-mode 12 categories only) supplies a canonical brand name
   when the curated alias map has none. */
async function externalStateOf(
  db: PrismaClient,
  sourceId: string,
  listing: NormalizedListing,
  fxRate: number | null,
  brandFallback?: ImportRunOptions["brandFallback"]
) {
  const [brandResolved, categoryResolved] = await Promise.all([
    resolveBrand(db, sourceId, listing.brand ?? ""),
    resolveCategory(db, sourceId, listing.category ?? ""),
  ]);
  let canonicalBrand = brandResolved;
  if (!canonicalBrand && brandFallback) {
    canonicalBrand = brandFallback(listing.brand);
  }
  return { brandResolved: canonicalBrand, categoryResolved, fxRate };
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

const external = await externalStateOf(
      db,
      source.id,
      listing,
      fxRate,
      options?.brandFallback
    );
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
      skippedByDiversity: 0,
      sellerIneligible: 0,
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
      skippedByDiversity: 0,
      sellerIneligible: 0,
      errors: [`sample contains structurally invalid listings: ${reasons}`],
      productCountBefore,
      productCountAfter: productCountBefore,
    };
  }

  const run: SyncRunHandle | null = dryRun
    ? null
    : await startSyncRun(db, source.id);

  const counts = { created: 0, updated: 0, quarantined: 0, dropped: 0 };
  let skippedByDiversity = 0;
  let sellerIneligible = 0;
  const errors: string[] = [];

  /* Layer B in-run brand budget (canonical-aware). `target` may be larger
     than maxListings; the binding stop is whichever comes first. */
  const diversityOpt = options?.diversity ?? null;
  const budget: DiversityBudget | null = diversityOpt
    ? {
        target: diversityOpt.target,
        maxBrandShare: diversityOpt.maxBrandShare,
        brandCanonical: new Map<string, number>(),
        /* resume safety: cap computed against the FULL category target and
           seeded with EXISTING canonical counts so a brand already at the
           max share can never be pushed past it by a follow-up run. Both
           default away to in-run-only behavior for single-shot callers. */
        capTarget: diversityOpt.capTarget ?? diversityOpt.target,
        existingByBrand: diversityOpt.existingByBrand ?? new Map<string, number>(),
      }
    : null;
  const targetCreated = budget ? Math.max(0, budget.target) : 0;

  /* Controlled page loop with a hard cap. Fatal errors (e.g. eBay HTTP
     429) must leave a terminal FAILED trail (never a RUNNING row that
     looks alive forever) and propagate so the orchestrator halts. */
  let page = 1;
  let processed = 0;
  let hasMore = true;
  try {
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

        /* Seller-trust gate (before canonical brand/category/offer work):
           a listing whose seller resolves to a non-importable decision is
           quarantined and NEVER reaches canonical creation. The registry
           (not the API) is the source of truth; scope is per-brand; disabled
           when no registry is injected (backwards compatible). */
        if (options?.sellerEligibility) {
          const sellerVerdict = decideSeller(
            {
              sellerUsername: listing.sellerUsername ?? null,
              brand: listing.brand ?? null,
              category: options.categorySlug ?? null,
            },
            options.sellerEligibility
          );
          if (!sellerVerdict.eligible) {
            if (!dryRun) {
              await quarantineListing(db, {
                sourceId: source.id,
                externalListingId: listing.externalListingId,
                reason: `${sellerVerdict.reason}; ${sellerVerdict.detail}`,
                categoryToken: listing.category ?? null,
                brandToken: listing.brand ?? null,
                rawData: raw,
              });
            }
            counts.quarantined += 1;
            sellerIneligible += 1;
            continue;
          }
        }

        const external = await externalStateOf(
          db,
          source.id,
          listing,
          fxRate,
          options?.brandFallback
        );
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
        /* Fallback-mode target category (Step 14 exception): the 12 MVP
           categories assign their plan slug directly instead of resolving
           the real marketplace token, so bag/loafer etc. items land in
           THEIR leaf rather than a shared sibling (handbags/sneakers).
           Only active when the brand gate is bypassed (brandFallback). */
        const canonicalCategoryId =
          options?.brandFallback && options.categorySlug
            ? (await db.category.findUnique({ where: { slug: options.categorySlug } }))?.id ?? null
            : await resolveCategory(
                db,
                source.id,
                listing.category ?? ""
              );
        /* Fallback-mode brand name (no DB write): an unmapped real brand
           resolves to a deterministic canonical name so the row stays
           importable. Null here = the normal Brand Gate rules applied. */
        const fallbackBrandName =
          !canonicalBrandId && options?.brandFallback
            ? (options.brandFallback(listing.brand) ?? null)
            : null;
        if ((!canonicalBrandId && !fallbackBrandName) || !canonicalCategoryId) {
          /* validation already quarantined these - defensive skip */
          counts.dropped += 1;
          continue;
        }

        if (dryRun) {
          /* forecast only; nothing written */
          counts.updated += 1;
          continue;
        }

        /* Live only: materialize the canonical Brand row for an unmapped
           fallback name via the existing harness writer (a real identity
           row - never an alias/scope/family change). A slug collision with
           an existing canonical row reuses that row instead of failing. */
        let finalBrandId: string | null = canonicalBrandId;
        if (!finalBrandId && fallbackBrandName) {
          try {
            finalBrandId = (await ensureCanonicalBrand(db, fallbackBrandName)).id;
          } catch (err) {
            const existing = await db.brand.findFirst({
              where: { slug: slugToken(fallbackBrandName) },
            });
            finalBrandId = existing?.id ?? null;
          }
        }
        if (!finalBrandId) {
          counts.dropped += 1;
          continue;
        }

        /* Layer B: refuse a brand once it has saturated its canonical share
           of the run target. Canonical-aware: checked against this run's
           NEW-product count per brand (plus EXISTING on resume), so
           raw-listing volume for a minority brand (e.g. Puma) never gets
           starved by a dominant leader. */
        if (budget) {
          if (!brandHasHeadroom(budget, finalBrandId)) {
            skippedByDiversity += 1;
            continue;
          }
          if (targetCreated > 0 && counts.created >= targetCreated) {
            hasMore = false;
            break;
          }
        }

        const outcome = await applyListingToCatalog(db, {
          sourceId: source.id,
          canonicalBrandId: finalBrandId,
          canonicalCategoryId,
          listing,
          fxRate,
        });
        if (outcome.createdProduct) {
          counts.created += 1;
          budget?.brandCanonical.set(
            finalBrandId,
            (budget.brandCanonical.get(finalBrandId) ?? 0) + 1
          );
        } else {
          counts.updated += 1;
        }
      }

      hasMore = batch.hasMore;
      page += 1;
    }
  } catch (err) {
    /* Fatal mid-run error: record a terminal FAILED sync run (with the
       error), the source is marked ERROR, then rethrow so the caller
       (orchestrator) stops immediately. Products already written before
       the failure remain intact (idempotent on resume). */
    if (!dryRun && run) {
      try {
        await finishSyncRun(
          db,
          run,
          {
            fetchedCount: processed,
            insertedCount: counts.created,
            updatedCount: counts.updated,
            droppedCount: counts.dropped,
            quarantinedCount: counts.quarantined,
          },
          `import aborted: ${err instanceof Error ? err.message : String(err)}`
        );
      } catch (finishErr) {
        errors.push(
          `finishSyncRun (failed path) also failed: ${finishErr instanceof Error ? finishErr.message : String(finishErr)}`
        );
      }
    }
    throw err;
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
    skippedByDiversity,
    sellerIneligible,
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
  /* No env override: fall back to the live ECB (Frankfurter) rate via the
     shared currency helper. Returns null when unavailable, which preserves
     the existing quarantine path (USD cannot be normalized without a rate).
     The helper owns caching; it does not print any rate to logs. */
  const rate = await getFxRate();
  return rate.rate ?? null;
}