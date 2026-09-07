/* AvatarProfile — the user's visual model.

   PURPOSE
   A source-independent abstraction of the person the outfit is being
   styled for. It is intentionally NOT a transient piece of Review state:
   an AvatarProfile can be saved, persisted, and reused by Review,
   Builder, a future Virtual Try-On and future recommendations.

   SOURCE-INDEPENDENT
   This module knows nothing about Product, ProductOffer, sources or
   eBay. It is pure data + pure functions (no DB / network / I-O), so
   the exact same profile drives any future renderer or client.

   PRIVACY / NON-CLASSIFICATION
   The profile is built from VISUAL appearance properties (skin tone,
   hair style / length / color / texture) — deliberately NOT a "race" or
   ethnicity field. The goal is visual similarity, never categorizing
   the user into a demographic bucket.

   MEASUREMENTS
   avatarDimensionsFor() turns the profile into a deterministic body
   (proportions + shape multipliers). It is an APPROXIMATION for visual
   styling only — never claimed as precise tailoring. */

export const AVATAR_VERSION = 1;

export type AvatarGender = "MEN" | "WOMEN" | "KIDS";

export type BodyShape = "slim" | "regular" | "athletic" | "broad" | "curvy";

export type SkinTone = "fair" | "light" | "medium" | "tan" | "deep";

export type HairStyle =
  | "buzz"
  | "short"
  | "medium"
  | "long"
  | "curly"
  | "ponytail"
  | "bald";

export type HairColor = "black" | "brown" | "blonde" | "red" | "grey";

export type HairLength = "short" | "medium" | "long";

export type HairTexture = "straight" | "wavy" | "curly" | "coily";

export type AvatarProfile = {
  gender: AvatarGender;
  heightCm: number;
  weightKg: number;
  bodyShape: BodyShape;
  skinTone: SkinTone;
  hairStyle: HairStyle;
  hairLength: HairLength;
  hairColor: HairColor;
  hairTexture: HairTexture;
};

export type AvatarOption = { value: string; label: string };

export const AVATAR_GENDERS: AvatarOption[] = [
  { value: "MEN", label: "Men" },
  { value: "WOMEN", label: "Women" },
  { value: "KIDS", label: "Kids" },
];

export const BODY_SHAPES: AvatarOption[] = [
  { value: "slim", label: "Slim" },
  { value: "regular", label: "Regular" },
  { value: "athletic", label: "Athletic" },
  { value: "broad", label: "Broad" },
  { value: "curvy", label: "Curvy" },
];

export const SKIN_TONES: AvatarOption[] = [
  { value: "fair", label: "Fair" },
  { value: "light", label: "Light" },
  { value: "medium", label: "Medium" },
  { value: "tan", label: "Tan" },
  { value: "deep", label: "Deep" },
];

export const HAIR_STYLES: AvatarOption[] = [
  { value: "buzz", label: "Buzz cut" },
  { value: "short", label: "Short" },
  { value: "medium", label: "Medium" },
  { value: "long", label: "Long" },
  { value: "curly", label: "Curly" },
  { value: "ponytail", label: "Ponytail" },
  { value: "bald", label: "Bald" },
];

export const HAIR_LENGTHS: AvatarOption[] = [
  { value: "short", label: "Short" },
  { value: "medium", label: "Medium" },
  { value: "long", label: "Long" },
];

export const HAIR_COLORS: AvatarOption[] = [
  { value: "black", label: "Black" },
  { value: "brown", label: "Brown" },
  { value: "blonde", label: "Blonde" },
  { value: "red", label: "Red" },
  { value: "grey", label: "Grey" },
];

export const HAIR_TEXTURES: AvatarOption[] = [
  { value: "straight", label: "Straight" },
  { value: "wavy", label: "Wavy" },
  { value: "curly", label: "Curly" },
  { value: "coily", label: "Coily" },
];

/* Deterministic visual swatches (fashion-approximation only). */
export const SKIN_TONE_HEX: Record<SkinTone, string> = {
  fair: "#f3d3bd",
  light: "#e7b792",
  medium: "#c8895c",
  tan: "#a05f38",
  deep: "#5f3a24",
};

export const HAIR_COLOR_HEX: Record<HairColor, string> = {
  black: "#191411",
  brown: "#4a2f1d",
  blonde: "#c99a51",
  red: "#8a3a22",
  grey: "#8b857c",
};

export const DEFAULT_AVATAR_PROFILE: AvatarProfile = {
  gender: "MEN",
  heightCm: 174,
  weightKg: 72,
  bodyShape: "regular",
  skinTone: "medium",
  hairStyle: "short",
  hairLength: "short",
  hairColor: "brown",
  hairTexture: "straight",
};

const GENDER_VALUES = new Set(AVATAR_GENDERS.map((o) => o.value));
const SHAPE_VALUES = new Set(BODY_SHAPES.map((o) => o.value));
const SKIN_VALUES = new Set(SKIN_TONES.map((o) => o.value));
const STYLE_VALUES = new Set(HAIR_STYLES.map((o) => o.value));
const LENGTH_VALUES = new Set(HAIR_LENGTHS.map((o) => o.value));
const COLOR_VALUES = new Set(HAIR_COLORS.map((o) => o.value));
const TEXTURE_VALUES = new Set(HAIR_TEXTURES.map((o) => o.value));

