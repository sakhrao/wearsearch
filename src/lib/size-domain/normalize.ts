import {
  AMBIGUOUS_MEASUREMENT_LABELS,
  ALPHA_ALIAS_LOOKUP,
  BRA_CUPS,
  BRA_SIZE_PATTERN,
  MEASUREMENT_LABEL_LOOKUP,
  MEASUREMENT_UNIT_LOOKUP,
  NUMERIC_SIZE_PATTERN,
  ONE_SIZE_CANONICAL,
  ONE_SIZE_LOOKUP,
  SYSTEM_PREFIX_LOOKUP,
  SYSTEM_PREFIX_MAX_WORDS,
  foldLabel,
} from "./aliases";
import {
  canonicalSizeOptionId,
  isMeasurementTypeId,
  isSizeAudienceId,
  isSizeCategoryId,
  isSizeProductTypeId,
  isSizeSystemId,
  measurementType,
  sizeSystem,
} from "./registry";
import type {
  MeasurementTypeId,
  MeasurementUnit,
  SizeCategoryId,
  SizeChartColumn,
  SizeSystemId,
} from "./types";
import type {
  NormalizationConfidence,
  NormalizationReason,
  NormalizedChartColumn,
  NormalizedChartRow,
  NormalizedChartValue,
  NormalizedSize,
  NormalizedSizeChart,
  SizeNormalizationContext,
  SourceSizeChartInput,
  SourceSizeChartRowInput,
} from "./normalization-types";

const NUMERIC_SYSTEMS: ReadonlySet<SizeSystemId> = new Set<SizeSystemId>([
  "EU",
  "US",
  "UK",
  "IT",
  "FR",
  "DE",
  "JP",
  "CM",
  "MONDO",
  "WAIST_IN",
  "WAIST_CM",
]);

export function isPersistedSizeSystem(system: SizeSystemId): boolean {
  return sizeSystem(system)?.persisted ?? false;
}

function extractSystemPrefix(value: string): {
  system: SizeSystemId | null;
  rest: string;
} {
  const words = value.split(" ");
  const max = Math.min(SYSTEM_PREFIX_MAX_WORDS, words.length);
  for (let n = max; n >= 1; n--) {
    const candidate = words.slice(0, n).join(" ");
    const system = SYSTEM_PREFIX_LOOKUP.get(candidate);
    if (system) {
      const rest = words.slice(n).join(" ").trim();
      if (rest !== "") {
        return { system, rest };
      }
    }
  }
  return { system: null, rest: value };
}

