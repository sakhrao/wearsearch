/* Stage C — read-only live-catalog coverage measurement.

   This is an ANALYSIS path, not a test: it reads the real Product /
   ProductVariant / ProductOffer / ProductOfferVariant rows, runs the
   deterministic Stage C adapter + coverage analyzer, and prints the
   report. It never writes, never connects unless DATABASE_URL is set,
   and prints LIVE_CATALOG_COVERAGE: NOT_MEASURED when no database is
   configured (never fabricates statistics).

   Run: npm run size-domain-coverage */

import "dotenv/config";

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import {
  buildSizeCoverage,
  integrateProductSizes,
  type ProductSizeInput,
} from "../src/lib/size-domain";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("LIVE_CATALOG_COVERAGE: NOT_MEASURED");
    console.log("reason: DATABASE_URL is not configured");
    return;
  }

  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  });
  const prisma = new PrismaClient({ adapter });

  try {
    const products = await prisma.product.findMany({
      select: {
        id: true,
        gender: true,
        source: { select: { id: true, name: true } },
        category: { select: { name: true } },
        variants: {
          select: {
            id: true,
            availability: true,
            size: {
              select: {
                value: true,
                system: true,
                productType: true,
                audience: true,
              },
            },
          },
        },
        offers: {
          select: {
            id: true,
            source: { select: { id: true, name: true } },
            variants: {
              select: {
                variantKey: true,
                sizeValue: true,
                sizeSystem: true,
                sizeProductType: true,
                sizeAudience: true,
                availability: true,
              },
            },
          },
        },
      },
      orderBy: { id: "asc" },
    });

    const inputs: ProductSizeInput[] = products.map((p) => ({
      productId: p.id,
      context: {
        gender: p.gender,
        categoryName: p.category.name,
        sourceId: p.source.id,
        sourceName: p.source.name,
      },
      variants: p.variants.map((v) => ({
        variantId: v.id,
        size: v.size
          ? {
              value: v.size.value,
              system: v.size.system,
              productType: v.size.productType,
              audience: v.size.audience,
            }
          : null,
        availability: v.availability,
      })),
      offerVariants: p.offers.flatMap((offer) =>
        offer.variants.map((ov) => ({
          offerId: offer.id,
          variantKey: ov.variantKey,
          sourceId: offer.source.id,
          sourceName: offer.source.name,
          sizeValue: ov.sizeValue,
          sizeSystem: ov.sizeSystem,
          sizeProductType: ov.sizeProductType,
          sizeAudience: ov.sizeAudience,
          availability: ov.availability,
        }))
      ),
    }));

    const observations = inputs.flatMap((input) =>
      integrateProductSizes(input)
    );
    const report = buildSizeCoverage(observations);

    console.log("LIVE_CATALOG_COVERAGE: MEASURED");
    console.log(`products: ${inputs.length}`);
    console.log(`observations: ${report.observations.total}`);
    console.log(`resolved: ${report.observations.resolved}`);
    console.log(`unresolved: ${report.observations.unresolved}`);
    console.log(`insufficientContext: ${report.observations.insufficientContext}`);
    console.log(`ambiguous: ${report.observations.ambiguous}`);
    console.log(`resolutionPercentage: ${report.observations.resolutionPercentage}`);
    console.log(`uniqueSourceLabels: ${report.uniqueSourceLabels.total}`);
    console.log(`uniqueResolved: ${report.uniqueSourceLabels.resolved}`);
    console.log(`uniqueUnresolved: ${report.uniqueSourceLabels.unresolved}`);
    console.log(`uniqueMixed: ${report.uniqueSourceLabels.mixed}`);
    console.log(`byProductType: ${JSON.stringify(report.byProductType)}`);
    console.log(`byAudience: ${JSON.stringify(report.byAudience)}`);
    console.log(`bySystem: ${JSON.stringify(report.bySystem)}`);
    console.log(`byUnresolvedReason: ${JSON.stringify(report.byUnresolvedReason)}`);
    console.log(
      `topUnresolved: ${JSON.stringify(
        report.unresolvedVocabulary.slice(0, 25).map((entry) => ({
          label: entry.sourceLabel,
          count: entry.count,
          classes: entry.classes,
          reasons: entry.reasons,
        }))
      )}`
    );
    console.log("REPORT_JSON_BEGIN");
    console.log(JSON.stringify(report, null, 2));
    console.log("REPORT_JSON_END");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.log("LIVE_CATALOG_COVERAGE: NOT_MEASURED");
  console.log(`reason: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 0;
});
