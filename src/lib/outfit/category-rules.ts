/* Category rules — taxonomy-driven outfit slots.

   The slot vocabulary (footwear / bottoms / tops / layering /
   accessory) is derived from the SHARED canonical taxonomy
   (category-display + import-plan), never from a hand-maintained
   category list, so a new category leaf automatically lands in the
   right slot the moment the taxonomy declares it. Rules:

     - Shoes root                 -> footwear
     - Bottoms sub-group          -> bottoms  (Socks is accessory)
     - Tops sub-group             -> tops     (hoodie/sweatshirt/
                                      jumper/cardigan/sweater/jacket
                                      are layering)
     - Outerwear sub-group        -> layering
     - Accessories / Headwear root-> accessory
     - one-pieces + underwear     -> never fill a slot (they are
                                      anchors only)
     - legacy DB-only rows keep a sensible group

   The compatibility matrix is GENERATED from the slot templates +
   this grouping (group members per slot with a stable rank), so there
   is no hand-written anchor-by-anchor matrix to drift out of sync.
   Only real purchased categories can ever appear in a look, because
   candidate pools only contain products that exist in the snapshot. */

import { canonicalCategoryDisplay } from "@/lib/catalog/category-display";
import type { SlotName, SlotTemplate } from "./types";

export type CategoryGroup =
  | "footwear"
  | "bottoms"
  | "tops"
  | "layering"
  | "accessory";

/* Slugs whose canonical sub-group says "Tops" but that function as
   layering pieces in a look. */
const LAYERING_OVERRIDE = new Set([
  "hoodies",
  "sweatshirts",
  "jumpers",
  "cardigans",
  "sweaters",
  "jackets",
]);

/* One-piece / underwear categories are never FILLERS (you don't slot a
   dress into a "top" set), but they can still be anchors. */
const ONEPIECE = new Set([
  "dresses",
  "jumpsuits",
  "bodysuits",
  "swimwear",
  "swimming-trunks",
  "bikinis",
  "bras",
  "sports-bras",
  "underwear",
  "boxers",
  "briefs",
]);

/* Socks are categorised under Bottoms by the taxonomy but dress as an
   accessory in a look. */
const ACCESSORY_OVERRIDE = new Set(["socks"]);

/* Legacy DB-only rows (not canonical leaves) keep a sensible group. */
const LEGACY_GROUP: Record<string, CategoryGroup> = {
  beanies: "accessory",
  caps: "accessory",
  hats: "accessory",
  belts: "accessory",
  sunglasses: "accessory",
  ties: "accessory",
  watches: "accessory",
  "running-trainers": "footwear",
  "button-ups": "tops", /* legacy top (was under the Tops sub-group) */
};

let cachedMap: Map<string, CategoryGroup | null> | null = null;
let cachedMembers: Record<CategoryGroup, string[]> | null = null;

function taxonomyMap(): Map<string, CategoryGroup | null> {
  if (cachedMap) return cachedMap;
  const map = new Map<string, CategoryGroup | null>();
  for (const c of canonicalCategoryDisplay()) {
    let group: CategoryGroup | null = null;
    if (c.rootSlug === "shoes") {
      group = "footwear";
    } else if (
      c.rootSlug === "accessories" ||
      c.rootSlug === "headwear"
    ) {
      group = "accessory";
    } else if (c.subgroup === "Bottoms") {
      group = "bottoms";
    } else if (c.subgroup === "Outerwear") {
      group = "layering";
    } else if (
      c.subgroup === "Tops" ||
      c.subgroup === "Dresses & Jumpsuits"
    ) {
      group = "tops";
    }
    map.set(c.slug, group);
  }
  for (const [slug, group] of Object.entries(LEGACY_GROUP)) {
    map.set(slug, group);
  }
  for (const slug of LAYERING_OVERRIDE) {
    map.set(slug, "layering");
  }
  for (const slug of ACCESSORY_OVERRIDE) {
    map.set(slug, "accessory");
  }
  cachedMap = map;
  return map;
}

function membersOf(group: CategoryGroup): string[] {
  const map = taxonomyMap();
  return [...map.entries()]
    .filter(([, g]) => g === group)
    .map(([slug]) => slug);
}

