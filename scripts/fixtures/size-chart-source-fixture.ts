/* TEST ONLY — NOT PRODUCTION DATA.
 *
 * A hypothetical *approved* size-chart source used solely to prove that a
 * future provider can flow through the existing, unchanged boundary:
 *
 *   hypothetical source record
 *     -> SourceSizeChartInput
 *     -> normalizeSourceSizeChart   (the one parser)
 *     -> NormalizedSizeChart
 *     -> sizeChartFromNormalized    (the one bridge)
 *     -> SizeChart
 *     -> resolveSizeChart           (the one resolver)
 *     -> buildSizeChartView         (the one view-model)
 *
 * Nothing in this file is seeded into, read from, or persisted to the
 * production database. The measurement values below are illustrative
 * placeholders for the contract test only.
 *
 * Identity mapping is EXACT-ONLY. There is deliberately no name similarity,
 * no fuzzy match, and no guessing: if a required mapping or required source
 * metadata is missing, the record yields no chart (fails closed). */

import {
  normalizeSourceSizeChart,
  sizeChartFromNormalized,
  type SizeAudienceId,
  type SizeAgeRange,
  type SizeCategoryId,
  type SizeChart,
  type SizeChartPriority,
  type SizeChartScope,
  type SizeChartSource,
  type SizeChartTarget,
  type SizeProductTypeId,
} from "../../src/lib/size-domain";

export const FIXTURE_MARKER = "TEST ONLY — NOT PRODUCTION DATA" as const;

export type FixtureChartColumn = {
  label: string;
  measurement?: string;
  unit?: string | null;
};

export type FixtureChartRow = {
  sizeLabel: string;
  values: readonly (number | string | null)[];
};

export type FixtureSourceRecord = {
  /* The source's own stable identifiers. */
  sourceProductId: string;
  sourceBrandId: string | null;
  sourceCategoryToken: string | null;
  /* Chart payload — exactly what an approved source would supply. */
  system: string | null;
  source: string;
  columns: readonly FixtureChartColumn[];
  rows: readonly FixtureChartRow[];
  /* Context is explicit where the source provides it; never guessed. */
  context: {
    audience: SizeAudienceId | null;
    productType: SizeProductTypeId | null;
    ageRange?: SizeAgeRange | null;
  };
};

/* Exact-only identity maps: source identifier -> canonical database id. */
export type FixtureIdentityMaps = {
  product: Readonly<Record<string, string>>;
  brand: Readonly<Record<string, string>>;
  category: Readonly<Record<string, SizeCategoryId>>;
};

/* The canonical K10 example: a US, inches, women's clothing chart.
 *   S: Chest 36–38, Waist 30–32
 *   M: Chest 39–41, Waist 33–35
 * plus one deliberately missing cell and one null row value. */
export const EXAMPLE_APPROVED_SOURCE_RECORD: FixtureSourceRecord = {
  sourceProductId: "example-product-001",
  sourceBrandId: "example-brand-001",
  sourceCategoryToken: "example-tops",
  system: "US",
  source: "Example Approved Source",
  columns: [
    { label: "Chest", unit: "in" },
    { label: "Waist", unit: "in" },
  ],
  rows: [
    { sizeLabel: "S", values: ["36–38", "30–32"] },
    { sizeLabel: "M", values: ["39–41", "33–35"] },
  ],
  context: { audience: "WOMEN", productType: "CLOTHING", ageRange: null },
};

export const EXAMPLE_IDENTITY_MAPS: FixtureIdentityMaps = {
  product: { "example-product-001": "canonical-product-001" },
  brand: { "example-brand-001": "canonical-brand-001" },
  category: { "example-tops": "clothing" },
};

/* Scope resolution is EXACT. Returns [] when the record cannot be tied to
 * the target by a verified identifier — never by similarity. */
export function scopesFor(
  record: FixtureSourceRecord,
  maps: FixtureIdentityMaps,
  target: SizeChartTarget
): Array<{ scope: SizeChartScope; priority: SizeChartPriority }> {
  const mappedProductId = maps.product[record.sourceProductId];
  if (mappedProductId != null) {
    /* The source names the product. If it is not this target, the chart
     * simply does not belong here (no fallback to name matching). */
    if (mappedProductId !== target.productId) return [];
    return [{ scope: { kind: "product", productId: mappedProductId }, priority: "product" }];
  }

  const out: Array<{ scope: SizeChartScope; priority: SizeChartPriority }> = [];
  const mappedBrandId =
    record.sourceBrandId != null ? maps.brand[record.sourceBrandId] : undefined;
  const mappedCategory =
    record.sourceCategoryToken != null
      ? maps.category[record.sourceCategoryToken]
      : undefined;

  if (
    mappedBrandId != null &&
    mappedCategory != null &&
    target.brandId != null &&
    mappedBrandId === target.brandId
  ) {
    out.push({
      scope: { kind: "brand", brandId: mappedBrandId, category: mappedCategory },
      priority: "brand",
    });
  }

  if (mappedCategory != null && target.category === mappedCategory) {
    out.push({ scope: { kind: "category", category: mappedCategory }, priority: "category" });
  }

  return out;
}

/* Build a SizeChartSource over the hypothetical records. Fails closed:
 *   - missing explicit system           -> skip record (never guessed)
 *   - missing audience or product type   -> skip record (never guessed)
 *   - chart parses to `missing`          -> skip record (never filled)
 *   - no verified scope for the target    -> no chart
 *   - unmapped identifiers                -> no chart */
export function buildFixtureSource(
  records: readonly FixtureSourceRecord[],
  maps: FixtureIdentityMaps
): SizeChartSource {
  return {
    name: "fixture-approved-source",
    async loadCharts(target: SizeChartTarget): Promise<readonly SizeChart[]> {
      const charts: SizeChart[] = [];
      for (const record of records) {
        if (record.system == null) continue;
        const { audience, productType, ageRange } = record.context;
        if (audience == null || productType == null) continue;

        const mappedCategory =
          record.sourceCategoryToken != null
            ? maps.category[record.sourceCategoryToken] ?? null
            : null;

        const normalized = normalizeSourceSizeChart(
          {
            id: record.sourceProductId,
            system: record.system,
            source: record.source,
            columns: record.columns,
            rows: record.rows,
          },
          {
            audience,
            productType,
            system: null,
            category: mappedCategory,
            ageRange: ageRange ?? null,
          }
        );

        if (normalized.status === "missing") continue;

        for (const { scope, priority } of scopesFor(record, maps, target)) {
          charts.push(
            sizeChartFromNormalized(normalized, {
              id: `${record.sourceProductId}|${scope.kind}`,
              scope,
              priority,
              context: { audience, productType, ageRange: ageRange ?? null },
              source: record.source,
              updatedAt: "2026-01-01T00:00:00.000Z",
            })
          );
        }
      }
      return charts;
    },
  };
}
