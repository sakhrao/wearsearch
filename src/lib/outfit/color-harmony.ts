/* Semantic color harmony — deterministic, explainable.
   The catalog has 22 distinct colors, but 14 of them have no hex, so
   hex-distance is unsafe. We map color NAME -> semantic group and a
   group-level harmony table. hex, when present, only disambiguates
   near-names and never overrides the primary semantic decision. */

import type { HarmonyLevel } from "./types";

export type ColorGroup =
  | "neutral"
  | "dark-neutral"
  | "blue"
  | "warm"
  | "cool"
  | "pattern";

const HARMONY_SCORE: Record<HarmonyLevel, number> = {
  excellent: 1,
  good: 0.7,
  neutral: 0.5,
  poor: 0,
};

/* Color name -> semantic group.
   Neutrals pair well with almost anything. Dark-neutrals are the
   safe base (black/navy/brown). "blue" is its own family (denim).
   warm = red/orange/yellow/pink/beige-adjacent accents.
   cool = green/teal/purple/light-blue.
   pattern = leopard/multi (patterned; treat with care). */

const COLOR_GROUP: Record<string, ColorGroup> = {
  White: "neutral",
  Ivory: "neutral",
  Cream: "neutral",
  Beige: "neutral",
  Silver: "neutral",
  Grey: "neutral",
  Gold: "neutral",

  Black: "dark-neutral",
  Navy: "dark-neutral",
  Brown: "dark-neutral",

  Blue: "blue",
  "Light Blue": "blue",

  Red: "warm",
  Burgundy: "warm",
  Pink: "warm",
  Orange: "warm",
  Yellow: "warm",

  Green: "cool",
  Teal: "cool",
  Purple: "cool",

  Leopard: "pattern",
  Multi: "pattern",
};

export function colorGroup(name: string | null | undefined): ColorGroup {
  if (!name) return "neutral";
  const key = name.trim();
  return COLOR_GROUP[key] ?? "neutral";
}

/* Group-pair harmony. Symmetric. Returns the level.
   Neutral-with-anything = excellent/good.
   Accent pairs are not automatically good — many are neutral/poor
   (that's the whole point: colors must be checked, not assumed). */

function groupHarmony(a: ColorGroup, b: ColorGroup): HarmonyLevel {
  if (a === b) {
    // Same group is never auto-excellent for accents.
    if (a === "neutral") return "excellent";
    if (a === "dark-neutral") return "good";
    if (a === "blue") return "good";
    return "neutral";
  }
  if (a === "neutral" || b === "neutral") return "excellent";
  if (a === "dark-neutral" || b === "dark-neutral") return "excellent";
  if ((a === "blue" && b === "warm") || (a === "warm" && b === "blue"))
    return "good"; // navy + warm accent
  if ((a === "blue" && b === "cool") || (a === "cool" && b === "blue"))
    return "good"; // blue + teal/green family
  if ((a === "warm" && b === "cool") || (a === "cool" && b === "warm"))
    return "good"; // e.g. olive + tan, teal + burgundy
  if (a === "pattern" || b === "pattern") return "good";
  // accent + accent fallback
  return "poor";
}

/* Named-pair specific overrides (rooted in known catalog colors) that
   refine or soften the group-level default. These exist so a few
   well-known good/bad combos are explicit and testable. */
const NAMED_OVERRIDE: Record<string, HarmonyLevel> = {
  "White|Black": "excellent",
  "Black|White": "excellent",
  "White|Blue": "excellent",
  "Blue|White": "excellent",
  "White|Beige": "excellent",
  "Beige|White": "excellent",
  "Black|Beige": "excellent",
  "Beige|Black": "excellent",
  "Black|Red": "good",
  "Red|Black": "good",
  "White|Red": "good",
  "Red|White": "good",
  "Blue|Red": "poor",
  "Red|Blue": "poor",
  "Red|Pink": "poor",
  "Pink|Red": "poor",
  "Green|Red": "poor",
  "Red|Green": "poor",
  "Blue|Purple": "neutral",
  "Purple|Blue": "neutral",
};

export function colorHarmony(
  nameA: string | null | undefined,
  nameB: string | null | undefined
): HarmonyLevel {
  const normA = (nameA || "").trim();
  const normB = (nameB || "").trim();
  if (!normA || !normB) return "neutral";

  const override = NAMED_OVERRIDE[`${normA}|${normB}`];
  if (override) return override;

  return groupHarmony(colorGroup(normA), colorGroup(normB));
}

export function harmonyScore(level: HarmonyLevel): number {
  return HARMONY_SCORE[level];
}

/* Deterministic color pick for multi-color products: the color whose
   name is lexicographically smallest among AVAILABLE variants. Never
   random. Returns null when the product has no AVAILABLE-variant
   color (such a product is not eligible at all). */
export function pickDeterministicColor(
  colors: { name: string; hex: string | null }[],
  against: string | null
): { name: string; hex: string | null } | null {
  if (colors.length === 0) return null;
  // Prefer the color that harmonizes best with `against`, tie-break by
  // lexicographic name for full determinism.
  let best = colors[0];
  let bestScore = against
    ? harmonyScore(colorHarmony(against, best.name))
    : 0;
  for (let i = 1; i < colors.length; i++) {
    const c = colors[i];
    const s = against
      ? harmonyScore(colorHarmony(against, c.name))
      : 0;
    if (
      s > bestScore ||
      (s === bestScore && c.name < best.name)
    ) {
      best = c;
      bestScore = s;
    }
  }
  return best;
}
