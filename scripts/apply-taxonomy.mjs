import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  }),
});

const NEW_CATEGORIES = [
  { name: "Hoodies", slug: "hoodies", parent: "tops" },
  { name: "Jumpers", slug: "jumpers", parent: "tops" },
  { name: "Jackets", slug: "jackets", parent: "tops" },
  { name: "Shorts", slug: "shorts", parent: "bottoms" },
  { name: "Cargo", slug: "cargo", parent: "bottoms" },
  { name: "Socks", slug: "socks", parent: "bottoms" },
  { name: "Underwear", slug: "underwear", parent: "bottoms" },
  { name: "Running Trainers", slug: "running-trainers", parent: "shoes" },
  { name: "Heels", slug: "heels", parent: "shoes" },
  { name: "Accessories", slug: "accessories", parent: null },
  { name: "Sunglasses", slug: "sunglasses", parent: "accessories" },
  { name: "Watches", slug: "watches", parent: "accessories" },
  { name: "Belts", slug: "belts", parent: "accessories" },
  { name: "Ties", slug: "ties", parent: "accessories" },
  { name: "Headwear", slug: "headwear", parent: null },
  { name: "Beanies", slug: "beanies", parent: "headwear" },
  { name: "Hats", slug: "hats", parent: "headwear" },
  { name: "Caps", slug: "caps", parent: "headwear" },
];

const allCategories = await prisma.category.findMany({
  select: { id: true, slug: true },
});

const idBySlug = new Map(allCategories.map((c) => [c.slug, c.id]));

for (const spec of NEW_CATEGORIES) {
  const parentId = spec.parent ? (idBySlug.get(spec.parent) ?? null) : null;
  const upserted = await prisma.category.upsert({
    where: { slug: spec.slug },
    update: { parentId },
    create: {
      name: spec.name,
      slug: spec.slug,
      parentId,
    },
  });
  console.log(`upserted ${spec.slug} (id=${upserted.id})`);
}

await prisma.$disconnect();