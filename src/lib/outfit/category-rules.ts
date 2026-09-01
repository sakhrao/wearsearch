/* Category rules — real catalog categories only.
   The engine runs on the actual purchasable leaf categories that
   exist in the live catalog. No invented categories (no dresses,
   skirts, blazers, jackets, accessories unless they actually stock
   purchasable products). */

import type { SlotName, SlotTemplate } from "./types";

export type CategoryGroup =
  | "footwear"
  | "bottoms"
  | "tops"
  | "layering"
  | "accessory";

/* The real, product-bearing leaf category slugs found in the catalog
   (verified by DB probe). Listed explicitly so nothing invented can
   leak in. */
export const REAL_CATEGORIES: Record<CategoryGroup, string[]> = {
  footwear: ["sneakers", "loafers", "heels", "sandals", "boots"],
  bottoms: ["trousers", "jeans", "joggers", "leggings", "chinos", "shorts", "cargo"],
  tops: ["t-shirts", "blouses", "button-ups", "tank-tops", "polos"],
  layering: ["cardigans", "hoodies", "sweatshirts", "jumpers", "jackets"],
  accessory: ["belts", "caps", "hats", "beanies", "sunglasses", "watches", "ties", "socks"],
};

export const GROUP_OF_SLOT: Record<SlotName, CategoryGroup> = {
  bottom: "bottoms",
  top: "tops",
  layer: "layering",
  footwear: "footwear",
  accessory: "accessory",
};

/* The natural slot a product's category occupies (used to place the
   anchor in the outfit's item list). */
export function slotOfCategory(slug: string): SlotName {
  const group = groupOfCategory(slug);
  switch (group) {
    case "bottoms":
      return "bottom";
    case "tops":
      return "top";
    case "layering":
      return "layer";
    case "footwear":
      return "footwear";
    case "accessory":
      return "accessory";
    default:
      return "top";
  }
}

export function groupOfCategory(slug: string): CategoryGroup | null {
  for (const [group, cats] of Object.entries(REAL_CATEGORIES)) {
    if (cats.includes(slug)) return group as CategoryGroup;
  }
  return null;
}

/* Slot templates per anchor category GROUP. Only real groups that
   can hold an anchor are supported; accessory anchors are weak but
   allowed (fill top+bottom around them). */
const SLOT_TEMPLATES: Record<CategoryGroup, SlotTemplate[]> = {
  footwear: [
    { slot: "bottom", required: true },
    { slot: "top", required: true },
    { slot: "layer", required: false },
    { slot: "accessory", required: false },
  ],
  bottoms: [
    { slot: "top", required: true },
    { slot: "layer", required: false },
    { slot: "footwear", required: false },
    { slot: "accessory", required: false },
  ],
  tops: [
    { slot: "bottom", required: true },
    { slot: "layer", required: false },
    { slot: "footwear", required: false },
    { slot: "accessory", required: false },
  ],
  layering: [
    { slot: "bottom", required: true },
    { slot: "top", required: true },
    { slot: "footwear", required: false },
    { slot: "accessory", required: false },
  ],
  accessory: [
    { slot: "top", required: true },
    { slot: "bottom", required: true },
  ],
};

export function slotTemplatesForCategory(slug: string): SlotTemplate[] {
  const group = groupOfCategory(slug) ?? "footwear";
  return SLOT_TEMPLATES[group];
}

/* Which category SLOT each category can fill for a given anchor slug.
   Returns allowed (slot, category, preference) tuples. */

type AllowedSlot = { slot: SlotName; category: string; preference: number };

/* Compatibility matrix: anchor category -> allowed (slot, category).
   preference is a lower-is-better rank used as a stable fill order. */
