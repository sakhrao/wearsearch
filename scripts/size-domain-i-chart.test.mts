/* Stage I / I15 — Size Guide resolver + UI contract (pure).

   Deterministic, no dev server and no DB required. Charts here are
   domain inputs used to prove the contract; they are NOT production
   data and are never written anywhere. */

import {
  EMPTY_SIZE_CHART_SOURCE,
  buildSizeChartView,
  formatSizeChartCellValue,
  normalizeSourceSizeChart,
  parseSizeChartRange,
  resolveChartsFromSource,
  resolveSizeChart,
  sizeChartFromNormalized,
  SIZE_CHART_HIGHLIGHT_NOTE,
  type SizeChart,
  type SizeChartColumn,
  type SizeChartRow,
  type SizeChartTarget,
} from "../src/lib/size-domain";

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

const target: SizeChartTarget = {
  productId: "p1",
  brandId: "b1",
  category: "clothing",
  context: { audience: "MEN", productType: "CLOTHING", ageRange: null },
  systems: ["INTERNATIONAL"],
};

const chestColumn: SizeChartColumn = {
  id: "chest-0",
  measurement: "chest",
  label: "Chest",
  unit: "cm",
  order: 0,
};
const waistColumn: SizeChartColumn = {
  id: "waist-1",
  measurement: "waist",
  label: "Waist",
  unit: "cm",
  order: 1,
};

const mRow: SizeChartRow = {
  id: "r-m",
  sizeOptionId: "MEN|clothing|INTERNATIONAL|M",
  sizeLabel: "M",
  values: { "chest-0": 100, "waist-1": { min: 80, max: 82 } },
};
const lRow: SizeChartRow = {
  id: "r-l",
  sizeOptionId: "MEN|clothing|INTERNATIONAL|L",
  sizeLabel: "L",
  values: { "chest-0": 104, "waist-1": null },
};

