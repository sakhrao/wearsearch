import "dotenv/config";

import {
  PrismaClient,
  SizeSystem,
  SizeAudience,
  SizeProductType,
  SourceStatus,
  SourceType,
  type Gender,
} from "../../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { dummyJsonProvider } from "./dummyjson";
import { fakeStoreProvider } from "./fakestore";
import { livostyleProvider } from "./livostyle";
import { writeProductAttributes } from "./attribute-enrichment";
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

const brandCache = new Map<string, string>();
const colorCache = new Map<string, string | null>();
const sizeCache = new Map<string, string | null>();

async function brandIdOf(name: string) {
  const hit = brandCache.get(name);
  if (hit) return hit;
  const brand = await prisma.brand.upsert({
    where: { name },
    update: {},
    create: { name, slug: slugify(name) },
  });
  brandCache.set(name, brand.id);
  return brand.id;
}

async function colorIdOf(
  name: string | null
): Promise<string | null> {
  if (!name) return null;
  const hit = colorCache.get(name);
  if (hit !== undefined) return hit;
  const color = await prisma.color.upsert({
    where: { name },
    update: {},
    create: { name, slug: slugify(name) },
  });
  colorCache.set(name, color.id);
  return color.id;
}

async function sizeIdOf(
  category: string,
  system: string,
  value: string
): Promise<string | null> {
  const key = `${category}|${system}|${value}`;
  const hit = sizeCache.get(key);
  if (hit !== undefined) return hit;
  const size = await prisma.size.upsert({
    where: {
      audience_productType_system_value: {
        audience: SizeAudience.UNKNOWN,
        productType: SizeProductType.UNKNOWN,
        system: system as SizeSystem,
        value,
      },
    },
    update: {},
    create: {
      category,
      system: system as SizeSystem,
      value,
      normalizedValue: value.toLowerCase(),
    },
  });
  sizeCache.set(key, size.id);
  return size.id;
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

async function syncVariants(
  productId: string,
  product: ProviderFetchResult["products"][number]
) {
  await prisma.productVariant.deleteMany({
    where: { productId },
  });

  if (
    product.variants &&
    product.variants.length > 0
  ) {
    const seen = new Set<string>();
    const rows: Array<{
      productId: string;
      sizeId: string | null;
      colorId: string | null;
      sku: string;
      price: number;
      currency: string;
      availability: "AVAILABLE" | "OUT_OF_STOCK";
    }> = [];

    for (const [
      index,
      variant,
    ] of product.variants.entries()) {
      const colorId = await colorIdOf(
        variant.color
      );
      const sizeId = variant.size
        ? await sizeIdOf(
            product.sizeCategory ?? "clothing",
            product.sizeSystem ?? "INTERNATIONAL",
            variant.size
          )
        : null;
      const key = `${colorId ?? "-"}|${sizeId ?? "-"}`;
      if (seen.has(key)) continue;
      seen.add(key);

      rows.push({
        productId,
        sizeId,
        colorId,
        sku: `${product.externalId}-v${index}`,
        price: variant.price,
        currency: product.currency,
        availability: variant.inStock
          ? "AVAILABLE"
          : "OUT_OF_STOCK",
      });
    }

    if (rows.length > 0) {
      await prisma.productVariant.createMany({
        data: rows,
      });
    }
    return;
  }

  let colorId: string | null = null;
  const primaryColor = product.colors[0];
  if (primaryColor) {
    colorId = await colorIdOf(primaryColor);
  }

  await prisma.productVariant.create({
    data: {
      productId,
      sizeId: null,
      colorId,
      sku: `${product.externalId}-OS`,
      price: product.price,
      currency: product.currency,
      availability: product.availability,
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
      type: SourceType.AUTHORIZED_FEED,
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
    const brandId = await brandIdOf(product.brand);

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
        brandId,
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
        brandId,
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

    await syncVariants(dbProduct.id, product);
    await writeProductAttributes(
      prisma,
      dbProduct.id,
      product.attributes ?? []
    );
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
}

async function main() {
  console.log("🔌 Syncing external providers...");

  await ensureTaxonomyLeaves();

  const providers: ProductProvider[] = [
    dummyJsonProvider,
    fakeStoreProvider,
    livostyleProvider,
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