const COMPAT: Record<string, AllowedSlot[]> = {
  /* --- FOOTWEAR anchors --- */
  sneakers: [
    { slot: "bottom", category: "trousers", preference: 1 },
    { slot: "bottom", category: "joggers", preference: 2 },
    { slot: "bottom", category: "jeans", preference: 3 },
    { slot: "bottom", category: "chinos", preference: 4 },
    { slot: "bottom", category: "leggings", preference: 5 },
    { slot: "top", category: "t-shirts", preference: 1 },
    { slot: "top", category: "blouses", preference: 2 },
    { slot: "top", category: "button-ups", preference: 3 },
    { slot: "top", category: "tank-tops", preference: 4 },
    { slot: "layer", category: "hoodies", preference: 1 },
    { slot: "layer", category: "sweatshirts", preference: 2 },
    { slot: "layer", category: "cardigans", preference: 3 },
  ],
  joggers: [
    { slot: "bottom", category: "trousers", preference: 1 },
    { slot: "bottom", category: "joggers", preference: 2 },
    { slot: "bottom", category: "jeans", preference: 3 },
    { slot: "bottom", category: "chinos", preference: 4 },
    { slot: "top", category: "t-shirts", preference: 1 },
    { slot: "top", category: "tank-tops", preference: 2 },
    { slot: "top", category: "blouses", preference: 3 },
    { slot: "layer", category: "hoodies", preference: 1 },
    { slot: "layer", category: "sweatshirts", preference: 2 },
  ],
  leggings: [
    { slot: "bottom", category: "leggings", preference: 1 },
    { slot: "bottom", category: "trousers", preference: 2 },
    { slot: "bottom", category: "jeans", preference: 3 },
    { slot: "bottom", category: "joggers", preference: 4 },
    { slot: "top", category: "t-shirts", preference: 1 },
    { slot: "top", category: "tank-tops", preference: 2 },
    { slot: "top", category: "blouses", preference: 3 },
    { slot: "top", category: "button-ups", preference: 4 },
    { slot: "layer", category: "hoodies", preference: 1 },
    { slot: "layer", category: "sweatshirts", preference: 2 },
    { slot: "layer", category: "cardigans", preference: 3 },
  ],
  jeans: [
    { slot: "bottom", category: "jeans", preference: 1 },
    { slot: "bottom", category: "trousers", preference: 2 },
    { slot: "bottom", category: "chinos", preference: 3 },
    { slot: "top", category: "t-shirts", preference: 1 },
    { slot: "top", category: "blouses", preference: 2 },
    { slot: "top", category: "button-ups", preference: 3 },
    { slot: "top", category: "tank-tops", preference: 4 },
    { slot: "layer", category: "hoodies", preference: 1 },
    { slot: "layer", category: "sweatshirts", preference: 2 },
    { slot: "layer", category: "cardigans", preference: 3 },
  ],
  trousers: [
    { slot: "bottom", category: "trousers", preference: 1 },
    { slot: "bottom", category: "jeans", preference: 2 },
    { slot: "bottom", category: "chinos", preference: 3 },
    { slot: "top", category: "blouses", preference: 1 },
    { slot: "top", category: "button-ups", preference: 2 },
    { slot: "top", category: "t-shirts", preference: 3 },
    { slot: "top", category: "tank-tops", preference: 4 },
    { slot: "layer", category: "cardigans", preference: 1 },
    { slot: "layer", category: "sweatshirts", preference: 2 },
    { slot: "layer", category: "hoodies", preference: 3 },
    { slot: "footwear", category: "loafers", preference: 1 },
    { slot: "footwear", category: "sneakers", preference: 2 },
    { slot: "footwear", category: "heels", preference: 3 },
  ],
  chinos: [
    { slot: "bottom", category: "chinos", preference: 1 },
    { slot: "bottom", category: "trousers", preference: 2 },
    { slot: "bottom", category: "jeans", preference: 3 },
    { slot: "top", category: "button-ups", preference: 1 },
    { slot: "top", category: "blouses", preference: 2 },
    { slot: "top", category: "t-shirts", preference: 3 },
    { slot: "layer", category: "cardigans", preference: 1 },
    { slot: "layer", category: "sweatshirts", preference: 2 },
    { slot: "layer", category: "hoodies", preference: 3 },
    { slot: "footwear", category: "loafers", preference: 1 },
    { slot: "footwear", category: "sneakers", preference: 2 },
  ],
  /* --- TOPS anchors --- */
  "t-shirts": [
    { slot: "bottom", category: "trousers", preference: 1 },
    { slot: "bottom", category: "joggers", preference: 2 },
    { slot: "bottom", category: "jeans", preference: 3 },
    { slot: "bottom", category: "chinos", preference: 4 },
    { slot: "bottom", category: "leggings", preference: 5 },
    { slot: "layer", category: "hoodies", preference: 1 },
    { slot: "layer", category: "sweatshirts", preference: 2 },
    { slot: "layer", category: "cardigans", preference: 3 },
    { slot: "footwear", category: "sneakers", preference: 1 },
    { slot: "footwear", category: "sandals", preference: 2 },
  ],
  "tank-tops": [
    { slot: "bottom", category: "trousers", preference: 1 },
    { slot: "bottom", category: "leggings", preference: 2 },
    { slot: "bottom", category: "jeans", preference: 3 },
    { slot: "bottom", category: "chinos", preference: 4 },
    { slot: "bottom", category: "joggers", preference: 5 },
    { slot: "layer", category: "cardigans", preference: 1 },
    { slot: "layer", category: "hoodies", preference: 2 },
    { slot: "layer", category: "sweatshirts", preference: 3 },
    { slot: "footwear", category: "sandals", preference: 1 },
    { slot: "footwear", category: "sneakers", preference: 2 },
  ],
  blouses: [
    { slot: "bottom", category: "trousers", preference: 1 },
    { slot: "bottom", category: "jeans", preference: 2 },
    { slot: "bottom", category: "chinos", preference: 3 },
    { slot: "bottom", category: "leggings", preference: 4 },
    { slot: "layer", category: "cardigans", preference: 1 },
    { slot: "layer", category: "sweatshirts", preference: 2 },
    { slot: "layer", category: "hoodies", preference: 3 },
    { slot: "footwear", category: "loafers", preference: 1 },
    { slot: "footwear", category: "heels", preference: 2 },
    { slot: "footwear", category: "sneakers", preference: 3 },
  ],
  "button-ups": [
    { slot: "bottom", category: "trousers", preference: 1 },
    { slot: "bottom", category: "chinos", preference: 2 },
    { slot: "bottom", category: "jeans", preference: 3 },
    { slot: "layer", category: "cardigans", preference: 1 },
    { slot: "layer", category: "sweatshirts", preference: 2 },
    { slot: "footwear", category: "loafers", preference: 1 },
    { slot: "footwear", category: "sneakers", preference: 2 },
    { slot: "footwear", category: "heels", preference: 3 },
  ],
  polos: [
    { slot: "bottom", category: "trousers", preference: 1 },
    { slot: "bottom", category: "chinos", preference: 2 },
    { slot: "bottom", category: "jeans", preference: 3 },
    { slot: "layer", category: "cardigans", preference: 1 },
    { slot: "layer", category: "sweatshirts", preference: 2 },
    { slot: "footwear", category: "loafers", preference: 1 },
    { slot: "footwear", category: "sneakers", preference: 2 },
  ],
  /* --- LAYERING anchors --- */
  hoodies: [
    { slot: "bottom", category: "trousers", preference: 1 },
    { slot: "bottom", category: "joggers", preference: 2 },
    { slot: "bottom", category: "jeans", preference: 3 },
    { slot: "bottom", category: "chinos", preference: 4 },
    { slot: "bottom", category: "leggings", preference: 5 },
    { slot: "top", category: "t-shirts", preference: 1 },
    { slot: "top", category: "tank-tops", preference: 2 },
    { slot: "footwear", category: "sneakers", preference: 1 },
    { slot: "footwear", category: "sandals", preference: 2 },
  ],
  sweatshirts: [
    { slot: "bottom", category: "trousers", preference: 1 },
    { slot: "bottom", category: "joggers", preference: 2 },
    { slot: "bottom", category: "jeans", preference: 3 },
    { slot: "bottom", category: "chinos", preference: 4 },
    { slot: "bottom", category: "leggings", preference: 5 },
    { slot: "top", category: "t-shirts", preference: 1 },
    { slot: "top", category: "tank-tops", preference: 2 },
    { slot: "top", category: "button-ups", preference: 3 },
    { slot: "footwear", category: "sneakers", preference: 1 },
    { slot: "footwear", category: "sandals", preference: 2 },
  ],
  cardigans: [
    { slot: "bottom", category: "trousers", preference: 1 },
    { slot: "bottom", category: "jeans", preference: 2 },
    { slot: "bottom", category: "chinos", preference: 3 },
    { slot: "bottom", category: "leggings", preference: 4 },
    { slot: "top", category: "blouses", preference: 1 },
    { slot: "top", category: "tank-tops", preference: 2 },
    { slot: "top", category: "t-shirts", preference: 3 },
    { slot: "top", category: "button-ups", preference: 4 },
    { slot: "footwear", category: "loafers", preference: 1 },
    { slot: "footwear", category: "heels", preference: 2 },
    { slot: "footwear", category: "sneakers", preference: 3 },
  ],
  /* --- Footwear anchors (dressier) --- */
  loafers: [
    { slot: "bottom", category: "trousers", preference: 1 },
    { slot: "bottom", category: "chinos", preference: 2 },
    { slot: "bottom", category: "jeans", preference: 3 },
    { slot: "top", category: "button-ups", preference: 1 },
    { slot: "top", category: "blouses", preference: 2 },
    { slot: "top", category: "t-shirts", preference: 3 },
    { slot: "layer", category: "cardigans", preference: 1 },
    { slot: "layer", category: "sweatshirts", preference: 2 },
  ],
  heels: [
    { slot: "bottom", category: "trousers", preference: 1 },
    { slot: "bottom", category: "jeans", preference: 2 },
    { slot: "bottom", category: "leggings", preference: 3 },
    { slot: "top", category: "blouses", preference: 1 },
    { slot: "top", category: "button-ups", preference: 2 },
    { slot: "top", category: "tank-tops", preference: 3 },
    { slot: "layer", category: "cardigans", preference: 1 },
  ],
  sandals: [
    { slot: "bottom", category: "trousers", preference: 1 },
    { slot: "bottom", category: "jeans", preference: 2 },
    { slot: "bottom", category: "leggings", preference: 3 },
    { slot: "bottom", category: "joggers", preference: 4 },
    { slot: "top", category: "tank-tops", preference: 1 },
    { slot: "top", category: "blouses", preference: 2 },
    { slot: "top", category: "t-shirts", preference: 3 },
    { slot: "layer", category: "cardigans", preference: 1 },
  ],
  boots: [
    { slot: "bottom", category: "trousers", preference: 1 },
    { slot: "bottom", category: "jeans", preference: 2 },
    { slot: "top", category: "blouses", preference: 1 },
    { slot: "top", category: "button-ups", preference: 2 },
    { slot: "top", category: "t-shirts", preference: 3 },
    { slot: "layer", category: "cardigans", preference: 1 },
  ],
};

export function allowedCategoriesForAnchor(
  anchorSlug: string
): AllowedSlot[] {
  return COMPAT[anchorSlug] ?? [];
}

export function isAllowed(
  anchorSlug: string,
  slot: SlotName,
  categorySlug: string
): boolean {
  const list = COMPAT[anchorSlug] ?? [];
  return list.some(
    (a) => a.slot === slot && a.category === categorySlug
  );
}

export function preferenceFor(
  anchorSlug: string,
  slot: SlotName,
  categorySlug: string
): number {
  const list = COMPAT[anchorSlug] ?? [];
  const hit = list.find(
    (a) => a.slot === slot && a.category === categorySlug
  );
  return hit?.preference ?? 99;
}
