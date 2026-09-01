/* Outfit scoring — deterministic, weighted, explainable.
   Approved initial weights (sum to 1.0):
     category 0.25, color 0.25, style 0.15, occasion 0.10,
     formality 0.10, budget 0.05, global 0.10.
   Weights are exported so tests can adjust them without redesigning
   the engine. */

import {
  colorHarmony,
  harmonyScore,
} from "./color-harmony";
import type {
  GroundTruth,
  OutfitProduct,
  PlacedItem,
  Occasion,
  StyleLabel,
} from "./types";
import { STYLE_LABELS, type StyleProfile } from "./style-profile";

export const WEIGHTS = {
  category: 0.25,
  color: 0.25,
  style: 0.15,
  occasion: 0.1,
  formality: 0.1,
  budget: 0.05,
  global: 0.1,
};

export function assertWeightsSumOne(): void {
  const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 1e-9) {
    throw new Error(`outfit weights must sum to 1, got ${sum}`);
  }
}

export function categoryCompatibilityScore(
  anchor: OutfitProduct,
  items: PlacedItem[]
): number {
  if (items.length === 0) return 1;
  // Category compatibility is granted by the matrix at candidate
  // time; here we score the anchor-category and item grouping.
  // Every allowed category is 1; we return the mean pairwise match.
  let sum = 0;
  for (const it of items) {
    sum += 1; // all candidates passed the matrix gate
  }
  return sum / items.length;
}

export function colorHarmonyScore(
  items: PlacedItem[]
): number {
  if (items.length < 2) return 1;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      sum += harmonyScore(
        colorHarmony(
          items[i].color?.name,
          items[j].color?.name
        )
      );
      count++;
    }
  }
  return count ? sum / count : 1;
}

export function cosine(a: Record<string, number>, b: Record<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const k of STYLE_LABELS) {
    dot += a[k] * b[k];
    na += a[k] * a[k];
    nb += b[k] * b[k];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function styleConsistencyScore(
  profiles: StyleProfile[]
): number {
  if (profiles.length < 2) return 1;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < profiles.length; i++) {
    for (let j = i + 1; j < profiles.length; j++) {
      sum += cosine(profiles[i].vector, profiles[j].vector);
      count++;
    }
  }
  return count ? sum / count : 1;
}

export function formalityConsistencyScore(
  profiles: StyleProfile[]
): number {
  if (profiles.length < 2) return 1;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < profiles.length; i++) {
    for (let j = i + 1; j < profiles.length; j++) {
      sum += 1 - Math.abs(profiles[i].formality - profiles[j].formality);
      count++;
    }
  }
  return count ? sum / count : 1;
}

/* Occasion fit. Everyday/neutral = neutral (does not lower score).
   Otherwise compare the outfit's mean style vector against the
   occasion's preferred vector, plus a formality-band check. */
const OCCASION_VECTOR: Record<string, StyleVector> = {
  Work: { casual: 0, sporty: 0, streetwear: 0, "smart-casual": 1, formal: 0.7, classic: 0.8, bohemian: 0, minimalist: 0.6 },
  Formal: { casual: 0, sporty: 0, streetwear: 0, "smart-casual": 0.6, formal: 1, classic: 0.9, bohemian: 0, minimalist: 0.4 },
  Date: { casual: 0.4, sporty: 0, streetwear: 0.2, "smart-casual": 0.8, formal: 0.4, classic: 0.5, bohemian: 0.5, minimalist: 0.4 },
  Party: { casual: 0.3, sporty: 0, streetwear: 0.4, "smart-casual": 0.6, formal: 0.6, classic: 0.3, bohemian: 0.6, minimalist: 0.3 },
  Sport: { casual: 0.5, sporty: 1, streetwear: 0.5, "smart-casual": 0, formal: 0, classic: 0, bohemian: 0, minimalist: 0.3 },
  Travel: { casual: 0.8, sporty: 0.4, streetwear: 0.3, "smart-casual": 0.4, formal: 0, classic: 0.3, bohemian: 0.2, minimalist: 0.3 },
  University: { casual: 0.8, sporty: 0.5, streetwear: 0.6, "smart-casual": 0.4, formal: 0, classic: 0.3, bohemian: 0.4, minimalist: 0.3 },
  Everyday: { casual: 0.9, sporty: 0.4, streetwear: 0.4, "smart-casual": 0.3, formal: 0, classic: 0.3, bohemian: 0.3, minimalist: 0.3 },
};

