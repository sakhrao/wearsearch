import type { Discipline } from "../facets";
import type {
  MeasurementTypeId,
  MeasurementUnit,
  SizeAudienceId,
  SizeCategoryId,
  SizeProductTypeId,
  SizeSystemId,
} from "./types";

export type SizeSystemKind =
  | "alpha"
  | "footwear"
  | "length"
  | "circumference"
  | "one_size"
  | "unknown";

export type SizeSystemMeta = {
  id: SizeSystemId;
  label: string;
  kind: SizeSystemKind;
  persisted: boolean;
  order: number;
};

export const SIZE_SYSTEMS: readonly SizeSystemMeta[] = [
  { id: "INTERNATIONAL", label: "International", kind: "alpha", persisted: true, order: 0 },
  { id: "EU", label: "EU", kind: "footwear", persisted: true, order: 1 },
  { id: "US", label: "US", kind: "footwear", persisted: true, order: 2 },
  { id: "UK", label: "UK", kind: "footwear", persisted: true, order: 3 },
  { id: "IT", label: "IT", kind: "footwear", persisted: true, order: 4 },
  { id: "FR", label: "FR", kind: "footwear", persisted: true, order: 5 },
  { id: "DE", label: "DE", kind: "footwear", persisted: false, order: 6 },
  { id: "JP", label: "JP", kind: "footwear", persisted: false, order: 7 },
  { id: "CM", label: "CM", kind: "length", persisted: false, order: 8 },
  { id: "MONDO", label: "Mondopoint", kind: "length", persisted: false, order: 9 },
  { id: "WAIST_IN", label: "Waist (in)", kind: "length", persisted: false, order: 10 },
  { id: "WAIST_CM", label: "Waist (cm)", kind: "length", persisted: false, order: 11 },
  { id: "BRA", label: "Bra", kind: "circumference", persisted: false, order: 12 },
  { id: "ONE_SIZE", label: "One Size", kind: "one_size", persisted: false, order: 13 },
  { id: "UNKNOWN", label: "Unknown", kind: "unknown", persisted: true, order: 14 },
];

export type SizeCategoryMeta = {
  id: SizeCategoryId;
  label: string;
  productType: SizeProductTypeId;
  measurements: readonly MeasurementTypeId[];
};

export const SIZE_CATEGORIES: readonly SizeCategoryMeta[] = [
  {
    id: "clothing",
    label: "Clothing",
    productType: "CLOTHING",
    measurements: [
      "chest",
      "bust",
      "underbust",
      "waist",
      "hip",
      "inseam",
      "sleeve",
      "shoulder",
      "neck",
      "back_length",
    ],
  },
  {
    id: "footwear",
    label: "Footwear",
    productType: "FOOTWEAR",
    measurements: ["foot_length", "foot_width"],
  },
  {
    id: "bra",
    label: "Bra",
    productType: "CLOTHING",
    measurements: ["bust", "underbust", "waist"],
  },
  {
    id: "belt",
    label: "Belt",
    productType: "ACCESSORY",
    measurements: ["belt_length", "waist"],
  },
  {
    id: "hat",
    label: "Hat",
    productType: "HEADWEAR",
    measurements: ["head_circumference"],
  },
  {
    id: "glove",
    label: "Glove",
    productType: "ACCESSORY",
    measurements: ["hand_circumference", "glove_length"],
  },
  {
    id: "socks",
    label: "Socks",
    productType: "ACCESSORY",
    measurements: ["foot_length"],
  },
  {
    id: "bag",
    label: "Bag",
    productType: "ACCESSORY",
    measurements: ["bag_width", "bag_height", "bag_depth", "strap_drop"],
  },
  {
    id: "one_size",
    label: "One Size",
    productType: "UNKNOWN",
    measurements: [],
  },
  {
    id: "unknown",
    label: "Unknown",
    productType: "UNKNOWN",
    measurements: [],
  },
];

export type MeasurementTypeMeta = {
  id: MeasurementTypeId;
  label: string;
  unit: MeasurementUnit;
};

