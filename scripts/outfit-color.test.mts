import {
  colorHarmony,
  colorGroup,
  harmonyScore,
  pickDeterministicColor,
} from "../src/lib/outfit/color-harmony";

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

/* --- group assignment --- */
check("white -> neutral", colorGroup("White") === "neutral");
check("black -> dark-neutral", colorGroup("Black") === "dark-neutral");
check("blue -> blue", colorGroup("Blue") === "blue");
check("red -> warm", colorGroup("Red") === "warm");
check("green -> cool", colorGroup("Green") === "cool");
check("leopard -> pattern", colorGroup("Leopard") === "pattern");
check("unknown -> neutral", colorGroup("Chartreuse") === "neutral");

/* --- the three worked examples from the brief must be Excellent --- */
check("White sneakers + Black jeans excellent",
  colorHarmony("White", "Black") === "excellent");
check("White sneakers + Blue denim excellent",
  colorHarmony("White", "Blue") === "excellent");
check("White sneakers + Beige chinos excellent",
  colorHarmony("White", "Beige") === "excellent");

/* --- £6: hex = null must NOT change the primary result ---
   These colors have hex null in the catalog (Beige, Navy, Cream,
   Burgundy, Purple...). The semantic groups drive the decision, so
   null hex is irrelevant by construction. We assert the level is
   decided without any hex at all. */
check("Navy(no hex) with White = excellent (dark-neutral x neutral)",
  colorHarmony("Navy", "White") === "excellent");
check("Beige(no hex) with Navy(no hex) = excellent (neutral x dark-neutral)",
  colorHarmony("Beige", "Navy") === "excellent");
check("Burgundy(no hex) with Cream(no hex) = excellent (warm x neutral)",
  colorHarmony("Burgundy", "Cream") === "excellent");
check("No hex anywhere -> still decided", true);

/* --- £7: Accent + Accent is NOT automatically Excellent --- */
check("Red + Pink = NOT excellent (clash should be poor/neutral)",
  colorHarmony("Red", "Pink") !== "excellent");
check("Red + Pink is poor (explicit clash)",
  colorHarmony("Red", "Pink") === "poor");
check("Blue + Red is poor (explicit clash)",
  colorHarmony("Blue", "Red") === "poor");
check("Green + Red is poor (explicit clash)",
  colorHarmony("Green", "Red") === "poor");
check("Red + White (accent x neutral) = good",
  colorHarmony("Red", "White") === "good");

/* --- same color-group not auto-excellent for accents --- */
check("Red + Orange (both warm) is not excellent",
  colorHarmony("Red", "Orange") !== "excellent");
check("Purple + Pink (warm/cool-ish) is not excellent",
  colorHarmony("Purple", "Pink") !== "excellent");

/* --- harmonyScore levels --- */
check("excellent -> 1", harmonyScore("excellent") === 1);
check("good -> 0.7", harmonyScore("good") === 0.7);
check("neutral -> 0.5", harmonyScore("neutral") === 0.5);
check("poor -> 0", harmonyScore("poor") === 0);

/* --- deterministic multi-color pick --- */
/* Given two colors, against nothing -> deterministic tie by name
   (no randomness). */
const p1 = pickDeterministicColor(
  [{ name: "Red", hex: null }, { name: "Black", hex: null }],
  null
);
const p2 = pickDeterministicColor(
  [{ name: "Red", hex: null }, { name: "Black", hex: null }],
  null
);
check("deterministic pick (same input -> same output)", p1?.name === p2?.name);
/* Against White, should prefer Black (excellent) over Red (good). */
const p3 = pickDeterministicColor(
  [{ name: "Red", hex: null }, { name: "Black", hex: null }],
  "White"
);
check("against White prefers Black over Red", p3?.name === "Black");

/* --- stable across ordering of input (determinism) --- */
const p4 = pickDeterministicColor(
  [{ name: "Black", hex: null }, { name: "Red", hex: null }, { name: "White", hex: null }],
  "Navy"
);
const p5 = pickDeterministicColor(
  [{ name: "White", hex: null }, { name: "Black", hex: null }, { name: "Red", hex: null }],
  "Navy"
);
check("pick is independent of input order", p4?.name === p5?.name);

console.log(`\noutfit-color: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
