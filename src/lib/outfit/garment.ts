/* Garment layer — the generic representation of a product as
   something "worn", built from CANONICAL data only.

   WHY THIS LAYER EXISTS
   Review's fashion Look verdict reasons over generic garments
   (a tee, a shirt, a coat, ...). This module is the single place
   that decides what a product "wears":
     - category slug (canonical taxonomy) -> GarmentType
     - normalized attributes (Fit / Sleeve / Collar / Pattern) -> shape
     - product/variant color -> the garment's color
   It deliberately NEVER reads source, sourceId, eBay listing fields,
   or provider names. Removing a source must not change Review/Build
   behavior at all.

   COVERAGE LEVELS (honest representation)
   - "structured": built from real canonical data. Exact enough to
     represent type / silhouette / color; NOT an exact fit.
   - "asset": a future asset (image-based Virtual Try-On garment) has
     replaced the primitive. attachGarmentAsset() is the pure hook.
   - "estimate": unknown category fell back to the slot's generic
     garment. Never a lie on screen: the UI shows the known facts.

   FUTURE VIRTUAL TRY-ON
   A future image-based VTON consumes these visuals as the try-on
   garment — a generic GarmentVisual, never raw products or source
   fields. Nothing here couples to today's data source.

   Pure module: no DB / network / I-O. Safe for server + offline tests. */

import {
  resolveCandidateColor,
} from "./compatibility";
import { slotOfCategory } from "./category-rules";
import type {
  ColorInfo,
  OutfitProduct,
  SlotName,
} from "./types";

export type GarmentType =
  /* torso layers */
  | "tee" | "polo" | "shirt" | "blouse" | "knit"
  | "hoodie" | "sweatshirt" | "vest"
  | "jacket" | "coat" | "blazer"
  | "dress" | "jumpsuit"
  /* legs */
  | "jeans" | "trousers" | "shorts" | "skirt" | "leggings"
  /* feet */
  | "sneakers" | "running-shoes" | "boots" | "sandals" | "heels"
  | "flats" | "loafers" | "formal-shoes"
  /* accessories + head */
  | "headwear" | "glasses" | "watch" | "belt" | "bag" | "socks"
  | "scarf" | "tie" | "jewelry"
  /* generic slot fallbacks (unknown taxonomy leaves) */
  | "solid-torso" | "solid-legs" | "solid-shoes" | "accent";

export type GarmentFit =
  | "slim" | "regular" | "relaxed" | "oversized" | "fitted" | "unknown";

export type GarmentLength =
  | "cropped" | "short" | "regular" | "long" | "ankle" | "full";

export type SleeveType =
  | "sleeveless" | "cap" | "short" | "three-quarter" | "long" | "unknown";

export type CollarType =
  | "none" | "crew" | "v-neck" | "collar" | "polo" | "high"
  | "round" | "square" | "scoop" | "mock" | "halter" | "boat";

export type GarmentPattern = "solid" | "striped" | "checked" | "floral" | "patterned";

export type GarmentCoverage = "structured" | "asset" | "estimate";

export type GarmentVisual = {
  slot: SlotName;
  type: GarmentType;
  label: string;
  color: ColorInfo | null;
  fit: GarmentFit;
  sleeve: SleeveType;
  collar: CollarType;
  length: GarmentLength;
  pattern: GarmentPattern;
  /* drawing order: higher = worn further out / on top */
  layerOrder: number;
  coverage: GarmentCoverage;
  /* VTON hook: future image-based try-on garment URI that replaces the primitive. */
  assetUri: string | null;
  /* what we actually knew (for the UI's "preview" disclosure) */
  note: string | null;
};

/* Canonical category slug -> garment type. Read from the shared
   taxonomy's slug vocabulary; a new canonical leaf simply needs a row
   here (or inherits its slot's generic garment). */
