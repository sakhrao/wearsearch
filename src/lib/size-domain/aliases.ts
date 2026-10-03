import { ORDERED_ALPHA } from "../sizes";
import type {
  MeasurementTypeId,
  MeasurementUnit,
  SizeCategoryId,
  SizeSystemId,
} from "./types";

export function foldLabel(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, " ");
}

export type SizeValueAlias = {
  canonical: string;
  aliases: readonly string[];
};

export const ALPHA_SIZE_ALIASES: readonly SizeValueAlias[] = [
  { canonical: "XXS", aliases: ["xxs", "extra extra small"] },
  { canonical: "XS", aliases: ["xs", "extra small"] },
  { canonical: "S", aliases: ["s", "small"] },
  { canonical: "M", aliases: ["m", "medium", "med"] },
  { canonical: "L", aliases: ["l", "large"] },
  { canonical: "XL", aliases: ["xl", "extra large"] },
  { canonical: "XXL", aliases: ["xxl", "2xl", "2x", "double extra large"] },
  {
    canonical: "XXXL",
    aliases: ["xxxl", "3xl", "3x", "triple extra large"],
  },
  { canonical: "4XL", aliases: ["4xl", "4x"] },
  { canonical: "5XL", aliases: ["5xl", "5x"] },
];

export const ONE_SIZE_ALIASES: readonly string[] = [
  "one size",
  "onesize",
  "one-size",
  "os",
  "universal",
  "uni",
];

export const ONE_SIZE_CANONICAL = "One Size";

export const BRA_CUPS: readonly string[] = [
  "AA",
  "A",
  "B",
  "C",
  "D",
  "DD",
  "E",
  "F",
  "FF",
  "G",
  "GG",
  "H",
  "HH",
  "I",
  "J",
  "K",
];

export const NUMERIC_SIZE_PATTERN = /^\d+(?:[.,]\d+)?$/;

export const BRA_SIZE_PATTERN = /^(\d{2,3})\s*([a-z]{1,3})$/;

export const SYSTEM_PREFIX_ALIASES: readonly {
  system: SizeSystemId;
  labels: readonly string[];
}[] = [
  {
    system: "INTERNATIONAL",
    labels: ["international", "intl", "int"],
  },
  { system: "EU", labels: ["eu"] },
  { system: "US", labels: ["us", "usa"] },
  { system: "UK", labels: ["uk"] },
  { system: "IT", labels: ["it"] },
  { system: "FR", labels: ["fr"] },
  { system: "DE", labels: ["de"] },
  { system: "JP", labels: ["jp"] },
  { system: "CM", labels: ["cm"] },
  { system: "MONDO", labels: ["mondo", "mondopoint"] },
  { system: "WAIST_IN", labels: ["waist in", "waist inch", "waist inches"] },
  { system: "WAIST_CM", labels: ["waist cm"] },
  { system: "BRA", labels: ["bra"] },
  { system: "ONE_SIZE", labels: ["one size"] },
];

export const MEASUREMENT_LABEL_ALIASES: readonly {
  id: MeasurementTypeId;
  labels: readonly string[];
}[] = [
  { id: "chest", labels: ["chest", "chest circumference"] },
  { id: "bust", labels: ["bust", "bust circumference"] },
  { id: "underbust", labels: ["underbust", "under bust"] },
  { id: "waist", labels: ["waist", "waist circumference"] },
  { id: "hip", labels: ["hip", "hips", "hip circumference"] },
  { id: "inseam", labels: ["inseam", "in seam", "inside leg"] },
  { id: "outseam", labels: ["outseam", "out seam"] },
  { id: "rise", labels: ["rise"] },
  { id: "thigh", labels: ["thigh"] },
  {
    id: "leg_opening",
    labels: ["leg opening", "leg opening circumference"],
  },
  { id: "neck", labels: ["neck"] },
  { id: "shoulder", labels: ["shoulder", "shoulder width"] },
  { id: "sleeve", labels: ["sleeve", "sleeve length"] },
  { id: "back_length", labels: ["back length"] },
  {
    id: "head_circumference",
    labels: ["head circumference", "head"],
  },
  { id: "foot_length", labels: ["foot length", "foot"] },
  { id: "foot_width", labels: ["foot width"] },
  {
    id: "hand_circumference",
    labels: ["hand circumference", "hand"],
  },
  { id: "glove_length", labels: ["glove length"] },
  { id: "height", labels: ["height"] },
  { id: "weight", labels: ["weight"] },
  { id: "age", labels: ["age"] },
  { id: "bag_width", labels: ["bag width"] },
  { id: "bag_height", labels: ["bag height"] },
  { id: "bag_depth", labels: ["bag depth"] },
  { id: "strap_drop", labels: ["strap drop"] },
  { id: "belt_length", labels: ["belt length"] },
  { id: "ring_diameter", labels: ["ring diameter", "diameter"] },
];

