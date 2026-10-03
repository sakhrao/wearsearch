/* Stage F — canonical read path + size-system filtering contract.

   Two guarantees this module establishes, and nothing else:

     A. A SINGLE canonical read path. `readCanonicalSize()` is the only
        place that decides whether a size row is canonically resolved,
        unresolved, or not-yet-backfilled. It wraps Stage E's
        `readCanonicalOrLegacySize()` and classifies the three states that
        must never collapse into each other:

          RESOLVED       — backfilled, canonical identity present
          UNRESOLVED     — backfilled, processed, no canonical identity
          NOT_BACKFILLED — legacy row, canonical columns all null

     B. VARIANT/OFFER-VARIANT-GRAIN filtering over the two Stage E
        columns. Size never lives at Product grain, so a Product query is
        expressed through the relation and reaches the Stage E indexes
        instead of loading the catalog and normalizing in JS.

   Filtering rules:
     - `canonicalSizeOptionId` matches ONLY resolved rows (a null id can
       never satisfy it);
     - `sizeResolutionSystem` matches whenever the stored system equals the
       requested one, EVEN IF the identity is null (system may be known
       without a resolved id);
     - the two predicates compose with AND;
     - an empty filter constrains nothing;
     - availability is an explicit, independent, optional condition; it is
       never merged with resolution and defaults to "do not filter".

   This module is pure for the read/predicate/where layers. The two DB
   helpers import only types, so importing the barrel never loads Prisma at
   runtime. No migration, no write, no UI/search integration. */

import type { Availability, Prisma, PrismaClient } from "../../generated/prisma/client";
import type { SizeResolutionStatus } from "./persist";
import {
  isBackfilled,
  readCanonicalOrLegacySize,
  type PersistedSizeReadInput,
  type PersistedSizeView,
  type SizeCanonicalFields,
} from "./persist";
import type { SystemResolutionProvenance } from "./system-resolution";

/* ==== 1. Read state classification ==== */

export type SizeReadState = "RESOLVED" | "UNRESOLVED" | "NOT_BACKFILLED";

/* The canonical fields of a row may be missing entirely (a projection that
   did not select them) or all-null (a legacy row). Both mean
   NOT_BACKFILLED; only a valid persisted status means processed. */
export function canonicalReadState(
  fields: SizeCanonicalFields | null | undefined
): SizeReadState {
  if (fields == null || !isBackfilled(fields)) {
    return "NOT_BACKFILLED";
  }
  return fields.sizeResolutionStatus === "RESOLVED"
    ? "RESOLVED"
    : "UNRESOLVED";
}

export type CanonicalSizeRead = {
  state: SizeReadState;
  /* The untouched raw source label, when present. Never canonicalized
     away — downstream provenance/source display still needs it. */
  sourceSizeLabel: string | null;
  /* Present only when state === "RESOLVED". */
  canonicalSizeOptionId: string | null;
  /* The resolved system component; can be non-null for UNRESOLVED. For a
     NOT_BACKFILLED row this falls back to the raw legacy system. */
  system: string | null;
  status: SizeResolutionStatus | null;
  provenance: SystemResolutionProvenance | null;
  /* True when the returned view came from the legacy branch. */
  usedLegacyFallback: boolean;
};

function classifyView(view: PersistedSizeView): SizeReadState {
  if (view.usedLegacyFallback) return "NOT_BACKFILLED";
  return view.status === "RESOLVED" ? "RESOLVED" : "UNRESOLVED";
}

/* THE canonical read path (§4). Callers ask this once and never re-branch
   on canonical-vs-legacy themselves. */
export function readCanonicalSize(
  input: PersistedSizeReadInput
): CanonicalSizeRead {
  const view = readCanonicalOrLegacySize(input);
  const state = classifyView(view);
  return {
    state,
    sourceSizeLabel: view.sourceSizeLabel,
    canonicalSizeOptionId:
      state === "RESOLVED" ? view.canonicalSizeOptionId : null,
    system: view.system,
    status: state === "NOT_BACKFILLED" ? null : view.status,
    provenance:
      state === "NOT_BACKFILLED" ? null : view.provenance,
    usedLegacyFallback: view.usedLegacyFallback,
  };
}

export function isResolvedSize(read: CanonicalSizeRead): boolean {
  return read.state === "RESOLVED";
}

export function isUnresolvedSize(read: CanonicalSizeRead): boolean {
  return read.state === "UNRESOLVED";
}

