/* Derived style profile — deterministic, explainable.
   Classification priority (strongest -> weakest):
     Style attribute > category > other attributes (hint) > title/desc.
   Never written to the DB; always derived in-memory and tagged with
   its source. No AI/LLM. */

import type {
  OutfitProduct,
  StyleLabel,
  StyleProfile,
  StyleSource,
  StyleVector,
} from "./types";

export type { StyleProfile } from "./types";

export const STYLE_LABELS: StyleLabel[] = [
  "casual",
  "sporty",
  "streetwear",
  "smart-casual",
  "formal",
  "classic",
  "bohemian",
  "minimalist",
];

function emptyVector(): StyleVector {
  return {
    casual: 0,
    sporty: 0,
    streetwear: 0,
    "smart-casual": 0,
    formal: 0,
    classic: 0,
    bohemian: 0,
    minimalist: 0,
  };
}

/* Style attribute (source-backed) -> base vector. */
const STYLE_ATTR_VECTOR: Record<string, StyleVector> = {
  Casual: { ...emptyVector(), casual: 1 },
  Sport: { ...emptyVector(), sporty: 1, casual: 0.6 },
  Bohemian: { ...emptyVector(), bohemian: 1, casual: 0.4 },
  Utility: { ...emptyVector(), streetwear: 0.6, casual: 0.6, sporty: 0.4 },
  Classic: { ...emptyVector(), classic: 1, formal: 0.4, "smart-casual": 0.6 },
  Formal: { ...emptyVector(), formal: 1, classic: 0.5 },
  Contemporary: { ...emptyVector(), minimalist: 0.7, classic: 0.5, "smart-casual": 0.6 },
  Minimalist: { ...emptyVector(), minimalist: 1, classic: 0.5, "smart-casual": 0.5 },
  Retro: { ...emptyVector(), streetwear: 0.5, casual: 0.5, sporty: 0.4 },
};

/* Category group -> base vector (derived, lower authority). */
const CATEGORY_VECTOR: Record<string, StyleVector> = {
  footwear: { ...emptyVector(), casual: 0.7, sporty: 0.4 },
  bottoms: { ...emptyVector(), casual: 0.7 },
  tops: { ...emptyVector(), casual: 0.7 },
  layering: { ...emptyVector(), casual: 0.8, streetwear: 0.3 },
  accessory: { ...emptyVector(), casual: 0.5 },
};

/* Per-category refined vectors (category beats the group generic). */
const CATEGORY_SPECIFIC: Record<string, StyleVector> = {
  sneakers: { ...emptyVector(), sporty: 0.9, casual: 0.9, streetwear: 0.6 },
  joggers: { ...emptyVector(), sporty: 0.9, casual: 0.8, streetwear: 0.6 },
  heels: { ...emptyVector(), formal: 0.8, classic: 0.5, "smart-casual": 0.7 },
  loafers: { ...emptyVector(), "smart-casual": 0.8, classic: 0.6, formal: 0.5 },
  sandals: { ...emptyVector(), casual: 0.9, sporty: 0.4 },
  boots: { ...emptyVector(), casual: 0.7, streetwear: 0.5 },
  blouses: { ...emptyVector(), "smart-casual": 0.7, classic: 0.5, bohemian: 0.5, casual: 0.4 },
  "button-ups": { ...emptyVector(), "smart-casual": 0.8, classic: 0.7, formal: 0.4 },
  "t-shirts": { ...emptyVector(), casual: 0.9, streetwear: 0.5, sporty: 0.5 },
  "tank-tops": { ...emptyVector(), casual: 0.9, sporty: 0.6 },
  polos: { ...emptyVector(), "smart-casual": 0.6, classic: 0.6, casual: 0.5 },
  hoodies: { ...emptyVector(), streetwear: 0.9, casual: 0.8, sporty: 0.6 },
  sweatshirts: { ...emptyVector(), casual: 0.8, streetwear: 0.6, sporty: 0.6 },
  cardigans: { ...emptyVector(), classic: 0.6, "smart-casual": 0.7, casual: 0.6, minimalist: 0.4 },
  trousers: { ...emptyVector(), "smart-casual": 0.6, classic: 0.5, formal: 0.4, casual: 0.5 },
  jeans: { ...emptyVector(), casual: 0.9, streetwear: 0.5 },
  chinos: { ...emptyVector(), "smart-casual": 0.7, classic: 0.5, casual: 0.6 },
  leggings: { ...emptyVector(), sporty: 0.8, casual: 0.6 },
};

