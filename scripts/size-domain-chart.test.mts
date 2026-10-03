/* Stage G / G2 — Size Chart Resolver.

   Pure, fixture-driven, DB-free. Verifies:
     G2-1  product chart wins
     G2-2  brand fallback
     G2-3  category fallback
     G2-4  no chart
     G2-5  incompatible chart rejected (never silent)
     G2-6  footwear chart + foot_length column
     G2-7  clothing chart + chest/waist columns
     G2-8  bag chart + bag_* columns
     G2-9  dynamic columns preserved, chart object untouched
     G2-10 priority provenance
     G2-11 deterministic selection / tie-breaks / order independence
     G2-12 no fabrication (empty/partial, null values preserved)
     G2-13 size-system compatibility
     G2-14 invalid product chart is recorded and does not block a fallback
     G2-15 conversion tables are not product charts
     G2-16 priority order contract */

import {
  SIZE_CHART_PRIORITY_ORDER,
  chartContextIncompatibility,
  isUsableSizeChart,
  resolveSizeChart,
  type SizeChart,
  type SizeChartColumn,
  type SizeChartRow,
  type SizeChartTarget,
  type SizeContext,
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

/* ==== fixtures ==== */

const clothingCtx: SizeContext = {
  audience: "WOMEN",
  productType: "CLOTHING",
  ageRange: null,
};
const footwearCtx: SizeContext = {
  audience: "WOMEN",
  productType: "FOOTWEAR",
  ageRange: null,
};
const bagCtx: SizeContext = {
  audience: "UNKNOWN",
  productType: "ACCESSORY",
  ageRange: null,
};

const clothingTarget: SizeChartTarget = {
  productId: "p1",
  brandId: "b1",
  category: "clothing",
  context: clothingCtx,
  systems: ["US"],
};
const footwearTarget: SizeChartTarget = {
  productId: "p2",
  brandId: "b2",
  category: "footwear",
  context: footwearCtx,
  systems: ["US"],
};
const bagTarget: SizeChartTarget = {
  productId: "p3",
  brandId: "b3",
  category: "bag",
  context: bagCtx,
  systems: [],
};

function column(
  id: string,
  measurement: SizeChartColumn["measurement"],
  label: string,
  unit: SizeChartColumn["unit"],
  order: number
): SizeChartColumn {
  return { id, measurement, label, unit, order };
}

function row(
  id: string,
  sizeLabel: string,
  values: Record<string, number | null>
): SizeChartRow {
  return { id, sizeOptionId: null, sizeLabel, values };
}

const clothingColumns: SizeChartColumn[] = [
  column("chest-0", "chest", "Chest", "cm", 0),
  column("waist-1", "waist", "Waist", "cm", 1),
];
const clothingRows: SizeChartRow[] = [
  row("r-s", "S", { "chest-0": 84, "waist-1": 66 }),
  row("r-m", "M", { "chest-0": 90, "waist-1": 72 }),
  row("r-l", "L", { "chest-0": 96, "waist-1": 78 }),
];

function chart(overrides: Partial<SizeChart> & Pick<SizeChart, "id" | "scope" | "priority">): SizeChart {
  return {
    version: 1,
    context: clothingCtx,
    columns: clothingColumns,
    rows: clothingRows,
    status: "available",
    source: "test",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const productChart = chart({
  id: "c-product",
  scope: { kind: "product", productId: "p1" },
  priority: "product",
  version: 2,
});
const brandChart = chart({
  id: "c-brand",
  scope: { kind: "brand", brandId: "b1", category: "clothing" },
  priority: "brand",
});
const categoryChart = chart({
  id: "c-category",
  scope: { kind: "category", category: "clothing" },
  priority: "category",
});
const footwearChart = chart({
  id: "c-footwear",
  scope: { kind: "category", category: "footwear" },
  priority: "category",
  context: footwearCtx,
  columns: [column("foot_length-0", "foot_length", "Foot length", "cm", 0)],
  rows: [row("r-38", "38", { "foot_length-0": 24.5 })],
});
const bagChart = chart({
  id: "c-bag",
  scope: { kind: "category", category: "bag" },
  priority: "category",
  context: bagCtx,
  columns: [
    column("bag_width-0", "bag_width", "Width", "cm", 0),
    column("bag_height-1", "bag_height", "Height", "cm", 1),
    column("bag_depth-2", "bag_depth", "Depth", "cm", 2),
    column("strap_drop-3", "strap_drop", "Strap drop", "cm", 3),
  ],
  rows: [row("r-one", "One Size", { "bag_width-0": 30, "bag_height-1": 22, "bag_depth-2": 10, "strap_drop-3": 55 })],
});
const wrongTypeChart = chart({
  id: "c-wrong-type",
  scope: { kind: "product", productId: "p1" },
  priority: "product",
  context: footwearCtx,
  columns: [column("foot_length-0", "foot_length", "Foot length", "cm", 0)],
  rows: [row("r-38", "38", { "foot_length-0": 24.5 })],
});
const euChart = chart({
  id: "c-eu",
  scope: { kind: "category", category: "clothing" },
  priority: "category",
  system: "EU",
});
const emptyChart = chart({
  id: "c-empty",
  scope: { kind: "product", productId: "p1" },
  priority: "product",
  columns: [],
  rows: [],
});
const missingChart = chart({
  id: "c-missing",
  scope: { kind: "product", productId: "p1" },
  priority: "product",
  status: "missing",
});
const conversionChart = chart({
  id: "c-conversion",
  scope: { kind: "conversion", from: "US", to: "EU" },
  priority: "category",
});

function reasonFor(
  result: ReturnType<typeof resolveSizeChart>,
  chartId: string
) {
  return result.considered.find((e) => e.chartId === chartId) ?? null;
}

/* ==== G2-1 product chart wins ==== */
{
  const result = resolveSizeChart(clothingTarget, [
    categoryChart,
    brandChart,
    productChart,
  ]);
  check(
    "G2-1 product chart wins over brand and category",
    result.status === "FOUND" &&
      result.chart?.id === "c-product" &&
      result.provenance === "PRODUCT" &&
      reasonFor(result, "c-product")?.accepted === true &&
      reasonFor(result, "c-brand")?.reason === "LOWER_PRIORITY" &&
      reasonFor(result, "c-category")?.reason === "LOWER_PRIORITY",
    JSON.stringify(result.considered)
  );
}

/* ==== G2-2 brand fallback ==== */
{
  const result = resolveSizeChart(clothingTarget, [categoryChart, brandChart]);
  check(
    "G2-2 brand chart is the fallback when no product chart exists",
    result.status === "FOUND" &&
      result.chart?.id === "c-brand" &&
      result.provenance === "BRAND",
    JSON.stringify(result)
  );
}

/* ==== G2-3 category fallback ==== */
{
  const result = resolveSizeChart(clothingTarget, [categoryChart]);
  check(
    "G2-3 category chart is the fallback when no product/brand chart exists",
    result.status === "FOUND" &&
      result.chart?.id === "c-category" &&
      result.provenance === "CATEGORY",
    JSON.stringify(result)
  );
}

/* ==== G2-4 no chart ==== */
{
  const result = resolveSizeChart(clothingTarget, []);
  check(
    "G2-4 no candidates yields NO_CHART with no chart/provenance",
    result.status === "NO_CHART" &&
      result.chart === null &&
      result.provenance === null &&
      result.considered.length === 0,
    JSON.stringify(result)
  );
}

/* ==== G2-5 incompatible chart is rejected, never silent ==== */
{
  const only = resolveSizeChart(clothingTarget, [wrongTypeChart]);
  const withBrand = resolveSizeChart(clothingTarget, [
    wrongTypeChart,
    brandChart,
  ]);
  check(
    "G2-5 stale product chart is rejected with a recorded reason",
    only.status === "NO_COMPATIBLE_CHART" &&
      reasonFor(only, "c-wrong-type")?.reason === "PRODUCT_TYPE_MISMATCH" &&
      reasonFor(only, "c-wrong-type")?.compatible === false &&
      withBrand.status === "FOUND" &&
      withBrand.chart?.id === "c-brand" &&
      reasonFor(withBrand, "c-wrong-type")?.reason === "PRODUCT_TYPE_MISMATCH",
    JSON.stringify({ only, withBrand })
  );
}

/* ==== G2-6 footwear chart ==== */
{
  const result = resolveSizeChart(footwearTarget, [footwearChart]);
  check(
    "G2-6 footwear chart resolves with a foot_length column",
    result.status === "FOUND" &&
      result.chart?.id === "c-footwear" &&
      result.chart?.columns[0].measurement === "foot_length" &&
      result.chart?.context.productType === "FOOTWEAR",
    JSON.stringify(result.chart?.columns)
  );
}

/* ==== G2-7 clothing chart ==== */
{
  const result = resolveSizeChart(clothingTarget, [categoryChart]);
  check(
    "G2-7 clothing chart resolves with chest + waist columns",
    result.status === "FOUND" &&
      result.chart?.columns.map((c) => c.measurement).join(",") ===
        "chest,waist",
    JSON.stringify(result.chart?.columns)
  );
}

/* ==== G2-8 bag chart ==== */
{
  const result = resolveSizeChart(bagTarget, [bagChart]);
  check(
    "G2-8 bag chart resolves with bag_width/height/depth/strap_drop",
    result.status === "FOUND" &&
      result.chart?.columns.map((c) => c.measurement).join(",") ===
        "bag_width,bag_height,bag_depth,strap_drop",
    JSON.stringify(result.chart?.columns)
  );
}

/* ==== G2-9 dynamic columns preserved, object untouched ==== */
{
  const dynamic = chart({
    id: "c-dynamic",
    scope: { kind: "product", productId: "p1" },
    priority: "product",
    columns: [
      column("sleeve-0", "sleeve", "Sleeve", "cm", 0),
      column("neck-1", "neck", "Neck", "in", 1),
    ],
    rows: [row("r-a", "Alpha A", { "sleeve-0": 60, "neck-1": 15.5 })],
  });
  const result = resolveSizeChart(clothingTarget, [dynamic]);
  check(
    "G2-9 dynamic columns pass through untouched (same object)",
    result.status === "FOUND" &&
      result.chart === dynamic &&
      result.chart?.columns.length === 2 &&
      result.chart?.columns[1].unit === "in" &&
      result.chart?.rows[0].values["neck-1"] === 15.5,
    JSON.stringify(result.chart?.columns)
  );
}

/* ==== G2-10 provenance ==== */
{
  const p = resolveSizeChart(clothingTarget, [productChart]).provenance;
  const b = resolveSizeChart(clothingTarget, [brandChart]).provenance;
  const c = resolveSizeChart(clothingTarget, [categoryChart]).provenance;
  check(
    "G2-10 provenance mirrors the winning priority",
    p === "PRODUCT" && b === "BRAND" && c === "CATEGORY",
    JSON.stringify({ p, b, c })
  );
}

/* ==== G2-11 deterministic selection + tie-breaks ==== */
{
  const forward = resolveSizeChart(clothingTarget, [
    productChart,
    brandChart,
    categoryChart,
  ]);
  const reverse = resolveSizeChart(clothingTarget, [
    categoryChart,
    brandChart,
    productChart,
  ]);
  const sameOrder =
    JSON.stringify(forward.considered) === JSON.stringify(reverse.considered) &&
    forward.chart?.id === reverse.chart?.id;

  const v1 = chart({
    id: "c-v1",
    scope: { kind: "category", category: "clothing" },
    priority: "category",
    version: 1,
    updatedAt: "2026-06-01T00:00:00.000Z",
  });
  const v2 = chart({
    id: "c-v2",
    scope: { kind: "category", category: "clothing" },
    priority: "category",
    version: 3,
    updatedAt: "2025-01-01T00:00:00.000Z",
  });
  const byVersion = resolveSizeChart(clothingTarget, [v1, v2]);

  const newer = chart({
    id: "c-newer",
    scope: { kind: "category", category: "clothing" },
    priority: "category",
    version: 2,
    updatedAt: "2026-09-01T00:00:00.000Z",
  });
  const older = chart({
    id: "c-older",
    scope: { kind: "category", category: "clothing" },
    priority: "category",
    version: 2,
    updatedAt: "2024-01-01T00:00:00.000Z",
  });
  const byUpdatedAt = resolveSizeChart(clothingTarget, [older, newer]);

  const a = chart({
    id: "c-a",
    scope: { kind: "category", category: "clothing" },
    priority: "category",
    version: 2,
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const z = chart({
    id: "c-z",
    scope: { kind: "category", category: "clothing" },
    priority: "category",
    version: 2,
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const byId = resolveSizeChart(clothingTarget, [z, a]);

  check(
    "G2-11 selection is deterministic across order, version, updatedAt, id",
    sameOrder &&
      byVersion.chart?.id === "c-v2" &&
      byUpdatedAt.chart?.id === "c-newer" &&
      byId.chart?.id === "c-a",
    JSON.stringify({
      sameOrder,
      version: byVersion.chart?.id,
      updatedAt: byUpdatedAt.chart?.id,
      id: byId.chart?.id,
    })
  );
}

/* ==== G2-12 no fabrication ==== */
{
  const empty = resolveSizeChart(clothingTarget, [emptyChart]);
  const missing = resolveSizeChart(clothingTarget, [missingChart]);
  const partial = chart({
    id: "c-partial",
    scope: { kind: "product", productId: "p1" },
    priority: "product",
    status: "partial",
    columns: [column("chest-0", "chest", "Chest", "cm", 0)],
    rows: [row("r-m", "M", { "chest-0": null })],
  });
  const partialResult = resolveSizeChart(clothingTarget, [partial]);
  check(
    "G2-12 unusable charts are rejected; null values are never filled in",
    empty.status === "INVALID" &&
      reasonFor(empty, "c-empty")?.reason === "EMPTY" &&
      missing.status === "INVALID" &&
      reasonFor(missing, "c-missing")?.reason === "EMPTY" &&
      partialResult.status === "FOUND" &&
      partialResult.chart?.rows[0].values["chest-0"] === null &&
      isUsableSizeChart(partial) === true,
    JSON.stringify({ empty, missing, partialResult })
  );
}

/* ==== G2-13 size-system compatibility ==== */
{
  const us = resolveSizeChart(clothingTarget, [euChart]);
  const euTarget: SizeChartTarget = {
    ...clothingTarget,
    productId: "p-eu",
    systems: ["EU"],
  };
  const eu = resolveSizeChart(euTarget, [euChart]);
  check(
    "G2-13 a US product never silently receives an EU chart",
    us.status === "NO_COMPATIBLE_CHART" &&
      reasonFor(us, "c-eu")?.reason === "SYSTEM_MISMATCH" &&
      eu.status === "FOUND" &&
      eu.chart?.id === "c-eu",
    JSON.stringify({ us, eu })
  );
}

/* ==== G2-14 invalid product chart is recorded, fallback still works ==== */
{
  const result = resolveSizeChart(clothingTarget, [emptyChart, brandChart]);
  check(
    "G2-14 an unusable product chart is recorded (not silent) and falls back",
    result.status === "FOUND" &&
      result.chart?.id === "c-brand" &&
      result.provenance === "BRAND" &&
      reasonFor(result, "c-empty")?.usable === false &&
      reasonFor(result, "c-empty")?.reason === "EMPTY",
    JSON.stringify(result.considered)
  );
}

/* ==== G2-15 conversion tables are not product charts ==== */
{
  const result = resolveSizeChart(clothingTarget, [conversionChart]);
  check(
    "G2-15 conversion scope is not treated as a product chart",
    result.status === "NO_CHART" &&
      reasonFor(result, "c-conversion")?.reason === "SCOPE_MISMATCH",
    JSON.stringify(result)
  );
}

/* ==== G2-16 priority order contract ==== */
{
  const product = chart({
    id: "c-p",
    scope: { kind: "product", productId: "p1" },
    priority: "product",
  });
  check(
    "G2-16 priority order is product > brand > category",
    SIZE_CHART_PRIORITY_ORDER.join(",") === "product,brand,category" &&
      chartContextIncompatibility(productChart, clothingTarget) === null &&
      chartContextIncompatibility(product, clothingTarget) === null,
    SIZE_CHART_PRIORITY_ORDER.join(",")
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