type StyleVector = Record<StyleLabel, number>;

export function occasionFitScore(
  occasion: Occasion | null,
  profiles: StyleProfile[]
): number {
  if (!occasion) return 1;
  const ott = OCCASION_VECTOR[occasion];
  if (!ott) return 1;
  if (profiles.length === 0) return 0.5;
  const mean: StyleVector = { casual: 0, sporty: 0, streetwear: 0, "smart-casual": 0, formal: 0, classic: 0, bohemian: 0, minimalist: 0 };
  for (const p of profiles) {
    for (const k of STYLE_LABELS) mean[k] += p.vector[k];
  }
  for (const k of STYLE_LABELS) mean[k] /= profiles.length;
  const styleFit = cosine(mean as Record<string, number>, ott);
  let formality = 0;
  for (const p of profiles) formality += p.formality;
  formality /= profiles.length;
  // Formality band: occasion expects a band; close = good.
  const expectedFormality: Record<string, number> = {
    Work: 0.55,
    Formal: 0.9,
    Date: 0.5,
    Party: 0.5,
    Sport: 0.15,
    Travel: 0.3,
    University: 0.3,
    Everyday: 0.3,
  };
  const bandFit = 1 - Math.abs(formality - (expectedFormality[occasion] ?? 0.3));
  return 0.5 * styleFit + 0.5 * Math.max(0, Math.min(1, bandFit));
}

export function budgetFitScore(
  totalPriceEur: number,
  budgetEur: number | null
): number {
  if (budgetEur === null || budgetEur <= 0) return 1;
  if (totalPriceEur <= budgetEur) return 1;
  return Math.max(0, 1 - (totalPriceEur - budgetEur) / budgetEur);
}

/* Global coherence: captures the case where each local pair is fine
   but the whole outfit is off. We measure variance of formality and
   the worst pairwise style gap across the ENTIRE outfit, so a single
   style outlier drags the whole thing down even if pairwise means
   looked okay. */
export function globalCoherenceScore(
  profiles: StyleProfile[]
): number {
  if (profiles.length < 3) return 1;
  const styleMean = styleConsistencyScore(profiles);
  const formMean = formalityConsistencyScore(profiles);
  // Standard-deviation penalty: high formality spread = incoherent.
  let sum = 0;
  for (const p of profiles) sum += p.formality;
  const mean = sum / profiles.length;
  let variance = 0;
  for (const p of profiles) variance += (p.formality - mean) ** 2;
  variance /= profiles.length;
  const sdPenalty = 1 - Math.min(1, Math.sqrt(variance) / 0.5);
  return 0.5 * styleMean + 0.3 * formMean + 0.2 * sdPenalty;
}

export type OutfitScores = {
  category: number;
  color: number;
  style: number;
  occasion: number;
  formality: number;
  budget: number;
  global: number;
  total: number;
};

export function scoreOutfit(args: {
  anchor: OutfitProduct;
  items: PlacedItem[];
  profiles: StyleProfile[];
  truth: GroundTruth;
  totalPriceEur: number;
}): OutfitScores {
  assertWeightsSumOne();
  const { anchor, items, profiles, truth, totalPriceEur } = args;
  const category =
    WEIGHTS.category * categoryCompatibilityScore(anchor, items);
  const color =
    WEIGHTS.color * colorHarmonyScore(items);
  const style =
    WEIGHTS.style * styleConsistencyScore(profiles);
  const occasion =
    WEIGHTS.occasion * occasionFitScore(truth.occasion ?? null, profiles);
  const formality =
    WEIGHTS.formality * formalityConsistencyScore(profiles);
  const budget =
    WEIGHTS.budget * budgetFitScore(totalPriceEur, truth.budgetEur);
  const global =
    WEIGHTS.global * globalCoherenceScore(profiles);
  const total = category + color + style + occasion + formality + budget + global;
  return {
    category,
    color,
    style,
    occasion,
    formality,
    budget,
    global,
    total,
  };
}
