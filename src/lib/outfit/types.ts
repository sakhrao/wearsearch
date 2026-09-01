/* Outfit Engine — domain types.
   Independent layer above the catalog; reads products only.
   No DB writes, no changes to the search engine. */

export type Gender = "MEN" | "WOMEN" | "UNISEX" | "KIDS";

export type Occasion =
  | "Everyday"
  | "University"
  | "Work"
  | "Date"
  | "Party"
  | "Formal"
  | "Sport"
  | "Travel";

export type StyleLabel =
  | "casual"
  | "sporty"
  | "streetwear"
  | "smart-casual"
  | "formal"
  | "classic"
  | "bohemian"
  | "minimalist";

/* A style vector over a fixed vocabulary. A product can hold a
   fuzzy membership in multiple styles. */
export type StyleVector = Record<StyleLabel, number>;

/* Where a style classification came from. Source-backed
   (attribute) is authoritative over derived (category/hint/title). */
export type StyleSource =
  | "attribute"
  | "category"
  | "attribute-hint"
  | "title";

export type StyleProfile = {
  vector: StyleVector;
  /* Formality scalar in [0,1]: 1 = most formal. */
  formality: number;
  source: StyleSource;
};

/* The minimal product shape the outfit engine consumes. It mirrors
   the search route's select + invariants (F1/F7/F8). */
export type OutfitProduct = {
  id: string;
  name: string;
  price: string;
  currency: string | null;
  productUrl: string;
  imageUrl: string | null;
  availability: string | null;
  gender: Gender | null;
  brand: { id: string; name: string } | null;
  category: { id: string; slug: string; name: string } | null;
  variants: {
    price: string;
    currency: string | null;
    availability: string;
    color: { name: string; hex: string | null } | null;
  }[];
  attributes: { value: string; attribute: { name: string } }[];
};

export type ColorInfo = {
  name: string;
  hex: string | null;
};

export type HarmonyLevel = "excellent" | "good" | "neutral" | "poor";

export type SlotName = "bottom" | "top" | "layer" | "footwear" | "accessory";

export type SlotTemplate = {
  slot: SlotName;
  required: boolean;
};

export type PlacedItem = {
  slot: SlotName;
  product: OutfitProduct;
  /* The color actually used for this placement (deterministic pick
     for multi-color products). */
  color: ColorInfo | null;
};

/* Explanation line: human text + the internal reason code + the
   numeric term that produced it. */
export type ExplanationLine = {
  text: string;
  code: string;
  value: number;
};

export type GroundTruth = {
  anchorId: string;
  occasion: Occasion | null;
  style: StyleLabel | null;
  budgetEur: number | null;
};

export type Outfit = {
  id: string;
  complete: boolean;
  score: number;
  totalPriceEur: number;
  items: PlacedItem[];
  missingSlots: SlotName[];
  explanations: Record<string, ExplanationLine[]>;
};

export type OutfitRequest = {
  anchorProductId: string;
  occasion?: Occasion | null;
  style?: StyleLabel | null;
  budget?: number | null;
};

export type ReplaceRequest = {
  anchorProductId: string;
  slot: SlotName;
  lockedProductIds: string[];
};
