import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/* =========================================================
   TEXT HELPERS
========================================================= */

function normalizeText(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/['’]s(?=\s|$)/gi, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getWords(text: string): string[] {
  return normalizeText(text)
    .split(/[\s-]+/)
    .filter((word) => word.length > 1);
}

function looseNormalize(
  text: string | null | undefined
): string {
  return normalizeText(text).replace(/-/g, " ");
}

function buildFlexiblePattern(
  normalizedValue: string,
  allowPluralFlex = true
): string {
  return normalizedValue
    .split(" ")
    .map((word) =>
      allowPluralFlex && /^[a-z]{3,}s$/.test(word)
        ? `${word.slice(0, -1)}s?`
        : word
    )
    .join("[\\s-]");
}

/* Values whose plural spelling collides with a common
   adjective (e.g. "shorts" vs "short"). Detection requires
   the exact dictionary spelling; the trailing-s elasticity
   is disabled so "short sleeve" can never be mistaken for
   the Shorts category. */
const STRICT_PLURAL_VALUES = new Set([
  "shorts",
]);

function findMatch(
  query: string,
  values: string[]
): string | null {
  const normalizedQuery = looseNormalize(query);

  const sortedValues = [...new Set(values)]
    .filter(Boolean)
    .sort(
      (a, b) =>
        looseNormalize(b).length -
        looseNormalize(a).length
    );

  for (const value of sortedValues) {
    const normalizedValue =
      looseNormalize(value);

    if (!normalizedValue) {
      continue;
    }

    const escaped = normalizedValue.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

    const allowedPluralFlex =
      !STRICT_PLURAL_VALUES.has(
        normalizedValue
      );

    const regex = new RegExp(
      `(^|\\s)${buildFlexiblePattern(escaped, allowedPluralFlex)}($|\\s)`,
      "i"
    );

    if (regex.test(normalizedQuery)) {
      return value;
    }
  }

  return null;
}

function findMatchSpan(
  query: string,
  values: string[]
): { value: string; index: number; length: number } | null {
  const normalizedQuery = looseNormalize(query);

  const sortedValues = [...new Set(values)]
    .filter(Boolean)
    .sort(
      (a, b) =>
        looseNormalize(b).length -
        looseNormalize(a).length
    );

  for (const value of sortedValues) {
    const normalizedValue =
      looseNormalize(value);

    if (!normalizedValue) {
      continue;
    }

    const escaped = normalizedValue.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

    const allowedPluralFlex =
      !STRICT_PLURAL_VALUES.has(
        normalizedValue
      );

    const regex = new RegExp(
      `(^|\\s)${buildFlexiblePattern(escaped, allowedPluralFlex)}($|\\s)`,
      "i"
    );

    const match = regex.exec(normalizedQuery);

    if (match && match.index !== undefined) {
      return {
        value,
        index: match.index,
        length: match[0].length,
      };
    }
  }

  return null;
}

function maskValue(
  queryText: string,
  value: string
): string {
  const escaped = looseNormalize(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );

  const allowedPluralFlex =
    !STRICT_PLURAL_VALUES.has(
      looseNormalize(value)
    );

  const regex = new RegExp(
    `(^|\\s)${buildFlexiblePattern(escaped, allowedPluralFlex)}(?=$|\\s)`,
    "gi"
  );

  return queryText.replace(
    regex,
    (matched) => " ".repeat(matched.length)
  );
}

/* =========================================================
   GENDER
========================================================= */

const SIZE_ALIAS_WORDS: Record<
  string,
  string
> = {
  "extra small": "XS",
  small: "S",
  medium: "M",
  large: "L",
  "extra large": "XL",
  "double extra large": "XXL",
};

const CATEGORY_ALIAS_WORDS: Record<
  string,
  string
> = {
  tee: "T-Shirts",
  tees: "T-Shirts",
  tshirt: "T-Shirts",
  tshirts: "T-Shirts",
  trainer: "Sneakers",
  trainers: "Sneakers",
  tank: "Tank Tops",
  tanks: "Tank Tops",
  tanktop: "Tank Tops",
  tanktops: "Tank Tops",
  hoodie: "Hoodies",
  hoodies: "Hoodies",
  jumper: "Jumpers",
  jumpers: "Jumpers",
  jacket: "Jackets",
  jackets: "Jackets",
  heel: "Heels",
  heels: "Heels",
  "running trainer": "Running Trainers",
  "running trainers": "Running Trainers",
  sunglasses: "Sunglasses",
  sunglass: "Sunglasses",
  watch: "Watches",
  watches: "Watches",
  belt: "Belts",
  belts: "Belts",
  tie: "Ties",
  ties: "Ties",
  beanie: "Beanies",
  beanies: "Beanies",
  hat: "Hats",
  hats: "Hats",
  cap: "Caps",
  caps: "Caps",
};

type Gender =
  | "MEN"
  | "WOMEN"
  | "KIDS"
  | "UNISEX"
  | null;

function normalizeGender(
  value: string | null | undefined
): Gender {
  const gender = normalizeText(value);

  if (
    gender === "men" ||
    gender === "man" ||
    gender === "male" ||
    gender === "mens" ||
    gender === "gentleman" ||
    gender === "gentlemen"
  ) {
    return "MEN";
  }

  if (
    gender === "women" ||
    gender === "woman" ||
    gender === "female" ||
    gender === "womens" ||
    gender === "ladies" ||
    gender === "lady"
  ) {
    return "WOMEN";
  }

  if (
    gender === "kids" ||
    gender === "kid" ||
    gender === "children" ||
    gender === "child" ||
    gender === "boys" ||
    gender === "boy" ||
    gender === "girls" ||
    gender === "girl"
  ) {
    return "KIDS";
  }

  if (gender === "unisex") {
    return "UNISEX";
  }

  return null;
}

/*
  MEN search:
    MEN    ✓
    UNISEX ✓
    WOMEN  ✗

  WOMEN search:
    WOMEN  ✓
    UNISEX ✓
    MEN    ✗

  KIDS search:
    KIDS   ✓
    UNISEX ✓
    MEN    ✗
    WOMEN  ✗

  UNISEX search:
    UNISEX ✓
    MEN    ✗
    WOMEN  ✗
*/

function genderMatches(
  requested: Gender,
  product: Gender
): boolean {
  if (!requested) {
    return true;
  }

  if (!product) {
    return false;
  }

  if (requested === "MEN") {
    return (
      product === "MEN" ||
      product === "UNISEX"
    );
  }

  if (requested === "WOMEN") {
    return (
      product === "WOMEN" ||
      product === "UNISEX"
    );
  }

  if (requested === "KIDS") {
    return (
      product === "KIDS" ||
      product === "UNISEX"
    );
  }

  return product === "UNISEX";
}

/* Explicit-gender admission is the same compatibility
   rule used throughout (spec §2/§12): a Men/Women/Kids
   search allows UNISEX products into Exact, but they are
   ranked after same-gender products (see the exact-product
   sorting key below). Hard isolation is preserved: no WOMEN
   product ever enters a MEN search and vice versa. */

/* =========================================================
   GET
========================================================= */

export async function GET(
  request: NextRequest
) {
  try {
    const { searchParams } =
      new URL(request.url);

    const query =
      searchParams.get("q")?.trim() ?? "";

    const parsePriceParam = (
      raw: string | null
    ): number | null => {
      if (raw === null || raw.trim() === "") {
        return null;
      }
      const value = Number(raw);
      return Number.isFinite(value) && value >= 0
        ? value
        : null;
    };

    const priceMin = parsePriceParam(
      searchParams.get("priceMin")
    );

    const priceMax = parsePriceParam(
      searchParams.get("priceMax")
    );

    const hasBudget =
      priceMin !== null ||
      priceMax !== null;

    const softAttributes =
      (searchParams.get("soft") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => normalizeText(value));

    /* =====================================================
       EMPTY QUERY
    ===================================================== */

    if (!query) {
      return NextResponse.json({
        success: true,
        query: "",
        structuredQuery: {
          brand: null,
          category: null,
          color: null,
          size: null,
          gender: null,
          attributes: [],
        },
        exactCount: 0,
        similarCount: 0,
        exactProducts: [],
        similarProducts: [],
      });
    }

    /* =====================================================
       LOAD SEARCH DICTIONARIES
    ===================================================== */

    const [
      brands,
      categories,
      colors,
      sizes,
    ] = await Promise.all([
      prisma.brand.findMany({
        select: {
          name: true,
        },
      }),

      prisma.category.findMany({
        select: {
          id: true,
          name: true,
          parentId: true,
        },
      }),

      prisma.color.findMany({
        select: {
          name: true,
        },
      }),

      prisma.size.findMany({
        select: {
          value: true,
        },
      }),
    ]);

    const brandNames = brands.map(
      (item) => item.name
    );

    const categoryNames = categories.map(
      (item) => item.name
    );

    const categoryNameById = new Map<
      string,
      string
    >();

    const categoryParentIdById = new Map<
      string,
      string | null
    >();

    for (const category of categories) {
      categoryNameById.set(
        category.id,
        category.name
      );

      categoryParentIdById.set(
        category.id,
        category.parentId
      );
    }

    const getCategoryChainNames = (
      categoryId: string
    ): string[] => {
      const names: string[] = [];

      const visitedIds = new Set<string>();

      let currentId: string | null =
        categoryId;

      while (
        currentId &&
        !visitedIds.has(currentId)
      ) {
        visitedIds.add(currentId);

        const name =
          categoryNameById.get(currentId);

        if (name) {
          names.push(name);
        }

        currentId =
          categoryParentIdById.get(
            currentId
          ) ?? null;
      }

      return names;
    };

    const colorNames = colors.map(
      (item) => item.name
    );

    const sizeValues = sizes.map(
      (item) => item.value
    );

    /* =====================================================
       DETECT STRUCTURED QUERY
       (sequential detection with span masking: each matched
       entity is consumed before the next dictionary runs)
    ===================================================== */

    let workingQuery = looseNormalize(query);

    const detectEntity = (
      values: string[]
    ): string | null => {
      const hit = findMatchSpan(
        workingQuery,
        values
      );

      if (!hit) {
        return null;
      }

      workingQuery = maskValue(
        workingQuery,
        hit.value
      );

      return hit.value;
    };

    const detectEntities = (
      values: string[]
    ): string[] => {
      const found: string[] = [];

      for (;;) {
        const hit = findMatchSpan(
          workingQuery,
          values
        );

        if (!hit) {
          break;
        }

        workingQuery = maskValue(
          workingQuery,
          hit.value
        );

        found.push(hit.value);
      }

      return found;
    };

    const detectedBrand =
      detectEntity(brandNames);

    const detectedCategoryRaw =
      detectEntity([
        ...categoryNames,
        ...Object.keys(
          CATEGORY_ALIAS_WORDS
        ),
      ]);

    const detectedCategory =
      detectedCategoryRaw
        ? (CATEGORY_ALIAS_WORDS[
            looseNormalize(
              detectedCategoryRaw
            )
          ] ?? detectedCategoryRaw)
        : null;

    const detectedColors =
      detectEntities(colorNames);

    const detectedColor =
      detectedColors[0] ?? null;

    const detectedSizeRaw =
      detectEntity([
        ...sizeValues,
        ...Object.keys(
          SIZE_ALIAS_WORDS
        ),
      ]);

    const detectedSize =
      detectedSizeRaw
        ? (SIZE_ALIAS_WORDS[
            looseNormalize(
              detectedSizeRaw
            )
          ] ?? detectedSizeRaw)
        : null;

    const genderWords = [
      "women",
      "woman",
      "womens",
      "ladies",
      "lady",
      "female",
      "men",
      "man",
      "mens",
      "gentleman",
      "gentlemen",
      "male",
      "kids",
      "kid",
      "children",
      "child",
      "boys",
      "boy",
      "girls",
      "girl",
      "unisex",
    ];

    const detectedGenderRaw =
      detectEntity(genderWords);

    const detectedGender =
      normalizeGender(
        detectedGenderRaw
      );

    /* =====================================================
       LOAD PRODUCTS
    ===================================================== */

    const products =
      await prisma.product.findMany({
        select: {
          id: true,
          name: true,
          description: true,
          price: true,
          currency: true,
          productUrl: true,
          imageUrl: true,
          gender: true,

          brand: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },

          category: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },

          variants: {
            select: {
              id: true,
              sku: true,
              price: true,
              currency: true,
              availability: true,

              color: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  hex: true,
                },
              },

              size: {
                select: {
                  id: true,
                  value: true,
                  normalizedValue: true,
                  system: true,
                },
              },
            },
          },

          attributes: {
            select: {
              value: true,

              attribute: {
                select: {
                  name: true,
                },
              },
            },
          },
        },

        orderBy: {
          createdAt: "desc",
        },
      });

    /* =====================================================
       BUILD ATTRIBUTE DICTIONARY
    ===================================================== */

    const attributeValues: string[] = [];

    for (const product of products) {
      for (const item of product.attributes) {
        const value = normalizeText(
          item.value
        );

        if (!value) {
          continue;
        }

        if (
          value === "n a" ||
          value === "n/a"
        ) {
          continue;
        }

        attributeValues.push(
          item.value
        );
      }
    }

    /* =====================================================
       DETECT ATTRIBUTES
    ===================================================== */

    const detectedAttributes: {
      attributeName: string;
      value: string;
    }[] = [];

    const uniqueAttributes =
      new Map<
        string,
        {
          attributeName: string;
          value: string;
        }
      >();

    for (const product of products) {
      for (const item of product.attributes) {
        if (!item.value) {
          continue;
        }

        const value =
          normalizeText(item.value);

        if (
          value === "n a" ||
          value === "n/a"
        ) {
          continue;
        }

        const key =
          `${normalizeText(
            item.attribute.name
          )}::${value}`;

        if (
          !uniqueAttributes.has(key)
        ) {
          uniqueAttributes.set(key, {
            attributeName:
              item.attribute.name,
            value: item.value,
          });
        }
      }
    }

    for (const item of uniqueAttributes.values()) {
      const attributeHit = findMatchSpan(
        workingQuery,
        [item.value]
      );

      if (attributeHit) {
        workingQuery = maskValue(
          workingQuery,
          item.value
        );

        detectedAttributes.push({
          attributeName:
            item.attributeName,
          value: item.value,
        });
      }
    }

    /* =====================================================
       STRUCTURED QUERY
    ===================================================== */

    const structuredQuery = {
      brand: detectedBrand,
      category: detectedCategory,
      color: detectedColor,
      colors: detectedColors,
      size: detectedSize,
      gender: detectedGender,
      attributes: detectedAttributes,
      budget: hasBudget
        ? { min: priceMin, max: priceMax }
        : null,
    };

    /* =====================================================
       QUERY WORDS
    ===================================================== */

    const SEARCH_STOP_WORDS = new Set([
      "size",
      "sizes",
      "for",
    ]);

    /* =====================================================
       CATEGORY INTENT VOCABULARY (Phase 6.4.2)
       Known clothing categories that do NOT exist in the
       catalog taxonomy. A query token from this list is
       recognized as category intent and consumed, but it
       makes Exact impossible regardless of remaining
       constraint matches. Purely subtractive: it never
       adds score, strength, or candidates.
    ===================================================== */

    const UNSUPPORTED_CATEGORY_WORDS =
      new Set([
        "pant",
        "pants",
        "coat",
        "dress",
        "skirt",
        "sweater",
        "blazer",
        "suit",
        "suits",
      ]);

    const singularizeCategoryWord = (
      word: string
    ): string | null => {
      if (
        UNSUPPORTED_CATEGORY_WORDS.has(
          word
        )
      ) {
        return word;
      }

      if (
        word.endsWith("s") &&
        UNSUPPORTED_CATEGORY_WORDS.has(
          word.slice(0, -1)
        )
      ) {
        return word.slice(0, -1);
      }

      return null;
    };

    const unsupportedIntentWords =
      new Set<string>();

    const queryWords =
      getWords(query);

    const filteredQueryWords =
      queryWords.filter(
        (word) => !SEARCH_STOP_WORDS.has(word)
      );

    for (const word of filteredQueryWords) {
      if (singularizeCategoryWord(word)) {
        unsupportedIntentWords.add(word);
      }
    }

    /* =====================================================
       STRUCTURED WORDS
    ===================================================== */

    const structuredWords =
      new Set<string>();

    const addStructuredWords = (
      value: string | null
    ) => {
      if (!value) {
        return;
      }

      for (const word of getWords(value)) {
        structuredWords.add(word);
      }
    };

    addStructuredWords(detectedBrand);
    addStructuredWords(
      detectedCategoryRaw
    );
    addStructuredWords(detectedCategory);
    addStructuredWords(detectedColor);
    addStructuredWords(detectedSizeRaw);
    addStructuredWords(detectedSize);
    addStructuredWords(
      detectedGenderRaw
    );
    addStructuredWords(
      detectedGender
    );

    for (const attribute of detectedAttributes) {
      addStructuredWords(
        attribute.value
      );
    }

    const freeTextWords =
      filteredQueryWords.filter(
        (word) =>
          !structuredWords.has(word) &&
          !unsupportedIntentWords.has(
            word
          )
      );

    const hasStructuredFilterGlobal =
      Boolean(
        detectedBrand ||
          detectedCategory ||
          detectedColor ||
          detectedSize ||
          detectedGender ||
          detectedAttributes.length > 0
      );

    const hasStrongStructuredFilter =
      Boolean(
        detectedBrand ||
          detectedCategory ||
          detectedColor ||
          detectedSize ||
          detectedAttributes.length > 0
      );

    const corpusWords = new Set<string>();

    for (const product of products) {
      const corpusTexts = [
        product.name,
        product.description,
        product.brand?.name,
        product.category?.name,
        String(product.gender ?? ""),

        ...product.variants.map(
          (variant) =>
            variant.color?.name ?? ""
        ),

        ...product.variants.map(
          (variant) =>
            variant.size?.value ?? ""
        ),

        ...product.attributes.map(
          (attribute) => attribute.value
        ),

        ...product.attributes.map(
          (attribute) =>
            attribute.attribute.name
        ),
      ];

      for (const word of getWords(
        corpusTexts.join(" ")
      )) {
        corpusWords.add(word);
      }
    }

    const requiredFreeWords =
      freeTextWords.filter((word) =>
        corpusWords.has(word)
      );

    const requiredWordSet = new Set(
      requiredFreeWords
    );

    const hasSearchSignal =
      Boolean(detectedBrand) ||
      Boolean(detectedCategory) ||
      Boolean(detectedColor) ||
      Boolean(detectedSize) ||
      Boolean(detectedGender) ||
      detectedAttributes.length > 0 ||
      filteredQueryWords.length > 0;

    /* =====================================================
       CATEGORY STATUS METADATA + EMPTY-NODE POLICY STATE
       Describes the requested category node, how many
       products its subtree stocks, and which sibling
       nodes exist. The metadata itself is informational;
       the derived empty/sibling flags below feed ONLY
       the similar-path substitution policy (6.7.2).
    ===================================================== */

    let categoryStatus: {
      requested: string;
      productCount: number;
      siblings: string[];
    } | null = null;

    if (detectedCategory) {
      const requestedNode =
        categories.find(
          (category) =>
            category.name ===
            detectedCategory
        );

      if (requestedNode) {
        const subtreeIds = new Set([
          requestedNode.id,
        ]);

        let subtreeChanged = true;

        while (subtreeChanged) {
          subtreeChanged = false;

          for (const category of categories) {
            if (
              !subtreeIds.has(category.id) &&
              category.parentId !== null &&
              subtreeIds.has(category.parentId)
            ) {
              subtreeIds.add(category.id);
              subtreeChanged = true;
            }
          }
        }

        const productCount =
          products.filter(
            (product) =>
              product.category &&
              subtreeIds.has(product.category.id)
          ).length;

        const siblings = categories
          .filter(
            (category) =>
              requestedNode.parentId !==
                null &&
              category.id !==
                requestedNode.id &&
              category.parentId ===
                requestedNode.parentId
          )
          .map((category) => category.name)
          .sort();

        categoryStatus = {
          requested: detectedCategory,
          productCount,
          siblings,
        };
      }
    }

    /* B2-gated substitution trigger: the requested
       node exists in taxonomy but stocks nothing.
       Siblings may then stand in for it in the
       similar path only - never for Exact. */
    const requestedCategoryIsEmpty =
      categoryStatus !== null &&
      categoryStatus.productCount === 0;

    const siblingCategoryNames =
      new Set(
        categoryStatus
          ? categoryStatus.siblings
          : []
      );

    /* =====================================================
       SCORE PRODUCTS
    ===================================================== */

    const scoredProducts =
      products.map((product) => {
        const productGender =
          normalizeGender(
            String(product.gender ?? "")
          );

        const brandText =
          normalizeText(
            product.brand?.name
          );

        const categoryText =
          normalizeText(
            product.category?.name
          );

        const nameText =
          normalizeText(product.name);

        const descriptionText =
          normalizeText(
            product.description
          );

        const productColors =
          product.variants
            .map((variant) =>
              normalizeText(
                variant.color?.name
              )
            )
            .filter(Boolean);

        const productSizes =
          product.variants
            .map((variant) =>
              normalizeText(
                variant.size?.value
              )
            )
            .filter(Boolean);

        const searchableText =
          normalizeText(
            [
              product.name,
              product.description,
              product.brand?.name,
              product.category?.name,
              String(
                product.gender ?? ""
              ),

              ...product.variants.map(
                (variant) =>
                  variant.color?.name ??
                  ""
              ),

              ...product.variants.map(
                (variant) =>
                  variant.size?.value ??
                  ""
              ),

              ...product.attributes.map(
                (attribute) =>
                  attribute.value
              ),

              ...product.attributes.map(
                (attribute) =>
                  attribute.attribute
                    .name
              ),
            ].join(" ")
          );

        /* ===============================================
           STRUCTURED MATCHES
        =============================================== */

        const brandMatches =
          !detectedBrand ||
          brandText ===
            normalizeText(
              detectedBrand
            );

        /* Budget (spec §8): Exact requires the price inside
           the requested bounds; a product within ±35% of the
           bounds is "close" and eligible for Similar only. */
        const productPrice =
          Number(product.price);

        const budgetMatches =
          !hasBudget ||
          ((priceMin === null ||
            productPrice >= priceMin) &&
            (priceMax === null ||
              productPrice <= priceMax));

        const budgetCompatible =
          !hasBudget ||
          ((priceMin === null ||
            productPrice >= priceMin * 0.65) &&
            (priceMax === null ||
              productPrice <= priceMax * 1.35));

        const productCategoryChainNames =
          product.category
            ? getCategoryChainNames(
                product.category.id
              )
            : [];

        const categoryMatches =
          !detectedCategory ||
          productCategoryChainNames.includes(
            detectedCategory
          );

        const selectedColorSet = new Set(
          detectedColors.map((color) =>
            normalizeText(color)
          )
        );

        const productColorSet = new Set(
          productColors
        );

        /* Color admission (spec §5):
           - no color requested: vacuous
           - one color: product must carry it (intersection)
           - two+: subset semantics — every product color must
             be inside the requested palette AND the product
             carries at least one requested color */
        const colorMatches =
          detectedColors.length === 0
            ? true
            : detectedColors.length === 1
              ? productColorSet.has(
                  normalizeText(
                    detectedColor!
                  )
                )
              : productColors.length > 0 &&
                  productColors.every(
                    (color) =>
                      selectedColorSet.has(color)
                  );

        /* Compatibility for the Similar path / 80% gate:
           a product sharing any requested color is a color
           companion, even when it also carries off-palette
           colors (e.g. a White/Red item for a White+Black
           palette). */
        const colorCompatible =
          detectedColors.length === 0
            ? true
            : productColors.some((color) =>
                selectedColorSet.has(color)
              );

        const sizeMatches =
          !detectedSize ||
          productSizes.includes(
            normalizeText(
              detectedSize
            )
          );

        const productGenderMatches =
          genderMatches(
            detectedGender,
            productGender
          );

        /* ===============================================
           ATTRIBUTE MATCHES
        =============================================== */

        let matchedAttributes = 0;

        for (
          const requested of
          detectedAttributes
        ) {
          const found =
            product.attributes.some(
              (attribute) =>
                normalizeText(
                  attribute.attribute.name
                ) ===
                  normalizeText(
                    requested.attributeName
                  ) &&
                normalizeText(
                  attribute.value
                ) ===
                  normalizeText(
                    requested.value
                  )
            );

          if (found) {
            matchedAttributes++;
          }
        }

        const allAttributesMatched =
          detectedAttributes.length === 0 ||
          matchedAttributes ===
            detectedAttributes.length;

        /* Soft preferences (spec §9): context-aware hints
           (Fit/Material/Style/…) nudge ranking inside Exact
           only; they never gate Exact or Similar admission. */
        const softMatchedCount =
          softAttributes.filter((hint) =>
            product.attributes.some(
              (attribute) =>
                normalizeText(
                  attribute.value
                ) === hint
            )
          ).length;

        /* ===============================================
           FREE TEXT
        =============================================== */

        let matchedFreeTextWords = 0;
        let matchedRequiredWords = 0;
        let score = 0;
        let freeTextPoints = 0;

        const applyWordMatch = (
          word: string,
          points: number
        ) => {
          matchedFreeTextWords++;

          if (requiredWordSet.has(word)) {
            matchedRequiredWords++;
          }

          freeTextPoints += points;
        };

        for (const word of freeTextWords) {
          if (nameText.includes(word)) {
            applyWordMatch(word, 100);
          } else if (
            categoryText.includes(word)
          ) {
            applyWordMatch(word, 80);
          } else if (
            brandText.includes(word)
          ) {
            applyWordMatch(word, 70);
          } else if (
            descriptionText.includes(word)
          ) {
            applyWordMatch(word, 40);
          } else if (
            searchableText.includes(word)
          ) {
            applyWordMatch(word, 20);
          }
        }

        /* ===============================================
           STRUCTURED SCORE
        =============================================== */

        if (detectedBrand) {
          score += brandMatches
            ? 240
            : -80;
        }

        if (hasBudget) {
          score += budgetMatches
            ? 180
            : budgetCompatible
              ? -30
              : -70;
        }

        /* B2 substitution credit: a sibling of an
           empty requested node that satisfies every
           other explicit structural constraint is
           scored as if the category matched, in the
           similar path only. */
        const categoryCredit =
          categoryMatches ||
          (requestedCategoryIsEmpty &&
            !categoryMatches &&
            product.category !== null &&
            siblingCategoryNames.has(
              product.category.name
            ) &&
            brandMatches &&
            colorMatches &&
            sizeMatches &&
            allAttributesMatched);

        if (detectedCategory) {
          score += categoryCredit
            ? 400
            : -220;
        }

        if (detectedColor) {
          score += colorMatches
            ? 320
            : -80;
        }

        if (detectedSize) {
          score += sizeMatches
            ? 140
            : -100;
        }

        if (detectedAttributes.length > 0) {
          score +=
            matchedAttributes * 160;

          score -=
            (detectedAttributes.length -
              matchedAttributes) *
            120;
        }

        if (softMatchedCount > 0) {
          score += softMatchedCount * 40;
        }

        const structuralMismatches = [
          Boolean(
            detectedBrand &&
              !brandMatches
          ),
          Boolean(
            detectedCategory &&
              !categoryMatches &&
              !categoryCredit
          ),
          Boolean(
            detectedColor &&
              !colorMatches
          ),
          Boolean(
            detectedSize &&
              !sizeMatches
          ),
          Boolean(
            hasBudget &&
              !budgetCompatible
          ),
          Boolean(
            detectedAttributes.length > 0 &&
              matchedAttributes <
                detectedAttributes.length
          ),
        ].filter(Boolean).length;

        /* ===============================================
           FREE TEXT APPLICATION
           Structured intent dominates: free-text and
           phrase bonuses only apply when the candidate
           has no structural mismatch against detected
           intent, or when the query had none.
        =============================================== */

        const normalizedQuery =
          normalizeText(query);

        const phraseBonus =
          normalizedQuery.length > 0 &&
          searchableText.includes(
            normalizedQuery
          )
            ? 100
            : 0;

        const freeTextAllowed =
          !hasStructuredFilterGlobal ||
          structuralMismatches === 0;

        if (freeTextAllowed) {
          score += freeTextPoints + phraseBonus;
        }

        /* ===============================================
           CATEGORY COHERENCE FACTOR
           The detected category is the spine of query
           intent. A candidate outside an explicitly
           requested category carries half relevance,
           so refinement stacks (brand/color) can never
           outrank on-category candidates.
        =============================================== */

        const categoryCoherent =
          !detectedCategory ||
          categoryMatches ||
          categoryCredit;

        if (!categoryCoherent) {
          score = Math.round(score * 0.5);
        }

        /* ===============================================
           EXACT MATCH
        =============================================== */

        const structuredFiltersMatch =
          brandMatches &&
          categoryMatches &&
          colorMatches &&
          sizeMatches &&
          genderMatches(
            detectedGender,
            productGender
          ) &&
          budgetMatches &&
          allAttributesMatched;

        /* Free-text words are relevance signals,
           never hard Exact gates. A word that
           happens to exist in catalog vocabulary
           adds tiered points when found, but its
           absence cannot veto a candidate whose
           structured intent is complete. Only the
           unknown-noise guard (no recognizable
           free words AND no strong structural
           filter) still blocks Exact. */
        const unknownOnlyNoise =
          requiredFreeWords.length === 0 &&
          freeTextWords.length > 0 &&
          !hasStrongStructuredFilter;

        const allFreeTextMatched =
          !unknownOnlyNoise;

        const exactMatch =
          hasSearchSignal &&
          structuredFiltersMatch &&
          allFreeTextMatched &&
          unsupportedIntentWords.size ===
            0;

        /* ===============================================
           SIMILAR MATCH
        =============================================== */

        const hasAnyPositiveComponent =
          Boolean(
            detectedBrand &&
            brandMatches
          ) ||
          Boolean(
            detectedCategory &&
            (categoryMatches ||
              categoryCredit)
          ) ||
          Boolean(
            detectedColor &&
            colorMatches
          ) ||
          Boolean(
            detectedSize &&
            sizeMatches
          ) ||
          Boolean(
            hasBudget &&
            budgetCompatible
          ) ||
          matchedAttributes > 0;

        const hasFreeTextMatch =
          matchedFreeTextWords > 0;

        const meaningfulRelevance =
          hasAnyPositiveComponent ||
          (!hasStructuredFilterGlobal &&
            hasFreeTextMatch);

        const genderMismatch = Boolean(
          detectedGender &&
            !productGenderMatches
        );

        /* Category scope gate (Similar path only):
           with an explicit non-empty category intent,
           candidates must belong to the requested
           subtree, or qualify as empty-node sibling
           substitutions. Unrelated branches (e.g.
           Shoes for "white shirt") never enter. */
        const categoryScopeAllowed =
          !detectedCategory ||
          categoryMatches ||
          categoryCredit;

        const similarMatch =
          !exactMatch &&
          !genderMismatch &&
          categoryScopeAllowed &&
          structuralMismatches <= 2 &&
          meaningfulRelevance &&
          score > 0;

        /* ===============================================
           RESULT
        =============================================== */

        return {
          ...product,

          score,

          exactMatch,

          similarMatch,

          matchedWords:
            matchedFreeTextWords,

          totalQueryWords:
            filteredQueryWords.length,

          matchedColors:
            detectedColors.length === 0
              ? 0
              : detectedColors.reduce(
                  (count, color) =>
                    count +
                    (productColorSet.has(
                      normalizeText(color)
                    )
                      ? 1
                      : 0),
                  0
                ),

          matchedCategories:
            detectedCategory &&
            categoryMatches
              ? 1
              : 0,

          matchedAttributes,

          softMatched: softMatchedCount,

          structuredMatches: {
            brand:
              detectedBrand
                ? brandMatches
                : null,

            category:
              detectedCategory
                ? categoryMatches
                : null,

            color:
              detectedColor
                ? colorCompatible
                : null,

            size:
              detectedSize
                ? sizeMatches
                : null,

            gender:
              detectedGender
                ? productGenderMatches
                : null,

            budget:
              hasBudget
                ? budgetCompatible
                : null,

            attributes:
              detectedAttributes.length > 0
                ? allAttributesMatched
                : null,
          },
        };
      });

    /* =====================================================
       EXACT PRODUCTS
       Gender priority is a PRIMARY sort key, not a
       tie-break: for an explicit Men/Women/Kids request,
       same-gender products always come before UNISEX
       products regardless of score, then (within each
       gender bucket) score descending (spec §1/§12).
    ===================================================== */

    const genderOrderKey = (
      product: (typeof scoredProducts)[number]
    ): number => {
      if (
        detectedGender !== "MEN" &&
        detectedGender !== "WOMEN" &&
        detectedGender !== "KIDS"
      ) {
        return 0;
      }

      const same =
        normalizeGender(
          String(product.gender ?? "")
        ) === detectedGender;

      return same ? 0 : 1;
    };

    const exactProducts =
      scoredProducts
        .filter(
          (product) =>
            product.exactMatch
        )
        .sort(
          (a, b) =>
            genderOrderKey(a) -
              genderOrderKey(b) ||
            b.score - a.score ||
            (a.id < b.id
              ? -1
              : a.id > b.id
                ? 1
                : 0)
        );

    /* =====================================================
       SIMILAR PRODUCTS
       (80% structured-constraint gate: similar candidates
       must match at least 80% of the structured
       constraints the parser actually detected. Compute
       the ratio independently from per-product
       structuredMatches; the internal score is not used.
       Exact is untouched.)
    ===================================================== */

    const structuredMatchKeys = [
      "brand",
      "category",
      "color",
      "size",
      "gender",
      "budget",
      "attributes",
    ] as const;

    const detectedConstraintCount =
      (() => {
        const sample = scoredProducts[0];
        if (!sample) {
          return 0;
        }
        return structuredMatchKeys.filter(
          (key) =>
            sample.structuredMatches[key] !==
            null
        ).length;
      })();

    const matchesAtLeast80Percent = (
      product: (typeof scoredProducts)[number]
    ): boolean => {
      if (detectedConstraintCount === 0) {
        return true;
      }

      const matchedCount =
        structuredMatchKeys.filter(
          (key) =>
            product.structuredMatches[key] ===
            true
        ).length;

      return (
        matchedCount * 5 >=
        detectedConstraintCount * 4
      );
    };

    const allSimilarProducts =
      scoredProducts
        .filter(
          (product) =>
            product.similarMatch &&
            product.score > 0
        )
        .sort(
          (a, b) =>
            b.score - a.score ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
        );

    const similarProducts =
      allSimilarProducts.filter((product) =>
        matchesAtLeast80Percent(product)
      );

    const similarMessage =
      detectedConstraintCount > 0 &&
      similarProducts.length === 0
        ? "No similar products match at least 80% of your preferences. Try fewer or less specific preferences."
        : null;

    /* =====================================================
       EMPTY-RESULT DIAGNOSTICS (spec §11)
       Evidence-based only: each message names a detected
       hard constraint that has zero matching products in
       the catalog. Never guesses.
    ===================================================== */

    const diagnostics: string[] = [];

    if (
      exactProducts.length === 0 &&
      scoredProducts.length > 0
    ) {
      diagnostics.push(
        "No products match all your preferences."
      );

      if (
        unsupportedIntentWords.size > 0
      ) {
        const word = [
          ...unsupportedIntentWords,
        ][0];
        diagnostics.push(
          `No products in the catalog for "${word}".`
        );
      }

      const categoryClause = detectedCategory
        ? ` in ${detectedCategory.toLowerCase()}`
        : "";

      const scopeProducts = detectedCategory
        ? products.filter(
            (product) =>
              product.category &&
              getCategoryChainNames(
                product.category.id
              ).includes(
                detectedCategory
              )
          )
        : products;

      if (
        requestedCategoryIsEmpty &&
        detectedCategory
      ) {
        diagnostics.push(
          `This category currently has no products in the catalog.`
        );
      } else {
        if (detectedBrand) {
          const hasBrand =
            scopeProducts.some(
              (product) =>
                normalizeText(
                  product.brand?.name
                ) ===
                normalizeText(
                  detectedBrand
                )
            );
          if (!hasBrand) {
            diagnostics.push(
              `No ${detectedBrand} products are currently available${categoryClause}.`
            );
          }
        }

        if (detectedColors.length > 0) {
          const hasPaletteColor =
            scopeProducts.some(
              (product) =>
                product.variants.some(
                  (variant) =>
                    variant.color &&
                    detectedColors.some(
                      (color) =>
                        normalizeText(
                          variant.color!.name
                        ) ===
                        normalizeText(color)
                    )
                )
            );
          if (!hasPaletteColor) {
            diagnostics.push(
              `No products in ${detectedColors.join(
                " or "
              )} are currently available${categoryClause}.`
            );
          }
        }

        if (detectedSize) {
          const hasSize = scopeProducts.some(
            (product) =>
              product.variants.some(
                (variant) =>
                  variant.size &&
                  normalizeText(
                    variant.size.value
                  ) ===
                  normalizeText(
                    detectedSize
                  )
              )
          );
          if (!hasSize) {
            diagnostics.push(
              `Size ${detectedSize} is currently unavailable for this combination.`
            );
          }
        }

        if (detectedGender) {
          const hasGender = scopeProducts.some(
            (product) =>
              genderMatches(
                detectedGender,
                normalizeGender(
                  String(
                    product.gender ?? ""
                  )
                )
              )
          );
          if (!hasGender) {
            diagnostics.push(
              `No ${detectedGender.toLowerCase()} products are currently available${categoryClause}.`
            );
          }
        }

        if (hasBudget) {
          const hasInBudget = scopeProducts.some(
            (product) => {
              const price = Number(
                product.price
              );
              return (
                (priceMin === null ||
                  price >= priceMin) &&
                (priceMax === null ||
                  price <= priceMax)
              );
            }
          );
          if (!hasInBudget) {
            diagnostics.push(
              `No products match your budget range (${priceMin ?? "any"} - ${priceMax ?? "any"})${categoryClause}.`
            );
          }
        }
      }
    }

    /* =====================================================
       RESPONSE
    ===================================================== */

    return NextResponse.json({
      success: true,

      query,

      structuredQuery,

      categoryStatus,

      exactCount:
        exactProducts.length,

      similarCount:
        similarProducts.length,

      similarMessage,

      diagnostics,

      exactProducts,

      similarProducts,
    });
  } catch (error) {
    console.error(
      "Search API error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error: "Failed to search products",
      },
      {
        status: 500,
      }
    );
  }
}