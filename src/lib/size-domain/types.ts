export type SizeSystemId =
  | "INTERNATIONAL"
  | "EU"
  | "US"
  | "UK"
  | "IT"
  | "FR"
  | "DE"
  | "JP"
  | "CM"
  | "MONDO"
  | "WAIST_IN"
  | "WAIST_CM"
  | "BRA"
  | "ONE_SIZE"
  | "UNKNOWN";

export type SizeAudienceId =
  | "MEN"
  | "WOMEN"
  | "KIDS"
  | "UNISEX"
  | "UNKNOWN";

export type SizeProductTypeId =
  | "CLOTHING"
  | "FOOTWEAR"
  | "ACCESSORY"
  | "HEADWEAR"
  | "UNKNOWN";

export type SizeCategoryId =
  | "clothing"
  | "footwear"
  | "bag"
  | "belt"
  | "hat"
  | "glove"
  | "socks"
  | "bra"
  | "one_size"
  | "unknown";

export type MeasurementTypeId =
  | "chest"
  | "bust"
  | "underbust"
  | "waist"
  | "hip"
  | "inseam"
  | "outseam"
  | "rise"
  | "thigh"
  | "leg_opening"
  | "neck"
  | "shoulder"
  | "sleeve"
  | "back_length"
  | "head_circumference"
  | "foot_length"
  | "foot_width"
  | "hand_circumference"
  | "glove_length"
  | "height"
  | "weight"
  | "age"
  | "bag_width"
  | "bag_height"
  | "bag_depth"
  | "strap_drop"
  | "belt_length"
  | "ring_diameter";

export type MeasurementUnit =
  | "cm"
  | "mm"
  | "in"
  | "kg"
  | "g"
  | "years"
  | "months";

export type SizeAgeRange = {
  minMonths: number | null;
  maxMonths: number | null;
};

export type SizeContext = {
  audience: SizeAudienceId;
  productType: SizeProductTypeId;
  ageRange: SizeAgeRange | null;
};

export type SizeOption = {
  id: string;
  category: SizeCategoryId;
  context: SizeContext;
  system: SizeSystemId;
  value: string;
  displayValue: string;
  numericValue: number | null;
  ordinal: number | null;
  aliases: string[];
};

export type SizeChartColumn = {
  id: string;
  measurement: MeasurementTypeId;
  label: string;
  unit: MeasurementUnit;
  order: number;
};

/* A measurement stated by the source as a range (e.g. "Chest 100–104 cm").
   Stored as-is; never converted or interpolated. */
export type SizeChartRange = {
  min: number;
  max: number;
};

/* The value of one measurement cell, exactly as derived from the source:
   an exact number, a source range, the raw source string when it is neither
   (preserved verbatim), or null when the source provides no measurement.
   Null is never filled with a guess. */
export type SizeChartCellValue = number | SizeChartRange | string | null;

export type SizeChartRow = {
  id: string;
  sizeOptionId: string | null;
  sizeLabel: string;
  values: Record<string, SizeChartCellValue>;
};

export type SizeChartScope =
  | { kind: "product"; productId: string }
  | { kind: "brand"; brandId: string; category: SizeCategoryId }
  | { kind: "category"; category: SizeCategoryId }
  | { kind: "conversion"; from: SizeSystemId; to: SizeSystemId };

export type SizeChartPriority = "product" | "brand" | "category";

export type SizeChartStatus = "available" | "partial" | "missing";

export type SizeChart = {
  id: string;
  scope: SizeChartScope;
  priority: SizeChartPriority;
  version: number;
  context: SizeContext;
  /* Optional explicit size-system metadata. When present the resolver
     refuses to apply the chart to a product that only carries other
     systems (e.g. a US chart never silently serves an EU product). */
  system?: SizeSystemId | null;
  columns: SizeChartColumn[];
  rows: SizeChartRow[];
  status: SizeChartStatus;
  source: string;
  updatedAt: string;
};
