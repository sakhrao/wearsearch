/* Pure dedup engine (Phase 0).

   Identity resolution the import harness drives, in order:
     1. GTIN/EAN/UPC        (GtinRecord index)
     2. Brand + MPN         (MpnRecord, brand-scoped)     [DEDUP_LAYERS.BRAND_MPN]
     3. Brand + SKU         (sku - reserved, brand-scoped)
     4. brand + name + color(bnc fingerprint)
     5. similarity          (fallback only, marked DEDUP_LAYERS.SIMILARITY)

   This module computes WHAT a listing is (its identity layers and
   similarity tokens). It never decides by itself whether two listings
   are the same product ONLY on fuzzy grounds - the harness owns that
   decision and only applies layer 5 when a human-approved policy says
   it may (default: never auto-merge on fuzzy alone).

   Pure: no DB, no I/O. */

import { DEDUP_LAYERS, type DedupLayer, type IdentityBundle } from "./types";
import { dedupKeyFor, foldToken, normalizeColorName } from "./normalize";

/* Which layers this listing can even express. A listing with no GTIN,
   no MPN, no SKU and no name cannot be identity-matched at those
   layers respectively; the harness should not query for them. */
export function identityLayersOf(bundle: IdentityBundle): DedupLayer[] {
  const layers: DedupLayer[] = [];
  if (bundle.gtins.length > 0) layers.push(DEDUP_LAYERS.GTIN as DedupLayer);
  if (bundle.brand && bundle.mpn) layers.push(DEDUP_LAYERS.BRAND_MPN as DedupLayer);
  if (bundle.brand && bundle.sku) layers.push(DEDUP_LAYERS.BRAND_SKU as DedupLayer);
  if (bundle.name) layers.push(DEDUP_LAYERS.BRAND_NAME_COLOR as DedupLayer);
  /* Layer 5 (similarity) is always expressible as a fallback. */
  layers.push(DEDUP_LAYERS.SIMILARITY as DedupLayer);
  return layers.map((l) => l);
}

export function identityKey(
  layer: DedupLayer,
  bundle: IdentityBundle
): string {
  return dedupKeyFor(layer, bundle);
}

/* Token set for similarity comparison (layer 5). Stopwords and generic
   commerce terms excluded so fuzzy matching does not merge on
   meaningless words. */
const SIMILARITY_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "for", "with", "womens", "mens",
  "woman", "man", "unisex", "kids", "kids", "shirt", "t", "shirt",
  "tshirt", "top", "tee", "new", "classic", "essential", "regular",
]);

export function similarityTokens(name: string): string[] {
  return foldToken(name)
    .split(/\s+/)
    .filter((token) => token.length > 1 || /^\d+(\.\d+)?$/.test(token))
    .filter((token) => !SIMILARITY_STOPWORDS.has(token));
}

/* Pure Jaccard similarity over token sets. Used only for the human-
   review queue at layer 5, not for auto-merge. */
export function tokenJaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

/* A weak "definitely same style" guard the harness may use when both
   listings reach layer 5: identical normalized color + brand required
   before ANY fuzzy pairing is even considered. */
export function sameAudibleIdentity(
  a: IdentityBundle,
  b: IdentityBundle
): boolean {
  if (foldToken(a.brand ?? "") !== foldToken(b.brand ?? "")) return false;
  const colorA = normalizeColorName(a.color) ?? "";
  const colorB = normalizeColorName(b.color) ?? "";
  if (colorA && colorB && colorA !== colorB) return false;
  if (!colorA && !colorB) return true; /* both colorless */
  return true;
}

/* Human-review-candidate producer for layer 5: returns same-brand,
   color-compatible candidate names ordered by similarity, together with
   the score. The harness ALWAYS flags these for review instead of
   merging them. */
export function similarCandidates(
  a: IdentityBundle,
  candidates: IdentityBundle[]
): Array<{ candidate: IdentityBundle; score: number }> {
  const tokensA = similarityTokens(a.name);
  const out: Array<{ candidate: IdentityBundle; score: number }> = [];
  for (const candidate of candidates) {
    if (!sameAudibleIdentity(a, candidate)) continue;
    const tokensB = similarityTokens(candidate.name);
    const score = tokenJaccard(tokensA, tokensB);
    if (score >= 0.6) {
      out.push({ candidate, score });
    }
  }
  return out.sort((x, y) => y.score - x.score);
}