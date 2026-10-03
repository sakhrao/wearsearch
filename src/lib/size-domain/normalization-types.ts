import type {
  MeasurementTypeId,
  MeasurementUnit,
  SizeAgeRange,
  SizeAudienceId,
  SizeCategoryId,
  SizeChartColumn,
  SizeChartStatus,
  SizeProductTypeId,
  SizeSystemId,
} from "./types";

export type SizeNormalizationContext = {
  audience: SizeAudienceId;
  productType: SizeProductTypeId;
  system?: SizeSystemId | null;
  category?: SizeCategoryId | null;
  ageRange?: SizeAgeRange | null;
};

export type NormalizationStatus = "RESOLVED" | "UNRESOLVED";

export type NormalizationConfidence = "EXACT" | "NORMALIZED" | "UNKNOWN";

export type NormalizationReason =
  | "EMPTY_INPUT"
  | "MALFORMED_INPUT"
  | "UNKNOWN_VALUE"
  | "UNSUPPORTED_SYSTEM"
  | "NON_PERSISTED_SYSTEM"
  | "INSUFFICIENT_CONTEXT"
  | "CONTEXT_MISMATCH"
  | "CONFLICTING_SYSTEM";

export type NormalizedSize = {
  status: NormalizationStatus;
  confidence: NormalizationConfidence;
  sourceLabel: string;
  canonicalSizeOptionId: string | null;
  canonicalValue: string | null;
  displayLabel: string | null;
  system: SizeSystemId | null;
  systemPersisted: boolean;
  audience: SizeAudienceId;
  productType: SizeProductTypeId;
  category: SizeCategoryId | null;
  reason: NormalizationReason | null;
};

export type SourceSizeChartColumnInput = {
  label: string;
  unit?: string | null;
  measurement?: string | null;
};

export type SourceSizeChartRowInput = {
  sizeLabel: string;
  values: readonly (number | string | null | undefined)[];
};

export type SourceSizeChartInput = {
  id?: string | null;
  system?: string | null;
  source?: string | null;
  columns: readonly SourceSizeChartColumnInput[];
  rows: readonly SourceSizeChartRowInput[];
};

export type NormalizedChartColumn = {
  sourceLabel: string;
  resolved: boolean;
  measurement: MeasurementTypeId | null;
  unit: MeasurementUnit | null;
  order: number;
  column: SizeChartColumn | null;
  reason: NormalizationReason | null;
};

export type NormalizedChartValue = {
  columnId: string | null;
  number: number | null;
  unit: MeasurementUnit | null;
  raw: number | string | null;
};

export type NormalizedChartRow = {
  sourceSizeLabel: string;
  status: NormalizationStatus;
  confidence: NormalizationConfidence;
  canonicalSizeOptionId: string | null;
  values: NormalizedChartValue[];
};

export type NormalizedSizeChart = {
  id: string | null;
  source: string | null;
  system: SizeSystemId | null;
  status: SizeChartStatus;
  columns: NormalizedChartColumn[];
  rows: NormalizedChartRow[];
  unresolvedColumnCount: number;
  unresolvedRowCount: number;
};