/* Attribute hints (Pattern/Fit/Material/Sleeve) — lower authority. */
const HINT_VECTOR: Record<string, StyleVector> = {
  Slim: { ...emptyVector(), "smart-casual": 0.7, formal: 0.5, minimalist: 0.4 },
  "Straight Leg": { ...emptyVector(), classic: 0.5, casual: 0.6 },
  "Wide Leg": { ...emptyVector(), bohemian: 0.6, casual: 0.5 },
  Oversized: { ...emptyVector(), streetwear: 0.8, casual: 0.5 },
  Relaxed: { ...emptyVector(), casual: 0.8, sporty: 0.4 },
  Fitted: { ...emptyVector(), formal: 0.3, "smart-casual": 0.6 },
  FittedOther: { ...emptyVector(), "smart-casual": 0.6, minimalist: 0.4 },
  Linen: { ...emptyVector(), casual: 0.7, classic: 0.4 },
  Satin: { ...emptyVector(), formal: 0.8, "smart-casual": 0.5 },
  Denim: { ...emptyVector(), casual: 0.9 },
  Leather: { ...emptyVector(), streetwear: 0.5, casual: 0.5 },
  Floral: { ...emptyVector(), bohemian: 0.8 },
  Striped: { ...emptyVector(), "smart-casual": 0.5, classic: 0.3, sporty: 0.4 },
  Checked: { ...emptyVector(), classic: 0.6, "smart-casual": 0.5 },
  Graphic: { ...emptyVector(), streetwear: 0.9, casual: 0.6 },
  Camouflage: { ...emptyVector(), streetwear: 0.8, sporty: 0.7 },
};

/* Title/description keyword bank — weakest, treated as derived. */
const TITLE_HINT: Array<[RegExp, StyleLabel, number]> = [
  [/oversized|baggy/i, "streetwear", 0.6],
  [/slim|fitted/i, "smart-casual", 0.6],
  [/formal|office|suit/i, "formal", 0.8],
  [/sport|gym|run/i, "sporty", 0.8],
  [/bohemian|boho|floral/i, "bohemian", 0.6],
  [/denim/i, "casual", 0.5],
  [/minimal/i, "minimalist", 0.6],
  [/classic/i, "classic", 0.5],
];

export function normalizeStyleAttribute(value: string): string | null {
  const v = value.trim();
  // The catalog uses "Bohemian" as the normalized form.
  if (/^boh(o|emian|emian)$/i.test(v)) return "Bohemian";
  const key = v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
  return key in STYLE_ATTR_VECTOR ? key : null;
}

export function deriveStyleProfile(product: OutfitProduct): StyleProfile {
  const attributes = product.attributes.map((a) => ({
    name: a.attribute.name,
    value: a.value,
  }));

  // 1. Style attribute (source-backed, strongest).
  const styleAttr = attributes.find(
    (a) => a.name.toLowerCase() === "style"
  );
  if (styleAttr) {
    const norm = normalizeStyleAttribute(styleAttr.value);
    const vec = norm ? STYLE_ATTR_VECTOR[norm] : null;
    if (vec) {
      return {
        vector: vec,
        formality: formalityOf(vec),
        source: "attribute",
      };
    }
  }

  const catSlug = product.category?.slug?.toLowerCase() ?? "";

  // 2. Category (specific beats generic group).
  const catVec =
    CATEGORY_SPECIFIC[catSlug] ??
    CATEGORY_VECTOR[groupOfSlug(catSlug)] ??
    emptyVector();

  // 3. Attribute hints add weight.
  const combined: StyleVector = { ...catVec };
  let usedHint = false;
  for (const a of attributes) {
    const name = a.name.toLowerCase();
    const val =
      (name === "fit" ? a.value : "") ||
      (name === "material" ? a.value : "") ||
      (name === "pattern" ? a.value : "") ||
      (name === "sleeve" ? a.value : "");
    const hintVec = HINT_VECTOR[val];
    if (hintVec) {
      usedHint = true;
      for (const k of STYLE_LABELS) {
        combined[k] = Math.max(combined[k], hintVec[k]);
      }
    }
  }

  // 4. Title/description hints (weakest).
  const title = product.name ?? "";
  const desc = product.name ?? "";
  let usedTitle = false;
  for (const [re, label, w] of TITLE_HINT) {
    if (re.test(title) || re.test(desc)) {
      combined[label] = Math.max(combined[label], w);
      usedTitle = true;
    }
  }

  if (usedHint) {
    return {
      vector: combined,
      formality: formalityOf(combined),
      source: "attribute-hint",
    };
  }
  if (usedTitle) {
    return {
      vector: combined,
      formality: formalityOf(combined),
      source: "title",
    };
  }
  return {
    vector: combined,
    formality: formalityOf(combined),
    source: "category",
  };
}

function groupOfSlug(slug: string): string {
  if (!slug) return "tops";
  if (
    ["sneakers", "loafers", "heels", "sandals", "boots"].includes(slug)
  )
    return "footwear";
  if (
    ["trousers", "jeans", "joggers", "leggings", "chinos", "shorts", "cargo"].includes(slug)
  )
    return "bottoms";
  if (["cardigans", "hoodies", "sweatshirts", "jumpers"].includes(slug))
    return "layering";
  if (["belts", "caps", "hats", "sunglasses", "watches", "ties"].includes(slug))
    return "accessory";
  return "tops";
}

/* Formality scalar from a vector, deterministic linear blend. */
export function formalityOf(vector: StyleVector): number {
  return Math.min(
    1,
    Math.max(
      0,
      vector.formal * 1.0 +
        vector.classic * 0.5 +
        vector["smart-casual"] * 0.6 +
        vector.minimalist * 0.3 -
        vector.sporty * 0.4 -
        vector.casual * 0.3 -
        vector.streetwear * 0.3
    )
  );
}


