/* Stage G / G2 — Size Chart Resolver.

   A PURE, UI-free, DB-free decision function. Given a product target and a
   set of candidate charts it returns exactly one of:

     FOUND               — a usable, context-compatible chart, with the
                           winning priority recorded as provenance
     NO_CHART            — no candidate chart even applies to the product
     NO_COMPATIBLE_CHART — charts apply but none match the product's
                           context / size system
     INVALID             — the best applying chart is structurally unusable

   Guarantees:
     - Priority is fixed: PRODUCT > BRAND > CATEGORY. A product's own chart
       always wins when it is usable and compatible.
     - A rejection is NEVER silent: every candidate is reported in
       `considered` with the reason it lost.
     - No fabrication: the returned `chart` is the caller's object, its
       columns/rows/values untouched. The resolver never interpolates,
       converts units, or invents a measurement.
     - Compatibility is by context (`productType`, `audience`, `ageRange`)
       and, when both sides declare it, size system (`chart.system` vs the
       product's carried `systems`). A footwear product never receives a
       clothing chart; a US product never silently receives an EU chart.
     - Deterministic: candidate order never affects the result. Ties break
       by version desc, then updatedAt desc, then id asc.

   This module is a domain contract only. It does not read the database and
   does not decide where charts come from. */

import type {
  SizeCategoryId,
  SizeChart,
  SizeChartPriority,
  SizeContext,
  SizeSystemId,
} from "./types";

/* ==== Priority ==== */

export const SIZE_CHART_PRIORITY_ORDER: readonly SizeChartPriority[] = [
  "product",
  "brand",
  "category",
];

const PRIORITY_RANK: Record<SizeChartPriority, number> = {
  product: 0,
  brand: 1,
  category: 2,
};

export type SizeChartProvenance = "PRODUCT" | "BRAND" | "CATEGORY";

const PROVENANCE_BY_PRIORITY: Record<SizeChartPriority, SizeChartProvenance> = {
  product: "PRODUCT",
  brand: "BRAND",
  category: "CATEGORY",
};

/* ==== Result contract ==== */

export type SizeChartResolutionStatus =
  | "FOUND"
  | "NO_CHART"
  | "NO_COMPATIBLE_CHART"
  | "INVALID";

export type SizeChartRejectionReason =
  | "SCOPE_MISMATCH"
  | "CATEGORY_MISMATCH"
  | "PRODUCT_TYPE_MISMATCH"
  | "AUDIENCE_MISMATCH"
  | "AGE_RANGE_MISMATCH"
  | "SYSTEM_MISMATCH"
  | "EMPTY"
  | "INVALID"
  | "LOWER_PRIORITY";

export type SizeChartEvaluation = {
  chartId: string;
  priority: SizeChartPriority;
  /* The chart's scope names this product / brand / category. */
  applies: boolean;
  /* The chart has columns + rows of a real shape. */
  usable: boolean;
  /* Applies, usable, and context/system-compatible. */
  compatible: boolean;
  accepted: boolean;
  reason: SizeChartRejectionReason | null;
};

export type ResolvedSizeChart = {
  status: SizeChartResolutionStatus;
  chart: SizeChart | null;
  provenance: SizeChartProvenance | null;
  /* Every candidate considered, in a deterministic (id-asc) order. */
  considered: SizeChartEvaluation[];
};

/* The product under consideration. `systems` are the size systems the
   product actually carries (from canonical reads); empty means unknown. */
export type SizeChartTarget = {
  productId: string;
  brandId: string | null;
  category: SizeCategoryId | null;
  context: SizeContext;
  systems?: readonly SizeSystemId[];
};

/* ==== Structural usability (never fabricates, only accepts or rejects) ==== */

export function isUsableSizeChart(chart: SizeChart): boolean {
  if (chart.status === "missing") return false;
  if (!Array.isArray(chart.columns) || chart.columns.length === 0) return false;
  if (!Array.isArray(chart.rows) || chart.rows.length === 0) return false;
  const columnsOk = chart.columns.every(
    (column) =>
      typeof column.id === "string" &&
      column.id !== "" &&
      typeof column.label === "string" &&
      column.label !== "" &&
      Number.isFinite(column.order)
  );
  const rowsOk = chart.rows.every(
    (row) =>
      typeof row.id === "string" &&
      row.id !== "" &&
      typeof row.sizeLabel === "string" &&
      row.values != null &&
      typeof row.values === "object"
  );
  return columnsOk && rowsOk;
}

/* ==== Compatibility ==== */

function audiencesCompatible(
  chart: SizeContext["audience"],
  target: SizeContext["audience"]
): boolean {
  if (chart === target) return true;
  if (chart === "UNKNOWN" || target === "UNKNOWN") return true;
  const unisexPair =
    (chart === "UNISEX" && (target === "MEN" || target === "WOMEN")) ||
    (target === "UNISEX" && (chart === "MEN" || chart === "WOMEN"));
  return unisexPair;
}

