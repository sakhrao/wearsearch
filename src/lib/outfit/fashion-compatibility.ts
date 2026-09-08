/* FashionCompatibility — a fresh, honest fashion-scoring engine for a
   FIXED look (the review page), independent of the outfit engine's
   contextFitScore.

   Input: generic GarmentVisuals (canonical product data projected by the
   garment layer) + optional real context (occasion/season), never a
   product source. It produces:
     - a verdict (hard-invalid / soft-mismatch / valid / strong);
     - a weighted 0..1 score with an explainable factor breakdown.

   If a factor contributes nothing (e.g. no pattern info), its weight is
   redistributed to the factors that DO apply — the score stays honest
   for every input size.

   Color rules come from the shared semantic harmony table (color-harmony):
   neutral-with-anything = excellent, accent pairs are checked, NEVER
   "same color = good". */

import {
  colorGroup,
  colorHarmony,
  harmonyScore,
  type ColorGroup,
} from "./color-harmony";
import type { GarmentVisual, GarmentType } from "./garment";

export type FashionVerdict = "hard-invalid" | "soft-mismatch" | "valid" | "strong";

export type FashionFactorKey =
  | "color" | "palette" | "pattern" | "silhouette" | "layering" | "context";

export type FashionFactor = {
  key: FashionFactorKey;
  score: number;   /* 0..1 */
  weight: number;  /* contribution to the total (sums <= 1) */
  label: string;
  detail: string;
};

export type FashionContext = {
  occasion?: string | null;
  season?: string | null;
};

export type FashionCompatibilityResult = {
  verdict: FashionVerdict;
  score: number;           /* 0..1 */
  factors: FashionFactor[];
  highlights: string[];
  issues: string[];
};

/* ---- body-coverage classes (drives hard-invalid rules) ---- */

const BODY_TOPS = new Set<GarmentType>([
  "tee", "polo", "shirt", "blouse", "solid-torso",
]);
const ONE_PIECES = new Set<GarmentType>(["dress", "jumpsuit"]);
const BOTTOMS = new Set<GarmentType>([
  "jeans", "trousers", "shorts", "skirt", "leggings", "solid-legs",
]);
const FOOTWEAR = new Set<GarmentType>([
  "sneakers", "running-shoes", "boots", "sandals", "heels",
  "flats", "loafers", "formal-shoes", "solid-shoes",
]);
const OUTERS = new Set<GarmentType>([
  "coat", "jacket", "blazer", "hoodie", "sweatshirt", "vest", "knit",
]);

function coverageOf(v: GarmentVisual): string {
  if (ONE_PIECES.has(v.type)) return "one-piece";
  if (BODY_TOPS.has(v.type)) return "body-top";
  if (BOTTOMS.has(v.type)) return "bottom";
  if (FOOTWEAR.has(v.type)) return "footwear";
  if (v.slot === "top" || v.slot === "layer") return "layer";
  return "accessory";
}

/* ---- factor: color (pairwise harmony among the worn pieces) ---- */

export function colorPairFactor(garments: GarmentVisual[]): number {
  const colored = garments.filter((g) => g.color?.name);
  if (colored.length < 2) return 0.85; /* single color: clean, not bonus */
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < colored.length; i++) {
    for (let j = i + 1; j < colored.length; j++) {
      sum += harmonyScore(colorHarmony(colored[i].color!.name, colored[j].color!.name));
      pairs++;
    }
  }
  return pairs ? sum / pairs : 0.85;
}

/* ---- factor: palette footprint (how many distinct color families) ---- */

export function paletteFactor(garments: GarmentVisual[]): number {
  const clothing = garments.filter((g) => {
    const c = coverageOf(g);
    return c === "body-top" || c === "bottom" || c === "one-piece" || c === "layer";
  });
  const groups = new Set<ColorGroup>();
  for (const g of clothing) {
    if (!g.color?.name) continue;
    const grp = colorGroup(g.color.name);
    if (grp !== "neutral" && grp !== "pattern") groups.add(grp);
  }
  /* neutrals are free; 1-2 accent families = best, 4+ = cluttered */
  if (groups.size <= 2) return 1;
  if (groups.size === 3) return 0.7;
  if (groups.size === 4) return 0.42;
  return 0.2;
}

/* ---- factor: pattern discipline (overload penalty) ---- */

export function patternFactor(garments: GarmentVisual[]): number {
  const patterned = garments.filter(
    (g) => g.pattern !== "solid" && coverageOf(g) !== "accessory"
  );
  if (patterned.length === 0) return 1;
  if (patterned.length === 1) return 0.88; /* a single patterned piece is fine */
  /* two or more patterned garments on the body = overload */
  return 0.2;
}

/* ---- factor: silhouette volume balance (weighted, not absolute) ---- */

function volumeTop(type: GarmentType, fit: GarmentVisual["fit"]): number {
  const loose = fit === "oversized" || fit === "relaxed" ? 1 : 0;
  if (type === "coat") return 2 + loose;
  if (type === "jacket" || type === "blazer" || type === "hoodie" ||
      type === "sweatshirt" || type === "vest" || type === "knit") {
    return 1 + loose;
  }
  if (type === "dress" || type === "jumpsuit") return 1 + loose;
  return 0 + loose;
}

