import type {
  ProviderFetchResult,
  ProductProvider,
  UnifiedGender,
  UnifiedProduct,
  UnifiedVariant,
} from "./types";

interface LivostyleVariant {
  sku: string;
  title: string;
  price_usd: number;
  compare_at_price_usd?: number;
  in_stock: boolean;
  options?: {
    Color?: string;
    Size?: string;
    [key: string]: string | undefined;
  };
}

interface LivostyleProduct {
  id: string;
  handle: string;
  title: string;
  url: string;
  vendor?: string;
  tags?: string[];
  category?: {
    name: string;
    full_path: string;
  };
  featured_image_url?: string;
  variants?: LivostyleVariant[];
}

const DATA_URL =
  "https://raw.githubusercontent.com/arturayupov/womens-fashion-catalog-open-data/master/data/products.json";

/* Curated corrections for source-level category mislabels.
   The source feeds may slot a garment under a wrong branch
   (e.g. a t-shirt listed under Shoes > Athletic Shoes).
   Entries are authoritative over any heuristic below. */
const CATEGORY_OVERRIDES: Readonly<Record<string, string>> = {
  "square-neck-crisscross-active-t-shirt": "t-shirts",
};

const CATEGORY_MAP: Array<[RegExp, string]> = [
  [/ > Clothing Tops > Blouses$/, "blouses"],
  [/ > Clothing Tops > Tunics$/, "blouses"],
  [/ > Clothing Tops$/, "blouses"],
  [/ > Clothing Tops > Tank Tops$/, "tank-tops"],
  [/ > Clothing Tops > Cardigans$/, "cardigans"],
  [/ > Clothing Tops > T-Shirts$/, "t-shirts"],
  [/ > Clothing Tops > Shirts$/, "button-ups"],
  [/ > Shoes > Athletic Shoes$/, "sneakers"],
  [/ > Pants > Trousers$/, "trousers"],
  [/ > Pants > Cargo Pants$/, "trousers"],
  [/ > Pants > Leggings$/, "leggings"],
  [/ > Activewear Pants > Leggings$/, "leggings"],
  [/ > Activewear Pants > Sweatpants$/, "joggers"],
  [/ > Activewear Pants > Track Pants$/, "joggers"],
  [/ > Pants > Jeans$/, "jeans"],
];

const SHOE_TITLE_RULES: Array<[RegExp, string]> = [
  [/sneaker|trainer|athletic|running|sport/i, "sneakers"],
  [/heel|pump|stiletto/i, "heels"],
  [/boot|ankle boot|chelsea/i, "boots"],
  [/loafer|moccasin|flat$|ballet flat/i, "loafers"],
  [/sandal|slide|espadrille/i, "sandals"],
];

/* Source paths whose garment class the engine supports natively.
   These win over the TITLE_GUARD: a real `> Hoodies` / `> Sweatshirts`
   product must not be dropped merely because its title contains the
   garment word itself ("hoodie", "sweatshirt"). The guard still applies
   to every other path, so Sweaters / Coats & Jackets / Dresses etc.
   stay outside the supported taxonomy. */
const GARMENT_CLASS_PATHS: Array<[RegExp, string]> = [
  [/ > Clothing Tops > Hoodies$/, "hoodies"],
  [/ > Clothing Tops > Sweatshirts$/, "sweatshirts"],
];

const TITLE_GUARD =
  /jacket|hoodie|coat|dress|skirt|short\b|shorts|sweater|blazer|bikini|swim|lingerie|bodysuit|jumpsuit|romper/i;

const COLOR_TOKENS: Array<[RegExp, string]> = [
  [/off[\s-]?white/i, "White"],
  [/ivory/i, "Ivory"],
  [/gray|grey|charcoal|heather/i, "Grey"],
  [/navy/i, "Navy"],
  [/burgundy|wine|maroon/i, "Burgundy"],
  [/turquoise|teal|aqua/i, "Teal"],
  [/lavender|lilac|purple|violet|magenta|mauve|plum/i, "Purple"],
  [/mustard/i, "Yellow"],
  [/\bblack\b/i, "Black"],
  [/\bwhite\b/i, "White"],
  [/\bblue\b|\bdenim\b|\bcobalt\b|\bslate\b/i, "Blue"],
  [/\bred\b|\bcherry\b|\bflamingo\b/i, "Red"],
  [/\bgreen\b|\bsage\b|\bemerald\b|\bmatcha\b|\bmint\b|\bolive\b/i, "Green"],
  [/\bbrown\b|\bcoffee\b|\bchocolate\b|\blatte\b|\bcocoa\b/i, "Brown"],
  [/\bpink\b|\bblush\b|\brose\b|\bcoral\b|\bsalmon\b/i, "Pink"],
  [/\byellow\b|\bbutter\b|\bcitron\b/i, "Yellow"],
  [/\borange\b|\brust\b|\bcaramel\b|\bcopper\b/i, "Orange"],
  [/\bbeige\b|\btan\b|\bcamel\b|\bkha?ki\b|\bstone\b|\btaupe\b|\bsand\b|\bnatural\b/i, "Beige"],
  [/\bcream\b|\beggshell\b/i, "Cream"],
  [/\bgold\b/i, "Gold"],
  [/\bsilver\b/i, "Silver"],
  [/leopard|animal print|snake|cheetah/i, "Leopard"],
  [/\bmulti\b|tie[\s-]?dye|print|floral|stripe|paisley|abstract|painting/i, "Multi"],
];

function normalizeColor(
  value: string | undefined
): string | null {
  if (!value) return null;
  for (const [pattern, color] of COLOR_TOKENS) {
    if (pattern.test(value)) {
      return color;
    }
  }
  return null;
}

