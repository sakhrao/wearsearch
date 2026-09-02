/* Candidate generator — reads a catalog snapshot and, per slot,
   produces the eligible candidates for the outfit builder.

   Hard gates applied BEFORE any scoring (order matters):
     1. hasRealProductPage (F1)  — no demo/placeholder pages.
     2. product not OUT_OF_STOCK (F7).
     3. has at least one AVAILABLE variant (F8).
     4. gender policy (mirrors search route genderMatches).
     5. category is allowed for the anchor+slot (matrix gate).

   Only products passing ALL gates reach scoring.

   Additive: when a `size` preference is supplied, the stable sort is
   made size-aware so an AVAILABLE in-size product ranks above one
   that is not, within the same preference/name tier. When no size is
   given the ordering is byte-identical to the size-unaware path. */

import { hasRealProductPage } from "@/lib/product-url";
import { preferenceFor } from "./category-rules";
import { resolveCandidateColor } from "./compatibility";
import { deriveStyleProfile } from "./style-profile";
import { evalSize, type SizePreference } from "./outfit-size";
import type {
  Gender,
  OutfitProduct,
  SlotName,
  StyleProfile,
} from "./types";

/* Gender policy — faithful copy of the search route's predicate
   (route.ts genderMatches). WOMEN/MEN admit UNISEX; KIDS only KIDS;
   hard isolation preserved. Kept here because Outfit must not
   modify route.ts, yet must use the exact same semantics (§5). */
export function genderMatches(
  requested: Gender,
  product: Gender
): boolean {
  if (!requested) return true;
  if (!product) return false;
  if (requested === "MEN") {
    return product === "MEN" || product === "UNISEX";
  }
  if (requested === "WOMEN") {
    return product === "WOMEN" || product === "UNISEX";
  }
  if (requested === "KIDS") {
    return product === "KIDS";
  }
  return product === "UNISEX";
}

export function isEligibleCandidate(args: {
  product: OutfitProduct;
  slot: SlotName;
  anchorSlug: string;
  anchorGender: Gender | null;
}): boolean {
  const { product, slot, anchorSlug, anchorGender } = args;

  if (!hasRealProductPage(product.productUrl)) return false;
  if (product.availability === "OUT_OF_STOCK") return false;
  if (!product.variants.some((v) => v.availability === "AVAILABLE"))
    return false;
  if (anchorGender) {
    const pGender = normalizeGender(product.gender);
    if (!genderMatches(anchorGender, pGender)) return false;
  }
  const catSlug = product.category?.slug?.toLowerCase() ?? "";
  if (preferenceFor(anchorSlug, slot, catSlug) >= 99) return false;
  return true;
}

export function normalizeGender(g: Gender | null | undefined): Gender {
  if (!g) return "UNISEX";
  return g;
}

/* Build candidates for one slot from a snapshot. Returns each
   eligible candidate with its precomputed profile and color. */
export function candidatesForSlot(args: {
  products: OutfitProduct[];
  slot: SlotName;
  anchorSlug: string;
  anchorGender: Gender | null;
  anchorProfile: StyleProfile | null;
  anchorColor: string | null;
  size?: SizePreference | null;
}): CandidateEntry[] {
  const { products, slot, anchorSlug, anchorGender, anchorProfile, anchorColor, size = null } = args;

  const entries: CandidateEntry[] = [];
  const seen = new Set<string>();

  for (const p of products) {
    if (!isEligibleCandidate({ product: p, slot, anchorSlug, anchorGender }))
      continue;
    if (seen.has(p.id)) continue;
    seen.add(p.id);

    const profile = deriveStyleProfile(p);
    const color = resolveCandidateColor(p, anchorColor);
    const catSlug = p.category?.slug?.toLowerCase() ?? "";
    entries.push({
      product: p,
      profile,
      color,
      categorySlug: catSlug,
      anchorSlug,
      slot,
    });
  }

  // Stable ordering: preference, then name, then id — deterministic.
  // When a size is requested, an AVAILABLE in-size candidate ranks
  // ahead within the same preference tier (additive size awareness).
  entries.sort((a, b) => {
    const pa = preferenceFor(anchorSlug, slot, a.categorySlug);
    const pb = preferenceFor(anchorSlug, slot, b.categorySlug);
    if (pa !== pb) return pa - pb;
    if (size && size.value && size.value.trim() !== "") {
      const sa = evalSize(a.product, size).score;
      const sb = evalSize(b.product, size).score;
      if (sa !== sb) return sb - sa;
    }
    if (a.product.name < b.product.name) return -1;
    if (a.product.name > b.product.name) return 1;
    if (a.product.id < b.product.id) return -1;
    if (a.product.id > b.product.id) return 1;
    return 0;
  });

  return entries;
}

export type CandidateEntry = {
  product: OutfitProduct;
  profile: StyleProfile;
  color: { name: string; hex: string | null } | null;
  categorySlug: string;
  anchorSlug: string;
  slot: SlotName;
};
