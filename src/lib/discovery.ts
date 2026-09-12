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

  const brandHighlights = await getBrandHighlights();

  return { spotlights, liveBrands, brandHighlights };
}

/* ------------------------------------------------------------------ */
/* BRAND HIGHLIGHTS (per-category top houses)                         */
/* ------------------------------------------------------------------ */

export type BrandHighlight = {
  id: string;
  name: string;
  slug: string;
  count: number;
  /* The two most prominent brands in the category, by product
     count, both named only if they actually hold inventory. */
  brands: Array<{ name: string; count: number }>;
};

/** Per-category "top N brands" aggregates. Same honest-catalog rules
    as the rest of the homepage: AVAILABLE products from non-demo
    sources with a real, placeable product page. Categories are
    ranked by total products and clipped to the top MAX so the
    section stays tight. */
const MAX_HIGHLIGHT_CATEGORIES = 6;
const MAX_BRANDS_PER_CATEGORY = 2;

export async function getBrandHighlights(): Promise<
  BrandHighlight[]
> {
  const products = await prisma.product.findMany({
    where: {
      availability: "AVAILABLE",
      source: { type: { not: "DEMO" } },
    },
    select: {
      categoryId: true,
      brandId: true,
      productUrl: true,
    },
  });

  const categoryNames = new Map<
    string,
    { name: string; slug: string }
  >(
    (
      await prisma.category.findMany({
        select: { id: true, name: true, slug: true },
      })
    ).map((c) => [c.id, { name: c.name, slug: c.slug }])
  );

  const brandNames = new Map<string, string>(
    (
      await prisma.brand.findMany({
        select: { id: true, name: true },
      })
    ).map((b) => [b.id, b.name])
  );

  type Acc = {
    count: number;
    brands: Map<string, number>;
  };
  const acc = new Map<string, Acc>();

  for (const product of products) {
    if (!product.brandId || !product.categoryId) continue;
    if (!hasRealProductPage(product.productUrl)) continue;
    let bucket = acc.get(product.categoryId);
    if (!bucket) {
      bucket = { count: 0, brands: new Map() };
      acc.set(product.categoryId, bucket);
    }
    bucket.count += 1;
    bucket.brands.set(
      product.brandId,
      (bucket.brands.get(product.brandId) ?? 0) + 1
    );
  }

  return [...acc.entries()]
    .map(([categoryId, bucket]) => {
      const meta = categoryNames.get(categoryId);
      return {
        id: categoryId,
        name: meta?.name ?? categoryId,
        slug: meta?.slug ?? "",
        count: bucket.count,
        brands: [...bucket.brands.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, MAX_BRANDS_PER_CATEGORY)
          .map(([brandId, count]) => ({
            name: brandNames.get(brandId) ?? brandId,
            count,
          })),
      };
    })
    .filter((row) => row.count > 0 && row.brands.length > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_HIGHLIGHT_CATEGORIES);
}