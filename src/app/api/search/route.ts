import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/* =========================================================
   TEXT HELPERS
========================================================= */

function normalizeText(text: string | null | undefined): string {
  return (text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getWords(text: string): string[] {
  return normalizeText(text)
    .split(/\s+/)
    .filter((word) => word.length > 1);
}

function looseNormalize(
  text: string | null | undefined
): string {
  return normalizeText(text).replace(/-/g, " ");
}

function buildFlexiblePattern(
  normalizedValue: string
): string {
  return normalizedValue
    .split(" ")
    .map((word) =>
      /^[a-z]{3,}s$/.test(word)
        ? `${word.slice(0, -1)}s?`
        : word
    )
    .join("[\\s-]");
}

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

    const regex = new RegExp(
      `(^|\\s)${buildFlexiblePattern(escaped)}($|\\s)`,
      "i"
    );

    if (regex.test(normalizedQuery)) {
      return value;
    }
  }

  return null;
}

/* =========================================================
   GENDER
========================================================= */

type Gender =
  | "MEN"
  | "WOMEN"
  | "UNISEX"
  | null;

function normalizeGender(
  value: string | null | undefined
): Gender {
  const gender = normalizeText(value);

  if (
    gender === "men" ||
    gender === "man" ||
    gender === "male"
  ) {
    return "MEN";
  }

  if (
    gender === "women" ||
    gender === "woman" ||
    gender === "female"
  ) {
    return "WOMEN";
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

  return product === "UNISEX";
}

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
    ===================================================== */

    const detectedBrand =
      findMatch(query, brandNames);

    const detectedCategory =
      findMatch(query, categoryNames);

    const detectedColor =
      findMatch(query, colorNames);

    const detectedSize =
      findMatch(query, sizeValues);

    /* =====================================================
       DETECT GENDER
    ===================================================== */

    const genderWords = [
      "women",
      "woman",
      "female",
      "men",
      "man",
      "male",
      "unisex",
    ];

    const detectedGenderRaw =
      findMatch(query, genderWords);

    const detectedGender =
      normalizeGender(
        detectedGenderRaw
      );

    /* =====================================================
       LOAD PRODUCTS
    ===================================================== */

    const products =
      await prisma.product.findMany({
        take: 100,

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
      if (
        findMatch(query, [item.value])
      ) {
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
      size: detectedSize,
      gender: detectedGender,
      attributes: detectedAttributes,
    };

    /* =====================================================
       QUERY WORDS
    ===================================================== */

    const queryWords =
      getWords(query);

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
    addStructuredWords(detectedCategory);
    addStructuredWords(detectedColor);
    addStructuredWords(detectedSize);
    addStructuredWords(
      detectedGenderRaw
    );

    for (const attribute of detectedAttributes) {
      addStructuredWords(
        attribute.value
      );
    }

    const freeTextWords =
      queryWords.filter(
        (word) =>
          !structuredWords.has(word)
      );

    const hasSearchSignal =
      Boolean(detectedBrand) ||
      Boolean(detectedCategory) ||
      Boolean(detectedColor) ||
      Boolean(detectedSize) ||
      Boolean(detectedGender) ||
      detectedAttributes.length > 0 ||
      queryWords.length > 0;

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

        const colorMatches =
          !detectedColor ||
          productColors.includes(
            normalizeText(
              detectedColor
            )
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

        /* ===============================================
           FREE TEXT
        =============================================== */

        let matchedFreeTextWords = 0;
        let score = 0;

        for (const word of freeTextWords) {
          if (nameText.includes(word)) {
            score += 100;
            matchedFreeTextWords++;
          } else if (
            categoryText.includes(word)
          ) {
            score += 80;
            matchedFreeTextWords++;
          } else if (
            brandText.includes(word)
          ) {
            score += 70;
            matchedFreeTextWords++;
          } else if (
            descriptionText.includes(word)
          ) {
            score += 40;
            matchedFreeTextWords++;
          } else if (
            searchableText.includes(word)
          ) {
            score += 20;
            matchedFreeTextWords++;
          }
        }

        /* ===============================================
           STRUCTURED SCORE
        =============================================== */

        if (detectedBrand) {
          score += brandMatches
            ? 500
            : -500;
        }

        if (detectedCategory) {
          score += categoryMatches
            ? 400
            : -400;
        }

        if (detectedColor) {
          score += colorMatches
            ? 300
            : -300;
        }

        if (detectedSize) {
          score += sizeMatches
            ? 250
            : -250;
        }

        if (detectedGender) {
          score += productGenderMatches
            ? 600
            : -600;
        }

        if (detectedAttributes.length > 0) {
          score +=
            matchedAttributes * 200;

          score -=
            (detectedAttributes.length -
              matchedAttributes) *
            150;
        }

        /* ===============================================
           EXACT PHRASE
        =============================================== */

        const normalizedQuery =
          normalizeText(query);

        if (
          normalizedQuery.length > 0 &&
          searchableText.includes(
            normalizedQuery
          )
        ) {
          score += 100;
        }

        /* ===============================================
           EXACT MATCH
        =============================================== */

        const structuredFiltersMatch =
          brandMatches &&
          categoryMatches &&
          colorMatches &&
          sizeMatches &&
          productGenderMatches &&
          allAttributesMatched;

        const allFreeTextMatched =
          freeTextWords.length === 0 ||
          matchedFreeTextWords ===
            freeTextWords.length;

        const exactMatch =
          hasSearchSignal &&
          structuredFiltersMatch &&
          allFreeTextMatched;

        /* ===============================================
           SIMILAR MATCH
        =============================================== */

        const hasBrandMatch =
          Boolean(
            detectedBrand &&
            brandMatches
          );

        const hasCategoryMatch =
          Boolean(
            detectedCategory &&
            categoryMatches
          );

        const hasColorMatch =
          Boolean(
            detectedColor &&
            colorMatches
          );

        const hasSizeMatch =
          Boolean(
            detectedSize &&
            sizeMatches
          );

        const hasGenderMatch =
          Boolean(
            detectedGender &&
            productGenderMatches
          );

        const hasAttributeMatch =
          matchedAttributes > 0;

        const hasFreeTextMatch =
          matchedFreeTextWords > 0;

        const hasStructuredFilter =
          Boolean(
            detectedBrand ||
              detectedCategory ||
              detectedColor ||
              detectedSize ||
              detectedGender ||
              detectedAttributes.length > 0
          );

        const mismatches = [
          Boolean(
            detectedBrand &&
              !brandMatches
          ),
          Boolean(
            detectedCategory &&
              !categoryMatches
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
            detectedGender &&
              !productGenderMatches
          ),
        ].filter(Boolean).length;

        const genderMismatch = Boolean(
          detectedGender &&
            !productGenderMatches
        );

        let similarMatch = false;

        if (
          !exactMatch &&
          !genderMismatch
        ) {
          const meaningfulMatch =
            hasBrandMatch ||
            hasCategoryMatch ||
            hasColorMatch ||
            hasSizeMatch ||
            hasGenderMatch ||
            hasAttributeMatch ||
            hasFreeTextMatch;

          if (meaningfulMatch) {
            if (!hasStructuredFilter) {
              similarMatch = true;
            } else if (mismatches === 0) {
              similarMatch = true;
            } else if (
              mismatches === 1 &&
              (
                hasFreeTextMatch ||
                hasAttributeMatch ||
                hasBrandMatch ||
                hasCategoryMatch ||
                hasColorMatch
              )
            ) {
              similarMatch = true;
            }
          }
        }

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
            queryWords.length,

          matchedColors:
            detectedColor &&
            colorMatches
              ? 1
              : 0,

          matchedCategories:
            detectedCategory &&
            categoryMatches
              ? 1
              : 0,

          matchedAttributes,

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
                ? colorMatches
                : null,

            size:
              detectedSize
                ? sizeMatches
                : null,

            gender:
              detectedGender
                ? productGenderMatches
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
    ===================================================== */

    const exactProducts =
      scoredProducts
        .filter(
          (product) =>
            product.exactMatch
        )
        .sort(
          (a, b) =>
            b.score - a.score
        );

    /* =====================================================
       SIMILAR PRODUCTS
    ===================================================== */

    const similarProducts =
      scoredProducts
        .filter(
          (product) =>
            product.similarMatch &&
            product.score >= 0
        )
        .sort(
          (a, b) =>
            b.score - a.score
        );

    /* =====================================================
       RESPONSE
    ===================================================== */

    return NextResponse.json({
      success: true,

      query,

      structuredQuery,

      exactCount:
        exactProducts.length,

      similarCount:
        similarProducts.length,

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