function normalizeSize(
  rawSize: string,
  isShoes: boolean
): { category: string; system: "INTERNATIONAL" | "US"; value: string } | null {
  const value = rawSize.trim();
  if (!value) return null;

  if (/^one[\s-]?size$|^os$|^uni$/i.test(value)) {
    return {
      category: "clothing",
      system: "INTERNATIONAL",
      value: "One Size",
    };
  }

  if (
    /^(xxxs|xxs|xs|s|m|l|xl|xxl|2xl|3xl|4xl)$/i.test(
      value
    )
  ) {
    return {
      category: "clothing",
      system: "INTERNATIONAL",
      value: value.toUpperCase().replace(/^2XL$/, "XXL").replace(/^3XL$/, "XXXL").replace(/^4XL$/, "XXXXL"),
    };
  }

  if (isShoes) {
    /* Numeric shoe sizes arrive either bare ("41") or as
       combined EU+US strings ("36(US5)", "42(US10)"). Both
       are real source values; the bare leading number is the
       EU size users search on. */
    const match = value.match(
      /^(\d{1,2}(?:\.\d)?)(?:\(\s*US\s*\d+(?:\.\d+)?\s*\))?$/i
    );
    if (match) {
      return {
        category: "shoes",
        system: "US",
        value: match[1],
      };
    }
  }

  return null;
}

function resolveCategory(
  fullPath: string,
  title: string,
  handle: string
): { slug: string } | { slug: null; reason: string } {
  const override = CATEGORY_OVERRIDES[handle];
  if (override) {
    return { slug: override };
  }

  for (const [pattern, slug] of GARMENT_CLASS_PATHS) {
    if (fullPath.match(pattern)) {
      return { slug };
    }
  }

  if (TITLE_GUARD.test(title)) {
    return {
      slug: null,
      reason: "unsupported garment class (frozen engine vocabulary)",
    };
  }

  if (/ > Shoes$/.test(fullPath)) {
    for (const [pattern, slug] of SHOE_TITLE_RULES) {
      if (pattern.test(title)) {
        return { slug };
      }
    }
    return {
      slug: null,
      reason: "unclassified generic shoes",
    };
  }

  for (const [pattern, slug] of CATEGORY_MAP) {
    if (fullPath.match(pattern)) {
      return { slug };
    }
  }

  return {
    slug: null,
    reason: "category outside supported taxonomy",
  };
}

function buildVariants(
  product: LivostyleProduct,
  isShoes: boolean
): UnifiedVariant[] {
  const seen = new Set<string>();
  const variants: UnifiedVariant[] = [];

  for (const variant of product.variants ?? []) {
    if (variants.length >= 40) break;

    const color = normalizeColor(
      variant.options?.Color
    );
    const normalizedSize = normalizeSize(
      variant.options?.Size ?? "",
      isShoes
    );
    const sizeValue = normalizedSize?.value ?? null;
    const key = `${color ?? "-"}|${sizeValue ?? "-"}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (
      typeof variant.price_usd !== "number" ||
      variant.price_usd <= 0
    ) {
      continue;
    }

    variants.push({
      color,
      size: sizeValue,
      price: Number(variant.price_usd.toFixed(2)),
      inStock: Boolean(variant.in_stock),
    });
  }

  return variants;
}

async function fetchUnified(): Promise<ProviderFetchResult> {
  const response = await fetch(DATA_URL);
  if (!response.ok) {
    throw new Error(
      `livostyle data HTTP ${response.status}`
    );
  }
  const items =
    (await response.json()) as LivostyleProduct[];

  const dropped = new Map<string, number>();
  const products: UnifiedProduct[] = [];

  for (const item of items) {
    const fullPath =
      item.category?.full_path ?? "";

    const resolved = resolveCategory(
      fullPath,
      item.title,
      item.handle
    );

    if (resolved.slug === null) {
      const shortReason = resolved.reason.replace(
        /\(.*\)/,
        ""
      ).trim();
      dropped.set(
        shortReason,
        (dropped.get(shortReason) ?? 0) + 1
      );
      continue;
    }

    const isShoes = resolved.slug === "sneakers" || resolved.slug === "heels" || resolved.slug === "boots" || resolved.slug === "loafers" || resolved.slug === "sandals";

    const variants = buildVariants(
      item,
      isShoes
    );

    if (variants.length === 0) {
      dropped.set(
        "no usable priced variants",
        (dropped.get("no usable priced variants") ?? 0) + 1
      );
      continue;
    }

    const inStock = variants.some((v) => v.inStock);
    const price = Math.min(
      ...variants.map((v) => v.price)
    );

    const colors = [
      ...new Set(
        variants
          .map((v) => v.color)
          .filter((c): c is string => c !== null)
      ),
    ];

    products.push({
      externalId: `lv-${item.handle}`,
      name: item.title,
      brand: item.vendor?.trim() || "Unbranded",
      categorySlug: resolved.slug,
      gender: "WOMEN" as UnifiedGender,
      colors,
      sizes: [],
      price,
      currency: "USD",
      imageUrl: item.featured_image_url || null,
      productUrl: item.url,
      availability: inStock ? "AVAILABLE" : "OUT_OF_STOCK",
      variants: variants.slice(0, 40),
      sizeCategory: isShoes ? "shoes" : "clothing",
      sizeSystem: isShoes ? "US" : "INTERNATIONAL",
    });
  }

  console.log(
    "   livostyle drop summary:"
  );
  for (const [reason, count] of dropped) {
    console.log(`     ⛔ ${count} × ${reason}`);
  }

  return {
    providerId: "livostyle",
    fetched: items.length,
    products,
    dropped: [],
  };
}

export const livostyleProvider: ProductProvider = {
  id: "livostyle",
  sourceName: "Livostyle Open Catalog",
  fetchUnified,
};
