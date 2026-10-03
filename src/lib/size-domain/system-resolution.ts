/* Stage D — size-system resolution policy + canonical size projection.

   Pure, read-only, migration-free. It sits on top of Stage B
   normalization and Stage C integration and adds exactly two things:

     1. an EXPLICIT / INFERRED / UNRESOLVED system-resolution provenance
        for every canonical projection, and
     2. a source-specific inference policy registry that is EMPTY by
        default. Inference only ever runs when a policy has been
        explicitly approved for that exact source + product type.

   It never converts between systems, never parses size labels (Stage B
   owns that), never guesses from a numeric range, and never coerces a
   non-persisted system into the persisted enum. */

import { normalizeSourceSize } from "./normalize";
import {
  isSizeAudienceId,
  isSizeProductTypeId,
  isSizeSystemId,
} from "./registry";
import type {
  NormalizationReason,
  NormalizationStatus,
  NormalizedSize,
  SizeNormalizationContext,
} from "./normalization-types";
import type { ProductSizeObservation } from "./integrate-product";
import type {
  SizeAudienceId,
  SizeCategoryId,
  SizeProductTypeId,
  SizeSystemId,
} from "./types";

/* ==== 1. System resolution provenance ==== */

export type SystemResolutionProvenance =
  | "EXPLICIT"
  | "INFERRED"
  | "UNRESOLVED";

export type SizeSystemResolution = {
  system: SizeSystemId | null;
  provenance: SystemResolutionProvenance;
  policyId: string | null;
};

/* A source-specific policy. It is only valid when it names the source
   (id or name) AND a product type; the audience is an optional extra
   constraint. A policy never triggers on a numeric range. */
export type SizeSystemPolicy = {
  id: string;
  sourceId?: string | null;
  sourceName?: string | null;
  productType: SizeProductTypeId;
  audience?: SizeAudienceId | null;
  system: SizeSystemId;
  note: string;
};

/* The candidate inferred from the live audit (see
   PHASE-02-STAGE-D-AUDIT.md). It is NOT approved: the source README
   identifies a US retailer but never states a shoe system, so this
   remains a reviewable proposal. */
export const SIZE_SYSTEM_POLICY_CANDIDATES: readonly SizeSystemPolicy[] = [
  {
    id: "livostyle-womens-shoes-us",
    sourceName: "Livostyle Open Catalog",
    productType: "FOOTWEAR",
    audience: "WOMEN",
    system: "US",
    note:
      "Bare numeric women's shoe sizes from a US DTC retailer. Evidence is " +
      "circumstantial (US market, USD, existing product-level sizeSystem=US " +
      "in providers/livostyle.ts) and the source README never declares a " +
      "shoe system, so this candidate is NOT approved.",
  },
];

/* Approved inference policies. Intentionally empty until a policy is
   explicitly approved; with this registry no observation is ever
   resolved by inference. */
export const APPROVED_SIZE_SYSTEM_POLICIES: readonly SizeSystemPolicy[] = [];

export type ResolveSizeSystemInput = {
  explicitSystem: string | null;
  sourceId: string | null;
  sourceName: string | null;
  productType: SizeProductTypeId;
  audience: SizeAudienceId;
  value: string;
};

function matchesSource(
  policy: SizeSystemPolicy,
  input: ResolveSizeSystemInput
): boolean {
  const byId =
    policy.sourceId != null &&
    policy.sourceId !== "" &&
    policy.sourceId === input.sourceId;
  const byName =
    policy.sourceName != null &&
    policy.sourceName !== "" &&
    policy.sourceName === input.sourceName;
  return byId || byName;
}

/* Explicit stored system wins; otherwise the first matching approved
   policy; otherwise unresolved. Label-encoded systems are intentionally
   NOT parsed here — Stage B owns that and will resolve them, after
   which the projection labels them EXPLICIT. */
export function resolveSizeSystem(
  input: ResolveSizeSystemInput,
  policies: readonly SizeSystemPolicy[] = APPROVED_SIZE_SYSTEM_POLICIES
): SizeSystemResolution {
  if (
    input.explicitSystem != null &&
    isSizeSystemId(input.explicitSystem) &&
    input.explicitSystem !== "UNKNOWN"
  ) {
    return {
      system: input.explicitSystem,
      provenance: "EXPLICIT",
      policyId: null,
    };
  }

  for (const policy of policies) {
    if (!isSizeSystemId(policy.system)) continue;
    if (policy.system === "UNKNOWN") continue;
    if (!matchesSource(policy, input)) continue;
    if (policy.productType !== input.productType) continue;
    if (
      policy.audience != null &&
      policy.audience !== input.audience
    ) {
      continue;
    }
    return {
      system: policy.system,
      provenance: "INFERRED",
      policyId: policy.id,
    };
  }

  return { system: null, provenance: "UNRESOLVED", policyId: null };
}

/* ==== 2. Canonical size projection ==== */

export type CanonicalSizeProjection = {
  productId: string;
  variantId: string | null;
  offerId: string | null;
  offerVariantKey: string | null;
  sourceId: string | null;
  sourceName: string | null;
  /* Verbatim source label. Never replaced by the canonical value. */
  sourceSizeLabel: string;
  /* The existing Stage A/B canonical identity; the wire id IS the
     canonical identity, so no second "canonical size id" is created. */
  canonicalSizeOptionId: string | null;
  canonicalValue: string | null;
  displayLabel: string | null;
  category: SizeCategoryId | null;
  audience: SizeAudienceId;
  productType: SizeProductTypeId;
  system: SizeSystemId | null;
  systemPersisted: boolean;
  status: NormalizationStatus;
  reason: NormalizationReason | null;
  systemResolution: SystemResolutionProvenance;
  policyId: string | null;
  availability: string | null;
  available: boolean | null;
};