export function normalizeSourceSize(
  input: string,
  context: SizeNormalizationContext
): NormalizedSize {
  const sourceLabel = typeof input === "string" ? input : String(input ?? "");

  const base: NormalizedSize = {
    status: "UNRESOLVED",
    confidence: "UNKNOWN",
    sourceLabel,
    canonicalSizeOptionId: null,
    canonicalValue: null,
    displayLabel: null,
    system: null,
    systemPersisted: false,
    audience: context.audience,
    productType: context.productType,
    category: context.category ?? null,
    reason: null,
  };

  const unresolvedWith = (
    reason: NormalizationReason,
    system: SizeSystemId | null = null
  ): NormalizedSize => ({
    ...base,
    reason,
    system,
    systemPersisted: system ? isPersistedSizeSystem(system) : false,
  });

  const resolvedWith = (args: {
    system: SizeSystemId;
    value: string;
    display: string;
    confidence: NormalizationConfidence;
  }): NormalizedSize => ({
    ...base,
    status: "RESOLVED",
    confidence: args.confidence,
    system: args.system,
    systemPersisted: isPersistedSizeSystem(args.system),
    canonicalSizeOptionId: canonicalSizeOptionId({
      context: {
        audience: context.audience,
        productType: context.productType,
      },
      system: args.system,
      value: args.value,
    }),
    canonicalValue: args.value,
    displayLabel: args.display,
    reason: null,
  });

  if (!isSizeAudienceId(context.audience)) {
    return unresolvedWith("INSUFFICIENT_CONTEXT");
  }
  if (!isSizeProductTypeId(context.productType)) {
    return unresolvedWith("INSUFFICIENT_CONTEXT");
  }
  if (context.category != null && !isSizeCategoryId(context.category)) {
    return unresolvedWith("CONTEXT_MISMATCH");
  }
  if (context.system != null && !isSizeSystemId(context.system)) {
    return unresolvedWith("UNSUPPORTED_SYSTEM");
  }

  if (context.ageRange != null) {
    const { minMonths, maxMonths } = context.ageRange;
    if (
      minMonths != null &&
      maxMonths != null &&
      minMonths > maxMonths
    ) {
      return unresolvedWith("CONTEXT_MISMATCH");
    }
    if (context.audience !== "KIDS") {
      return unresolvedWith("CONTEXT_MISMATCH");
    }
  }

  const folded = foldLabel(sourceLabel);
  if (folded === "") {
    return unresolvedWith("EMPTY_INPUT");
  }
  if (!/[a-z0-9]/.test(folded)) {
    return unresolvedWith("MALFORMED_INPUT");
  }

  const prefix = extractSystemPrefix(folded);
  let system: SizeSystemId | null = context.system ?? null;
  if (prefix.system) {
    if (context.system != null && context.system !== prefix.system) {
      return unresolvedWith("CONFLICTING_SYSTEM", prefix.system);
    }
    system = prefix.system;
  }
  const value = prefix.rest;

  if (value === "") {
    return unresolvedWith("UNKNOWN_VALUE", system);
  }

  if (ONE_SIZE_LOOKUP.has(value)) {
    if (
      system != null &&
      system !== "ONE_SIZE" &&
      system !== "INTERNATIONAL"
    ) {
      return unresolvedWith("CONTEXT_MISMATCH", system);
    }
    if (context.productType === "UNKNOWN") {
      return unresolvedWith("INSUFFICIENT_CONTEXT", system ?? "ONE_SIZE");
    }
    const resolvedSystem: SizeSystemId =
      system === "INTERNATIONAL" ? "INTERNATIONAL" : "ONE_SIZE";
    return resolvedWith({
      system: resolvedSystem,
      value: ONE_SIZE_CANONICAL,
      display: ONE_SIZE_CANONICAL,
      confidence:
        value === foldLabel(ONE_SIZE_CANONICAL) ? "EXACT" : "NORMALIZED",
    });
  }

  const alpha = ALPHA_ALIAS_LOOKUP.get(value);
  if (alpha) {
    if (context.productType === "FOOTWEAR") {
      return unresolvedWith("CONTEXT_MISMATCH", system);
    }
    if (system != null && system !== "INTERNATIONAL") {
      return unresolvedWith("CONTEXT_MISMATCH", system);
    }
    if (
      context.audience === "UNKNOWN" ||
      context.productType === "UNKNOWN"
    ) {
      return unresolvedWith("INSUFFICIENT_CONTEXT", system);
    }
    return resolvedWith({
      system: "INTERNATIONAL",
      value: alpha,
      display: alpha,
      confidence: value === alpha.toLowerCase() ? "EXACT" : "NORMALIZED",
    });
  }

  if (NUMERIC_SIZE_PATTERN.test(value)) {
    if (system == null) {
      return unresolvedWith("INSUFFICIENT_CONTEXT", null);
    }
    if (
      context.productType === "UNKNOWN" ||
      context.audience === "UNKNOWN"
    ) {
      return unresolvedWith("INSUFFICIENT_CONTEXT", system);
    }
    if (!NUMERIC_SYSTEMS.has(system)) {
      return unresolvedWith("CONTEXT_MISMATCH", system);
    }
    if (
      context.productType === "FOOTWEAR" &&
      (system === "WAIST_IN" || system === "WAIST_CM")
    ) {
      return unresolvedWith("CONTEXT_MISMATCH", system);
    }
    return resolvedWith({
      system,
      value,
      display: value,
      confidence: "NORMALIZED",
    });
  }

  const bra = value.match(BRA_SIZE_PATTERN);
  if (bra) {
    const cup = bra[2].toUpperCase();
    if (!BRA_CUPS.includes(cup)) {
      return unresolvedWith("UNKNOWN_VALUE", system);
    }
    if (context.category !== "bra") {
      return unresolvedWith("INSUFFICIENT_CONTEXT", system);
    }
    if (system != null && system !== "BRA") {
      return unresolvedWith("CONTEXT_MISMATCH", system);
    }
    if (context.productType === "FOOTWEAR") {
      return unresolvedWith("CONTEXT_MISMATCH", system);
    }
    const canonical = `${bra[1]}${cup}`;
    return resolvedWith({
      system: "BRA",
      value: canonical,
      display: canonical,
      confidence: value === canonical.toLowerCase() ? "EXACT" : "NORMALIZED",
    });
  }

  return unresolvedWith("UNKNOWN_VALUE", system);
}

