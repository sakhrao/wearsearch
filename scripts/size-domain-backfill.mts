/* Stage E — canonical size backfill runner.

   Deterministic, idempotent, provenance-safe. It reads the real
   Product / ProductVariant / ProductOffer / ProductOfferVariant rows,
   runs the existing Stage C adapter -> Stage D resolver -> Stage E
   planner, prints a report, and (only with `--apply`) writes the four
   additive canonical fields.

   SAFE BY DEFAULT: without `--apply` it never writes. It never touches
   source labels, availability, taxonomy, search or the questionnaire.

   Run:
     npm run size-domain-backfill            # dry run (report only)
     npm run size-domain-backfill -- --apply  # persist changes

   The approved inference registry is empty, so the 159 Livostyle bare
   numerics stay UNRESOLVED and are never inferred. */

import "dotenv/config";

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import {
  APPROVED_SIZE_SYSTEM_POLICIES,
  integrateProductSizes,
  planSizeBackfill,
  projectProductSizes,
  sizePersistenceTargetKey,
  type ProductSizeInput,
  type SizeCanonicalFields,
  type SizePersistenceEntry,
  type SizePersistenceTarget,
} from "../src/lib/size-domain";

const APPLY = process.argv.includes("--apply");
const VERIFY = process.argv.includes("--verify");
const CHUNK = 500;

/* Stage C baseline the report must not silently change. */
const BASELINE = { observations: 3977, resolved: 3818, unresolved: 159 };

function targetKey(target: SizePersistenceTarget): string {
  return sizePersistenceTargetKey(target);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("SIZE_BACKFILL: NOT_MEASURED");
    console.log("reason: DATABASE_URL is not configured");
    return;
  }

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
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
            canonicalSizeOptionId: true,
            sizeResolutionStatus: true,
            sizeResolutionProvenance: true,
            sizeResolutionSystem: true,
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
                offerId: true,
                variantKey: true,
                sizeValue: true,
                sizeSystem: true,
                sizeProductType: true,
                sizeAudience: true,
                availability: true,
                canonicalSizeOptionId: true,
                sizeResolutionStatus: true,
                sizeResolutionProvenance: true,
                sizeResolutionSystem: true,
              },
            },
          },
        },
      },
      orderBy: { id: "asc" },
    });

    const existingByTarget = new Map<string, SizeCanonicalFields>();

    const inputs: ProductSizeInput[] = products.map((p) => {
      for (const v of p.variants) {
        existingByTarget.set(targetKey({ kind: "variant", variantId: v.id }), {
          canonicalSizeOptionId: v.canonicalSizeOptionId,
          sizeResolutionStatus: v.sizeResolutionStatus,
          sizeResolutionProvenance: v.sizeResolutionProvenance,
          sizeResolutionSystem: v.sizeResolutionSystem,
        });
      }
      for (const offer of p.offers) {
        for (const ov of offer.variants) {
          existingByTarget.set(
            targetKey({
              kind: "offerVariant",
              offerId: ov.offerId,
              variantKey: ov.variantKey,
            }),
            {
              canonicalSizeOptionId: ov.canonicalSizeOptionId,
              sizeResolutionStatus: ov.sizeResolutionStatus,
              sizeResolutionProvenance: ov.sizeResolutionProvenance,
              sizeResolutionSystem: ov.sizeResolutionSystem,
            }
          );
        }
      }

      return {
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
            offerId: ov.offerId,
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
      };
    });

    const observations = inputs.flatMap((input) =>
      integrateProductSizes(input)
    );
    const projections = projectProductSizes(
      observations,
      APPROVED_SIZE_SYSTEM_POLICIES
    );

    const entries: SizePersistenceEntry[] = observations.map((observation, i) => {
      const target: SizePersistenceTarget =
        observation.origin === "variant"
          ? { kind: "variant", variantId: observation.variantId! }
          : {
              kind: "offerVariant",
              offerId: observation.offerId!,
              variantKey: observation.offerVariantKey!,
            };
      return {
        target,
        existing: existingByTarget.get(targetKey(target)) ?? {
          canonicalSizeOptionId: null,
          sizeResolutionStatus: null,
          sizeResolutionProvenance: null,
          sizeResolutionSystem: null,
        },
        projection: projections[i],
      };
    });

    const { changes, report } = planSizeBackfill(entries);

    console.log(`SIZE_BACKFILL: ${APPLY ? "APPLY" : "DRY_RUN"}`);
    console.log(`products: ${inputs.length}`);
    console.log(`observations: ${report.total}`);
    console.log(`resolved: ${report.resolved}`);
    console.log(`inferred: ${report.inferred}`);
    console.log(`unresolved: ${report.unresolved}`);
    console.log(`withCanonicalIdentity: ${report.withCanonicalIdentity}`);
    console.log(`withoutCanonicalIdentity: ${report.withoutCanonicalIdentity}`);
    console.log(`changed: ${report.changed}`);
    console.log(`unchanged: ${report.unchanged}`);
    console.log(`downgradesPrevented: ${report.downgradesPrevented}`);
    console.log(`byStatus: ${JSON.stringify(report.byStatus)}`);
    console.log(`byProvenance: ${JSON.stringify(report.byProvenance)}`);
    console.log(`bySystem: ${JSON.stringify(report.bySystem)}`);
    console.log(
      `baselineMatch: ${
        report.resolved === BASELINE.resolved &&
        report.unresolved === BASELINE.unresolved
      } (expected observations ${BASELINE.observations})`
    );

    if (APPLY) {
      let writes = 0;
      for (let i = 0; i < changes.length; i += CHUNK) {
        const slice = changes.slice(i, i + CHUNK);
        await prisma.$transaction(
          slice.map((change) => {
            const data = {
              canonicalSizeOptionId: change.fields.canonicalSizeOptionId,
              sizeResolutionStatus: change.fields.sizeResolutionStatus,
              sizeResolutionProvenance: change.fields.sizeResolutionProvenance,
              sizeResolutionSystem: change.fields.sizeResolutionSystem,
            };
            if (change.target.kind === "variant") {
              return prisma.productVariant.update({
                where: { id: change.target.variantId },
                data,
              });
            }
            return prisma.productOfferVariant.update({
              where: {
                offerId_variantKey: {
                  offerId: change.target.offerId,
                  variantKey: change.target.variantKey,
                },
              },
              data,
            });
          })
        );
        writes += slice.length;
      }
      console.log(`DATABASE_WRITES: ${writes}`);
    } else {
      console.log("DATABASE_WRITES: 0");
    }

    if (VERIFY) {
      await verify(prisma);
    }
  } finally {
    await prisma.$disconnect();
  }
}

