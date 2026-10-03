/* Stage K / K10 + K11 — Future size-chart source contract tests.
 *
 * Exercises the *existing* boundary with a hypothetical approved source:
 *   SizeChartSource -> NormalizedSizeChart -> SizeChart
 *     -> resolveSizeChart -> buildSizeChartView
 *
 * The fixture is TEST ONLY — NOT PRODUCTION DATA (see
 * scripts/fixtures/size-chart-source-fixture.ts). Nothing is persisted and
 * no production module is changed.
 *
 * The contract must fail closed: missing system, missing context, empty
 * charts, unmapped identifiers, and near-miss identifiers all yield NO_CHART
 * rather than a guessed or fuzzy-matched chart. */

import {
  buildSizeChartView,
  resolveChartsFromSource,
  type SizeChartTarget,
} from "../src/lib/size-domain";
import {
  EXAMPLE_APPROVED_SOURCE_RECORD,
  EXAMPLE_IDENTITY_MAPS,
  FIXTURE_MARKER,
  buildFixtureSource,
  type FixtureIdentityMaps,
  type FixtureSourceRecord,
} from "./fixtures/size-chart-source-fixture";

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

const productTarget: SizeChartTarget = {
  productId: "canonical-product-001",
  brandId: "canonical-brand-001",
  category: "clothing",
  context: { audience: "WOMEN", productType: "CLOTHING", ageRange: null },
  systems: ["US"],
};

function record(overrides: Partial<FixtureSourceRecord>): FixtureSourceRecord {
  return { ...EXAMPLE_APPROVED_SOURCE_RECORD, ...overrides };
}

