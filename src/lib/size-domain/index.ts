export type {
  MeasurementTypeId,
  MeasurementUnit,
  SizeAgeRange,
  SizeAudienceId,
  SizeCategoryId,
  SizeChart,
  SizeChartColumn,
  SizeChartPriority,
  SizeChartRow,
  SizeChartScope,
  SizeChartStatus,
  SizeContext,
  SizeOption,
  SizeProductTypeId,
  SizeSystemId,
} from "./types";

export {
  MEASUREMENT_TYPES,
  SIZE_CATEGORIES,
  SIZE_SYSTEMS,
  canonicalSizeOptionId,
  disciplineToSizeProductType,
  isMeasurementTypeId,
  isSizeAudienceId,
  isSizeCategoryId,
  isSizeProductTypeId,
  isSizeSystemId,
  measurementType,
  sizeCategory,
  sizeProductTypeToDiscipline,
  sizeSystem,
  sizeSystemOrder,
} from "./registry";

export type {
  MeasurementTypeMeta,
  SizeCategoryMeta,
  SizeSystemKind,
  SizeSystemMeta,
} from "./registry";

export {
  normalizeSourceSize,
  normalizeSourceSizeChart,
  isPersistedSizeSystem,
} from "./normalize";

export { integrateProductSizes } from "./integrate-product";

export { buildSizeCoverage } from "./size-coverage";

export {
  APPROVED_SIZE_SYSTEM_POLICIES,
  SIZE_SYSTEM_POLICY_CANDIDATES,
  isApprovedPolicyRegistered,
  isValidPolicy,
  projectObservation,
  projectProductSizes,
  resolveSizeSystem,
  summarizeSizeProjections,
} from "./system-resolution";

export type {
  CanonicalSizeProjection,
  ResolveSizeSystemInput,
  SizeProvenanceSummary,
  SizeSystemPolicy,
  SizeSystemResolution,
  SystemResolutionProvenance,
} from "./system-resolution";

export {
  SIZE_RESOLUTION_PROVENANCES,
  SIZE_RESOLUTION_STATUSES,
  canonicalFieldsFromProjection,
  isBackfilled,
  isDowngrade,
  isSizeResolutionStatus,
  isSystemResolutionProvenance,
  planSizeBackfill,
  readCanonicalOrLegacySize,
  sameCanonicalFields,
  sizePersistenceTargetKey,
} from "./persist";

export type {
  PersistedSizeReadInput,
  PersistedSizeView,
  SizeBackfillReport,
  SizeCanonicalFields,
  SizePersistenceChange,
  SizePersistenceEntry,
  SizePersistenceTarget,
  SizeResolutionStatus,
} from "./persist";

export {
  canonicalReadState,
  canonicalSizeIdentityOf,
  combineSizeFilters,
  countProductsBySizeFilter,
  filterByCanonicalSize,
  filterBySizeSystem,
  findProductIdsBySizeFilter,
  hasCanonicalSizePredicate,
  hasSizeSystemPredicate,
  isNotBackfilledSize,
  isEmptySizeFilter,
  isResolvedSize,
  isUnresolvedSize,
  matchesCanonicalSize,
  matchesSizeFilter,
  matchesSizeSystem,
  pickCanonicalFields,
  productSizeFilterWhere,
  queryProductsBySizeFilter,
  readCanonicalSize,
  sizeFilterToOfferVariantWhere,
  sizeFilterToVariantWhere,
  sizeSystemOf,
} from "./query";

export type {
  CanonicalSizeFilter,
  CanonicalSizeRead,
  SizeFilterQueryOptions,
  SizeReadState,
} from "./query";

export {
  SIZE_CHART_PRIORITY_ORDER,
  chartContextIncompatibility,
  isUsableSizeChart,
  resolveSizeChart,
} from "./resolve-chart";

export type {
  ResolvedSizeChart,
  SizeChartEvaluation,
  SizeChartProvenance,
  SizeChartRejectionReason,
  SizeChartResolutionStatus,
  SizeChartTarget,
} from "./resolve-chart";

export {
  parseSizeChartRange,
  sizeChartFromNormalized,
} from "./chart-import";

export type { SizeChartImportMeta } from "./chart-import";

export {
  EMPTY_SIZE_CHART_SOURCE,
  resolveChartsFromSource,
} from "./chart-source";

export type { SizeChartSource } from "./chart-source";

export {
  SIZE_CHART_HIGHLIGHT_NOTE,
  SIZE_CHART_PROVENANCE_LABELS,
  buildSizeChartView,
  formatSizeChartCellValue,
} from "./chart-view";

export type {
  SizeChartView,
  SizeChartViewCell,
  SizeChartViewColumn,
  SizeChartViewRow,
} from "./chart-view";

export type { SizeChartCellValue, SizeChartRange } from "./types";

export type {
  LegacyVariantSizeInput,
  OfferVariantSizeInput,
  ProductSizeContextInput,
  ProductSizeInput,
  ProductSizeObservation,
  ProductSizeObservationOrigin,
  SizeObservationClass,
} from "./integrate-product";

export type {
  SizeCoverageBucket,
  SizeCoverageReport,
  SizeUniqueLabelCoverage,
  SizeUnresolvedEntry,
} from "./size-coverage";

export {
  ALPHA_SIZE_ALIASES,
  AMBIGUOUS_MEASUREMENT_LABELS,
  BRA_CUPS,
  MEASUREMENT_LABEL_ALIASES,
  MEASUREMENT_UNIT_ALIASES,
  ONE_SIZE_ALIASES,
  ONE_SIZE_CANONICAL,
  SYSTEM_PREFIX_ALIASES,
  foldLabel,
} from "./aliases";

export type {
  NormalizationConfidence,
  NormalizationReason,
  NormalizationStatus,
  NormalizedChartColumn,
  NormalizedChartRow,
  NormalizedChartValue,
  NormalizedSize,
  NormalizedSizeChart,
  SizeNormalizationContext,
  SourceSizeChartColumnInput,
  SourceSizeChartInput,
  SourceSizeChartRowInput,
} from "./normalization-types";