export const GROUP_OF_SLOT: Record<SlotName, CategoryGroup> = {
  bottom: "bottoms",
  top: "tops",
  layer: "layering",
  footwear: "footwear",
  accessory: "accessory",
};

/* Filler categories for a slot: the group's members minus one-pieces,
   so a real look only ever combines separates. */
function fillerFor(slot: SlotName): string[] {
  return membersOf(
    GROUP_OF_SLOT[slot]
  ).filter((slug) => !ONEPIECE.has(slug));
}

/* The slot a product's category occupies (used to place the anchor in
   the outfit's item list and to place locked/share items). */
export function slotOfCategory(slug: string): SlotName {
  switch (groupOfCategory(slug)) {
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
  return taxonomyMap().get(slug) ?? null;
}

/* Slot templates per anchor category GROUP. One-piece anchors (dress,
   swimsuit, bodysuit ...) get the neutral full look: a base top and
   bottom with optional footwear/accessory, so an outfit is always
   buildable around them. */
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

const NEUTRAL_TEMPLATE: SlotTemplate[] = [
  { slot: "top", required: true },
  { slot: "bottom", required: true },
  { slot: "footwear", required: false },
  { slot: "accessory", required: false },
];

export function slotTemplatesForCategory(slug: string): SlotTemplate[] {
  if (ONEPIECE.has(slug)) {
    return NEUTRAL_TEMPLATE;
  }
  const group = groupOfCategory(slug);
  if (!group) {
    return NEUTRAL_TEMPLATE;
  }
  return SLOT_TEMPLATES[group];
}

/* Which category SLOT each slot accepts for a given anchor slug.
   Generated from the templates + grouping: every member of the slot's
   group is a valid candidate with a stable rank. Returns
   (slot, category, preference) tuples. */

export type AllowedSlot = {
  slot: SlotName;
  category: string;
  preference: number;
};

const GENERATED: Record<string, AllowedSlot[]> = {};

export function allowedCategoriesForAnchor(
  anchorSlug: string
): AllowedSlot[] {
  if (GENERATED[anchorSlug]) {
    return GENERATED[anchorSlug];
  }
  const templates = slotTemplatesForCategory(anchorSlug);
  const allowed: AllowedSlot[] = [];
  for (const tmpl of templates) {
    const members = fillerFor(tmpl.slot);
    /* The anchor's own group is never a candidate for its own slot
       (a sneakers anchor doesn't pair with another shoe), and a
       layering anchor's base top is not the anchor itself. */
    const group = groupOfCategory(anchorSlug);
    for (const [idx, category] of members.entries()) {
      if (group !== null && group === GROUP_OF_SLOT[tmpl.slot]) {
        if (category === anchorSlug) continue;
      }
      allowed.push({
        slot: tmpl.slot,
        category,
        preference: idx + 1,
      });
    }
  }
  GENERATED[anchorSlug] = allowed;
  return allowed;
}

export function isAllowed(
  anchorSlug: string,
  slot: SlotName,
  categorySlug: string
): boolean {
  const list = GENERATED[anchorSlug] ?? allowedCategoriesForAnchor(anchorSlug);
  return list.some(
    (a) => a.slot === slot && a.category === categorySlug
  );
}

export function preferenceFor(
  anchorSlug: string,
  slot: SlotName,
  categorySlug: string
): number {
  const list = GENERATED[anchorSlug] ?? allowedCategoriesForAnchor(anchorSlug);
  const hit = list.find(
    (a) => a.slot === slot && a.category === categorySlug
  );
  return hit?.preference ?? 99;
}

/* The full taxonomy-driven vocabulary per group (kept exported for
   callers/tests that enumerate the known universe). */
export const REAL_CATEGORIES: Record<CategoryGroup, string[]> = (() => {
  if (cachedMembers) return cachedMembers;
  cachedMembers = {
    footwear: membersOf("footwear"),
    bottoms: membersOf("bottoms"),
    tops: membersOf("tops"),
    layering: membersOf("layering"),
    accessory: membersOf("accessory"),
  };
  return cachedMembers;
})();