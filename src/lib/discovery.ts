import { prisma } from "@/lib/prisma";
import { hasRealProductPage } from "@/lib/product-url";

/*
   Server-only homepage discovery data.

   Honest-catalog rules (same contract the results surface already
   follows): a product may only appear on the homepage if it is
   AVAILABLE, has a real, placeable product page (hasRealProductPage),
   a real image, and does not come from a demo/placeholder source.
   No fabricated counts, no fake inventory.
*/

export type DiscoveryCategory = {
  id: string;
  name: string;
  slug: string;
  group: string;
  count: number;
};

export type FeaturedProduct = {
  id: string;
  name: string;
  brand: string;
  category: string;
  price: number;
  currency: string;
  productUrl: string;
  imageUrl: string | null;
};

/* Root accessory/headwear categories are flat roots; map them onto
   the group labels the rest of the app uses. */
const SLUG_TO_GROUP: Record<string, string> = {
  beanies: "Headwear",
  caps: "Headwear",
  hats: "Headwear",
  belts: "Accessories",
  sunglasses: "Accessories",
  ties: "Accessories",
  watches: "Accessories",
};

/* Demo/placeholder sources (DummyJSON Free API, Fake Store API,
   WearSearch Demo Store) must never drive homepage counts or cards. */
export function isDemoSource(name: string, type: string): boolean {
  if (type === "DEMO") return true;
  return /dummy|fake|demo/i.test(name);
}

const GROUP_ORDER = [
  "Tops",
  "Bottoms",
  "Shoes",
  "Accessories",
  "Headwear",
  "Swimwear",
  "Other",
];

/** Top categories with real, honest product counts. At most
    `perGroup` entries per group, capped at `total`. */
export async function getDiscoveryCategories(
  perGroup = 2,
  total = 8
): Promise<DiscoveryCategory[]> {
  const rows = await prisma.product.findMany({
    where: {
      availability: "AVAILABLE",
      source: { type: { not: "DEMO" } },
    },
    select: {
      productUrl: true,
      source: { select: { name: true, type: true } },
      category: {
        select: {
          id: true,
          name: true,
          slug: true,
          parent: { select: { name: true } },
        },
      },
    },
  });

  const counts = new Map<string, DiscoveryCategory & { order: number }>();

  for (const row of rows) {
    if (isDemoSource(row.source.name, row.source.type)) {
      continue;
    }
    if (!hasRealProductPage(row.productUrl)) {
      continue;
    }

    const category = row.category;
    const group =
      category.parent?.name ??
      SLUG_TO_GROUP[category.slug] ??
      category.name;

    const existing = counts.get(category.id);

    if (existing) {
      existing.count += 1;
    } else {
      counts.set(category.id, {
        id: category.id,
        name: category.name,
        slug: category.slug,
        group,
        count: 1,
        order: Math.max(0, GROUP_ORDER.indexOf(group)),
      });
    }
  }

  const sorted = [...counts.values()].sort(
    (a, b) => a.order - b.order || b.count - a.count
  );

  const byGroup = new Map<string, number>();
  const picked: DiscoveryCategory[] = [];

  for (const category of sorted) {
    const groupCount = byGroup.get(category.group) ?? 0;
    if (groupCount >= perGroup) {
      continue;
    }
    picked.push({
      id: category.id,
      name: category.name,
      slug: category.slug,
      group: category.group,
      count: category.count,
    });
    byGroup.set(category.group, groupCount + 1);
    if (picked.length >= total) {
      break;
    }
  }

  return picked;
}

/** Real products for the homepage preview, newest first. */
export async function getFeaturedProducts(
  limit = 6
): Promise<FeaturedProduct[]> {
  const rows = await prisma.product.findMany({
    where: {
      availability: "AVAILABLE",
      imageUrl: { not: null },
      source: { type: { not: "DEMO" } },
    },
    select: {
      id: true,
      name: true,
      price: true,
      currency: true,
      productUrl: true,
      imageUrl: true,
      source: { select: { name: true, type: true } },
      brand: { select: { name: true } },
      category: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit * 3,
  });

  const products: FeaturedProduct[] = [];

  for (const row of rows) {
    if (isDemoSource(row.source.name, row.source.type)) {
      continue;
    }
    if (!hasRealProductPage(row.productUrl)) {
      continue;
    }
    products.push({
      id: row.id,
      name: row.name,
      brand: row.brand.name,
      category: row.category.name,
      price: Number(row.price),
      currency: row.currency,
      productUrl: row.productUrl,
      imageUrl: row.imageUrl,
    });
    if (products.length >= limit) {
      break;
    }
  }

  return products;
}

export async function getHomepageData() {
  const [categories, featured] = await Promise.all([
    getDiscoveryCategories(),
    getFeaturedProducts(),
  ]);

  return { categories, featured };
}