export type AvatarProfileErrors = Partial<
  Record<keyof AvatarProfile, string>
>;

/* Validation with user-facing messages. Pure. */
export function validateAvatarProfile(
  value: unknown
): AvatarProfileErrors {
  const p = (value ?? {}) as Partial<AvatarProfile>;
  const errors: AvatarProfileErrors = {};
  if (!GENDER_VALUES.has(String(p.gender ?? ""))) {
    errors.gender = "Pick a valid gender.";
  }
  const height = Number(p.heightCm);
  if (
    !Number.isFinite(height) ||
    height < 80 ||
    height > 250
  ) {
    errors.heightCm = "Height must be between 80 and 250 cm.";
  }
  const weight = Number(p.weightKg);
  if (
    !Number.isFinite(weight) ||
    weight < 25 ||
    weight > 300
  ) {
    errors.weightKg = "Weight must be between 25 and 300 kg.";
  }
  if (!SHAPE_VALUES.has(String(p.bodyShape ?? ""))) {
    errors.bodyShape = "Pick a valid body shape.";
  }
  if (!SKIN_VALUES.has(String(p.skinTone ?? ""))) {
    errors.skinTone = "Pick a valid skin tone.";
  }
  if (!STYLE_VALUES.has(String(p.hairStyle ?? ""))) {
    errors.hairStyle = "Pick a valid hair style.";
  }
  if (!LENGTH_VALUES.has(String(p.hairLength ?? ""))) {
    errors.hairLength = "Pick a valid hair length.";
  }
  if (!COLOR_VALUES.has(String(p.hairColor ?? ""))) {
    errors.hairColor = "Pick a valid hair color.";
  }
  if (!TEXTURE_VALUES.has(String(p.hairTexture ?? ""))) {
    errors.hairTexture = "Pick a valid hair texture.";
  }
  return errors;
}

export function isAvatarProfile(value: unknown): boolean {
  if (value === null || value === undefined || typeof value !== "object") {
    return false;
  }
  return Object.keys(validateAvatarProfile(value)).length === 0;
}

/* Coerce a partial/unknown value into a valid AvatarProfile. Every
   invalid field falls back to its default; numbers are clamped. */
export function normalizeAvatarProfile(
  value: unknown,
  fallback: AvatarProfile = DEFAULT_AVATAR_PROFILE
): AvatarProfile {
  const p = (value ?? {}) as Partial<Record<keyof AvatarProfile, unknown>>;
  const gender = GENDER_VALUES.has(String(p.gender ?? ""))
    ? (p.gender as AvatarGender)
    : fallback.gender;
  const rawHeight = Number(p.heightCm);
  const heightCm = Number.isFinite(rawHeight)
    ? Math.min(250, Math.max(80, Math.round(rawHeight)))
    : fallback.heightCm;
  const rawWeight = Number(p.weightKg);
  const weightKg = Number.isFinite(rawWeight)
    ? Math.min(300, Math.max(25, Math.round(rawWeight)))
    : fallback.weightKg;
  const pick = <T extends string>(
    candidate: unknown,
    allowed: Set<string>,
    fallbackValue: T
  ): T => (allowed.has(String(candidate ?? "")) ? (candidate as T) : fallbackValue);
  return {
    gender,
    heightCm,
    weightKg,
    bodyShape: pick<BodyShape>(p.bodyShape, SHAPE_VALUES, fallback.bodyShape),
    skinTone: pick<SkinTone>(p.skinTone, SKIN_VALUES, fallback.skinTone),
    hairStyle: pick<HairStyle>(p.hairStyle, STYLE_VALUES, fallback.hairStyle),
    hairLength: pick<HairLength>(p.hairLength, LENGTH_VALUES, fallback.hairLength),
    hairColor: pick<HairColor>(p.hairColor, COLOR_VALUES, fallback.hairColor),
    hairTexture: pick<HairTexture>(p.hairTexture, TEXTURE_VALUES, fallback.hairTexture),
  };
}

/* URL-string serialization for deep links / sharing. */
export function serializeAvatarProfile(p: AvatarProfile): string {
  return JSON.stringify(p);
}

/* Parse a persisted/URL AvatarProfile; returns null when invalid. */
export function parseAvatarProfile(
  raw: string | null | undefined
): AvatarProfile | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isAvatarProfile(parsed) ? (parsed as AvatarProfile) : null;
  } catch {
    return null;
  }
}

/* Hydrate from a query param, falling back to default. */
export function hydrateAvatarProfile(
  raw: string | null | undefined,
  fallback: AvatarProfile = DEFAULT_AVATAR_PROFILE
): AvatarProfile {
  return parseAvatarProfile(raw) ?? fallback;
}

const GENDER_LABEL: Record<AvatarGender, string> = {
  MEN: "Men",
  WOMEN: "Women",
  KIDS: "Kids",
};

