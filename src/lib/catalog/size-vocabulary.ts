/* Semantic size vocabulary for the Questionnaire.

   The questionnaire's size step must never depend on whether a
   category happens to stock products right now. This module supplies
   the standard sizes a category's product type USES, from common
   knowledge of how clothing, shoes, bras, headwear and accessories
   size their products - not from any single catalog's inventory.

   Rules stay principled ("design as if the catalog has millions of
   products"):

     - shoes are sized numeric by system (EU / US / UK);
     - general clothing is sized with letters (XS..3XL);
     - bras use bra cup-and-band sizes (e.g. 36B);
     - headwear uses letter sizes plus One Size;
     - small accessories (watches, ties, bags, belts, sunglasses) are
       delivered One Size - no invented numeric scale.

   Kids sizes are deliberately NOT invented: the canonical project has
   no kids size convention (age-based, junior numeric, letters vary by
   brand), so KIDS rows stay data-driven only, exactly like kids
   category compatibility. Picking a semantic adult size that no
   product carries is a valid, honest choice: the engine matches real
   inventory and the results surface a zero-match state with a
   "Remove size" action - the pick is never deleted or replaced.

   This module is pure (no DB / network / I-O). */

import type {
  ContextualProductType,
  ContextualSizeRow,
} from "../sizes";

export type SizeVocabularyProduct = {
  slug: string;
  name: string;
  rootSlug: string;
  group: string;
};

export type SizeVocabularySystem = {
  system: string | null;
  values: string[];
};

export type SizeVocabulary = {
  productType: ContextualProductType;
  systems: SizeVocabularySystem[];
};

/* ---- known vocabularies ---- */

const CLOTHING_LETTERS_MEN = [
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "2XL",
  "3XL",
] as const;

const CLOTHING_LETTERS_WOMEN = [
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "2XL",
  "3XL",
] as const;

/* Bras need band-and-cup sizes, never plain letters: "36B" is a real
   bra size, "L" is not. Values align with the offer-size vocabulary so
   a pick matches listings that actually carry them. */
const BRA_SIZES = [
  "30A",
  "32A",
  "32B",
  "32C",
  "34A",
  "34B",
  "34C",
  "34D",
  "36A",
  "36B",
  "36C",
  "38B",
  "38C",
  "40B",
  "40C",
] as const;

const HEADWEAR =
  ["S", "M", "L", "XL", "One Size"] as const;

/* Accessories that are delivered one-size fit nobody's numeric scale,
   so they never get an invented one. */
const ACCESSORY_ONE_SIZE = ["One Size"] as const;

/* Socks are usually sold in a range pair (the shoe sizes they cover,
   EU-style) or a loose S/M/L walk; the range pairs are real, common
   listing sizes - not an invented scale. */
const SOCKS_LETTERS = [
  "S",
  "M",
  "L",
  "XL",
  "One Size",
] as const;

const SOCKS_EU_RANGES = [
  "35-38",
  "39-42",
  "43-46",
] as const;

/* Belts are sized by waist (numeric inches or S/M/L/XL); both are
   real sizing languages for belts and never One Size. */
const BELT_LETTERS = [
  "S",
  "M",
  "L",
  "XL",
  "One Size",
] as const;

const BELT_WAIST_IN = [
  "28",
  "30",
  "32",
  "34",
  "36",
  "38",
  "40",
  "42",
  "44",
] as const;

/* Numeric shoe scales per system, per gendered ring. The ranges are
   the standard adult walk of each system (not a per-catalog guess). */
const SHOES_EU_MEN = [
  "40",
  "41",
  "42",
  "43",
  "44",
  "45",
  "46",
  "47",
] as const;

const SHOES_US_MEN = [
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
  "13",
] as const;

const SHOES_UK_MEN = [
  "6.5",
  "7.5",
  "8.5",
  "9.5",
  "10.5",
  "11.5",
] as const;

const SHOES_EU_WOMEN = [
  "35",
  "36",
  "37",
  "38",
  "39",
  "40",
  "41",
  "42",
] as const;

const SHOES_US_WOMEN = [
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
] as const;

const SHOES_UK_WOMEN = [
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
] as const;

/* ---- vocabulary selection ---- */

function isBras(category: SizeVocabularyProduct): boolean {
  return (
    category.slug === "bras" ||
    /bra/i.test(category.slug) ||
    /bra/i.test(category.name)
  );
}