function contextWithSystem(
  observation: ProductSizeObservation,
  system: SizeSystemId | null
): SizeNormalizationContext {
  return { ...observation.context, system };
}

function projectResolved(
  observation: ProductSizeObservation,
  normalized: NormalizedSize,
  resolution: SizeSystemResolution
): CanonicalSizeProjection {
  return {
    productId: observation.productId,
    variantId: observation.variantId,
    offerId: observation.offerId,
    offerVariantKey: observation.offerVariantKey,
    sourceId: observation.sourceId,
    sourceName: observation.sourceName,
    sourceSizeLabel: observation.sourceSizeLabel,
    canonicalSizeOptionId: normalized.canonicalSizeOptionId,
    canonicalValue: normalized.canonicalValue,
    displayLabel: normalized.displayLabel,
    category: normalized.category,
    audience: normalized.audience,
    productType: normalized.productType,
    system: normalized.system,
    systemPersisted: normalized.systemPersisted,
    status: normalized.status,
    reason: normalized.reason,
    systemResolution: resolution.provenance,
    policyId: resolution.policyId,
    availability: observation.availability,
    available: observation.available,
  };
}

/* Project one Stage C observation. Order of authority:
     1. Stage B already resolved (stored or label-encoded) -> EXPLICIT.
     2. unresolved for a missing system + a matching approved policy ->
        re-normalize with the inferred system -> INFERRED.
     3. otherwise -> UNRESOLVED (unchanged Stage B result). */
export function projectObservation(
  observation: ProductSizeObservation,
  policies: readonly SizeSystemPolicy[] = APPROVED_SIZE_SYSTEM_POLICIES
): CanonicalSizeProjection {
  if (observation.normalization.status === "RESOLVED") {
    return projectResolved(observation, observation.normalization, {
      system: observation.normalization.system,
      provenance: "EXPLICIT",
      policyId: null,
    });
  }

  const reason = observation.normalization.reason;
  const canInfer =
    reason === "INSUFFICIENT_CONTEXT" &&
    observation.context.system == null;

  if (canInfer) {
    const resolution = resolveSizeSystem(
      {
        explicitSystem: observation.sourceSystem,
        sourceId: observation.sourceId,
        sourceName: observation.sourceName,
        productType: observation.context.productType,
        audience: observation.context.audience,
        value: observation.sourceSizeLabel,
      },
      policies
    );
    if (resolution.provenance === "INFERRED" && resolution.system != null) {
      const normalized = normalizeSourceSize(
        observation.sourceSizeLabel,
        contextWithSystem(observation, resolution.system)
      );
      return projectResolved(observation, normalized, resolution);
    }
  }

  return projectResolved(observation, observation.normalization, {
    system: observation.sourceSystem != null &&
      isSizeSystemId(observation.sourceSystem) &&
      observation.sourceSystem !== "UNKNOWN"
      ? observation.sourceSystem
      : null,
    provenance: "UNRESOLVED",
    policyId: null,
  });
}

export function projectProductSizes(
  observations: readonly ProductSizeObservation[],
  policies: readonly SizeSystemPolicy[] = APPROVED_SIZE_SYSTEM_POLICIES
): CanonicalSizeProjection[] {
  return observations.map((observation) =>
    projectObservation(observation, policies)
  );
}

/* ==== 3. Provenance summary (for coverage reporting) ==== */

export type SizeProvenanceSummary = {
  total: number;
  explicit: number;
  inferred: number;
  unresolved: number;
  /* Resolutions contributed specifically by an approved inference. */
  inferredResolved: number;
};

export function summarizeSizeProjections(
  projections: readonly CanonicalSizeProjection[]
): SizeProvenanceSummary {
  const summary: SizeProvenanceSummary = {
    total: 0,
    explicit: 0,
    inferred: 0,
    unresolved: 0,
    inferredResolved: 0,
  };
  for (const projection of projections) {
    summary.total += 1;
    switch (projection.systemResolution) {
      case "EXPLICIT":
        summary.explicit += 1;
        break;
      case "INFERRED":
        summary.inferred += 1;
        if (projection.status === "RESOLVED") summary.inferredResolved += 1;
        break;
      default:
        summary.unresolved += 1;
        break;
    }
  }
  return summary;
}

/* ==== 4. Guards ==== */

export function isApprovedPolicyRegistered(
  policies: readonly SizeSystemPolicy[] = APPROVED_SIZE_SYSTEM_POLICIES
): boolean {
  return policies.some((policy) => isSizeSystemId(policy.system) && policy.system !== "UNKNOWN");
}

export function isValidPolicy(policy: SizeSystemPolicy): boolean {
  return (
    (policy.sourceId != null && policy.sourceId !== "") ||
    (policy.sourceName != null && policy.sourceName !== "")
  ) && isSizeProductTypeId(policy.productType) &&
    isSizeSystemId(policy.system) &&
    policy.system !== "UNKNOWN";
}