async function main() {
  check("K-0 the fixture is explicitly marked test-only", FIXTURE_MARKER.includes("TEST ONLY"));

  const exampleSource = buildFixtureSource(
    [EXAMPLE_APPROVED_SOURCE_RECORD],
    EXAMPLE_IDENTITY_MAPS
  );

  /* K-1 stable product mapping */
  const productResolved = await resolveChartsFromSource(
    exampleSource,
    productTarget
  );
  check(
    "K-1 an exact sourceProductId -> Product.id mapping yields a PRODUCT chart",
    productResolved.status === "FOUND" &&
      productResolved.provenance === "PRODUCT" &&
      productResolved.chart?.scope.kind === "product" &&
      productResolved.chart.scope.productId === "canonical-product-001",
    productResolved.status
  );

  /* K-2 stable brand mapping */
  const brandRecord = record({
    sourceProductId: "brand-only-product",
    sourceBrandId: "example-brand-001",
  });
  const brandSource = buildFixtureSource([brandRecord], EXAMPLE_IDENTITY_MAPS);
  const brandResolved = await resolveChartsFromSource(brandSource, productTarget);
  check(
    "K-2 an exact sourceBrandId -> Brand.id mapping yields a BRAND chart",
    brandResolved.status === "FOUND" &&
      brandResolved.provenance === "BRAND" &&
      brandResolved.chart?.scope.kind === "brand",
    brandResolved.status
  );

  /* K-3 category mapping */
  const categoryRecord = record({
    sourceProductId: "category-only-product",
    sourceBrandId: null,
  });
  const categorySource = buildFixtureSource(
    [categoryRecord],
    EXAMPLE_IDENTITY_MAPS
  );
  const categoryResolved = await resolveChartsFromSource(
    categorySource,
    productTarget
  );
  check(
    "K-3 a mapped source category yields a CATEGORY chart",
    categoryResolved.status === "FOUND" &&
      categoryResolved.provenance === "CATEGORY" &&
      categoryResolved.chart?.scope.kind === "category",
    categoryResolved.status
  );

  /* K-4 explicit system preserved */
  check(
    "K-4 the explicit source system is preserved (US)",
    productResolved.chart?.system === "US"
  );

  /* K-5 explicit units preserved */
  check(
    "K-5 explicit column units are preserved (in)",
    productResolved.chart?.columns.every((column) => column.unit === "in") ===
      true,
    productResolved.chart?.columns.map((c) => c.unit).join(",")
  );

  /* K-6 measurement range preserved and formatted, never converted */
  const chest = productResolved.chart?.rows[0]?.values["chest-0"];
  const rangeValue =
    chest != null && typeof chest === "object" ? chest : null;
  check(
    "K-6 a source range is preserved as {min,max}",
    rangeValue != null && rangeValue.min === 36 && rangeValue.max === 38,
    JSON.stringify(chest)
  );
  const view = buildSizeChartView(productResolved);
  check(
    "K-6b the range is formatted verbatim (36–38), not converted",
    view.rows[0]?.cells.find((cell) => cell.columnId === "chest-0")?.text ===
      "36–38"
  );

  /* K-7 null measurement preserved (never filled) */
  const nullRecord = record({
    rows: [
      { sizeLabel: "S", values: ["36–38", "30–32"] },
      { sizeLabel: "M", values: ["39–41", null] },
    ],
  });
  const nullSource = buildFixtureSource([nullRecord], EXAMPLE_IDENTITY_MAPS);
  const nullResolved = await resolveChartsFromSource(nullSource, productTarget);
  const nullView = buildSizeChartView(nullResolved);
  const waistCell = nullView.rows
    .find((row) => row.sizeLabel === "M")
    ?.cells.find((cell) => cell.columnId === "waist-1");
  check(
    "K-7 a null source measurement stays empty (present=false)",
    waistCell != null && waistCell.present === false && waistCell.text === "",
    JSON.stringify(waistCell)
  );

  /* K-8 missing chart */
  const noChartResolved = await resolveChartsFromSource(exampleSource, {
    ...productTarget,
    productId: "some-unmapped-product",
    brandId: null,
    category: null,
  } as SizeChartTarget);
  check(
    "K-8 a target with no mapped chart yields NO_CHART",
    noChartResolved.status === "NO_CHART" && noChartResolved.chart === null,
    noChartResolved.status
  );

  /* K-9 invalid mapping fails closed (mapped to a different product) */
  const misdirected: FixtureIdentityMaps = {
    ...EXAMPLE_IDENTITY_MAPS,
    product: { ...EXAMPLE_IDENTITY_MAPS.product, "example-product-001": "other-product-999" },
  };
  const misdirectedSource = buildFixtureSource(
    [EXAMPLE_APPROVED_SOURCE_RECORD],
    misdirected
  );
  const misdirectedResolved = await resolveChartsFromSource(
    misdirectedSource,
    productTarget
  );
  check(
    "K-9 a product mapped elsewhere fails closed (NO_CHART, no fallback)",
    misdirectedResolved.status === "NO_CHART" &&
      misdirectedResolved.chart === null
  );

  /* K-10 provenance preservation */
  check(
    "K-10 provenance is preserved to the view (Product size guide)",
    view.provenance === "PRODUCT" &&
      view.provenanceLabel === "Product size guide",
    view.provenanceLabel ?? "null"
  );

  /* K-11 source identity preservation */
  check(
    "K-11 source identity and row labels are preserved verbatim",
    productResolved.chart?.id === "example-product-001|product" &&
      productResolved.chart?.source === "Example Approved Source" &&
      view.rows.map((row) => row.sizeLabel).join(",") === "S,M",
    `${productResolved.chart?.id} / ${view.rows.map((r) => r.sizeLabel).join(",")}`
  );

  /* K-12 no fuzzy matching */
  const fuzzyResolved = await resolveChartsFromSource(exampleSource, {
    ...productTarget,
    productId: "canonical-product-001-near",
  } as SizeChartTarget);
  const caseResolved = await resolveChartsFromSource(exampleSource, {
    ...productTarget,
    productId: "Canonical-Product-001",
  } as SizeChartTarget);
  check(
    "K-12 near-miss / different-case identifiers never match (no fuzzy)",
    fuzzyResolved.status === "NO_CHART" && caseResolved.status === "NO_CHART"
  );

  /* K-13 no fabricated values */
  const sourceColumnCount = EXAMPLE_APPROVED_SOURCE_RECORD.columns.length;
  const allPresentHaveValue = view.rows.every((row) =>
    row.cells.every((cell) =>
      cell.present ? cell.text.trim() !== "" : cell.text === ""
    )
  );
  check(
    "K-13 columns/rows never exceed the source and no value is invented",
    view.columns.length === sourceColumnCount &&
      view.rows.length === EXAMPLE_APPROVED_SOURCE_RECORD.rows.length &&
      allPresentHaveValue
  );

  /* K-14 fail closed: missing explicit system */
  const noSystemSource = buildFixtureSource(
    [record({ system: null })],
    EXAMPLE_IDENTITY_MAPS
  );
  const noSystemResolved = await resolveChartsFromSource(
    noSystemSource,
    productTarget
  );
  check(
    "K-14 a record without an explicit system fails closed (NO_CHART)",
    noSystemResolved.status === "NO_CHART"
  );

  /* K-15 fail closed: missing required context */
  const noAudienceSource = buildFixtureSource(
    [
      record({
        context: { audience: null, productType: "CLOTHING", ageRange: null },
      }),
    ],
    EXAMPLE_IDENTITY_MAPS
  );
  const noAudienceResolved = await resolveChartsFromSource(
    noAudienceSource,
    productTarget
  );
  const noProductTypeSource = buildFixtureSource(
    [
      record({
        context: { audience: "WOMEN", productType: null, ageRange: null },
      }),
    ],
    EXAMPLE_IDENTITY_MAPS
  );
  const noProductTypeResolved = await resolveChartsFromSource(
    noProductTypeSource,
    productTarget
  );
  check(
    "K-15 a record missing audience/productType fails closed (NO_CHART)",
    noAudienceResolved.status === "NO_CHART" &&
      noProductTypeResolved.status === "NO_CHART"
  );

  /* K-16 fail closed: empty chart is missing, never filled */
  const emptySource = buildFixtureSource(
    [record({ columns: [], rows: [] })],
    EXAMPLE_IDENTITY_MAPS
  );
  const emptyResolved = await resolveChartsFromSource(emptySource, productTarget);
  check(
    "K-16 an empty source chart fails closed (NO_CHART, never filled)",
    emptyResolved.status === "NO_CHART"
  );

  console.log(`\nK_SOURCE_CONTRACT_RESULTS passed=${passed} failed=${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
