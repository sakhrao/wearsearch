/* Build an Outfit — pure flow rules.
   Independent of the search engine and of the outfit engine's anchor
   matrix. The builder is USER-driven: the user picks one piece per
   step (Top -> Bottoms -> Shoes -> Outerwear -> Accessories), with a
   few hard, taxonomy-driven facts:

     - the UI only ever offers Men / Women / Kids. UNISEX is never a
       pick; a UNISEX product is implicitly available under Men and
       Women (the shared genderMatches policy in candidate-generator).
     - Dress / Jumpsuit are one-piece TOPS: choosing one as the Top
       removes the Bottoms step from the whole flow (a dress has no
       bottoms slot). Derived from the Dresses & Jumpsuits subgroup of
       the shared canonical taxonomy — never a hand-maintained list.
     - the category options for a slot ARE the slot's group members in
       the canonical taxonomy (groupOfCategory), so a new leaf lands in
       the right step automatically. No hardcoded gender/category
       lists live here; gender compatibility is supplied by the caller
       (the declared canonical audience /api/meta computes) and
       applied through genderCompatible().

   Everything in this module is pure (no DB / network / I-O). */

import { canonicalCategoryDisplay } from "@/lib/catalog/category-display";
import {
  GROUP_OF_SLOT,
  groupOfCategory,
} from "@/lib/outfit/category-rules";
import type { SlotName } from "@/lib/outfit/types";

/* The gender audiences the builder UI exposes. Deliberately only
   MEN / WOMEN / KIDS — there is no Unisex option to pick. */
export type BuildGender = "MEN" | "WOMEN" | "KIDS";

export const BUILD_GENDERS: BuildGender[] = ["MEN", "WOMEN", "KIDS"];

export const SLOT_LABELS: Record<SlotName, string> = {
  top: "Top",
  bottom: "Bottoms",
  footwear: "Shoes",
  layer: "Outerwear",
  accessory: "Accessories",
};

export type BuildStep = {
  slot: SlotName;
  label: string;
  /* a required slot left empty makes the outfit incomplete (never
     blocks finishing — the review states it honestly) */
  required: boolean;
};

/* The ordered flow. When the chosen Top is a one-piece (dress /
   jumpsuit) the Bottoms step disappears entirely. Every other slot
   keeps its canonical place: Top, Bottoms, Shoes, Outerwear,
   Accessories. */
export function flowSteps(onePieceTop: boolean): BuildStep[] {
  const steps: BuildStep[] = [
    { slot: "top", label: SLOT_LABELS.top, required: true },
  ];
  if (!onePieceTop) {
    steps.push({ slot: "bottom", label: SLOT_LABELS.bottom, required: true });
  }
  steps.push({ slot: "footwear", label: SLOT_LABELS.footwear, required: false });
  steps.push({ slot: "layer", label: SLOT_LABELS.layer, required: false });
  steps.push({ slot: "accessory", label: SLOT_LABELS.accessory, required: false });
  return steps;
}

/* One-piece TOP categories (Dresses & Jumpsuits). A dress/jumpsuit IS
   a valid Top (the group says tops), but choosing one removes the
   Bottoms step. Derived from the canonical Dresses & Jumpsuits
   subgroup so a future one-piece leaf automatically behaves the same. */
let cachedOnePieceTops: Set<string> | null = null;

export function onePieceTopSlugs(): Set<string> {
  if (cachedOnePieceTops) return cachedOnePieceTops;
  const set = new Set<string>();
  for (const d of canonicalCategoryDisplay()) {
    if (d.subgroup === "Dresses & Jumpsuits") set.add(d.slug);
  }
  cachedOnePieceTops = set;
  return set;
}

export function isOnePieceTopSlug(slug: string | null | undefined): boolean {
  if (!slug) return false;
  return onePieceTopSlugs().has(slug.toLowerCase());
}

/* A selectable category option for a builder step. */
export type SlotCategoryOption = {
  slug: string;
  name: string;
  root: string;
  group: string;
  rowSlug: string;
  /* whether the catalog currently stocks products under this leaf */
  hasProducts: boolean;
  /* a one-piece top (Dress/Jumpsuit): choosing it drops the Bottoms step */
  onePiece: boolean;
  /* legacy (DB-only) leaf not present in the canonical taxonomy */
  legacy: boolean;
};

function toOption(d: {
  slug: string;
  name: string;
  root: string;
  group: string;
  legacy: boolean;
}): SlotCategoryOption {
  return {
    slug: d.slug,
    name: d.name,
    root: d.root,
    group: d.group,
    rowSlug: d.slug,
    hasProducts: false,
    onePiece: isOnePieceTopSlug(d.slug),
    legacy: d.legacy,
  };
}

/* Canonical category options for a slot, in canonical (plan) order.
   For the Top slot this is the Tops group PLUS the one-piece
   Dresses/Jumpsuits leaves (both are valid first pieces). Every other
   slot is exactly its group's members — the shared sexes live in the
   taxonomy, never in a list here. */
export function canonicalCategoriesForSlot(
  slot: SlotName
): SlotCategoryOption[] {
  const out: SlotCategoryOption[] = [];
  const onePiece = onePieceTopSlugs();
  for (const d of canonicalCategoryDisplay()) {
    const g = groupOfCategory(d.slug);
    if (slot === "top") {
      if (g === "tops" || onePiece.has(d.slug)) {
        out.push(
          toOption({
            slug: d.slug,
            name: d.name,
            root: d.root,
            group: d.group,
            legacy: false,
          })
        );
      }
    } else if (g === GROUP_OF_SLOT[slot]) {
      /* one-pieces are never OTHER-slot candidates (a dress does not
         fill a bottoms pick) */
      if (onePiece.has(d.slug)) continue;
      out.push(
        toOption({
          slug: d.slug,
          name: d.name,
          root: d.root,
          group: d.group,
          legacy: false,
        })
      );
    }
  }
  return out;
}

/* A category (canonical or a real catalog leaf) belongs to a slot iff
   its taxonomy group matches the slot's group. This is the single
   membership rule used both for ticket options and candidate gating —
   a new taxonomy leaf lands in the right step by construction. */
export function categoryInSlot(
  slug: string | null | undefined,
  slot: SlotName
): boolean {
  if (!slug) return false;
  return groupOfCategory(slug) === GROUP_OF_SLOT[slot];
}

/* Gender compatibility for the builder, over the per-category gender
   signal /api/meta computes (declared canonical audience - inventory
   independent - plus data-driven KIDS for canonical leaves; legacy
   rows stay inventory-first). */
export function genderCompatible(
  categoryGenders: ReadonlyArray<
    "MEN" | "WOMEN" | "KIDS" | "UNISEX"
  > | null | undefined,
  requested: BuildGender
): boolean {
  if (!categoryGenders || categoryGenders.length === 0) return false;
  if (requested === "KIDS") {
    return categoryGenders.includes("KIDS");
  }
  return (
    categoryGenders.includes(requested) ||
    categoryGenders.includes("UNISEX")
  );
}