/* Human summary line for the "YOUR MODEL" card. */
export function describeAvatar(p: AvatarProfile): string {
  const shape = BODY_SHAPES.find((o) => o.value === p.bodyShape)?.label ?? "";
  return `${GENDER_LABEL[p.gender]} · ${p.heightCm} cm · ${shape}`;
}

export type AvatarDimensions = {
  /* full-body unit multiplier (1.0 = 175 cm reference) */
  scale: number;
  /* unit radii / lengths in normalized body units */
  headRadius: number;
  neckLength: number;
  shoulderWidth: number;
  chestDepth: number;
  waistWidth: number;
  hipWidth: number;
  torsoLength: number;
  legLength: number;
  armLength: number;
  /* per-shape chest/waist/hip multipliers after weight nudge */
  shapeChest: number;
  shapeWaist: number;
  shapeHip: number;
};

/* Deterministic body approximation derived from gender + height +
   body shape + weight (a gentle, clamped BMI nudge). PURE. */
export function avatarDimensionsFor(p: AvatarProfile): AvatarDimensions {
  const scale = p.heightCm / 175;

  const base: Record<AvatarGender, {
    head: number; shoulder: number; hip: number; chest: number;
  }> = {
    MEN: { head: 0.092, shoulder: 0.2, hip: 0.185, chest: 0.16 },
    WOMEN: { head: 0.096, shoulder: 0.17, hip: 0.2, chest: 0.15 },
    KIDS: { head: 0.115, shoulder: 0.14, hip: 0.15, chest: 0.12 },
  };

  const b = base[p.gender];

  const shapeChest: Record<BodyShape, number> = {
    slim: 0.9,
    regular: 1,
    athletic: 1.08,
    broad: 1.14,
    curvy: 1.04,
  };
  const shapeWaist: Record<BodyShape, number> = {
    slim: 0.84,
    regular: 1,
    athletic: 0.94,
    broad: 1.1,
    curvy: 0.92,
  };
  const shapeHip: Record<BodyShape, number> = {
    slim: 0.95,
    regular: 1,
    athletic: 1.0,
    broad: 1.06,
    curvy: 1.16,
  };

  /* gentle weight nudge (BMI ~ weight / height²) clamped to ±16% */
  const hM = p.heightCm / 100;
  const bmi = p.weightKg / (hM * hM);
  const nudge = Math.max(-0.16, Math.min(0.16, (bmi - 22) * 0.012));

  return {
    scale,
    headRadius: b.head * scale,
    neckLength: 0.055 * scale,
    shoulderWidth: b.shoulder * scale * shapeChest[p.bodyShape],
    chestDepth: b.chest * scale * shapeChest[p.bodyShape],
    waistWidth: b.chest * scale * shapeWaist[p.bodyShape],
    hipWidth: b.hip * scale * shapeHip[p.bodyShape],
    torsoLength: 0.34 * scale,
    legLength: 0.47 * scale,
    armLength: 0.32 * scale,
    shapeChest: shapeChest[p.bodyShape] * (1 + nudge),
    shapeWaist: shapeWaist[p.bodyShape] * (1 + nudge * 1.4),
    shapeHip: shapeHip[p.bodyShape] * (1 + nudge * 0.6),
  };
}

/* ---- persistence abstraction ----
   Review must not dictate where an avatar lives. A store is just a
   get/set pair; swap in a server-backed store later without touching
   the UI or the domain type. */

export interface AvatarStore {
  get(): AvatarProfile;
  set(profile: AvatarProfile): void;
}

/* Deterministic in-memory store (tests + graceful fallback). */
export class InMemoryAvatarStore implements AvatarStore {
  private current: AvatarProfile;

  constructor(initial: AvatarProfile = DEFAULT_AVATAR_PROFILE) {
    this.current = initial;
  }

  get(): AvatarProfile {
    return this.current;
  }

  set(profile: AvatarProfile): void {
    this.current = profile;
  }
}

const DEFAULT_STORAGE_KEY = "fitwear-avatar-profile";

/* localStorage-backed store. Degrades to in-memory when storage is
   unavailable (SSR, private mode, storage blocked) — never throws. */
export function createLocalStorageAvatarStore(
  key: string = DEFAULT_STORAGE_KEY
): AvatarStore {
  const canUseStorage = (): boolean => {
    if (typeof window === "undefined") return false;
    try {
      window.localStorage.setItem("__fitwear_probe__", "1");
      window.localStorage.removeItem("__fitwear_probe__");
      return true;
    } catch {
      return false;
    }
  };
  if (!canUseStorage()) {
    const memory = new InMemoryAvatarStore();
    return {
      get: () => memory.get(),
      set: (p) => memory.set(p),
    };
  }
  return {
    get(): AvatarProfile {
      try {
        return hydrateAvatarProfile(window.localStorage.getItem(key));
      } catch {
        return DEFAULT_AVATAR_PROFILE;
      }
    },
    set(profile: AvatarProfile): void {
      try {
        window.localStorage.setItem(key, serializeAvatarProfile(profile));
      } catch {
        /* storage blocked — persistence is best-effort */
      }
    },
  };
}