export const MEASUREMENT_TYPES: readonly MeasurementTypeMeta[] = [
  { id: "chest", label: "Chest", unit: "cm" },
  { id: "bust", label: "Bust", unit: "cm" },
  { id: "underbust", label: "Underbust", unit: "cm" },
  { id: "waist", label: "Waist", unit: "cm" },
  { id: "hip", label: "Hip", unit: "cm" },
  { id: "inseam", label: "Inseam", unit: "cm" },
  { id: "outseam", label: "Outseam", unit: "cm" },
  { id: "rise", label: "Rise", unit: "cm" },
  { id: "thigh", label: "Thigh", unit: "cm" },
  { id: "leg_opening", label: "Leg Opening", unit: "cm" },
  { id: "neck", label: "Neck", unit: "cm" },
  { id: "shoulder", label: "Shoulder", unit: "cm" },
  { id: "sleeve", label: "Sleeve", unit: "cm" },
  { id: "back_length", label: "Back Length", unit: "cm" },
  { id: "head_circumference", label: "Head Circumference", unit: "cm" },
  { id: "foot_length", label: "Foot Length", unit: "cm" },
  { id: "foot_width", label: "Foot Width", unit: "cm" },
  { id: "hand_circumference", label: "Hand Circumference", unit: "cm" },
  { id: "glove_length", label: "Glove Length", unit: "cm" },
  { id: "height", label: "Height", unit: "cm" },
  { id: "weight", label: "Weight", unit: "kg" },
  { id: "age", label: "Age", unit: "years" },
  { id: "bag_width", label: "Width", unit: "cm" },
  { id: "bag_height", label: "Height", unit: "cm" },
  { id: "bag_depth", label: "Depth", unit: "cm" },
  { id: "strap_drop", label: "Strap Drop", unit: "cm" },
  { id: "belt_length", label: "Belt Length", unit: "cm" },
  { id: "ring_diameter", label: "Ring Diameter", unit: "mm" },
];

const SIZE_SYSTEM_IDS = new Set<string>(
  SIZE_SYSTEMS.map((entry) => entry.id)
);
const SIZE_AUDIENCE_IDS = new Set<string>([
  "MEN",
  "WOMEN",
  "KIDS",
  "UNISEX",
  "UNKNOWN",
]);
const SIZE_PRODUCT_TYPE_IDS = new Set<string>([
  "CLOTHING",
  "FOOTWEAR",
  "ACCESSORY",
  "HEADWEAR",
  "UNKNOWN",
]);
const SIZE_CATEGORY_IDS = new Set<string>(
  SIZE_CATEGORIES.map((entry) => entry.id)
);
const MEASUREMENT_TYPE_IDS = new Set<string>(
  MEASUREMENT_TYPES.map((entry) => entry.id)
);

export function isSizeSystemId(value: string): value is SizeSystemId {
  return SIZE_SYSTEM_IDS.has(value);
}

export function isSizeAudienceId(value: string): value is SizeAudienceId {
  return SIZE_AUDIENCE_IDS.has(value);
}

export function isSizeProductTypeId(
  value: string
): value is SizeProductTypeId {
  return SIZE_PRODUCT_TYPE_IDS.has(value);
}

export function isSizeCategoryId(value: string): value is SizeCategoryId {
  return SIZE_CATEGORY_IDS.has(value);
}

export function isMeasurementTypeId(
  value: string
): value is MeasurementTypeId {
  return MEASUREMENT_TYPE_IDS.has(value);
}

export function sizeSystem(id: SizeSystemId): SizeSystemMeta | null {
  return SIZE_SYSTEMS.find((entry) => entry.id === id) ?? null;
}

export function sizeCategory(id: SizeCategoryId): SizeCategoryMeta | null {
  return SIZE_CATEGORIES.find((entry) => entry.id === id) ?? null;
}

export function measurementType(
  id: MeasurementTypeId
): MeasurementTypeMeta | null {
  return MEASUREMENT_TYPES.find((entry) => entry.id === id) ?? null;
}

export function sizeSystemOrder(a: string, b: string): number {
  const ia = sizeSystem(a as SizeSystemId)?.order ?? SIZE_SYSTEMS.length;
  const ib = sizeSystem(b as SizeSystemId)?.order ?? SIZE_SYSTEMS.length;
  return ia - ib || a.localeCompare(b);
}

export function sizeProductTypeToDiscipline(
  productType: SizeProductTypeId
): Discipline {
  return productType === "FOOTWEAR" ? "shoes" : "clothing";
}

export function disciplineToSizeProductType(
  discipline: Discipline
): SizeProductTypeId {
  return discipline === "shoes" ? "FOOTWEAR" : "CLOTHING";
}

export function canonicalSizeOptionId(option: {
  context: { audience: SizeAudienceId; productType: SizeProductTypeId };
  system: SizeSystemId;
  value: string;
}): string {
  return [
    option.context.audience,
    sizeProductTypeToDiscipline(option.context.productType),
    option.system,
    option.value,
  ].join("|");
}
