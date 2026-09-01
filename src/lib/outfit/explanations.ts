/* Deterministic explanations — derived directly from the scoring
   terms, never AI. Each returned line carries an internal reason
   code + numeric value so weak acceptance is never overstated. */

import { harmonyScore } from "./color-harmony";
import type {
  ExplanationLine,
  HarmonyLevel,
  OutfitProduct,
  SlotName,
} from "./types";

export function explainSlotItem(args: {
  slot: SlotName;
  product: OutfitProduct;
  colorName: string | null;
  colorLevel: HarmonyLevel;
  anchorColorName: string | null;
  anchorName: string;
  styleScore: number;
  formalityScore: number;
  occasionText: string | null;
  budgetOk: boolean;
}): ExplanationLine[] {
  const lines: ExplanationLine[] = [];
  const { slot, product, colorName, colorLevel, anchorColorName, anchorName, styleScore, formalityScore, occasionText, budgetOk } = args;

  // Category line (always for a successfully placed required slot).
  lines.push({
    text: `Pairs with the ${anchorName}`,
    code: "category",
    value: 1,
  });

  // Color line — only when it actually helps; otherwise say neutral.
  const cs = harmonyScore(colorLevel);
  if (cs >= 0.7) {
    lines.push({
      text: colorName
        ? `Complementary ${colorName.toLowerCase()} tones`
        : "Neutral tones",
      code: "color-hi",
      value: cs,
    });
  } else if (cs > 0.3) {
    lines.push({
      text: "Neutral color pairing",
      code: "color-neutral",
      value: cs,
    });
  } else {
    lines.push({
      text: "Bold color contrast",
      code: "color-poor",
      value: cs,
    });
  }

  if (styleScore >= 0.6) {
    lines.push({
      text: "Fits the shared style",
      code: "style-hi",
      value: styleScore,
    });
  } else if (styleScore >= 0.4) {
    lines.push({
      text: "Roughly matches the style",
      code: "style-mid",
      value: styleScore,
    });
  }

  if (formalityScore >= 0.7) {
    lines.push({
      text: "Matches the overall formality",
      code: "formality",
      value: formalityScore,
    });
  }

  if (occasionText) {
    lines.push({
      text: `Works with the ${occasionText.toLowerCase()} setting`,
      code: "occasion",
      value: 1,
    });
  }

  if (budgetOk) {
    lines.push({
      text: "Keeps the outfit within budget",
      code: "budget",
      value: 1,
    });
  }

  return lines;
}

/* Outfit-level explanation: a short summary of the strongest and
   weakest term, honest about what the score shows. */
export function explainOutfitLines(
  scores: {
    category: number;
    color: number;
    style: number;
    occasion: number;
    formality: number;
    global: number;
  }
): ExplanationLine[] {
  const lines: ExplanationLine[] = [];
  const entries: Array<[string, number]> = [
    ["category", scores.category],
    ["color", scores.color],
    ["style", scores.style],
    ["formality", scores.formality],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  const [bestTerm, bestVal] = entries[0];
  const [worstTerm, worstVal] = entries[entries.length - 1];

  lines.push({
    text: `Strong on ${bestTerm} (${Math.round(bestVal * 100)}%)`,
    code: `best-${bestTerm}`,
    value: bestVal,
  });
  if (worstVal < 0.5) {
    lines.push({
      text: `Weakest area is ${worstTerm} (${Math.round(worstVal * 100)}%)`,
      code: `weak-${worstTerm}`,
      value: worstVal,
    });
  }
  return lines;
}
