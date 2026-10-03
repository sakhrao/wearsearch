/* Stage I / I15 — Size Guide product integration (DB).

   Uses the real catalog read path (`loadProductDetail`) with an
   injected `SizeChartSource`. The injected chart is a test fixture that
   is never persisted; it only proves the UI receives the resolver
   result and that chart presence never alters size/availability data. */

import "dotenv/config";

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { loadProductDetail } from "../src/lib/product-detail";
import type {
  SizeChart,
  SizeChartSource,
  SizeChartTarget,
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

/* A test-only source that produces one product-scoped chart matching the
   requested target. No production data is created or stored. */
const matchingSource: SizeChartSource = {
  name: "i-test",
  async loadCharts(target: SizeChartTarget): Promise<SizeChart[]> {
    return [
      {
        id: `i-test-${target.productId}`,
        scope: { kind: "product", productId: target.productId },
        priority: "product",
        version: 1,
        context: target.context,
        system: target.systems?.[0] ?? null,
        columns: [
          {
            id: "chest-0",
            measurement: "chest",
            label: "Chest",
            unit: "cm",
            order: 0,
          },
        ],
        rows: [
          {
            id: "i-test-row-0",
            sizeOptionId: null,
            sizeLabel: "Reference",
            values: { "chest-0": 100 },
          },
        ],
        status: "available",
        source: "Test chart",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
  },
};

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("I-PRODUCT: NOT_MEASURED — DATABASE_URL not configured");
    console.log(`\nI_PRODUCT_RESULTS passed=${passed} failed=${failed}`);
    process.exit(failed === 0 ? 0 : 1);
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    const withResolved = await prisma.product.findFirst({
      where: {
        variants: {
          some: {
            sizeResolutionStatus: "RESOLVED",
            canonicalSizeOptionId: { not: null },
          },
        },
      },
      select: { id: true },
      orderBy: { id: "asc" },
    });

    check(
      "I-20 a real product with resolved variants exists",
      withResolved?.id != null
    );

    const productId = withResolved?.id ?? "";
    const withoutChart = productId
      ? await loadProductDetail(productId)
      : null;

    check(
      "I-21 a product without a source renders NO_CHART",
      withoutChart != null &&
        withoutChart.id === productId &&
        withoutChart.chart.status === "NO_CHART" &&
        withoutChart.chart.chart === null,
      withoutChart?.chart.status
    );

    const canonicalIds = new Set(
      (withoutChart?.sizes ?? [])
        .filter((size) => size.state === "RESOLVED" && size.canonicalSizeOptionId)
        .map((size) => size.canonicalSizeOptionId as string)
    );

    check(
      "I-22 multiple canonical sizes are exposed for the guide",
      canonicalIds.size >= 2,
      `count=${canonicalIds.size}`
    );

    const withChart = productId
      ? await loadProductDetail(productId, { chartSource: matchingSource })
      : null;

    check(
      "I-23 a matching chart is FOUND with PRODUCT provenance",
      withChart?.chart.status === "FOUND" &&
        withChart.chart.provenance === "PRODUCT" &&
        withChart.chart.chart?.columns.length === 1,
      withChart?.chart.status
    );

    const before = (withoutChart?.sizes ?? [])
      .map((size) => `${size.label}|${size.state}|${size.available}`)
      .sort()
      .join(",");
    const after = (withChart?.sizes ?? [])
      .map((size) => `${size.label}|${size.state}|${size.available}`)
      .sort()
      .join(",");

    check(
      "I-24 chart presence does not change size availability/resolution",
      before.length > 0 && before === after
    );

    check(
      "I-25 the external source link is preserved",
      withoutChart != null &&
        withChart != null &&
        withoutChart.productUrl === withChart.productUrl &&
        typeof withoutChart.hasRealProductPage === "boolean"
    );

    const unresolvedProduct = await prisma.product.findFirst({
      where: {
        variants: { some: { sizeResolutionStatus: "UNRESOLVED" } },
      },
      select: { id: true },
      orderBy: { id: "asc" },
    });

    const unresolvedDetail = unresolvedProduct
      ? await loadProductDetail(unresolvedProduct.id)
      : null;

    check(
      "I-26 unresolved sizes stay raw with no fabricated identity",
      unresolvedDetail != null &&
        unresolvedDetail.sizes.some(
          (size) =>
            size.state === "UNRESOLVED" && size.canonicalSizeOptionId === null
        ) &&
        unresolvedDetail.hasUnresolved === true,
      unresolvedProduct?.id
    );

    const missing = await loadProductDetail(
      `i-does-not-exist-${Date.now().toString(36)}`
    );
    check("I-27 an unknown product returns null (404)", missing === null);
  } finally {
    await prisma.$disconnect();
  }

  console.log(`\nI_PRODUCT_RESULTS passed=${passed} failed=${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