function resolveMeasurement(
  label: string,
  context: SizeNormalizationContext
): MeasurementTypeId | null {
  const folded = foldLabel(label);
  const ambiguous = AMBIGUOUS_MEASUREMENT_LABELS[folded];
  if (ambiguous) {
    const category: SizeCategoryId | null =
      context.category ??
      (context.productType === "FOOTWEAR" ? "footwear" : null);
    if (category && ambiguous[category]) {
      return ambiguous[category] ?? null;
    }
  }
  return MEASUREMENT_LABEL_LOOKUP.get(folded) ?? null;
}

function resolveUnit(
  raw: string | null,
  measurement: MeasurementTypeId
): MeasurementUnit | null {
  if (raw != null && raw.trim() !== "") {
    return MEASUREMENT_UNIT_LOOKUP.get(foldLabel(raw)) ?? null;
  }
  return measurementType(measurement)?.unit ?? null;
}

function chartColumnId(
  measurement: MeasurementTypeId,
  order: number
): string {
  return `${measurement}-${order}`;
}

function toMeasuredNumber(
  value: number | string | null | undefined
): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const folded = foldLabel(value);
    if (NUMERIC_SIZE_PATTERN.test(folded)) {
      const parsed = Number.parseFloat(folded.replace(",", "."));
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  return null;
}

function toRawValue(
  value: number | string | null | undefined
): number | string | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  return value ?? null;
}

function normalizeChartColumn(
  column: SourceSizeChartInput["columns"][number],
  order: number,
  context: SizeNormalizationContext
): NormalizedChartColumn {
  const declared =
    column.measurement != null && isMeasurementTypeId(column.measurement)
      ? column.measurement
      : null;
  const measurement =
    declared ?? resolveMeasurement(column.label, context);

  if (!measurement) {
    return {
      sourceLabel: column.label,
      resolved: false,
      measurement: null,
      unit: null,
      order,
      column: null,
      reason: "UNKNOWN_VALUE",
    };
  }

  const unit = resolveUnit(column.unit ?? null, measurement);
  if (!unit) {
    return {
      sourceLabel: column.label,
      resolved: false,
      measurement,
      unit: null,
      order,
      column: null,
      reason: "UNKNOWN_VALUE",
    };
  }

  const canonical: SizeChartColumn = {
    id: chartColumnId(measurement, order),
    measurement,
    label: column.label,
    unit,
    order,
  };

  return {
    sourceLabel: column.label,
    resolved: true,
    measurement,
    unit,
    order,
    column: canonical,
    reason: null,
  };
}

function normalizeChartRow(
  row: SourceSizeChartRowInput,
  columns: NormalizedChartColumn[],
  context: SizeNormalizationContext
): NormalizedChartRow {
  const normalized = normalizeSourceSize(row.sizeLabel, context);
  const values: NormalizedChartValue[] = row.values.map(
    (value, index) => {
      const column = columns[index] ?? null;
      return {
        columnId: column?.column?.id ?? null,
        number: toMeasuredNumber(value),
        unit: column?.unit ?? null,
        raw: toRawValue(value),
      };
    }
  );

  return {
    sourceSizeLabel: row.sizeLabel,
    status: normalized.status,
    confidence: normalized.confidence,
    canonicalSizeOptionId: normalized.canonicalSizeOptionId,
    values,
  };
}

export function normalizeSourceSizeChart(
  input: SourceSizeChartInput,
  context: SizeNormalizationContext
): NormalizedSizeChart {
  const chartSystem: SizeSystemId | null =
    input.system != null && isSizeSystemId(input.system)
      ? input.system
      : null;

  const columns = input.columns.map((column, order) =>
    normalizeChartColumn(column, order, context)
  );

  const rowContext: SizeNormalizationContext = {
    ...context,
    system: context.system ?? chartSystem,
  };

  const rows = input.rows.map((row) =>
    normalizeChartRow(row, columns, rowContext)
  );

  const unresolvedColumnCount = columns.filter(
    (column) => !column.resolved
  ).length;
  const unresolvedRowCount = rows.filter(
    (row) => row.status === "UNRESOLVED"
  ).length;

  const status: NormalizedSizeChart["status"] =
    columns.length === 0 || rows.length === 0
      ? "missing"
      : unresolvedColumnCount === 0 && unresolvedRowCount === 0
        ? "available"
        : "partial";

  return {
    id: input.id ?? null,
    source: input.source ?? null,
    system: chartSystem,
    status,
    columns,
    rows,
    unresolvedColumnCount,
    unresolvedRowCount,
  };
}
