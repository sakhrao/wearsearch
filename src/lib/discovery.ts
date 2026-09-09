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

/** The 6 spotlight categories the homepage highlights. */
export const SPOTLIGHT_CATEGORY_SLUGS = [
  "t-shirts",
  "hoodies",
  "jackets",
  "sneakers",
  "trousers",
  "jeans",
] as const;

export type CategorySpotlight = {
  id: string;
  name: string;
  slug: string;
  group: string;
  count: number;
  representativeProduct: FeaturedProduct | null;
};

/**
 * Returns one entry per target category slug with a real product
 * count and the newest AVAILABLE product as a representative.
 * Categories with zero matching products are omitted.
 */
export async function getSpotlightCategories(): Promise<
  CategorySpotlight[]
> {
  /* Fetch every AVAILABLE non-demo product with a real page once,
     grouped by category, to compute counts and pick representatives. */
  const rows = await prisma.product.findMany({
    where: {
      availability: "AVAILABLE",
      source: { type: { not: "DEMO" } },
    },
    select: {
      id: true,
      name: true,
      price: true,
      currency: true,
      productUrl: true,
      imageUrl: true,
      createdAt: true,
      source: { select: { name: true, type: true } },
      brand: { select: { name: true } },
      category: {
        select: {
          id: true,
          name: true,
          slug: true,
          parent: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  type Bucket = {
    id: string;
    name: string;
    slug: string;
    group: string;
    count: number;
    representative: FeaturedProduct | null;
  };

  const buckets = new Map<string, Bucket>();

  for (const slug of SPOTLIGHT_CATEGORY_SLUGS) {
    buckets.set(slug, {
      id: "",
      name: "",
      slug,
      group: "",
      count: 0,
      representative: null,
    });
  }

  for (const row of rows) {
    const slug = row.category.slug;
    const bucket = buckets.get(slug);
    if (!bucket) continue;

    if (isDemoSource(row.source.name, row.source.type)) continue;
    if (!hasRealProductPage(row.productUrl)) continue;

    if (!bucket.id) {
      bucket.id = row.category.id;
      bucket.name = row.category.name;
      bucket.group =
        row.category.parent?.name ??
        SLUG_TO_GROUP[row.category.slug] ??
        row.category.name;
    }

    bucket.count += 1;

    if (!bucket.representative && row.imageUrl) {
      bucket.representative = {
        id: row.id,
        name: row.name,
        brand: row.brand.name,
        category: row.category.name,
        price: Number(row.price),
        currency: row.currency,
        productUrl: row.productUrl,
        imageUrl: row.imageUrl,
      };
    }
  }

  return [...buckets.values()]
    .filter((b) => b.count > 0 && b.id)
    .map(({ id, name, slug, group, count, representative }) => ({
      id,
      name,
      slug,
      group,
      count,
      representativeProduct: representative,
    }));
}

export async function getHomepageData() {
  const spotlights = await getSpotlightCategories();

  return { spotlights };
}