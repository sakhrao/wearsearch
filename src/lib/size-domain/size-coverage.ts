/* Stage C — deterministic size-coverage analysis over integration
   observations. Pure: same observations => same report, no clock, no
   random ids, stable key ordering. It measures; it never fixes the
   catalog. */

import type { NormalizationReason } from "./normalization-types";
import type {
  ProductSizeObservation,
  SizeObservationClass,
} from "./integrate-product";

export type SizeCoverageBucket = {
  total: number;
  resolved: number;
  unresolved: number;
  insufficientContext: number;
  ambiguous: number;
};

export type SizeUniqueLabelCoverage = SizeCoverageBucket & {
  /* Labels that resolve in at least one context but not all. Counted
     inside `resolved`; surfaced so context-dependence is never hidden. */
  mixed: number;
  resolutionPercentage: number;
};

export type SizeUnresolvedEntry = {
  sourceLabel: string;
  /* Unresolved observations carrying this label (occurrence count). */
  count: number;
  /* All observations carrying this label. */
  totalCount: number;
  classes: {
    unresolved: number;
    insufficientContext: number;
    ambiguous: number;
  };
  reasons: NormalizationReason[];
  sources: string[];
  productTypes: string[];
  audiences: string[];
  contexts: string[];
};

export type SizeCoverageReport = {
  observations: SizeCoverageBucket & { resolutionPercentage: number };
  uniqueSourceLabels: SizeUniqueLabelCoverage;
  bySource: Record<string, SizeCoverageBucket>;
  byProductType: Record<string, SizeCoverageBucket>;
  byAudience: Record<string, SizeCoverageBucket>;
  bySystem: Record<string, SizeCoverageBucket>;
  byStatus: Record<string, number>;
  byUnresolvedReason: Record<string, number>;
  byCanonicalSize: Record<string, number>;
  unresolvedVocabulary: SizeUnresolvedEntry[];
};

function emptyBucket(): SizeCoverageBucket {
  return {
    total: 0,
    resolved: 0,
    unresolved: 0,
    insufficientContext: 0,
    ambiguous: 0,
  };
}

function addToBucket(
  bucket: SizeCoverageBucket,
  classification: SizeObservationClass
): void {
  bucket.total += 1;
  switch (classification) {
    case "RESOLVED":
      bucket.resolved += 1;
      break;
    case "INSUFFICIENT_CONTEXT":
      bucket.insufficientContext += 1;
      bucket.unresolved += 1;
      break;
    case "AMBIGUOUS":
      bucket.ambiguous += 1;
      bucket.unresolved += 1;
      break;
    default:
      bucket.unresolved += 1;
      break;
  }
}

function percentage(part: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((part / total) * 10000) / 100;
}

function sortedKeys<T>(record: Record<string, T>): string[] {
  return Object.keys(record).sort((a, b) => a.localeCompare(b));
}

function sortedRecord<T>(record: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of sortedKeys(record)) {
    out[key] = record[key];
  }
  return out;
}

function bucketInto(
  record: Record<string, SizeCoverageBucket>,
  key: string,
  classification: SizeObservationClass
): void {
  if (!record[key]) record[key] = emptyBucket();
  addToBucket(record[key], classification);
}