export function isNotBackfilledSize(read: CanonicalSizeRead): boolean {
  return read.state === "NOT_BACKFILLED";
}

/* Convenience identity/system accessors — identical to reading the fields
   above, kept because filtering and display both need them often. */
export function canonicalSizeIdentityOf(
  input: PersistedSizeReadInput
): string | null {
  return readCanonicalSize(input).canonicalSizeOptionId;
}

export function sizeSystemOf(input: PersistedSizeReadInput): string | null {
  return readCanonicalSize(input).system;
}

/* ==== 2. Pure predicates (fixture-testable, no DB) ==== */

export type CanonicalSizeFilter = {
  /* Exact canonical wire identity. Requires the row to be RESOLVED. */
  canonicalSizeOptionId?: string | null;
  /* Stored system component. Matches resolved AND unresolved rows. */
  sizeSystem?: string | null;
};

export function filterByCanonicalSize(
  canonicalSizeOptionId: string
): CanonicalSizeFilter {
  return { canonicalSizeOptionId };
}

export function filterBySizeSystem(sizeSystem: string): CanonicalSizeFilter {
  return { sizeSystem };
}

/* Compose filters with AND. Conflicting values for the same predicate are
   unsatisfiable and are rejected rather than silently ignored. */
export function combineSizeFilters(
  ...filters: readonly CanonicalSizeFilter[]
): CanonicalSizeFilter {
  const combined: CanonicalSizeFilter = {};
  for (const filter of filters) {
    if (
      filter.canonicalSizeOptionId != null &&
      filter.canonicalSizeOptionId !== ""
    ) {
      if (
        combined.canonicalSizeOptionId != null &&
        combined.canonicalSizeOptionId !== filter.canonicalSizeOptionId
      ) {
        throw new Error(
          "combineSizeFilters: conflicting canonicalSizeOptionId predicates"
        );
      }
      combined.canonicalSizeOptionId = filter.canonicalSizeOptionId;
    }
    if (filter.sizeSystem != null && filter.sizeSystem !== "") {
      if (
        combined.sizeSystem != null &&
        combined.sizeSystem !== filter.sizeSystem
      ) {
        throw new Error(
          "combineSizeFilters: conflicting sizeSystem predicates"
        );
      }
      combined.sizeSystem = filter.sizeSystem;
    }
  }
  return combined;
}

export function hasCanonicalSizePredicate(
  filter: CanonicalSizeFilter
): boolean {
  return filter.canonicalSizeOptionId != null &&
    filter.canonicalSizeOptionId !== "";
}

export function hasSizeSystemPredicate(filter: CanonicalSizeFilter): boolean {
  return filter.sizeSystem != null && filter.sizeSystem !== "";
}

export function isEmptySizeFilter(filter: CanonicalSizeFilter): boolean {
  return (
    !hasCanonicalSizePredicate(filter) && !hasSizeSystemPredicate(filter)
  );
}

/* A canonical identity can only be matched by a RESOLVED row — an
   UNRESOLVED or NOT_BACKFILLED row always has a null identity. */
export function matchesCanonicalSize(
  fields: SizeCanonicalFields | null | undefined,
  canonicalSizeOptionId: string
): boolean {
  if (canonicalSizeOptionId == null || canonicalSizeOptionId === "") {
    return false;
  }
  if (canonicalReadState(fields) !== "RESOLVED") return false;
  return fields?.canonicalSizeOptionId === canonicalSizeOptionId;
}

/* The system predicate is deliberately independent of resolution: a row can
   carry a known `sizeResolutionSystem` while its identity is null. */
export function matchesSizeSystem(
  fields: SizeCanonicalFields | null | undefined,
  sizeSystem: string
): boolean {
  if (sizeSystem == null || sizeSystem === "") return false;
  return fields?.sizeResolutionSystem === sizeSystem;
}

export function matchesSizeFilter(
  fields: SizeCanonicalFields | null | undefined,
  filter: CanonicalSizeFilter
): boolean {
  if (
    hasCanonicalSizePredicate(filter) &&
    !matchesCanonicalSize(fields, filter.canonicalSizeOptionId as string)
  ) {
    return false;
  }
  if (
    hasSizeSystemPredicate(filter) &&
    !matchesSizeSystem(fields, filter.sizeSystem as string)
  ) {
    return false;
  }
  return true;
}

/* Project only the persisted canonical columns out of a wider row (a Prisma
   select shape, an offer-variant row, ...). */
