import "dotenv/config";

import {
  PrismaClient,
  SourceStatus,
  SourceType,
  type Gender,
} from "../../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { dummyJsonProvider } from "./dummyjson";
import { fakeStoreProvider } from "./fakestore";
import type {
  ProductProvider,
  ProviderFetchResult,
} from "./types";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function ensureTaxonomyLeaves() {
  const tops = await prisma.category.findUnique({
    where: { slug: "tops" },
  });
  if (!tops) throw new Error("taxonomy parent 'tops' missing");

  await prisma.category.upsert({
    where: { slug: "button-ups" },
    update: {},
    create: {
      name: "Button-Ups",
      slug: "button-ups",
      parentId: tops.id,
    },
  });

  const shoes = await prisma.category.findUnique({
    where: { slug: "shoes" },
  });
  if (!shoes) throw new Error("taxonomy parent 'shoes' missing");

  await prisma.category.upsert({
    where: { slug: "heels" },
    update: {},
    create: {
      name: "Heels",
      slug: "heels",
      parentId: shoes.id,
    },
  });
}

async function syncProvider(
  provider: ProductProvider,
  result: ProviderFetchResult
) {
  const source = await prisma.source.upsert({
    where: { name: provider.sourceName },
    update: {},
    create: {
      name: provider.sourceName,
      type: SourceType.OFFICIAL_API,
      baseUrl: null,
      status: SourceStatus.ACTIVE,
    },
  });

  const existing = await prisma.product.findMany({
    where: { sourceId: source.id },
    select: { externalId: true },
  });
  const existingIds = new Set(
    existing.map((p) => p.externalId)
  );

  let created = 0;
  let updated = 0;

  for (const product of result.products) {
    const brand = await prisma.brand.upsert({
      where: { name: product.brand },
      update: {},
      create: {
        name: product.brand,
        slug: slugify(product.brand),
      },
    });

    let colorId: string | null = null;
    const primaryColor = product.colors[0];
    if (primaryColor) {
      const color = await prisma.color.upsert({
        where: { name: primaryColor },
        update: {},
        create: {
          name: primaryColor,
          slug: slugify(primaryColor),
        },
      });
      colorId = color.id;
    }

    const category = await prisma.category.findUnique({
      where: { slug: product.categorySlug },
    });
    if (!category) {
      throw new Error(
        `category '${product.categorySlug}' not found for ${product.externalId}`
      );
    }

    const dbProduct = await prisma.product.upsert({
      where: {
        sourceId_externalId: {
          sourceId: source.id,
          externalId: product.externalId,
        },
      },
      update: {
        brandId: brand.id,
        categoryId: category.id,
        name: product.name,
        price: product.price,
        currency: product.currency,
        productUrl: product.productUrl,
        imageUrl: product.imageUrl,
        gender: product.gender as Gender,
        availability: product.availability,
        lastSyncedAt: new Date(),
      },
      create: {
        sourceId: source.id,
        externalId: product.externalId,
        brandId: brand.id,
        categoryId: category.id,
        name: product.name,
        slug: `${provider.id}-${slugify(product.name).slice(0, 60)}`,
        price: product.price,
        currency: product.currency,
        productUrl: product.productUrl,
        imageUrl: product.imageUrl,
        gender: product.gender as Gender,
        availability: product.availability,
        lastSyncedAt: new Date(),
      },
    });

    if (existingIds.has(product.externalId)) {
      updated += 1;
    } else {
      created += 1;
    }

    await prisma.productVariant.deleteMany({
      where: { productId: dbProduct.id },
    });
    await prisma.productVariant.create({
      data: {
        productId: dbProduct.id,
        sizeId: null,
        colorId,
        sku: `${product.externalId}-OS`,
        price: product.price,
        currency: product.currency,
        availability: product.availability,
      },
    });
  }

  await prisma.source.update({
    where: { id: source.id },
    data: {
      status: SourceStatus.ACTIVE,
      lastSyncedAt: new Date(),
    },
  });

  console.log(
    `\n📥 ${provider.sourceName}: fetched=${result.fetched} included=${result.products.length} created=${created} updated=${updated}`
  );
  for (const d of result.dropped) {
    console.log(`   ⛔ [${d.id}] ${d.title} — ${d.reason}`);
  }
}

async function main() {
  console.log("🔌 Syncing external providers...");

  await ensureTaxonomyLeaves();

  const providers: ProductProvider[] = [
    dummyJsonProvider,
    fakeStoreProvider,
  ];

  let failures = 0;

  for (const provider of providers) {
    try {
      const result = await provider.fetchUnified();
      await syncProvider(provider, result);
    } catch (error) {
      failures += 1;
      console.error(
        `❌ ${provider.sourceName} failed:`,
        error instanceof Error ? error.message : error
      );
      await prisma.source.updateMany({
        where: { name: provider.sourceName },
        data: { status: SourceStatus.ERROR },
      });
    }
  }

  const totals = {
    products: await prisma.product.count(),
    variants: await prisma.productVariant.count(),
    sources: await prisma.source.count(),
  };

  console.log("\n📊 Database totals:");
  console.log(`   products=${totals.products}`);
  console.log(`   variants=${totals.variants}`);
  console.log(`   sources=${totals.sources}`);

  if (failures > 0) {
    process.exit(1);
  }
}

main()
  .then(() => {
    console.log("\n✅ Provider sync completed");
    return prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error("❌ Provider sync failed:", error);
    await prisma.$disconnect();
    process.exit(1);
  });
