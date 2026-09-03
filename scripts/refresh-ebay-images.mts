import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/* One-off image-URL refresh for the imported eBay listings.
   Empirically verified that i.ebayimg.com serves the SAME listing image
   at any /s-l{width}.jpg size; the Browse summary persisted s-l225 (a
   225px thumbnail). We promote existing rows to s-l500 (the verified
   sweet spot) so current products render sharply.

   This touches ONLY the imageUrl field of existing ProductOffer rows and
   the mirrored Product.imageUrl of each primary offer. No products,
   offers, variants are created or deleted; no re-import runs. */
const SOURCE_NAME = "eBay (production)";
const applyMode = process.argv.includes("--apply");

function promote(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/\/s-l\d+(\.(?:jpg|jpeg|png|webp))$/i, "/s-l500$1");
}

async function main(): Promise<void> {
  const con = process.env.DATABASE_URL;
  if (!con) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: con }) });

  const offers = await db.productOffer.findMany({
    where: { source: { name: SOURCE_NAME }, imageUrl: { not: null } },
    select: { id: true, externalListingId: true, imageUrl: true, productId: true, isPrimary: true },
    orderBy: { firstSeenAt: "asc" },
  });

  let changed = 0;
  let primaryChanged = 0;
  const productIdsToMirror = new Map<string, string>(); // productId -> newImageUrl (from primary)

  for (const o of offers) {
    const promoted = promote(o.imageUrl);
    if (!promoted || promoted === o.imageUrl) {
      console.log(`SKIP ${o.externalListingId} (no s-l token change)`);
      continue;
    }
    changed += 1;
    console.log(`PROMOTE ${o.externalListingId} isPrimary=${o.isPrimary}`);
    console.log(`  ${o.imageUrl}`);
    console.log(`  -> ${promoted}`);
    if (!applyMode) continue;

    await db.productOffer.update({
      where: { id: o.id },
      data: { imageUrl: promoted },
    });

    if (o.isPrimary) {
      productIdsToMirror.set(o.productId, promoted);
    }
  }

  if (applyMode && productIdsToMirror.size > 0) {
    for (const [productId, imageUrl] of productIdsToMirror) {
      await db.product.update({
        where: { id: productId },
        data: { imageUrl },
      });
      primaryChanged += 1;
    }
  }

  console.log(
    `\n=== offers changed: ${changed} | primary products mirrored: ${
      primaryChanged || 0
    } (source: ${SOURCE_NAME}) ===`
  );
  if (!applyMode) console.log("(DRY RUN: pass --apply to write to the database)");

  await db.$disconnect();
}

main().catch((e) => console.error("FATAL", e));
