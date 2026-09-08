/* AvatarModel — turns an AvatarProfile into the parameters that drive the
   real rigged human (public/models/avatar/base.glb).

   PURPOSE
   AvatarProfile → AvatarModel → HumanMesh + Skeleton + Morphs. EVERY visual
   profile field must change the rendered model: gender (genderToFemale/
   genderToMale morphs + gendered body micro-recipe), height (heightScale),
   weight + body shape (BMI-driven weight morph + a per-shape body recipe
   mapped to the baked morph set), skin tone (PBR skin color / roughness)
   and hair (style / length / texture / color). Nothing may be decorative.

   PURE
   This module does not import three.js. It emits the exact morph names the
   GLB exposes (avatar-manifest.json) so the renderer and the tests share one
   contract. DOM-free, IO-free, deterministic — identical profile in, identical
   model out, on any client. */

import type {
  AvatarGender,
  AvatarProfile,
  BodyShape,
  HairStyle,
  SkinTone,
} from "./profile";

/* Height of the baked base mesh (feet at 0, head top), in meters. */
export const AVATAR_BASE_HEIGHT_M = 1.694;

/* The 30 morphs baked into base.glb (matching avatar-manifest.json). */
export const AVATAR_MORPH_NAMES = [
  "weightUp",
  "weightDown",
  "muscleUp",
  "muscleDown",
  "bustUp",
  "bustDown",
  "waistUp",
  "waistDown",
  "hipsUp",
  "hipsDown",
  "shouldersUp",
  "shouldersDown",
  "torsoWidthUp",
  "torsoWidthDown",
  "torsoDepthUp",
  "torsoDepthDown",
  "stomachToned",
  "stomachSoft",
  "glutesUp",
  "glutesDown",
  "legsUp",
  "legsDown",
  "armsUp",
  "armsDown",
  "neckUp",
  "neckDown",
  "jawUp",
  "jawDown",
  "genderToFemale",
  "genderToMale",
] as const;

export type AvatarMorphName = (typeof AVATAR_MORPH_NAMES)[number];

export type AvatarMorphs = Record<AvatarMorphName, number>;

export type AvatarSkin = { color: number; roughness: number };

export type AvatarHair = {
  style: HairStyle;
  length: AvatarProfile["hairLength"];
  texture: AvatarProfile["hairTexture"];
  color: number;
};

export type AvatarModelConfig = {
  morphs: AvatarMorphs;
  heightScale: number;
  skin: AvatarSkin;
  hair: AvatarHair;
  gender: AvatarGender;
};

export const clamp01 = (v: number): number =>
  v <= 0 ? 0 : v >= 1 ? 1 : v;

const SKIN_ROUGHNESS: Record<SkinTone, number> = {
  fair: 0.58,
  light: 0.62,
  medium: 0.66,
  tan: 0.72,
  deep: 0.78,
};

const hex = (h: string): number => parseInt(h.replace("#", ""), 16);

/* Body macro pivot BMI per shape — the BMI that shape "sitting at rest" is
   assumed to imply, so weight drifts the body thicker/thinner around it. */
const SHAPE_PIVOT_BMI: Record<BodyShape, number> = {
  slim: 20,
  regular: 23.5,
  athletic: 26,
  broad: 27.5,
  curvy: 26,
};

/* Per-shape body recipe: signed (+/-) strength per morph axis.
   +x → <x>Up, -x → <x>Down morph (stomach → stomachToned/stomachSoft,
   muscle → muscleUp/muscleDown). Values are planning targets, clamped 0..1. */
