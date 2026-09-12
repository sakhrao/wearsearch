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

/** Titles in this band keep every spotlight card visually balanced:
    too-short names (single-word listings) and eBay-style one-line
    descriptions are both rejected, and the nearest one to the target
    length is chosen so the six cards read with matching proportions. */
const TARGET_TITLE_LENGTH = 34;
const MIN_TITLE_LENGTH = 12;
const MAX_TITLE_LENGTH = 90;

function titleScore(length: number): number {
  if (length < MIN_TITLE_LENGTH || length > MAX_TITLE_LENGTH) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Math.abs(length - TARGET_TITLE_LENGTH);
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

/**
 * Hand-picked representative products per category slug, matched by
 * the stable eBay item id inside `productUrl`. When such a product is
 * AVAILABLE with an image and a real page, it wins over the automatic
 * title-length pick so a specific listing can be showcased.
 */
const PINNED_REPRESENTATIVES: Record<string, string> = {
  "t-shirts": "256468968056",
};

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
 * count and a representative product: a pinned listing if one is
 * available for the category, otherwise the AVAILABLE product whose
 * title is nearest the target length (newest wins ties). Categories
 * with zero matching products are omitted.
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
    /* Tracks whether the current representative is a hand-picked
       pinned listing so the title-length fallback can never replace
       it with a plain product. */
    representativePinned: boolean;
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
      representativePinned: false,
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

    if (!row.imageUrl) continue;

    const pinnedItem = PINNED_REPRESENTATIVES[slug];
    const isPinned =
      !!pinnedItem &&
      row.productUrl.includes(pinnedItem);

/* Representative = the pinned listing when one exists for the
   category; otherwise the product whose title is nearest the
   target length (newest wins ties because rows come createdAt
   desc), so a too-long eBay listing or a bare brand name never
   becomes the spotlight card and every card stays the same height.
   A pinned listing can never be displaced by the title-length
   fallback: rows arrive newest-first, so without the guard a newer
   (or shorter/cleaner) title could otherwise replace it. */
    if (!bucket.representative) {
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
      bucket.representativePinned = isPinned;
      continue;
    }
    if (isPinned) {
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
      bucket.representativePinned = true;
      continue;
    }
    if (
      !bucket.representativePinned &&
      titleScore(row.name.length) <
        titleScore(bucket.representative.name.length)
    ) {
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

  const liveBrands = (
    await prisma.brand.findMany({
      select: { name: true },
      orderBy: { name: "asc" },
    })
  ).map((brand) => brand.name);

  return { spotlights, liveBrands };
}