function volumeBottom(type: GarmentType, fit: GarmentVisual["fit"]): number {
  if (type === "leggings") return -2;
  if (type === "skirt") return fit === "slim" || fit === "fitted" ? -1 : 1;
  if (type === "jeans" || type === "trousers") {
    if (fit === "oversized") return 2;
    if (fit === "relaxed") return 1;
    if (fit === "slim" || fit === "fitted") return -1;
  }
  return 0;
}

export function silhouetteFactor(garments: GarmentVisual[]): number {
  let topVol = 0;
  let bottomVol = 0;
  let saw = false;
  for (const g of garments) {
    const c = coverageOf(g);
    if (c === "body-top" || c === "layer") { topVol = Math.max(topVol, volumeTop(g.type, g.fit)); saw = true; }
    if (c === "bottom") bottomVol = volumeBottom(g.type, g.fit);
    if (c === "one-piece") { topVol = Math.max(topVol, volumeTop(g.type, g.fit)); saw = true; }
  }
  if (!saw) return 1;
  if (topVol >= 2 && bottomVol >= 1) return 0.4;   /* slab: big + big */
  if (topVol <= 0 && bottomVol <= -2) return 0.5;  /* stringy: tight + tight */
  if ((topVol >= 2 && bottomVol <= -1) || (topVol <= 0 && bottomVol >= 1)) {
    return 1; /* balanced opposite volumes */
  }
  return 0.78;
}

/* ---- factor: layered-outer sensibility ---- */

export function layeringFactor(garments: GarmentVisual[]): number {
  const outers = garments
    .filter((g) => OUTERS.has(g.type))
    .map((g) => g.type)
    .sort();
  if (outers.length <= 1) return 1;
  const has = (t: GarmentType) => outers.includes(t);
  const structured = outers.filter(
    (t) => t === "coat" || t === "jacket" || t === "blazer"
  ).length;
  if (structured >= 2) {
    /* two structured outers fight each other */
    if (has("coat") && has("blazer")) return 0.55;
    if (has("coat") && has("jacket")) return 0.65;
    return 0.72;
  }
  if (has("coat") && outers.some((t) => t === "hoodie" || t === "sweatshirt")) {
    return 0.85; /* comfortable, slightly heavy */
  }
  return 0.95;
}

/* ---- factor: context (occasion/season) — ONLY when real data exists ---- */

const FORMAL_OUTER = new Set<GarmentType>(["coat", "blazer"]);
const FORMAL_BOTTOM = new Set<GarmentType>(["trousers", "skirt"]);

export function contextFactor(
  garments: GarmentVisual[],
  ctx: FashionContext | null | undefined
): number {
  if (!ctx) return 1;
  const occasion = (ctx.occasion ?? "").toLowerCase().trim();
  const season = (ctx.season ?? "").toLowerCase().trim();
  let score = 1;

  if (occasion.includes("formal") || occasion.includes("wedding") ||
      occasion.includes("event")) {
    const hasFormal = garments.some(
      (g) => FORMAL_OUTER.has(g.type) || g.type === "dress" ||
        FORMAL_BOTTOM.has(g.type) || g.type === "heels" || g.type === "formal-shoes"
    );
    const hasCasual = garments.some(
      (g) => g.type === "sneakers" || g.type === "hoodie" ||
        g.type === "sweatshirt" || g.type === "leggings"
    );
    if (!hasFormal) score = Math.min(score, 0.45);
    if (hasCasual && !hasFormal) score = Math.min(score, 0.3);
  }

  if (season.includes("winter") || season.includes("cold")) {
    const warm = garments.some(
      (g) => g.type === "coat" || g.type === "jacket" || g.type === "boots" ||
        g.type === "knit" || g.type === "hoodie"
    );
    const cold = garments.some((g) => g.type === "sandals" || g.type === "flats");
    if (!warm) score = Math.min(score, 0.45);
    if (cold) score = Math.min(score, 0.5);
  }

  if (season.includes("summer") || season.includes("warm") || season.includes("hot")) {
    const cool = garments.some(
      (g) => g.type === "sandals" || g.type === "shorts" || g.type === "tee"
    );
    const heavy = garments.some(
      (g) => g.type === "coat" || g.type === "boots" || g.type === "knit"
    );
    if (heavy && !cool) score = Math.min(score, 0.5);
  }

  return score;
}

/* ---- verdict ---- */

export function verdictFor(score: number, hardInvalid: string[]): FashionVerdict {
  if (hardInvalid.length > 0) return "hard-invalid";
  if (score >= 0.72) return "strong";
  if (score >= 0.5) return "valid";
  return "soft-mismatch";
}

/* ---- top-level engine ---- */