export function pickCanonicalFields(row: {
  canonicalSizeOptionId?: string | null;
  sizeResolutionStatus?: string | null;
  sizeResolutionProvenance?: string | null;
  sizeResolutionSystem?: string | null;
}): SizeCanonicalFields {
  return {
    canonicalSizeOptionId: row.canonicalSizeOptionId ?? null,
    sizeResolutionStatus: row.sizeResolutionStatus ?? null,
    sizeResolutionProvenance: row.sizeResolutionProvenance ?? null,
    sizeResolutionSystem: row.sizeResolutionSystem ?? null,
  };
}

/* ==== 3. Prisma where builders (pure, type-only Prisma dependency) ==== */

export type SizeFilterQueryOptions = {
  skip?: number;
  take?: number;
  /* Optional, independent availability condition (§9). Never applied unless
     the caller explicitly asks for it. */
  availability?: string | null;
  /* Also match offer-variant rows (default true). */
  includeOffers?: boolean;
};

type SizeColumnWhere = {
  canonicalSizeOptionId?: string;
  sizeResolutionSystem?: string;
};

function sizeColumnWhere(filter: CanonicalSizeFilter): SizeColumnWhere {
  const where: SizeColumnWhere = {};
  if (hasCanonicalSizePredicate(filter)) {
    where.canonicalSizeOptionId = filter.canonicalSizeOptionId as string;
  }
  if (hasSizeSystemPredicate(filter)) {
    where.sizeResolutionSystem = filter.sizeSystem as string;
  }
  return where;
}

export function sizeFilterToVariantWhere(
  filter: CanonicalSizeFilter,
  options: SizeFilterQueryOptions = {}
): Prisma.ProductVariantWhereInput {
  const where: Prisma.ProductVariantWhereInput = sizeColumnWhere(filter);
  if (options.availability != null && options.availability !== "") {
    where.availability = options.availability as Availability;
  }
  return where;
}

export function sizeFilterToOfferVariantWhere(
  filter: CanonicalSizeFilter,
  options: SizeFilterQueryOptions = {}
): Prisma.ProductOfferVariantWhereInput {
  const where: Prisma.ProductOfferVariantWhereInput = sizeColumnWhere(filter);
  if (options.availability != null && options.availability !== "") {
    where.availability = options.availability;
  }
  return where;
}

/* A Product-grain where clause. Size ownership is variant/offer-variant
   grain, so the relation is traversed; the Stage E indexes on the two
   columns are reached inside the `some` subqueries. An empty filter (no
   predicate, no availability) constrains nothing. */
export function productSizeFilterWhere(
  filter: CanonicalSizeFilter,
  options: SizeFilterQueryOptions = {}
): Prisma.ProductWhereInput {
  const variantWhere = sizeFilterToVariantWhere(filter, options);
  const or: Prisma.ProductWhereInput[] = [{ variants: { some: variantWhere } }];
  if (options.includeOffers !== false) {
    or.push({
      offers: {
        some: { variants: { some: sizeFilterToOfferVariantWhere(filter, options) } },
      },
    });
  }
  return { OR: or };
}

/* ==== 4. DB helpers (index-backed, pagination-safe) ==== */

/* Deterministic order (`id` asc) makes skip/take pagination stable. */
export async function findProductIdsBySizeFilter(
  db: PrismaClient,
  filter: CanonicalSizeFilter,
  options: SizeFilterQueryOptions = {}
): Promise<string[]> {
  const rows = await db.product.findMany({
    where: productSizeFilterWhere(filter, options),
    select: { id: true },
    orderBy: { id: "asc" },
    skip: options.skip,
    take: options.take,
  });
  return rows.map((row) => row.id);
}

export async function countProductsBySizeFilter(
  db: PrismaClient,
  filter: CanonicalSizeFilter,
  options: SizeFilterQueryOptions = {}
): Promise<number> {
  return db.product.count({
    where: productSizeFilterWhere(filter, options),
  });
}

/* Count + page in one round trip, both over the same where clause. */
export async function queryProductsBySizeFilter(
  db: PrismaClient,
  filter: CanonicalSizeFilter,
  options: SizeFilterQueryOptions = {}
): Promise<{ ids: string[]; total: number }> {
  const where = productSizeFilterWhere(filter, options);
  const [rows, total] = await db.$transaction([
    db.product.findMany({
      where,
      select: { id: true },
      orderBy: { id: "asc" },
      skip: options.skip,
      take: options.take,
    }),
    db.product.count({ where }),
  ]);
  return { ids: rows.map((row) => row.id), total };
}