function uniqueSorted(values: Iterable<string | null>): string[] {
  const set = new Set<string>();
  for (const value of values) {
    if (value != null && value !== "") set.add(value);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function sourceKeyOf(observation: ProductSizeObservation): string {
  return (
    observation.sourceName ??
    observation.sourceId ??
    observation.origin
  );
}

function systemKeyOf(observation: ProductSizeObservation): string {
  return observation.normalization.system ?? "NONE";
}

function contextKeyOf(observation: ProductSizeObservation): string {
  const { audience, productType, system } = observation.context;
  return `${audience}|${productType}|${system ?? "NONE"}|${observation.normalization.category ?? "NONE"}`;
}

export function buildSizeCoverage(
  observations: readonly ProductSizeObservation[]
): SizeCoverageReport {
  const bucket = emptyBucket();
  const bySource: Record<string, SizeCoverageBucket> = {};
  const byProductType: Record<string, SizeCoverageBucket> = {};
  const byAudience: Record<string, SizeCoverageBucket> = {};
  const bySystem: Record<string, SizeCoverageBucket> = {};
  const byStatus: Record<string, number> = {};
  const byUnresolvedReason: Record<string, number> = {};
  const byCanonicalSize: Record<string, number> = {};

  const labelGroups = new Map<string, ProductSizeObservation[]>();

  for (const observation of observations) {
    addToBucket(bucket, observation.classification);

    const { normalization } = observation;
    bucketInto(bySource, sourceKeyOf(observation), observation.classification);
    bucketInto(
      byProductType,
      observation.context.productType,
      observation.classification
    );
    bucketInto(byAudience, observation.context.audience, observation.classification);
    bucketInto(bySystem, systemKeyOf(observation), observation.classification);

    byStatus[normalization.status] =
      (byStatus[normalization.status] ?? 0) + 1;

    if (
      normalization.status === "UNRESOLVED" &&
      normalization.reason != null
    ) {
      byUnresolvedReason[normalization.reason] =
        (byUnresolvedReason[normalization.reason] ?? 0) + 1;
    }
    if (
      normalization.status === "RESOLVED" &&
      normalization.canonicalSizeOptionId != null
    ) {
      byCanonicalSize[normalization.canonicalSizeOptionId] =
        (byCanonicalSize[normalization.canonicalSizeOptionId] ?? 0) + 1;
    }

    const group = labelGroups.get(observation.sourceSizeLabel);
    if (group) {
      group.push(observation);
    } else {
      labelGroups.set(observation.sourceSizeLabel, [observation]);
    }
  }

  const unique = emptyBucket();
  let mixed = 0;
  for (const group of labelGroups.values()) {
    unique.total += 1;
    const resolvedCount = group.filter(
      (o) => o.classification === "RESOLVED"
    ).length;
    if (resolvedCount === group.length) {
      unique.resolved += 1;
      continue;
    }
    if (resolvedCount > 0) {
      unique.resolved += 1;
      mixed += 1;
      continue;
    }
    /* No observation resolved: classify by the least ambiguous class. */
    if (group.some((o) => o.classification === "AMBIGUOUS")) {
      unique.ambiguous += 1;
    } else if (group.some((o) => o.classification === "INSUFFICIENT_CONTEXT")) {
      unique.insufficientContext += 1;
    } else {
      unique.unresolved += 1;
    }
  }
  unique.unresolved = unique.total - unique.resolved;

  const unresolvedByLabel = new Map<
    string,
    ProductSizeObservation[]
  >();
  for (const [label, group] of labelGroups) {
    const unresolvedObs = group.filter(
      (o) => o.classification !== "RESOLVED"
    );
    if (unresolvedObs.length > 0) {
      unresolvedByLabel.set(label, unresolvedObs);
    }
  }

  const vocabulary: SizeUnresolvedEntry[] = [...unresolvedByLabel.entries()]
    .map(([sourceLabel, group]) => {
      const all = labelGroups.get(sourceLabel) ?? group;
      const reasons = uniqueSorted(
        group
          .map((o) => o.normalization.reason)
          .filter((r): r is NormalizationReason => r != null)
      ) as NormalizationReason[];
      return {
        sourceLabel,
        count: group.length,
        totalCount: all.length,
        classes: {
          unresolved: group.filter(
            (o) => o.classification === "UNRESOLVED"
          ).length,
          insufficientContext: group.filter(
            (o) => o.classification === "INSUFFICIENT_CONTEXT"
          ).length,
          ambiguous: group.filter(
            (o) => o.classification === "AMBIGUOUS"
          ).length,
        },
        reasons,
        sources: uniqueSorted(group.map((o) => sourceKeyOf(o))),
        productTypes: uniqueSorted(
          group.map((o) => o.context.productType)
        ),
        audiences: uniqueSorted(group.map((o) => o.context.audience)),
        contexts: uniqueSorted(group.map((o) => contextKeyOf(o))),
      };
    })
    .sort(
      (a, b) =>
        b.count - a.count || a.sourceLabel.localeCompare(b.sourceLabel)
    );

  return {
    observations: {
      ...bucket,
      resolutionPercentage: percentage(bucket.resolved, bucket.total),
    },
    uniqueSourceLabels: {
      ...unique,
      mixed,
      resolutionPercentage: percentage(unique.resolved, unique.total),
    },
    bySource: sortedRecord(bySource),
    byProductType: sortedRecord(byProductType),
    byAudience: sortedRecord(byAudience),
    bySystem: sortedRecord(bySystem),
    byStatus: sortedRecord(byStatus),
    byUnresolvedReason: sortedRecord(byUnresolvedReason),
    byCanonicalSize: sortedRecord(byCanonicalSize),
    unresolvedVocabulary: vocabulary,
  };
}