function ageRangesCompatible(
  chart: SizeContext["ageRange"],
  target: SizeContext["ageRange"]
): boolean {
  if (chart == null || target == null) return true;
  const chartMin = chart.minMonths ?? Number.NEGATIVE_INFINITY;
  const chartMax = chart.maxMonths ?? Number.POSITIVE_INFINITY;
  const targetMin = target.minMonths ?? Number.NEGATIVE_INFINITY;
  const targetMax = target.maxMonths ?? Number.POSITIVE_INFINITY;
  return !(chartMax < targetMin || targetMax < chartMin);
}

function systemCompatible(
  chart: SizeChart,
  systems: readonly SizeSystemId[]
): boolean {
  if (chart.system == null || chart.system === "UNKNOWN") return true;
  if (systems.length === 0) return true;
  return systems.includes(chart.system);
}

/* Returns null when the chart is compatible with the target, otherwise the
   first concrete incompatibility reason. */
export function chartContextIncompatibility(
  chart: SizeChart,
  target: SizeChartTarget
): SizeChartRejectionReason | null {
  if (chart.context.productType !== target.context.productType) {
    return "PRODUCT_TYPE_MISMATCH";
  }
  if (!audiencesCompatible(chart.context.audience, target.context.audience)) {
    return "AUDIENCE_MISMATCH";
  }
  if (!ageRangesCompatible(chart.context.ageRange, target.context.ageRange)) {
    return "AGE_RANGE_MISMATCH";
  }
  if (!systemCompatible(chart, target.systems ?? [])) {
    return "SYSTEM_MISMATCH";
  }
  return null;
}

/* Does the chart's scope name this target? Returns null when it applies,
   otherwise the scope reason. */
function scopeInapplicability(
  chart: SizeChart,
  target: SizeChartTarget
): SizeChartRejectionReason | null {
  const scope = chart.scope;
  switch (scope.kind) {
    case "product":
      return scope.productId === target.productId ? null : "SCOPE_MISMATCH";
    case "brand":
      if (target.brandId == null || scope.brandId !== target.brandId) {
        return "SCOPE_MISMATCH";
      }
      if (target.category == null || scope.category !== target.category) {
        return "CATEGORY_MISMATCH";
      }
      return null;
    case "category":
      if (target.category == null || scope.category !== target.category) {
        return "SCOPE_MISMATCH";
      }
      return null;
    case "conversion":
      /* Conversion tables are not product size charts. */
      return "SCOPE_MISMATCH";
  }
}

/* ==== Selection ==== */

function byDeterministicPriority(
  a: SizeChart,
  b: SizeChart
): number {
  return (
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    b.version - a.version ||
    b.updatedAt.localeCompare(a.updatedAt) ||
    a.id.localeCompare(b.id)
  );
}

/* ==== Resolver ==== */

export function resolveSizeChart(
  target: SizeChartTarget,
  charts: readonly SizeChart[]
): ResolvedSizeChart {
  /* Sort by id first so `considered` and any tie-break are independent of
     the caller's ordering. */
  const ordered = [...charts].sort((a, b) => a.id.localeCompare(b.id));

  const evaluations: SizeChartEvaluation[] = [];
  const accepted: SizeChart[] = [];
  let applyingCount = 0;
  let applyingUsableCount = 0;

  for (const chart of ordered) {
    const scopeReason = scopeInapplicability(chart, target);
    const applies = scopeReason == null;

    let reason: SizeChartRejectionReason | null = scopeReason;
    let usable = false;
    let compatible = false;

    if (applies) {
      applyingCount += 1;
      const usableChart = isUsableSizeChart(chart);
      usable = usableChart;
      if (!usableChart) {
        const empty =
          chart.status === "missing" ||
          chart.columns.length === 0 ||
          chart.rows.length === 0;
        reason = empty ? "EMPTY" : "INVALID";
      } else {
        applyingUsableCount += 1;
        const incompatibility = chartContextIncompatibility(chart, target);
        if (incompatibility != null) {
          reason = incompatibility;
        } else {
          compatible = true;
          reason = null;
          accepted.push(chart);
        }
      }
    }

    evaluations.push({
      chartId: chart.id,
      priority: chart.priority,
      applies,
      usable,
      compatible,
      accepted: false,
      reason,
    });
  }

  const chosen = accepted.length > 0 ? accepted.sort(byDeterministicPriority)[0] : null;

  if (chosen != null) {
    const evaluation = evaluations.find((e) => e.chartId === chosen.id);
    if (evaluation) {
      evaluation.accepted = true;
      evaluation.reason = null;
    }
    /* Every other accepted candidate simply lost on priority. */
    for (const evaluation of evaluations) {
      if (!evaluation.accepted && evaluation.compatible) {
        evaluation.reason = "LOWER_PRIORITY";
      }
    }
    return {
      status: "FOUND",
      chart: chosen,
      provenance: PROVENANCE_BY_PRIORITY[chosen.priority],
      considered: evaluations,
    };
  }

  let status: SizeChartResolutionStatus;
  if (applyingCount === 0) {
    status = "NO_CHART";
  } else if (applyingUsableCount === 0) {
    status = "INVALID";
  } else {
    status = "NO_COMPATIBLE_CHART";
  }

  return { status, chart: null, provenance: null, considered: evaluations };
}
