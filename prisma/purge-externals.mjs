import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  }),
});

const EXTERNAL_SOURCES = [
  "DummyJSON Free API",
  "Fake Store API",
  "Livostyle Open Catalog",
];

const sources = await prisma.source.findMany({
  where: { name: { in: EXTERNAL_SOURCES } },
  select: { id: true, name: true },
});

for (const source of sources) {
  const deleted = await prisma.product.deleteMany({
    where: { sourceId: source.id },
  });
  console.log(`purged ${deleted.count} products from [${source.name}]`);
}

const orphanColors = await prisma.color.deleteMany({
  where: { variants: { none: {} } },
});
console.log(`orphan colors deleted: ${orphanColors.count}`);

const orphanSizes = await prisma.size.deleteMany({
  where: { variants: { none: {} } },
});
console.log(`orphan sizes deleted: ${orphanSizes.count}`);

const colorCount = await prisma.color.count();
const sizeCount = await prisma.size.count();
console.log(`remaining colors=${colorCount} sizes=${sizeCount}`);

await prisma.$disconnect();
