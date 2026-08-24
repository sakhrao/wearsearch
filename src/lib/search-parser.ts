import { prisma } from "@/lib/prisma";

export type ParsedSearchQuery = {
  original: string;
  terms: string[];

  brandId?: string;
  categoryId?: string;
  colorId?: string;
  sizeId?: string;

  gender?: "MEN" | "WOMEN" | "UNISEX" | "KIDS";

  attributeIds: string[];
};

const genderMap: Record<string, ParsedSearchQuery["gender"]> = {
  men: "MEN",
  man: "MEN",
  male: "MEN",

  women: "WOMEN",
  woman: "WOMEN",
  female: "WOMEN",

  unisex: "UNISEX",

  kids: "KIDS",
  kid: "KIDS",
  children: "KIDS",
};

export async function parseSearchQuery(
  query: string
): Promise<ParsedSearchQuery> {
  const normalized = query.trim().toLowerCase();

  const terms = normalized
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);

  const parsed: ParsedSearchQuery = {
    original: query,
    terms,
    attributeIds: [],
  };

  for (const term of terms) {
    /*
     * ==============================
     * GENDER
     * ==============================
     */

    if (genderMap[term]) {
      parsed.gender = genderMap[term];
      continue;
    }

    /*
     * ==============================
     * BRAND
     * ==============================
     */

    const brand = await prisma.brand.findFirst({
      where: {
        name: {
          equals: term,
          mode: "insensitive",
        },
      },
      select: {
        id: true,
      },
    });

    if (brand) {
      parsed.brandId = brand.id;
      continue;
    }

    /*
     * ==============================
     * CATEGORY
     * ==============================
     */

    const category = await prisma.category.findFirst({
      where: {
        OR: [
          {
            name: {
              equals: term,
              mode: "insensitive",
            },
          },
          {
            slug: {
              equals: term,
              mode: "insensitive",
            },
          },
        ],
      },
      select: {
        id: true,
      },
    });

    if (category) {
      parsed.categoryId = category.id;
      continue;
    }

    /*
     * ==============================
     * COLOR
     * ==============================
     */

    const color = await prisma.color.findFirst({
      where: {
        OR: [
          {
            name: {
              equals: term,
              mode: "insensitive",
            },
          },
          {
            slug: {
              equals: term,
              mode: "insensitive",
            },
          },
        ],
      },
      select: {
        id: true,
      },
    });

    if (color) {
      parsed.colorId = color.id;
      continue;
    }

    /*
     * ==============================
     * SIZE
     * ==============================
     */

    const size = await prisma.size.findFirst({
      where: {
        OR: [
          {
            value: {
              equals: term,
              mode: "insensitive",
            },
          },
          {
            normalizedValue: {
              equals: term,
              mode: "insensitive",
            },
          },
        ],
      },
      select: {
        id: true,
      },
    });

    if (size) {
      parsed.sizeId = size.id;
      continue;
    }

    /*
     * ==============================
     * ATTRIBUTE VALUE
     * ==============================
     */

    const attribute = await prisma.productAttribute.findFirst({
      where: {
        value: {
          equals: term,
          mode: "insensitive",
        },
      },
      select: {
        attributeId: true,
      },
    });

    if (attribute) {
      parsed.attributeIds.push(attribute.attributeId);
    }
  }

  return parsed;
}