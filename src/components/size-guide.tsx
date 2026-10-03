/* Stage I / I7–I11, I13 — Reusable Size Guide.

   Renders exactly what the G2 resolver returned. The component never
   selects a chart, never invents a measurement, and never hardcodes
   size labels or measurement columns: the resolved chart determines its
   own columns and rows. All state logic lives in the pure
   `buildSizeChartView`, so this file is a thin, reusable presentation.

   Wide charts scroll horizontally and cell values are never truncated. */

import {
  SIZE_CHART_HIGHLIGHT_NOTE,
  buildSizeChartView,
  type ResolvedSizeChart,
} from "@/lib/size-domain";

type SizeGuideProps = {
  chart: ResolvedSizeChart;
  /* Canonical size options this product lists. Used only to mark
     correspondence in the chart — never to claim availability. */
  carriedSizeOptionIds?: readonly string[];
};

export function SizeGuide({ chart, carriedSizeOptionIds }: SizeGuideProps) {
  const view = buildSizeChartView(chart, { carriedSizeOptionIds });

  return (
    <section>
      <h2 className="font-display text-xl font-medium text-ink">Size guide</h2>

      {view.status !== "FOUND" ? (
        <p className="mt-3 text-sm text-ink-faint">{view.message}</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {view.provenanceLabel && (
              <span className="rounded-full border border-line bg-paper-soft px-3 py-1 text-xs font-medium text-ink-soft">
                {view.provenanceLabel}
              </span>
            )}
            {view.system && (
              <span className="rounded-full border border-line bg-paper-soft px-3 py-1 text-xs font-medium text-ink-soft">
                {view.system}
              </span>
            )}
            {view.source && (
              <span className="text-xs text-ink-faint">Source: {view.source}</span>
            )}
          </div>

          <div className="mt-4 overflow-x-auto rounded-2xl border border-line">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-paper-soft text-left text-xs uppercase tracking-wide text-ink-faint">
                  <th className="whitespace-nowrap px-3 py-2">Size</th>
                  {view.columns.map((column) => (
                    <th
                      key={column.id}
                      className="whitespace-nowrap px-3 py-2"
                    >
                      {column.unit
                        ? `${column.label} (${column.unit})`
                        : column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.rows.map((row) => (
                  <tr key={row.id} className="border-t border-line">
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-ink">
                      {row.sizeLabel}
                      {row.highlighted && (
                        <span
                          className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-ink-soft"
                          title={SIZE_CHART_HIGHLIGHT_NOTE}
                        >
                          Listed
                        </span>
                      )}
                    </td>
                    {row.cells.map((cell) => (
                      <td
                        key={cell.columnId}
                        className="whitespace-nowrap px-3 py-2 text-ink-soft"
                      >
                        {cell.present ? cell.text : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {view.rows.some((row) => row.highlighted) && (
            <p className="mt-2 text-xs text-ink-faint">
              {SIZE_CHART_HIGHLIGHT_NOTE}
            </p>
          )}
        </>
      )}
    </section>
  );
}