function isSocks(category: SizeVocabularyProduct): boolean {
  return (
    category.slug === "socks" ||
    /sock/i.test(category.slug) ||
    /sock/i.test(category.name)
  );
}

function isBelts(category: SizeVocabularyProduct): boolean {
  return (
    category.slug === "belts" ||
    /belt/i.test(category.slug) ||
    /belt/i.test(category.name)
  );
}

export function vocabularyForCategory(
  category: SizeVocabularyProduct
): SizeVocabulary {
  if (category.rootSlug === "shoes") {
    return {
      productType: "FOOTWEAR",
      systems: [
        { system: "EU", values: [...SHOES_EU_WOMEN] },
        { system: "US", values: [...SHOES_US_WOMEN] },
        { system: "UK", values: [...SHOES_UK_WOMEN] },
      ],
    };
  }

  if (isBras(category)) {
    return {
      productType: "CLOTHING",
      systems: [
        { system: null, values: [...BRA_SIZES] },
      ],
    };
  }

  if (isSocks(category)) {
    return {
      productType: "CLOTHING",
      systems: [
        {
          system: "Letters",
          values: [...SOCKS_LETTERS],
        },
        {
          system: "EU range",
          values: [...SOCKS_EU_RANGES],
        },
      ],
    };
  }

  if (isBelts(category)) {
    return {
      productType: "CLOTHING",
      systems: [
        {
          system: "Letters",
          values: [...BELT_LETTERS],
        },
        {
          system: "Waist (in)",
          values: [...BELT_WAIST_IN],
        },
      ],
    };
  }

  if (category.rootSlug === "headwear") {
    return {
      productType: "CLOTHING",
      systems: [
        { system: null, values: [...HEADWEAR] },
      ],
    };
  }

  if (category.rootSlug === "accessories") {
    return {
      productType: "CLOTHING",
      systems: [
        {
          system: null,
          values: [...ACCESSORY_ONE_SIZE],
        },
      ],
    };
  }

  /* General clothing: letter sizes. */
  return {
    productType: "CLOTHING",
    systems: [
      {
        system: null,
        values: [...CLOTHING_LETTERS_MEN],
      },
    ],
  };
}

/* ---- row generation ---- */

/* The semantic audience for a category comes from its MEN/WOMEN
   compatibility (mirrored as the shared default + UNISEX expansion in
   category-display): a women-only leaf (Bras) yields WOMEN rows only,
   an adult-shared leaf yields both. Kids rows are never generated. */
const AUDIENCES: ("MEN" | "WOMEN")[] = [
  "MEN",
  "WOMEN",
];

export function semanticSizeRowsFor(
  category: SizeVocabularyProduct,
  genders: ReadonlyArray<"MEN" | "WOMEN" | "KIDS" | "UNISEX">
): ContextualSizeRow[] {
  const vocabulary = vocabularyForCategory(category);
  const rows: ContextualSizeRow[] = [];

  for (const audience of AUDIENCES) {
    if (!genders.includes(audience)) {
      continue;
    }
    /* A shoes vocabulary is a set of per-system scales that applies
       to the audience's ring; clothing/bra/headwear/accessory
       vocabularies are shared between adult audiences. */
    const systems =
      category.rootSlug === "shoes"
        ? schoolScaleFor(
            audience,
            vocabulary.systems
          )
        : vocabulary.systems;

    for (const system of systems) {
      for (const value of system.values) {
        rows.push({
          audience,
          productType: vocabulary.productType,
          category: category.name,
          system: system.system,
          value,
          ordinal: null,
        });
      }
    }
  }

  return rows;
}

/* Men's shoes use the wider EU/US/UK scales, women's the narrower
   ones - the system names stay, the values are the audience ring. */
function schoolScaleFor(
  audience: "MEN" | "WOMEN",
  systems: SizeVocabularySystem[]
): SizeVocabularySystem[] {
  if (systems.length !== 3) {
    return systems;
  }
  if (audience === "MEN") {
    return [
      { system: "EU", values: [...SHOES_EU_MEN] },
      { system: "US", values: [...SHOES_US_MEN] },
      { system: "UK", values: [...SHOES_UK_MEN] },
    ];
  }
  return [
    { system: "EU", values: [...SHOES_EU_WOMEN] },
    { system: "US", values: [...SHOES_US_WOMEN] },
    { system: "UK", values: [...SHOES_UK_WOMEN] },
  ];
}