const SLUG_GARMENT_TYPE: Record<string, GarmentType> = {
  "t-shirts": "tee",
  "tank-tops": "tee",
  "shirts": "shirt",
  "blouses": "blouse",
  polos: "polo",
  "polo-shirts": "polo",
  "button-ups": "shirt",
  sweaters: "knit",
  cardigans: "knit",
  jumpers: "knit",
  hoodies: "hoodie",
  sweatshirts: "sweatshirt",
  jackets: "jacket",
  coats: "coat",
  blazers: "blazer",
  parkas: "coat",
  "puffer-jackets": "jacket",
  vests: "vest",
  dresses: "dress",
  jumpsuits: "jumpsuit",
  bodysuits: "jumpsuit",
  jeans: "jeans",
  trousers: "trousers",
  chinos: "trousers",
  cargo: "trousers",
  "cargo-pants": "trousers",
  joggers: "trousers",
  shorts: "shorts",
  skirts: "skirt",
  leggings: "leggings",
  "track-pants": "trousers",
  "sports-shorts": "shorts",
  swimwear: "shorts",
  "swimming-trunks": "shorts",
  "sports-bras": "vest",
  "socks": "socks",
  belts: "belt",
  beanies: "headwear",
  caps: "headwear",
  hats: "headwear",
  sunglasses: "glasses",
  watches: "watch",
  handbags: "bag",
  backpacks: "bag",
  "shoulder-bags": "bag",
  "crossbody-bags": "bag",
  "duffle-travel-bags": "bag",
  "bum-bags": "bag",
  "tote-bags": "bag",
  wallets: "bag",
  ties: "tie",
  "ties-bow-ties": "tie",
  "bow-ties": "tie",
  scarves: "scarf",
  "scarves-and-hijabs": "scarf",
  hijabs: "scarf",
  "hijabs-and-scarves": "scarf",
  jewelry: "jewelry",
  sneakers: "sneakers",
  "running-trainers": "running-shoes",
  "running-shoes": "running-shoes",
  boots: "boots",
  sandals: "sandals",
  heels: "heels",
  flats: "flats",
  loafers: "loafers",
  "formal-shoes": "formal-shoes",
};

/* Generic garment per builder slot when the slug is unknown: the
   review always gets a plausible, honest generic piece. */
const SLOT_FALLBACK_TYPE: Record<SlotName, GarmentType> = {
  top: "solid-torso",
  layer: "solid-torso",
  bottom: "solid-legs",
  footwear: "solid-shoes",
  accessory: "accent",
};

export function garmentTypeFor(
  slug: string | null | undefined
): GarmentType {
  const key = (slug ?? "").toLowerCase();
  return SLUG_GARMENT_TYPE[key] ?? SLOT_FALLBACK_TYPE[slotOfCategory(key)];
}