const SHAPE_RECIPE: Record<BodyShape, Record<string, number>> = {
  slim: {
    waist: -0.5, hips: -0.3, shoulders: -0.25, torsoWidth: -0.3,
    torsoDepth: -0.25, legs: -0.4, arms: -0.4, glutes: -0.3,
    stomach: 0.4, neck: -0.25, jaw: -0.3, bust: -0.25,
  },
  regular: {},
  athletic: {
    muscle: 0.4, shoulders: 0.35, torsoWidth: 0.25, torsoDepth: 0.2,
    arms: 0.35, legs: 0.45, stomach: 0.85, glutes: 0.3,
    neck: 0.3, jaw: 0.2, bust: 0.12,
  },
  broad: {
    muscle: 0.25, shoulders: 0.5, torsoWidth: 0.45, torsoDepth: 0.35,
    waist: 0.3, hips: 0.25, arms: 0.3, legs: 0.35, stomach: -0.15,
    neck: 0.35, jaw: 0.3, glutes: 0.1, bust: 0.15,
  },
  curvy: {
    hips: 0.55, waist: -0.25, bust: 0.5, glutes: 0.6, legs: 0.55,
    arms: 0.28, torsoWidth: 0.3, stomach: -0.25, shoulders: -0.15,
    neck: -0.1,
  },
};

/* Small gender overlay so men/women differ beyond the gender morphs. */
const GENDER_RECIPE: Record<AvatarGender, Record<string, number>> = {
  MEN: { shoulders: 0.1, waist: 0.05, torsoDepth: 0.08, jaw: 0.05 },
  WOMEN: { shoulders: -0.12, waist: -0.1, hips: 0.1, glutes: 0.1 },
  KIDS: {},
};

/* Bust is feminine: scale its effective strength by gender. */
const BUST_FEMININITY: Record<AvatarGender, number> = {
  WOMEN: 1,
  MEN: 0.3,
  KIDS: 0.4,
};

export function bodyMorphsFor(p: AvatarProfile): AvatarMorphs {
  const morphs = Object.fromEntries(
    AVATAR_MORPH_NAMES.map((n) => [n, 0])
  ) as AvatarMorphs;

  /* 1. gender composites */
  if (p.gender === "WOMEN") morphs.genderToFemale = 1;
  else if (p.gender === "MEN") morphs.genderToMale = 1;

  /* 2. weight from BMI vs the shape's pivot */
  const hM = p.heightCm / 100;
  const bmi = p.weightKg / (hM * hM);
  const drift = clamp01(Math.abs((bmi - SHAPE_PIVOT_BMI[p.bodyShape]) / 5));
  if (bmi > SHAPE_PIVOT_BMI[p.bodyShape]) morphs.weightUp = drift * 0.92;
  else morphs.weightDown = drift * 0.92;

  /* 3. body-shape recipe + gender overlay */
  const recipe: Record<string, number> = { ...morphs };
  const apply = (src: Record<string, number>) => {
    for (const [axis, strength] of Object.entries(src)) {
      if (axis === "muscle") {
        if (strength >= 0) recipe.muscleUp = (recipe.muscleUp ?? 0) + strength;
        else recipe.muscleDown = (recipe.muscleDown ?? 0) - strength;
      } else if (axis === "stomach") {
        if (strength >= 0) recipe.stomachToned = (recipe.stomachToned ?? 0) + strength;
        else recipe.stomachSoft = (recipe.stomachSoft ?? 0) - strength;
      } else {
        recipe[axis] = (recipe[axis] ?? 0) + strength;
      }
    }
  };
  apply(SHAPE_RECIPE[p.bodyShape]);
  apply(GENDER_RECIPE[p.gender]);

  /* 4. map signed body-axis strengths -> Up/Down morph pairs.
     weight / muscle / stomach / gender are already expressed directly. */
  const AXES = [
    "bust", "waist", "hips", "shoulders", "torsoWidth", "torsoDepth",
    "glutes", "legs", "arms", "neck", "jaw",
  ] as const;
  for (const axis of AXES) {
    const v = recipe[axis] ?? 0;
    if (v >= 0) morphs[`${axis}Up` as AvatarMorphName] = clamp01(v);
    else morphs[`${axis}Down` as AvatarMorphName] = clamp01(-v);
  }
  morphs.muscleUp = clamp01(recipe.muscleUp ?? 0);
  morphs.muscleDown = clamp01(recipe.muscleDown ?? 0);
  morphs.stomachToned = clamp01(recipe.stomachToned ?? 0);
  morphs.stomachSoft = clamp01(recipe.stomachSoft ?? 0);
  morphs.weightUp = recipe.weightUp;
  morphs.weightDown = recipe.weightDown;

  /* 5. bust is feminine — scale by the gender's intensity */
  const femScale = BUST_FEMININITY[p.gender];
  morphs.bustUp = clamp01(morphs.bustUp * femScale);
  morphs.bustDown = clamp01(morphs.bustDown * femScale);

  return morphs;
}

