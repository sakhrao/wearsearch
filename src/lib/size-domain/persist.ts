/* Stage E — canonical size persistence contract + deterministic backfill
   planner.

   This module is pure, Prisma-free, DB-free and network-free. It defines
   the exact four persisted canonical fields and maps a Stage D
   `CanonicalSizeProjection` onto them. The backfill is split in two:

     planSizeBackfill()  — pure, deterministic, idempotent planning
     the DB runner       — applies the returned changes (opt-in `--apply`)

   Persistence rules:
     - source data is never touched (the legacy label stays authoritative);
     - resolved rows persist the existing wire identity as THE canonical id;
     - unresolved rows persist `null` canonical id + `UNRESOLVED`;
     - a write never downgrades better provenance (§13 of the Stage E spec). */

import type { NormalizationStatus } from "./normalization-types";
import type {
  CanonicalSizeProjection,
  SystemResolutionProvenance,
} from "./system-resolution";

/* ==== 1. Persisted field contract ==== */

export const SIZE_RESOLUTION_STATUSES: readonly NormalizationStatus[] = [
  "RESOLVED",
  "UNRESOLVED",
];

export const SIZE_RESOLUTION_PROVENANCES: readonly SystemResolutionProvenance[] =
  ["EXPLICIT", "INFERRED", "UNRESOLVED"];

export type SizeResolutionStatus = NormalizationStatus;

/* The exact columns added additively to ProductVariant and
   ProductOfferVariant. All four are nullable; `null` across all four
   means "not yet backfilled" (a legacy row). */
export type SizeCanonicalFields = {
  canonicalSizeOptionId: string | null;
  sizeResolutionStatus: string | null;
  sizeResolutionProvenance: string | null;
  sizeResolutionSystem: string | null;
};

export function isSizeResolutionStatus(
  value: string | null | undefined
): value is SizeResolutionStatus {
  return value === "RESOLVED" || value === "UNRESOLVED";
}

export function isSystemResolutionProvenance(
  value: string | null | undefined
): value is SystemResolutionProvenance {
  return (
    value === "EXPLICIT" || value === "INFERRED" || value === "UNRESOLVED"
  );
}

/* The persisted identity is the Stage A/B wire id; no second identity
   column exists. The system is a stored component, kept separate because
   it can be known while the id is null and because non-persisted systems
   cannot live in the SizeSystem enum. */
export function canonicalFieldsFromProjection(
  projection: CanonicalSizeProjection
): SizeCanonicalFields {
  const resolved = projection.status === "RESOLVED";
  return {
    canonicalSizeOptionId: resolved
      ? projection.canonicalSizeOptionId
      : null,
    sizeResolutionStatus: projection.status,
    sizeResolutionProvenance: projection.systemResolution,
    sizeResolutionSystem: projection.system ?? null,
  };
}

/* ==== 2. Provenance ranking (§13 never downgrade) ==== */

const PROVENANCE_RANK: Record<SystemResolutionProvenance, number> = {
  EXPLICIT: 3,
  INFERRED: 2,
  UNRESOLVED: 1,
};

function provenanceRank(fields: SizeCanonicalFields): number {
  if (
    fields.sizeResolutionStatus == null &&
    fields.sizeResolutionProvenance == null
  ) {
    return 0; // not yet backfilled
  }
  if (isSystemResolutionProvenance(fields.sizeResolutionProvenance)) {
    return PROVENANCE_RANK[fields.sizeResolutionProvenance];
  }
  return fields.sizeResolutionStatus === "RESOLVED" ? 2 : 1;
}

export function isBackfilled(fields: SizeCanonicalFields): boolean {
  return fields.sizeResolutionStatus != null;
}

export function isDowngrade(
  existing: SizeCanonicalFields,
  next: SizeCanonicalFields
): boolean {
  return provenanceRank(next) < provenanceRank(existing);
}

export function sameCanonicalFields(
  a: SizeCanonicalFields,
  b: SizeCanonicalFields
): boolean {
  return (
    a.canonicalSizeOptionId === b.canonicalSizeOptionId &&
    a.sizeResolutionStatus === b.sizeResolutionStatus &&
    a.sizeResolutionProvenance === b.sizeResolutionProvenance &&
    a.sizeResolutionSystem === b.sizeResolutionSystem
  );
}

/* ==== 3. Backfill planning ==== */

export type SizePersistenceTarget =
  | { kind: "variant"; variantId: string }
  | { kind: "offerVariant"; offerId: string; variantKey: string };

export function sizePersistenceTargetKey(
  target: SizePersistenceTarget
): string {
  return target.kind === "variant"
    ? `variant:${target.variantId}`
    : `offerVariant:${target.offerId}::${target.variantKey}`;
}