export const AMBIGUOUS_MEASUREMENT_LABELS: Readonly<
  Record<string, Partial<Record<SizeCategoryId, MeasurementTypeId>>>
> = {
  width: { footwear: "foot_width", bag: "bag_width" },
  height: { bag: "bag_height" },
  depth: { bag: "bag_depth" },
  length: { footwear: "foot_length" },
  drop: { bag: "strap_drop" },
};

export const MEASUREMENT_UNIT_ALIASES: readonly {
  unit: MeasurementUnit;
  labels: readonly string[];
}[] = [
  { unit: "cm", labels: ["cm", "cms", "centimeter", "centimeters"] },
  {
    unit: "in",
    labels: ["in", "inch", "inches", '"', "''"],
  },
  { unit: "mm", labels: ["mm", "mms", "millimeter", "millimeters"] },
  { unit: "kg", labels: ["kg", "kgs", "kilogram", "kilograms"] },
  { unit: "g", labels: ["g", "gr", "gram", "grams"] },
  { unit: "years", labels: ["years", "year", "yrs", "yr"] },
  { unit: "months", labels: ["months", "month", "mo", "mos"] },
];

function buildLookup(
  pairs: readonly (readonly [string, string])[]
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const [from, to] of pairs) {
    if (!map.has(from)) {
      map.set(from, to);
    }
  }
  return map;
}

export const ALPHA_ALIAS_LOOKUP: ReadonlyMap<string, string> =
  buildLookup(
    ALPHA_SIZE_ALIASES.flatMap((entry) =>
      entry.aliases.map(
        (alias) => [foldLabel(alias), entry.canonical] as const
      )
    )
  );

export const ONE_SIZE_LOOKUP: ReadonlySet<string> = new Set(
  ONE_SIZE_ALIASES.map(foldLabel)
);

export const SYSTEM_PREFIX_LOOKUP: ReadonlyMap<string, SizeSystemId> =
  new Map(
    SYSTEM_PREFIX_ALIASES.flatMap((entry) =>
      entry.labels.map(
        (label) => [foldLabel(label), entry.system] as const
      )
    )
  );

export const SYSTEM_PREFIX_MAX_WORDS = Math.max(
  ...SYSTEM_PREFIX_ALIASES.flatMap((entry) =>
    entry.labels.map((label) => foldLabel(label).split(" ").length)
  )
);

export const MEASUREMENT_LABEL_LOOKUP: ReadonlyMap<
  string,
  MeasurementTypeId
> = buildLookup(
  MEASUREMENT_LABEL_ALIASES.flatMap((entry) =>
    entry.labels.map(
      (label) => [foldLabel(label), entry.id] as const
    )
  )
) as ReadonlyMap<string, MeasurementTypeId>;

export const MEASUREMENT_UNIT_LOOKUP: ReadonlyMap<
  string,
  MeasurementUnit
> = buildLookup(
  MEASUREMENT_UNIT_ALIASES.flatMap((entry) =>
    entry.labels.map(
      (label) => [foldLabel(label), entry.unit] as const
    )
  )
) as ReadonlyMap<string, MeasurementUnit>;

export function isKnownAlphaCanonical(value: string): boolean {
  return ORDERED_ALPHA.includes(value);
}