export function avatarModelFor(p: AvatarProfile): AvatarModelConfig {
  const skin = { color: hex(SKIN_COLOR[p.skinTone]), roughness: SKIN_ROUGHNESS[p.skinTone] };
  const hair = {
    style: p.hairStyle,
    length: p.hairLength,
    texture: p.hairTexture,
    color: hex(HairColorHex(p.hairColor)),
  };
  return {
    morphs: bodyMorphsFor(p),
    heightScale: p.heightCm / (AVATAR_BASE_HEIGHT_M * 100),
    skin,
    hair,
    gender: p.gender,
  };
}

/* Deterministic maps (kept here so this module stays the single owner of
   look-mapping; profile.ts exports the hex tables we mirror). */
const SKIN_COLOR: Record<SkinTone, string> = {
  fair: "#f3d3bd",
  light: "#e7b792",
  medium: "#c8895c",
  tan: "#a05f38",
  deep: "#5f3a24",
};
const HAIR_COLOR_HEX: Record<AvatarProfile["hairColor"], string> = {
  black: "#191411",
  brown: "#4a2f1d",
  blonde: "#c99a51",
  red: "#8a3a22",
  grey: "#8b857c",
};
const HairColorHex = (c: AvatarProfile["hairColor"]): string => HAIR_COLOR_HEX[c];

/* ---- proof that every field actually drives the model ---- */

export type SilentField = keyof AvatarProfile;

/* Returns the list of profile fields that produce ZERO change in the model.
   The test suite fails if any field shows up — a field must never be merely
   decorative. PURE. */
export function silentProfileFields(profile: AvatarProfile): SilentField[] {
  const fields: (keyof AvatarProfile)[] = [
    "gender", "heightCm", "weightKg", "bodyShape",
    "skinTone", "hairStyle", "hairLength", "hairColor", "hairTexture",
  ];
  const refine = (m: AvatarModelConfig): string => JSON.stringify(m);
  const silent: SilentField[] = [];
  for (const field of fields) {
    const variant: AvatarProfile = { ...profile, [field]: undefined as never };
    switch (field) {
      case "gender":
        variant.gender = profile.gender === "MEN" ? "WOMEN" : profile.gender === "WOMEN" ? "KIDS" : "MEN";
        break;
      case "heightCm": variant.heightCm = profile.heightCm + 12; break;
      case "weightKg": variant.weightKg = profile.weightKg + 12; break;
      case "bodyShape": variant.bodyShape = nextShape(profile.bodyShape); break;
      case "skinTone": variant.skinTone = profile.skinTone === "fair" ? "deep" : "fair"; break;
      case "hairStyle": variant.hairStyle = nextStyle(profile.hairStyle); break;
      case "hairLength": variant.hairLength = profile.hairLength === "short" ? "long" : "short"; break;
      case "hairColor": variant.hairColor = profile.hairColor === "black" ? "blonde" : "black"; break;
      case "hairTexture": variant.hairTexture = profile.hairTexture === "straight" ? "curly" : "straight"; break;
      default: break;
    }
    if (refine(avatarModelFor(profile)) === refine(avatarModelFor(variant))) {
      silent.push(field);
    }
  }
  return silent;
}

const SHAPES: BodyShape[] = ["slim", "regular", "athletic", "broad", "curvy"];
const nextShape = (s: BodyShape): BodyShape =>
  SHAPES[(SHAPES.indexOf(s) + 1) % SHAPES.length];

const STYLES: HairStyle[] = [
  "buzz", "short", "medium", "long", "curly", "ponytail", "bald",
];
const nextStyle = (s: HairStyle): HairStyle =>
  STYLES[(STYLES.indexOf(s) + 1) % STYLES.length];