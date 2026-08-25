import type {
  DroppedItem,
  ProviderFetchResult,
  ProductProvider,
  UnifiedGender,
  UnifiedProduct,
} from "./types";

interface DummyJsonProduct {
  id: number;
  title: string;
  brand?: string;
  category: string;
  price: number;
  stock: number;
  availabilityStatus?: string;
  thumbnail?: string;
  images?: string[];
}

const BASE_URL = "https://dummyjson.com";

const CATEGORIES = [
  "mens-shirts",
  "mens-shoes",
  "womens-shoes",
] as const;

const UNSUPPORTED_TITLE =
  /jacket|hoodie|coat|dress|frock|skirt|sweater|blazer/i;

const COLOR_RULES: Array<[RegExp, string]> = [
  [/off[\s-]?white/i, "White"],
  [/\bgray\b|\bgrey\b/i, "Grey"],
  [/\bnavy\b/i, "Navy"],
  [/\bblack\b/i, "Black"],
  [/\bblue\b/i, "Blue"],
  [/\bred\b/i, "Red"],
  [/\bgreen\b/i, "Green"],
  [/\bbrown\b/i, "Brown"],
  [/\bwhite\b/i, "White"],
  [/\bgold(?:en)?\b/i, "Gold"],
  [/\bpink\b/i, "Pink"],
  [/\byellow\b/i, "Yellow"],
  [/\borange\b/i, "Orange"],
  [/\bpurple\b|\bviolet\b/i, "Purple"],
  [/\bbeige\b|\bcream\b|\btan\b/i, "Beige"],
  [/\bolive\b|\bkhaki\b/i, "Olive"],
];

function extractColor(title: string): string | null {
  for (const [pattern, color] of COLOR_RULES) {
    if (pattern.test(title)) {
      return color;
    }
  }
  return null;
}

function genderFromCategory(
  category: string
): UnifiedGender {
  if (category.startsWith("womens")) {
    return "WOMEN";
  }
  if (category.startsWith("mens")) {
    return "MEN";
  }
  return "UNISEX";
}

type ResolvedCategory =
  | { slug: string }
  | { slug: null; reason: string };

function resolveCategory(
  category: string,
  title: string
): ResolvedCategory {
  if (UNSUPPORTED_TITLE.test(title)) {
    return {
      slug: null,
      reason: "unsupported garment class (frozen engine vocabulary)",
    };
  }

  if (category === "mens-shirts") {
    if (/\bt-?shirts?\b|\btee\b/i.test(title)) {
      return { slug: "t-shirts" };
    }
    return { slug: "button-ups" };
  }

  if (
    category === "mens-shoes" ||
    category === "womens-shoes"
  ) {
    if (/cleat|boot|loafer|sandal|slipper/i.test(title)) {
      return {
        slug: null,
        reason:
          "footwear type outside current taxonomy",
      };
    }
    if (category === "womens-shoes") {
      if (/heel/i.test(title)) {
        return { slug: "heels" };
      }
      return {
        slug: null,
        reason:
          "generic/unmapped footwear title",
      };
    }
    return { slug: "sneakers" };
  }

  return {
    slug: null,
    reason: `unmapped source category "${category}"`,
  };
}

async function fetchCategory(
  category: string
): Promise<DummyJsonProduct[]> {
  const response = await fetch(
    `${BASE_URL}/products/category/${category}?limit=0`
  );
  if (!response.ok) {
    throw new Error(
      `dummyjson ${category} HTTP ${response.status}`
    );
  }
  const payload = (await response.json()) as {
    products: DummyJsonProduct[];
  };
  return payload.products ?? [];
}

async function fetchUnified(): Promise<ProviderFetchResult> {
  const dropped: DroppedItem[] = [];
  const products: UnifiedProduct[] = [];
  let fetched = 0;

  for (const category of CATEGORIES) {
    const items = await fetchCategory(category);
    fetched += items.length;

    for (const item of items) {
      const resolved = resolveCategory(
        item.category,
        item.title
      );

      if (resolved.slug === null) {
        dropped.push({
          id: String(item.id),
          title: item.title,
          reason: resolved.reason,
        });
        continue;
      }

      const color = extractColor(item.title);

      products.push({
        externalId: `dj-${item.id}`,
        name: item.title,
        brand: item.brand?.trim() || "Unbranded",
        categorySlug: resolved.slug,
        gender: genderFromCategory(item.category),
        colors: color ? [color] : [],
        sizes: [],
        price: Number(item.price.toFixed(2)),
        currency: "USD",
        imageUrl:
          item.thumbnail || item.images?.[0] || null,
        productUrl: `${BASE_URL}/products/${item.id}`,
        availability:
          item.stock > 0 ? "AVAILABLE" : "OUT_OF_STOCK",
      });
    }
  }

  return {
    providerId: "dummyjson",
    fetched,
    products,
    dropped,
  };
}

export const dummyJsonProvider: ProductProvider = {
  id: "dummyjson",
  sourceName: "DummyJSON Free API",
  fetchUnified,
};
