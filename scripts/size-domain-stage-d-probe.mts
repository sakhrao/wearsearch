/* Stage D — read-only probe of unresolved size observations.

   Prints exactly which source/origin/raw row produces each unresolved
   observation so the missing sizeSystem can be traced to its origin.
   Never writes. Run: npx tsx scripts/size-domain-stage-d-probe.mts */

import "dotenv/config";

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import {
  APPROVED_SIZE_SYSTEM_POLICIES,
  SIZE_SYSTEM_POLICY_CANDIDATES,
  integrateProductSizes,
  projectProductSizes,
  summarizeSizeProjections,
  type ProductSizeInput,
  type ProductSizeObservation,
} from "../src/lib/size-domain";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("STAGE_D_PROBE: NOT_RUN (no DATABASE_URL)");
    return;
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const products = await prisma.product.findMany({
      select: {
        id: true,
        name: true,
        gender: true,
        source: { select: { id: true, name: true, type: true } },
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
            source: { select: { id: true, name: true, type: true } },
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

    type Origin = "variant" | "offer";
    const allObservations: ProductSizeObservation[] = [];
    const unresolved: Array<{
      source: string;
      origin: Origin;
      productId: string;
      name: string;
      category: string;
      raw: string;
      rawSystem: string | null;
      rawProductType: string | null;
      reason: string | null;
    }> = [];
    let total = 0;

    for (const p of products) {
      const input: ProductSizeInput = {
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
      };
      for (const observation of integrateProductSizes(input)) {
        total += 1;
        allObservations.push(observation);
        if (observation.normalization.status === "RESOLVED") continue;
        unresolved.push({
          source: observation.sourceName ?? observation.sourceId ?? "?",
          origin: observation.origin,
          productId: observation.productId,
          name: p.name,
          category: p.category.name,
          raw: observation.sourceSizeLabel,
          rawSystem: observation.sourceSystem,
          rawProductType: observation.sourceProductType,
          reason: observation.normalization.reason,
        });
      }
    }

    console.log(`total observations: ${total}`);
    console.log(`unresolved: ${unresolved.length}`);

    const bySource = new Map<string, number>();
    const byOrigin = new Map<string, number>();
    const byReason = new Map<string, number>();
    const rawLabels = new Map<string, number>();
    for (const row of unresolved) {
      bySource.set(row.source, (bySource.get(row.source) ?? 0) + 1);
      byOrigin.set(row.origin, (byOrigin.get(row.origin) ?? 0) + 1);
      byReason.set(row.reason ?? "null", (byReason.get(row.reason ?? "null") ?? 0) + 1);
      rawLabels.set(row.raw, (rawLabels.get(row.raw) ?? 0) + 1);
    }
    console.log("by source:", JSON.stringify([...bySource.entries()]));
    console.log("by origin:", JSON.stringify([...byOrigin.entries()]));
    console.log("by reason:", JSON.stringify([...byReason.entries()]));
    console.log("raw labels:", JSON.stringify([...rawLabels.entries()].sort((a,b)=>b[1]-a[1])));

    const seen = new Set<string>();
    console.log("--- sample rows ---");
    for (const row of unresolved) {
      const key = `${row.source}|${row.origin}|${row.raw}|${row.rawSystem}|${row.category}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(
        `${row.source} | ${row.origin} | "${row.raw}" | system=${row.rawSystem} | pt=${row.rawProductType} | cat=${row.category} | ${row.name.slice(0, 40)}`
      );
      if (seen.size >= 40) break;
    }

    const approved = summarizeSizeProjections(
      projectProductSizes(allObservations, APPROVED_SIZE_SYSTEM_POLICIES)
    );
    console.log("--- Stage D projection with APPROVED registry (empty) ---");
    console.log(JSON.stringify(approved));

    const candidateSim = summarizeSizeProjections(
      projectProductSizes(allObservations, SIZE_SYSTEM_POLICY_CANDIDATES)
    );
    console.log("--- Stage D projection CANDIDATE simulation (NOT approved) ---");
    console.log(JSON.stringify(candidateSim));

    const sourceMetadataRecoverable = unresolved.filter(
      (row) => row.rawSystem != null && row.rawSystem !== "UNKNOWN"
    ).length;
    console.log(`unresolved with recoverable stored system: ${sourceMetadataRecoverable}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.log(`STAGE_D_PROBE: NOT_RUN (${e instanceof Error ? e.message : e})`);
  process.exitCode = 0;
});
