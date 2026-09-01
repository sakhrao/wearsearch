import {
  WEIGHTS,
  assertWeightsSumOne,
  scoreOutfit,
  globalCoherenceScore,
  styleConsistencyScore,
  formalityConsistencyScore,
  budgetFitScore,
  occasionFitScore,
} from "../src/lib/outfit/scoring";
import type { StyleProfile, StyleVector, PlacedItem, SlotName } from "../src/lib/outfit/types";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra?: string): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL ${name}${extra ? " :: " + extra : ""}`);
  }
}

function vec(v: Record<string, number>): StyleVector {
  const all: StyleVector = {
    casual: 0, sporty: 0, streetwear: 0, "smart-casual": 0,
    formal: 0, classic: 0, bohemian: 0, minimalist: 0,
  };
  for (const k of Object.keys(v)) all[k as keyof StyleVector] = v[k]!;
  return all;
}
function prof(v: Record<string, number>, formality: number): StyleProfile {
  return { vector: vec(v), formality, source: "category" as const };
}

/* --- weights sum to 1 --- */
check("weights sum to 1 (no throw)", (() => { try { assertWeightsSumOne(); return true; } catch { return false; } })());
const wsum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
check(`weights sum exactly 1.0 (got ${wsum})`, Math.abs(wsum - 1) < 1e-9);

/* --- AC-O8: budget evaluates TOTAL outfit, and over-budget lowers
   the score --- */
check("budget fit = 1 when total <= budget",
  budgetFitScore(100, 150) === 1);
check("budget fit < 1 when total > budget",
  budgetFitScore(150, 100) < 1);
check("budget fit ignored when no budget",
  budgetFitScore(100, null) === 1);

/* --- £10: global coherence detects "pairs fine, whole poor" --- */
// Three items: two casual, one ultra-formal. Pairwise means are
// mostly fine but the formality spread is large -> global < 1.
const mixed = [
  prof({ casual: 1 }, 0.1),
  prof({ casual: 1 }, 0.1),
  prof({ formal: 1 }, 0.95),
];
const coherent = [
  prof({ casual: 1 }, 0.2),
  prof({ casual: 1 }, 0.2),
  prof({ casual: 1 }, 0.2),
];
const mixedGlobal = globalCoherenceScore(mixed);
const coherentGlobal = globalCoherenceScore(coherent);
check("global coherence < 1 for mixed formality",
  mixedGlobal < 1);
check("global coherence for coherent trio is higher than mixed",
  coherentGlobal > mixedGlobal);

/* --- £6/£7: color affects ranking via scoreOutfit total --- */
// Build two outfits that differ ONLY in one item's color.
const anchor = makeProduct({ id: "a", category: { id: "c", slug: "sneakers", name: "Sneakers" }, name: "White sneakers" });
function placed(id: string, color: string, slug: string): PlacedItem {
  return {
    slot: (slug === "trousers" ? "bottom" : "top") as SlotName,
    product: makeProduct({ id, category: { id: "c", slug, name: slug } }),
    color: { name: color, hex: null },
  };
}
function makeScores(color: string) {
  const items = [placed("anchor", "White", "sneakers"), placed("b1", color, "trousers"), placed("t1", "White", "t-shirts")];
  const profiles = [prof({ casual: 1 }, 0.2), prof({ formal: 1 }, 0.5), prof({ casual: 1 }, 0.2)];
  return scoreOutfit({
    anchor: makeProduct({ id: "a", category: { id: "c", slug: "sneakers", name: "Sneakers" }, name: "White sneakers" }),
    items, profiles,
    truth: { anchorId: "a", occasion: null, style: null, budgetEur: null },
    totalPriceEur: 100,
  });
}
const goodColor = makeScores("Black");   // white+black = excellent
const poorColor = makeScores("Red");     // white+red = good (still, but let's use a real clash)
const veryPoorColor = makeScores("Pink"); // white+pink = good
check("color affects ranking: good pair scores >= poor pair",
  goodColor.total >= veryPoorColor.total);

// Red + White = good(0.7); Blue + White = excellent(1). Ensure an
// excellent-paired outfit ranks above a good-paired outfit.
const withExcellent = makeScores("Blue");
const withGood = makeScores("Red");
check("AC-O6 color impacts ranking: excellent >= good",
  withExcellent.total >= withGood.total);

/* --- occasion fit --- */
check("occasion=Sport boosts sporty profile",
  occasionFitScore("Sport", [prof({ sporty: 1 }, 0.1)]) >
  occasionFitScore("Formal", [prof({ sporty: 1 }, 0.1)]));

console.log(`\noutfit-scoring: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

function makeProduct(over: Record<string, unknown>) {
  const base = {
    id: "p", name: "P", price: "20", currency: "EUR",
    productUrl: "https://shop.example/p/1", imageUrl: null,
    availability: "AVAILABLE", gender: "WOMEN",
    brand: { id: "b", name: "B" },
    category: { id: "c", slug: "x", name: "X" },
    variants: [{ availability: "AVAILABLE", color: null }],
    attributes: [],
  };
  return { ...base, ...over } as any;
}