function chart(overrides: Partial<SizeChart>): SizeChart {
  return {
    id: "c1",
    scope: { kind: "product", productId: "p1" },
    priority: "product",
    version: 1,
    context: { audience: "MEN", productType: "CLOTHING", ageRange: null },
    system: "INTERNATIONAL",
    columns: [chestColumn, waistColumn],
    rows: [mRow, lRow],
    status: "available",
    source: "Brand X",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function main() {
  /* ---- 1–3 priority / provenance ---- */

  const productResolved = resolveSizeChart(target, [
    chart({
      id: "prod",
      scope: { kind: "product", productId: "p1" },
      priority: "product",
    }),
  ]);
  const productView = buildSizeChartView(productResolved);
  check(
    "I-1 a PRODUCT chart is displayed",
    productView.status === "FOUND" && productView.rows.length === 2
  );

  const brandResolved = resolveSizeChart(target, [
    chart({
      id: "brand-c",
      scope: { kind: "brand", brandId: "b1", category: "clothing" },
      priority: "brand",
    }),
  ]);
  check(
    "I-2 a BRAND chart is displayed when no product chart applies",
    brandResolved.status === "FOUND" &&
      brandResolved.provenance === "BRAND" &&
      buildSizeChartView(brandResolved).provenanceLabel === "Brand size guide"
  );

  const categoryResolved = resolveSizeChart(target, [
    chart({
      id: "cat-c",
      scope: { kind: "category", category: "clothing" },
      priority: "category",
    }),
  ]);
  check(
    "I-3 a CATEGORY chart is displayed when no product/brand chart applies",
    categoryResolved.status === "FOUND" &&
      categoryResolved.provenance === "CATEGORY" &&
      buildSizeChartView(categoryResolved).provenanceLabel ===
        "Category size guide"
  );

  /* ---- 4–6 states ---- */

  const none = resolveSizeChart(target, []);
  const noneView = buildSizeChartView(none);
  check(
    "I-4 NO_CHART renders a message with no columns/rows",
    noneView.status === "NO_CHART" &&
      noneView.message != null &&
      noneView.columns.length === 0 &&
      noneView.rows.length === 0
  );

  const incompatible = resolveSizeChart(target, [
    chart({
      id: "shoe",
      context: { audience: "MEN", productType: "FOOTWEAR", ageRange: null },
    }),
  ]);
  const incompatibleView = buildSizeChartView(incompatible);
  check(
    "I-5 NO_COMPATIBLE_CHART is explicit and renders nothing",
    incompatibleView.status === "NO_COMPATIBLE_CHART" &&
      incompatibleView.message != null &&
      incompatibleView.columns.length === 0 &&
      incompatibleView.rows.length === 0
  );

  const invalid = resolveSizeChart(target, [chart({ status: "missing" })]);
  const invalidView = buildSizeChartView(invalid);
  check(
    "I-6 INVALID is surfaced, never rendered as data",
    invalidView.status === "INVALID" &&
      invalidView.message != null &&
      invalidView.columns.length === 0 &&
      invalidView.rows.length === 0
  );

  /* ---- 7–11 provenance / system / units / dynamic columns+rows ---- */

  check(
    "I-7 provenance is preserved to the UI",
    productView.provenance === "PRODUCT" &&
      productView.provenanceLabel === "Product size guide"
  );
  check(
    "I-8 size system is preserved to the UI",
    productView.system === "INTERNATIONAL"
  );
  check(
    "I-9 column units are preserved",
    productView.columns.map((c) => c.unit).join(",") === "cm,cm"
  );
  check(
    "I-10 columns are dynamic (no universal Chest/Waist)",
    JSON.stringify(productView.columns.map((c) => c.label)) ===
      JSON.stringify(["Chest", "Waist"])
  );

  const shoeChart = chart({
    id: "shoe-ok",
    system: "EU",
    context: { audience: "MEN", productType: "FOOTWEAR", ageRange: null },
    columns: [
      {
        id: "foot-0",
        measurement: "foot_length",
        label: "Foot length",
        unit: "cm",
        order: 0,
      },
    ],
    rows: [
      {
        id: "r-42",
        sizeOptionId: "MEN|shoes|EU|42",
        sizeLabel: "42",
        values: { "foot-0": 27 },
      },
    ],
  });
  const shoeResolved = resolveSizeChart(
    { ...target, category: "footwear", context: shoeChart.context, systems: ["EU"] },
    [shoeChart]
  );
  const shoeView = buildSizeChartView(shoeResolved);
  check(
    "I-11 rows and columns follow a footwear chart dynamically",
    shoeView.status === "FOUND" &&
      shoeView.columns.length === 1 &&
      shoeView.columns[0].label === "Foot length" &&
      shoeView.rows.map((r) => r.sizeLabel).join(",") === "42"
  );

  /* ---- 12–14 ranges, partial, no fabrication ---- */

  check(
    "I-12 a source range is formatted, not converted",
    formatSizeChartCellValue({ min: 100, max: 104 }) === "100–104" &&
      formatSizeChartCellValue(100) === "100" &&
      JSON.stringify(parseSizeChartRange("100 - 104")) ===
        JSON.stringify({ min: 100, max: 104 }) &&
      parseSizeChartRange("not a range") === null
  );

  const unidentified = buildSizeChartView(productResolved);
  const lCells = unidentified.rows.find((r) => r.sizeLabel === "L")?.cells ?? [];
  check(
    "I-13 a missing cell stays empty (no fabricated measurement)",
    lCells.some((c) => c.columnId === "waist-1" && c.present === false && c.text === "")
  );

  const partialResolved = resolveSizeChart(
    {
      ...target,
      category: "footwear",
      context: { audience: "MEN", productType: "FOOTWEAR", ageRange: null },
      systems: ["EU"],
    },
    [
      sizeChartFromNormalized(
        normalizeSourceSizeChart(
          {
            id: "src-1",
            system: "EU",
            source: "Brand Y",
            columns: [{ label: "Foot Length", unit: "cm" }, { label: "Mystery" }],
            rows: [
              { sizeLabel: "42", values: ["100–104"] },
              { sizeLabel: "Custom", values: [null, null] },
            ],
          },
          { audience: "MEN", productType: "FOOTWEAR" }
        ),
        {
          id: "imp-1",
          scope: { kind: "category", category: "footwear" },
          priority: "category",
          context: { audience: "MEN", productType: "FOOTWEAR", ageRange: null },
          source: "Brand Y",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }
      ),
    ]
  );
  const partialView = buildSizeChartView(partialResolved);
  check(
    "I-14 an imported partial chart stays partial and shows only verified columns",
    partialResolved.status === "FOUND" &&
      partialResolved.chart?.status === "partial" &&
      partialView.columns.length === 1 &&
      partialView.columns[0].label === "Foot Length" &&
      partialView.rows[0].cells[0].text === "100–104"
  );

  /* ---- 15–17 import bridge + source boundary ---- */

  const bridged = sizeChartFromNormalized(
    normalizeSourceSizeChart(
      {
        id: "src-2",
        system: "EU",
        source: "Brand Z",
        columns: [{ label: "Foot Length", unit: "cm" }],
        rows: [
          { sizeLabel: "42", values: [27] },
          { sizeLabel: "43", values: [28] },
        ],
      },
      { audience: "MEN", productType: "FOOTWEAR" }
    ),
    {
      id: "imp-2",
      scope: { kind: "product", productId: "p1" },
      priority: "product",
      context: { audience: "MEN", productType: "FOOTWEAR", ageRange: null },
      source: "Brand Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }
  );
  check(
    "I-15 the bridge maps numbers and canonical size ids without guessing",
    bridged.system === "EU" &&
      bridged.rows[0].values["foot_length-0"] === 27 &&
      bridged.rows[0].sizeOptionId === "MEN|shoes|EU|42" &&
      bridged.source === "Brand Z"
  );

  const emptySourceResolved = await resolveChartsFromSource(
    EMPTY_SIZE_CHART_SOURCE,
    target
  );
  check(
    "I-16 the default (no source) boundary yields NO_CHART",
    emptySourceResolved.status === "NO_CHART"
  );

  const fakeSourceResolved = await resolveChartsFromSource(
    {
      name: "test",
      async loadCharts() {
        return [chart({ id: "src-prod" })];
      },
    },
    target
  );
  check(
    "I-17 an injected source is resolved through the single resolver",
    fakeSourceResolved.status === "FOUND" &&
      fakeSourceResolved.provenance === "PRODUCT"
  );

  /* ---- 18–19 highlighting is correspondence, not availability ---- */

  const carriedView = buildSizeChartView(productResolved, {
    carriedSizeOptionIds: ["MEN|clothing|INTERNATIONAL|M"],
  });
  const mRowView = carriedView.rows.find((r) => r.sizeLabel === "M");
  const lRowView = carriedView.rows.find((r) => r.sizeLabel === "L");
  check(
    "I-18 a chart row matching a carried canonical size is marked",
    mRowView?.highlighted === true && lRowView?.highlighted === false
  );

  const noCarriedView = buildSizeChartView(productResolved, {
    carriedSizeOptionIds: [],
  });
  check(
    "I-19 without carried sizes nothing is marked (no availability claim)",
    noCarriedView.rows.every((r) => r.highlighted === false) &&
      SIZE_CHART_HIGHLIGHT_NOTE.toLowerCase().includes("availability")
  );

  console.log(`\nI_CHART_RESULTS passed=${passed} failed=${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