const FACTOR_META: Record<FashionFactorKey, { label: string; weight: number }> = {
  color: { label: "Color harmony", weight: 0.3 },
  palette: { label: "Palette footprint", weight: 0.15 },
  pattern: { label: "Pattern discipline", weight: 0.15 },
  silhouette: { label: "Silhouette balance", weight: 0.2 },
  layering: { label: "Layering", weight: 0.1 },
  context: { label: "Occasion / season", weight: 0.1 },
};
export function fashionCompatibility(
  garments: GarmentVisual[],
  context?: FashionContext | null
): FashionCompatibilityResult {
  const hardInvalid: string[] = [];
  const issues: string[] = [];
  const highlights: string[] = [];

  /* coverage-based hard-invalid rules */
  const counts: Record<string, number> = {};
  for (const g of garments) {
    const c = coverageOf(g);
    counts[c] = (counts[c] ?? 0) + 1;
  }

  if ((counts["body-top"] ?? 0) >= 2 || (counts["one-piece"] ?? 0) >= 2) {
    hardInvalid.push("Two pieces trying to cover the same torso — pick one.");
  }
  if ((counts["bottom"] ?? 0) >= 2) {
    hardInvalid.push("Two bottom pieces at once — pick one.");
  }
  if ((counts["footwear"] ?? 0) >= 2) {
    hardInvalid.push("Two pairs of shoes — pick one.");
  }
  if ((counts["one-piece"] ?? 0) === 1 && (counts["body-top"] ?? 0) >= 1) {
    hardInvalid.push("A dress/jumpsuit is already a full top — remove the tee/shirt.");
  }
  if ((counts["one-piece"] ?? 0) === 1 && (counts["bottom"] ?? 0) === 1) {
    hardInvalid.push("A dress/jumpsuit covers the bottom too — drop the trousers/jeans.");
  }
  /* two structured outer layers fight each other and read as clutter */
  const structuredOuters = garments.filter(
    (g) => g.type === "coat" || g.type === "jacket" || g.type === "blazer"
  ).length;
  if (structuredOuters >= 2) {
    hardInvalid.push("More than one structured outer layer (coat / jacket / blazer) — pick one.");
  }
  issues.push(...hardInvalid);

  /* per-factor scores */
  const factors: FashionFactor[] = [];
  const forceApplicable = (key: FashionFactorKey): boolean => {
    switch (key) {
      case "context": return Boolean(context?.occasion || context?.season);
      case "pattern": return garments.some((g) => g.pattern !== "solid");
      default: return garments.length > 0;
    }
  };

  const raw: Record<FashionFactorKey, number> = {
    color: colorPairFactor(garments),
    palette: paletteFactor(garments),
    pattern: patternFactor(garments),
    silhouette: silhouetteFactor(garments),
    layering: layeringFactor(garments),
    context: contextFactor(garments, context),
  };

  const applicable = (Object.keys(FACTOR_META) as FashionFactorKey[]).filter(
    (k) => forceApplicable(k)
  );
  const metaSum = applicable.reduce((s, k) => s + FACTOR_META[k].weight, 0);
  const normalize = (w: number) => (metaSum > 0 ? w / metaSum : 0);

  let score = 0;
  for (const key of applicable) {
    const w = normalize(FACTOR_META[key].weight);
    let detail = "—";
    if (key === "color") {
      detail = raw.color >= 0.8
        ? "Pieces sit in the same color family or pair with neutrals."
        : raw.color >= 0.5
          ? "Most colors work together."
          : "Some accent colors fight each other.";
    } else if (key === "palette") {
      detail = raw.palette >= 0.9
        ? "Tight, focused palette."
        : raw.palette >= 0.6
          ? "A couple of color families — still coherent."
          : "Too many color families at once.";
    } else if (key === "pattern") {
      detail = raw.pattern >= 0.8
        ? "At most one patterned piece."
        : "Multiple patterned pieces — pattern overload.";
    } else if (key === "silhouette") {
      detail = raw.silhouette >= 0.9
        ? "Balanced volumes: a loose piece is grounded by a fitted one."
        : raw.silhouette >= 0.7
          ? "Volumes are reasonably balanced."
          : "Both halves lean the same extreme way.";
    } else if (key === "layering") {
      detail = raw.layering >= 0.9
        ? "Layers work comfortably."
        : "The outer layers conflict (structured-over-structured).";
    } else if (key === "context") {
      detail = "Checked against the stated occasion/season.";
    }
    score += raw[key] * w;
    if (raw[key] >= 0.85 && key !== "context") {
      highlights.push(`${FACTOR_META[key].label}: good.`);
    }
    if (raw[key] <= 0.45) {
      issues.push(`${FACTOR_META[key].label}: ${detail}.`);
    }
    factors.push({
      key,
      score: Math.round(raw[key] * 100) / 100,
      weight: Math.round(w * 100) / 100,
      label: FACTOR_META[key].label,
      detail,
    });
  }

  score = Math.round(score * 100) / 100;
  const verdict = verdictFor(score, hardInvalid);

  if (verdict === "strong") highlights.unshift("A genuinely strong look.");
  if (verdict === "valid") highlights.unshift("A solid, wearable look.");
  if (highlights.length === 0 && verdict !== "hard-invalid") {
    highlights.push("Adjust one or two factors to lift the score.");
  }

  return { verdict, score, factors, highlights, issues };
}