/* Stage I / I7–I10, I13 — Resolver result → presentational view-model.

   A pure, React-free projection of a `ResolvedSizeChart` into exactly
   what the Size Guide renders. Keeping it out of the component makes
   the UI contract deterministic and testable without a DOM.

   Rules:
     - Four states are kept distinct: FOUND / NO_CHART /
       NO_COMPATIBLE_CHART / INVALID. A non-FOUND state never carries
       columns or rows, so no incompatible chart can be rendered.
     - Columns and rows are dynamic: whatever the chosen chart declares.
     - A cell is formatted from its source value (number, range, or raw
       string); a missing cell is empty, never filled.
     - `highlighted` marks a chart row whose canonical size option the
       product lists. This is a *correspondence* marker only — it never
       claims availability, which remains the variant/offer data's job. */

import type {
  ResolvedSizeChart,
  SizeChartProvenance,
  SizeChartResolutionStatus,
} from "./resolve-chart";
import type {
  MeasurementUnit,
  SizeChartCellValue,
  SizeSystemId,
} from "./types";

export const SIZE_CHART_PROVENANCE_LABELS: Record<
  SizeChartProvenance,
  string
> = {
  PRODUCT: "Product size guide",
  BRAND: "Brand size guide",
  CATEGORY: "Category size guide",
};

export const SIZE_CHART_HIGHLIGHT_NOTE =
  "Marked sizes are listed by this product. Check the Sizes section for availability.";

export function formatSizeChartCellValue(value: SizeChartCellValue): string {
  if (value == null) return "";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return `${value.min}–${value.max}`;
}

export type SizeChartViewColumn = {
  id: string;
  label: string;
  unit: MeasurementUnit;
  order: number;
};

export type SizeChartViewCell = {
  columnId: string;
  text: string;
  present: boolean;
};

export type SizeChartViewRow = {
  id: string;
  sizeLabel: string;
  sizeOptionId: string | null;
  highlighted: boolean;
  cells: SizeChartViewCell[];
};

export type SizeChartView = {
  status: SizeChartResolutionStatus;
  provenance: SizeChartProvenance | null;
  provenanceLabel: string | null;
  source: string | null;
  system: SizeSystemId | null;
  columns: SizeChartViewColumn[];
  rows: SizeChartViewRow[];
  message: string | null;
};

const STATE_MESSAGES: Record<
  Exclude<SizeChartResolutionStatus, "FOUND">,
  string
> = {
  NO_CHART:
    "No size chart is available for this product. Measurements are never estimated, so nothing is shown until a real chart exists.",
  NO_COMPATIBLE_CHART:
    "Size charts exist for this brand or category, but none matches this product's sizing context, so none is shown.",
  INVALID:
    "The available size chart data for this product is malformed and cannot be displayed.",
};

export function buildSizeChartView(
  resolved: ResolvedSizeChart,
  options?: { carriedSizeOptionIds?: readonly string[] }
): SizeChartView {
  const status = resolved.status;

  if (status === "FOUND" && resolved.chart != null) {
    const carried = new Set(options?.carriedSizeOptionIds ?? []);
    const chart = resolved.chart;

    const columns: SizeChartViewColumn[] = [...chart.columns]
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      .map((column) => ({
        id: column.id,
        label: column.label,
        unit: column.unit,
        order: column.order,
      }));

    const rows: SizeChartViewRow[] = chart.rows.map((row) => ({
      id: row.id,
      sizeLabel: row.sizeLabel,
      sizeOptionId: row.sizeOptionId,
      highlighted: row.sizeOptionId != null && carried.has(row.sizeOptionId),
      cells: columns.map((column) => {
        const value = row.values[column.id] ?? null;
        return {
          columnId: column.id,
          text: formatSizeChartCellValue(value),
          present: value != null,
        };
      }),
    }));

    return {
      status: "FOUND",
      provenance: resolved.provenance,
      provenanceLabel:
        resolved.provenance != null
          ? SIZE_CHART_PROVENANCE_LABELS[resolved.provenance]
          : null,
      source: chart.source ?? null,
      system: chart.system ?? null,
      columns,
      rows,
      message: null,
    };
  }

  return {
    status,
    provenance: null,
    provenanceLabel: null,
    source: null,
    system: null,
    columns: [],
    rows: [],
    message: status === "FOUND" ? null : STATE_MESSAGES[status],
  };
}
