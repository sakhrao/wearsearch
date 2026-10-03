/* Stage I / I2–I5 — Normalized chart → canonical SizeChart bridge.

   The Stage A–F pipeline can already parse a raw source chart into a
   `NormalizedSizeChart` (`normalizeSourceSizeChart`): columns validated
   against the measurement registry, units preserved, rows carrying the
   canonical size id, every value kept as `{ number, unit, raw }`, and a
   `available | partial | missing` status.

   The G2 resolver, however, consumes the canonical `SizeChart` shape.
   This module is the missing bridge: it maps a `NormalizedSizeChart`
   plus identity/scope metadata into a `SizeChart` without inventing a
   single measurement.

   Guarantees:
     - Only resolved measurement columns are carried (an unresolved label
       has no measurement type or unit, so it cannot be displayed as a
       measurement). The normalized report still records them.
     - A cell is an exact number, a source range, the raw source string,
       or null. Null stays null — never filled.
     - `partial` / `missing` status is preserved verbatim, so a partial
       source chart stays partial. */

import type { NormalizedSizeChart } from "./normalization-types";
import type {
  SizeChart,
  SizeChartCellValue,
  SizeChartColumn,
  SizeChartPriority,
  SizeChartRange,
  SizeChartScope,
  SizeContext,
} from "./types";

const RANGE_PATTERN =
  /^\s*(\d+(?:[.,]\d+)?)\s*(?:–|—|-|to)\s*(\d+(?:[.,]\d+)?)\s*$/i;

function toFiniteNumber(raw: string): number | null {
  const parsed = Number.parseFloat(raw.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

/* A source range like "100–104", "100 - 104", or "100 to 104".
   Returns null when the string is not a clean two-number range; the
   caller then preserves the raw string instead of guessing. */
export function parseSizeChartRange(raw: string): SizeChartRange | null {
  const match = RANGE_PATTERN.exec(raw);
  if (!match) return null;
  const min = toFiniteNumber(match[1]);
  const max = toFiniteNumber(match[2]);
  if (min == null || max == null) return null;
  return { min, max };
}

function toCellValue(
  number: number | null,
  raw: number | string | null
): SizeChartCellValue {
  if (number != null) return number;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const range = parseSizeChartRange(trimmed);
    if (range != null) return range;
    /* Not numeric and not a clean range: preserve the source verbatim. */
    return trimmed;
  }
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }
  return null;
}

export type SizeChartImportMeta = {
  /* Stable chart identity in the canonical registry. */
  id: string;
  scope: SizeChartScope;
  priority: SizeChartPriority;
  /* The product context this chart is authored for. */
  context: SizeContext;
  /* Human-readable provenance (brand, retailer, feed name, ...). */
  source: string;
  updatedAt: string;
  version?: number;
};

export function sizeChartFromNormalized(
  normalized: NormalizedSizeChart,
  meta: SizeChartImportMeta
): SizeChart {
  const columns: SizeChartColumn[] = normalized.columns
    .filter((column) => column.column != null)
    .map((column) => column.column as SizeChartColumn);

  const columnIds = new Set(columns.map((column) => column.id));

  const rows = normalized.rows.map((row, index) => {
    const values: Record<string, SizeChartCellValue> = {};
    for (const value of row.values) {
      if (value.columnId == null || !columnIds.has(value.columnId)) continue;
      values[value.columnId] = toCellValue(value.number, value.raw);
    }
    return {
      id: `${meta.id}-row-${index}`,
      sizeOptionId: row.canonicalSizeOptionId,
      sizeLabel: row.sourceSizeLabel,
      values,
    };
  });

  return {
    id: meta.id,
    scope: meta.scope,
    priority: meta.priority,
    version: meta.version ?? 1,
    context: meta.context,
    system: normalized.system ?? null,
    columns,
    rows,
    status: normalized.status,
    source: meta.source,
    updatedAt: meta.updatedAt,
  };
}
