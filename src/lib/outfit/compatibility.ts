/* Compatibility scoring — pure functions, no module state.
   Scores a candidate against a partially-filled outfit for a given
   slot. Category is the matrix gate; color/style/formality are the
   discriminating terms. All deterministic. */

import {
  colorHarmony,
  harmonyScore,
  pickDeterministicColor,
} from "./color-harmony";
import { cosine } from "./scoring";
import { STYLE_LABELS } from "./style-profile";
import type {
  ColorInfo,
  HarmonyLevel,
  OutfitProduct,
  PlacedItem,
  SlotName,
  StyleProfile,
} from "./types";
import { preferenceFor } from "./category-rules";

export type CandidateReasons = {
  categoryOk: boolean;
  color: HarmonyLevel;
  colorScore: number;
  styleScore: number;
  formalityScore: number;
};

export function resolveCandidateColor(
  product: OutfitProduct,
  againstColor: string | null
): ColorInfo | null {
  const avail: ColorInfo[] = product.variants
    .filter((v) => v.availability === "AVAILABLE" && v.color?.name)
    .map((v) => ({ name: v.color!.name, hex: v.color!.hex ?? null }));
  return pickDeterministicColor(avail, againstColor);
}

export function scoreCandidate(args: {
  candidate: OutfitProduct;
  candidateProfile: StyleProfile;
  slot: SlotName;
  anchorSlug: string;
  placed: PlacedItem[];
  placedProfiles: StyleProfile[];
  anchorProfile: StyleProfile | null;
  anchorColor: string | null;
}): { score: number; reasons: CandidateReasons } {
  const {
    candidate,
    candidateProfile,
    slot,
    anchorSlug,
    placed,
    placedProfiles,
    anchorProfile,
    anchorColor,
  } = args;

  const catSlug = candidate.category?.slug?.toLowerCase() ?? "";
  const categoryOk = preferenceFor(anchorSlug, slot, catSlug) < 99;

  const against =
    placed.length > 0
      ? placed[placed.length - 1].color?.name ?? null
      : anchorColor;

  const color = resolveCandidateColor(candidate, against);
  const colorLevel = colorHarmony(color?.name ?? null, against);
  const colorScore = harmonyScore(colorLevel);

  // Style: cosine vs the accumulation of anchor + placed profiles.
  const anchorVec = anchorProfile?.vector ?? { casual: 0, sporty: 0, streetwear: 0, "smart-casual": 0, formal: 0, classic: 0, bohemian: 0, minimalist: 0 };
  const candVec = candidateProfile.vector;
  const contextVec = meanVectors([anchorVec, ...placedProfiles.map((p) => p.vector)]);
  const styleScore = cosine(candVec, contextVec);

  // Formality gap vs anchor + placed mean formality.
  const anchorFormality = anchorProfile?.formality ?? 0;
  let sumF = anchorFormality;
  let n = anchorProfile ? 1 : 0;
  for (const p of placedProfiles) {
    sumF += p.formality;
    n++;
  }
  const meanFormality = n ? sumF / n : 0;
  const formalityScore = 1 - Math.min(1, Math.abs(candidateProfile.formality - meanFormality));

  const score =
    (categoryOk ? 0.4 : 0) +
    colorScore * 0.35 +
    styleScore * 0.15 +
    formalityScore * 0.1;

  return {
    score,
    reasons: {
      categoryOk,
      color: colorLevel,
      colorScore,
      styleScore,
      formalityScore,
    },
  };
}

function meanVectors(
  vecs: Record<string, number>[]
): Record<string, number> {
  const mean: Record<string, number> = {};
  for (const k of STYLE_LABELS) mean[k] = 0;
  if (vecs.length === 0) return mean;
  for (const v of vecs) {
    for (const k of STYLE_LABELS) mean[k] += v[k] ?? 0;
  }
  for (const k of STYLE_LABELS) mean[k] /= vecs.length;
  return mean;
}
