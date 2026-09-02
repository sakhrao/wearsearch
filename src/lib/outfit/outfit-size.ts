/* Size awareness for the outfit engine — deterministic, additive.
   Pure functions over OutfitProduct variants' size data. The builder
   uses these to PREFER an available in-size product over one that is
   not, while never hard-emptying a slot (graceful fallback when the
   requested size is unavailable or the data is missing).

   Matching is exact-value first (case-insensitive / numeric compare),
   then normalizedValue, then a numeric-equivalence across systems for
   shoe sizes (EU 42 == US 9-style numeric are NOT treated as equal —
   different systems are different scales; we only equate identical
   numeric magnitudes within the SAME system unless normalized matches). */

import { isNumericSize } from "@/lib/facets";
import type { OutfitProduct } from "./types";

export type SizePreference = {
  value: string;
  /* Optional discipline hint ("CLOTHING" | "FOOTWEAR"); when omitted
     the matcher infers from whether the requested value is numeric. */
  productType?: string | null;
};

export type SizeMatch =
  | "exact-available"
  | "exact-any"
  | "equivalent-available"
  | "no-data"
  | "none";

export type SizeEval = {
  match: SizeMatch;
  score: number;
};

const SCORES: Record<SizeMatch, number> = {
  "exact-available": 1,
  "exact-any": 0.7,
  "equivalent-available": 0.7,
  "no-data": 0.5,
  none: 0.2,
};

export function sizeMatchScore(
  match: SizeMatch
): number {
  return SCORES[match];
}

/* A variant "carries" the requested size value exactly. */
function hasExactSize(
  variants: OutfitProduct["variants"],
  requestValue: string
): { available: boolean; exists: boolean } {
  const rv = requestValue.trim().toLowerCase();
  const rn = requestValue.trim();
  let available = false;
  let exists = false;
  for (const v of variants) {
    const s = v.size;
    if (!s) continue;
    const value = (s.value ?? "").trim();
    const norm = (s.normalizedValue ?? "").trim();
    const eq =
      value.toLowerCase() === rv ||
      norm.toLowerCase() === rv ||
      (isNumericSize(value) && isNumericSize(rn) && Number(value) === Number(rn));
    if (!eq) continue;
    if (v.availability === "AVAILABLE") available = true;
    exists = true;
  }
  return { available, exists };
}

/* Does this product carry ANY available size at all (to detect
   "no structured size data" products cleanly). */
function hasAnySize(variants: OutfitProduct["variants"]): boolean {
  return variants.some((v) => v.size && (v.size.value ?? "") !== "");
}

export function evalSize(
  product: OutfitProduct,
  preference: SizePreference | null
): SizeEval {
  if (!preference || !preference.value || preference.value.trim() === "") {
    return { match: "no-data", score: SCORES["no-data"] };
  }
  const variants = product.variants ?? [];

  const exact = hasExactSize(variants, preference.value);
  if (exact.available) {
    return { match: "exact-available", score: SCORES["exact-available"] };
  }
  if (exact.exists) {
    return { match: "exact-any", score: SCORES["exact-any"] };
  }

  // No exact value anywhere — try a same-magnitude numeric equivalent
  // (same system family) for shoe sizes when the request is numeric.
  const rn = parseFloat(preference.value);
  if (Number.isFinite(rn)) {
    for (const v of variants) {
      const s = v.size;
      if (!s) continue;
      const vn = parseFloat(s.value ?? "");
      if (Number.isFinite(vn) && vn === rn) {
        if (v.availability === "AVAILABLE") {
          return { match: "equivalent-available", score: SCORES["equivalent-available"] };
        }
      }
    }
  }

  // No structured size data on this product at all -> neutral fallback.
  if (!hasAnySize(variants)) {
    return { match: "no-data", score: SCORES["no-data"] };
  }

  return { match: "none", score: SCORES.none };
}