/* Post-backfill data-integrity assertions (§17). Read-only. */
async function verify(prisma: PrismaClient): Promise<void> {
  const [
    resolvedNoId,
    unresolvedWithId,
    inferredRows,
    variantWithSize,
    offerVariantWithSize,
    sizeRows,
  ] = await Promise.all([
    prisma.productVariant.count({
      where: {
        sizeResolutionStatus: "RESOLVED",
        canonicalSizeOptionId: null,
      },
    }),
    prisma.productVariant.count({
      where: {
        sizeResolutionStatus: "UNRESOLVED",
        canonicalSizeOptionId: { not: null },
      },
    }),
    prisma.productVariant.count({
      where: { sizeResolutionProvenance: "INFERRED" },
    }),
    prisma.productVariant.count({ where: { sizeId: { not: null } } }),
    prisma.productOfferVariant.count({
      where: { sizeValue: { not: null } },
    }),
    prisma.size.count(),
  ]);

  const checks: Array<[string, boolean, string]> = [
    [
      "V1 every RESOLVED row has a canonical identity",
      resolvedNoId === 0,
      `resolvedWithoutId=${resolvedNoId}`,
    ],
    [
      "V2 no UNRESOLVED row has a fabricated canonical identity",
      unresolvedWithId === 0,
      `unresolvedWithId=${unresolvedWithId}`,
    ],
    [
      "V3 production INFERRED count is 0",
      inferredRows === 0,
      `inferred=${inferredRows}`,
    ],
    [
      "V4 legacy size-bearing rows preserved",
      variantWithSize === BASELINE.observations &&
        offerVariantWithSize === 0 &&
        sizeRows === 107,
      `variantWithSize=${variantWithSize} offerVariantWithSize=${offerVariantWithSize} sizeRows=${sizeRows}`,
    ],
  ];

  let failed = 0;
  for (const [name, ok, detail] of checks) {
    if (!ok) failed += 1;
    console.log(`${ok ? "PASS" : "FAIL"} ${name} :: ${detail}`);
  }
  console.log(`VERIFY: ${failed === 0 ? "PASS" : "FAIL"}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.log("SIZE_BACKFILL: FAILED");
  console.log(
    `reason: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});
