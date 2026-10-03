/* Stage I / I6 + I14 — Size chart source boundary.

   The G2 resolver decides *which* chart applies. This module is the one
   place that decides *where* candidate charts come from, so a future
   importer (product feed, brand-provided table, category reference)
   can supply charts through the existing `SizeChart` contract without
   the UI or the resolver knowing the source.

   No real chart source exists today (see
   `docs/size-system/PHASE-07-I1-CHART-DATA-AUDIT.md`). The default
   source is therefore deliberately empty: it returns zero candidates,
   so the resolver reports `NO_CHART`. No chart is ever synthesized
   here. A real source must be added explicitly and reviewed. */

import {
  resolveSizeChart,
  type ResolvedSizeChart,
  type SizeChartTarget,
} from "./resolve-chart";
import type { SizeChart } from "./types";

export type SizeChartSource = {
  /* Identifies the source for diagnostics; never user-facing copy. */
  readonly name: string;
  loadCharts(target: SizeChartTarget): Promise<readonly SizeChart[]>;
};

/* The honest default: no chart data available. */
export const EMPTY_SIZE_CHART_SOURCE: SizeChartSource = {
  name: "none",
  async loadCharts() {
    return [];
  },
};

/* Load the candidate charts for a target and run the single resolver. */
export async function resolveChartsFromSource(
  source: SizeChartSource,
  target: SizeChartTarget
): Promise<ResolvedSizeChart> {
  const charts = await source.loadCharts(target);
  return resolveSizeChart(target, charts);
}