export function garmentLabel(type: GarmentType): string {
  return type.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/* Drawing order: outer layers above base layers; accessories on top
   of clothing; shoes/head are the outermost of their zone. */
export function garmentLayerOrder(type: GarmentType): number {
  switch (type) {
    case "coat":
    case "blazer":
      return 3;
    case "jacket":
    case "hoodie":
    case "sweatshirt":
    case "vest":
    case "knit":
    case "dress":
    case "jumpsuit":
      return 2;
    case "shirt":
    case "blouse":
    case "polo":
      return 1;
    default:
      return 1;
  }
}

function attrValue(
  product: OutfitProduct,
  name: string
): string | null {
  for (const a of product.attributes ?? []) {
    if (a.attribute.name.toLowerCase() === name.toLowerCase()) {
      return a.value.trim();
    }
  }
  return null;
}

function normalizeFit(value: string | null): GarmentFit {
  switch ((value ?? "").toLowerCase()) {
    case "oversized": return "oversized";
    case "relaxed": return "relaxed";
    case "fitted": return "fitted";
    case "slim": return "slim";
    case "straight leg": return "regular";
    case "wide leg": return "relaxed";
    default: return "regular";
  }
}

function normalizeSleeve(value: string | null, type: GarmentType): SleeveType {
  switch ((value ?? "").toLowerCase()) {
    case "long sleeve": return "long";
    case "short sleeve": return "short";
    case "cap sleeve": return "cap";
    case "3/4 sleeve": return "three-quarter";
    case "sleeveless": return "sleeveless";
    case "puff sleeve":
    case "balloon sleeve":
      return "short";
    default:
      /* sensible silhouette defaults per garment type */
      if (type === "tee" || type === "polo" || type === "shirt" || type === "blouse") return "short";
      if (type === "knit") return "long";
      if (type === "vest" || type === "sweatshirt" || type === "hoodie") return "long";
      return "unknown";
  }
}

function normalizeCollar(value: string | null, type: GarmentType): CollarType {
  switch ((value ?? "").toLowerCase()) {
    case "crew neck": return "crew";
    case "v-neck": return "v-neck";
    case "collared": return "collar";
    case "polo": return "polo";
    case "high neck": return "high";
    case "round neck": return "round";
    case "square neck": return "square";
    case "scoop neck": return "scoop";
    case "mock neck": return "mock";
    case "halter neck": return "halter";
    case "boat neck": return "boat";
    case "split neck": return "collar";
    default:
      if (type === "shirt" || type === "blouse") return "collar";
      if (type === "polo") return "polo";
      if (type === "tee" || type === "sweatshirt") return "crew";
      if (type === "knit") return "crew";
      return "none";
  }
}

function normalizePattern(value: string | null): GarmentPattern {
  switch ((value ?? "").toLowerCase()) {
    case "striped": return "striped";
    case "checked": return "checked";
    case "floral": return "floral";
    case "solid":
    case "plain":
    case "":
      return "solid";
    default:
      return "patterned";
  }
}

/* Length by garment type; refined by category-specific semantics.
   Coats/puffers read "long"/"ankle"; layers hang looser. */
function lengthOf(type: GarmentType): GarmentLength {
  switch (type) {
    case "coat":
      return "long";
    case "jacket":
    case "blazer":
    case "knit":
    case "hoodie":
    case "sweatshirt":
      return "regular";
    case "dress":
    case "jumpsuit":
      return "ankle";
    case "shorts":
    case "skirt":
      return "short";
    case "jeans":
    case "trousers":
    case "leggings":
      return "full";
    default:
      return "regular";
  }
}

/* The canonical color of a product for garment purposes: an explicit
   focus color wins (the user picked it), otherwise the same
   deterministic pick the outfit engine uses. */
function colorOf(
  product: OutfitProduct,
  focus: ColorInfo | null | undefined
): ColorInfo | null {
  if (focus?.name) return focus;
  return resolveCandidateColor(product, null);
}

/* Build the generic garment for a product. Pure. */
export function garmentVisualFor(args: {
  product: OutfitProduct;
  slot?: SlotName | null;
  color?: ColorInfo | null;
}): GarmentVisual {
  const { product, color } = args;
  const slug = product.category?.slug ?? "";
  const slot = args.slot ?? slotOfCategory(slug);

  const type = garmentTypeFor(slug);
  const known = SLUG_GARMENT_TYPE[slug.toLowerCase()] !== undefined;

  const rawFit = attrValue(product, "Fit");
  const rawSleeve = attrValue(product, "Sleeve");
  const rawCollar = attrValue(product, "Collar");
  const rawPattern = attrValue(product, "Pattern");
  const rawMaterial = attrValue(product, "Material");

  const visual: GarmentVisual = {
    slot,
    type,
    label: garmentLabel(type),
    color: colorOf(product, color),
    fit: normalizeFit(rawFit),
    sleeve: normalizeSleeve(rawSleeve, type),
    collar: normalizeCollar(rawCollar, type),
    length: lengthOf(type),
    pattern: normalizePattern(rawPattern),
    layerOrder: garmentLayerOrder(type),
    coverage: known ? "structured" : "estimate",
    assetUri: null,
    note: rawMaterial
      ? `${garmentLabel(type)} · ${rawMaterial}`
      : garmentLabel(type),
  };
  return visual;
}

/* VTON hook: swap the primitive for a future try-on garment. Pure; the
   caller validates the asset source. */
export function attachGarmentAsset(
  visual: GarmentVisual,
  assetUri: string
): GarmentVisual {
  return { ...visual, assetUri, coverage: "asset" };
}