export type SizePersistenceEntry = {
  target: SizePersistenceTarget;
  /* What is currently stored. All null means "not backfilled". */
  existing: SizeCanonicalFields;
  projection: CanonicalSizeProjection;
};

export type SizePersistenceChange = {
  target: SizePersistenceTarget;
  fields: SizeCanonicalFields;
};

export type SizeBackfillReport = {
  total: number;
  resolved: number;
  inferred: number;
  unresolved: number;
  /* Resolved rows carrying a canonical identity. */
  withCanonicalIdentity: number;
  /* Unresolved rows (identity must be null). */
  withoutCanonicalIdentity: number;
  changed: number;
  unchanged: number;
  /* Writes skipped because they would lower provenance (§13). */
  downgradesPrevented: number;
  byStatus: Record<string, number>;
  byProvenance: Record<string, number>;
  bySystem: Record<string, number>;
};

function bump(bucket: Record<string, number>, key: string): void {
  bucket[key] = (bucket[key] ?? 0) + 1;
}

/* Deterministic: entries are processed in input order and the same
   (data, policy, registry) always yields the same changes. Running the
   result twice produces zero changes the second time. */
export function planSizeBackfill(
  entries: readonly SizePersistenceEntry[]
): { changes: SizePersistenceChange[]; report: SizeBackfillReport } {
  const changes: SizePersistenceChange[] = [];
  const report: SizeBackfillReport = {
    total: 0,
    resolved: 0,
    inferred: 0,
    unresolved: 0,
    withCanonicalIdentity: 0,
    withoutCanonicalIdentity: 0,
    changed: 0,
    unchanged: 0,
    downgradesPrevented: 0,
    byStatus: {},
    byProvenance: {},
    bySystem: {},
  };

  for (const entry of entries) {
    const next = canonicalFieldsFromProjection(entry.projection);
    report.total += 1;
    if (next.sizeResolutionStatus === "RESOLVED") report.resolved += 1;
    else report.unresolved += 1;
    if (next.sizeResolutionProvenance === "INFERRED") report.inferred += 1;
    if (next.canonicalSizeOptionId != null) report.withCanonicalIdentity += 1;
    else report.withoutCanonicalIdentity += 1;
    bump(report.byStatus, next.sizeResolutionStatus ?? "NOT_BACKFILLED");
    bump(report.byProvenance, next.sizeResolutionProvenance ?? "NONE");
    bump(report.bySystem, next.sizeResolutionSystem ?? "NONE");

    if (!isBackfilled(entry.existing)) {
      changes.push({ target: entry.target, fields: next });
      report.changed += 1;
      continue;
    }
    if (isDowngrade(entry.existing, next)) {
      report.downgradesPrevented += 1;
      continue;
    }
    if (sameCanonicalFields(entry.existing, next)) {
      report.unchanged += 1;
      continue;
    }
    changes.push({ target: entry.target, fields: next });
    report.changed += 1;
  }

  return { changes, report };
}

/* ==== 4. Backward-compatible read fallback (§10) ==== */

export type PersistedSizeReadInput = {
  canonical?: SizeCanonicalFields | null;
  legacy: {
    /* Size.value / ProductOfferVariant.sizeValue — never mutated. */
    sourceSizeLabel: string | null;
    /* Size.system (enum string) / ProductOfferVariant.sizeSystem. */
    legacySystem?: string | null;
  };
};

export type PersistedSizeView = {
  sourceSizeLabel: string | null;
  canonicalSizeOptionId: string | null;
  system: string | null;
  status: SizeResolutionStatus | null;
  provenance: SystemResolutionProvenance | null;
  usedLegacyFallback: boolean;
};

/* If the row has been backfilled, expose the canonical representation;
   otherwise fall back to the untouched legacy fields. Callers never
   need to re-implement this branch. */
export function readCanonicalOrLegacySize(
  input: PersistedSizeReadInput
): PersistedSizeView {
  const sourceSizeLabel = input.legacy.sourceSizeLabel ?? null;
  const canonical = input.canonical ?? null;

  if (canonical != null && isSizeResolutionStatus(canonical.sizeResolutionStatus)) {
    return {
      sourceSizeLabel,
      canonicalSizeOptionId: canonical.canonicalSizeOptionId ?? null,
      system: canonical.sizeResolutionSystem ?? null,
      status: canonical.sizeResolutionStatus,
      provenance: isSystemResolutionProvenance(
        canonical.sizeResolutionProvenance
      )
        ? canonical.sizeResolutionProvenance
        : null,
      usedLegacyFallback: false,
    };
  }

  return {
    sourceSizeLabel,
    canonicalSizeOptionId: null,
    system: input.legacy.legacySystem ?? null,
    status: null,
    provenance: null,
    usedLegacyFallback: true,
  };
}
