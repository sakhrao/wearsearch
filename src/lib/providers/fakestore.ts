import type {
  DroppedItem,
  ProviderFetchResult,
  ProductProvider,
  UnifiedProduct,
} from "./types";

interface FakeStoreProduct {
  id: number;
  title: string;
  category: string;
  price: number;
  image?: string;
  description?: string;
}

const BASE_URL = "https://fakestoreapi.com";

const COLOR_RULES: Array<[RegExp, string]> = [
  [/\bgray\b|\bgrey\b/i, "Grey"],
  [/\bblack\b/i, "Black"],
  [/\bblue\b/i, "Blue"],
  [/\bred\b/i, "Red"],
  [/\bgreen\b/i, "Green"],
  [/\bbrown\b/i, "Brown"],
  [/\bwhite\b/i, "White"],
  [/\bpink\b/i, "Pink"],
];

function extractColor(title: string): string | null {
  for (const [pattern, color] of COLOR_RULES) {
    if (pattern.test(title)) {
      return color;
    }
  }
  return null;
}

const CURATED_ITEMS: Record<
  number,
  { slug: string; gender: "MEN" | "WOMEN" }
> = {
  2: { slug: "t-shirts", gender: "MEN" },
  4: { slug: "t-shirts", gender: "MEN" },
  18: { slug: "t-shirts", gender: "WOMEN" },
  20: { slug: "t-shirts", gender: "WOMEN" },
};

const DROP_REASONS: Array<[RegExp, string]> = [
  [/jacket|hoodie|coat|blazer|sweater/i, "unsupported garment class (frozen engine vocabulary)"],
  [/backpack|bag|shoe|jewelery|electronics/i, "non-apparel item"],
];

async function fetchUnified(): Promise<ProviderFetchResult> {
  const response = await fetch(
    `${BASE_URL}/products`
  );
  if (!response.ok) {
    throw new Error(
      `fakestore HTTP ${response.status}`
    );
  }
  const items =
    (await response.json()) as FakeStoreProduct[];

  const dropped: DroppedItem[] = [];
  const products: UnifiedProduct[] = [];

  for (const item of items) {
    const curated = CURATED_ITEMS[item.id];

    if (!curated) {
      const reason =
        DROP_REASONS.find(([pattern]) =>
          pattern.test(item.title)
        )?.[1] ?? "unmapped apparel title";
      dropped.push({
        id: String(item.id),
        title: item.title,
        reason,
      });
      continue;
    }

    products.push({
      externalId: `fs-${item.id}`,
      name: item.title,
      brand: "Unbranded",
      categorySlug: curated.slug,
      gender: curated.gender,
      colors: [],
      sizes: [],
      price: Number(item.price.toFixed(2)),
      currency: "USD",
      imageUrl: item.image || null,
      productUrl: `${BASE_URL}/products/${item.id}`,
      availability: "AVAILABLE",
    });
  }

  return {
    providerId: "fakestore",
    fetched: items.length,
    products,
    dropped,
  };
}

export const fakeStoreProvider: ProductProvider = {
  id: "fakestore",
  sourceName: "Fake Store API",
  fetchUnified,
};
