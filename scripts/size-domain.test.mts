import {
  MEASUREMENT_TYPES,
  SIZE_CATEGORIES,
  SIZE_SYSTEMS,
  canonicalSizeOptionId,
  disciplineToSizeProductType,
  isMeasurementTypeId,
  isSizeCategoryId,
  isSizeProductTypeId,
  isSizeSystemId,
  measurementType,
  sizeCategory,
  sizeProductTypeToDiscipline,
  sizeSystem,
  sizeSystemOrder,
  type MeasurementTypeId,
  type SizeCategoryId,
  type SizeSystemId,
} from "../src/lib/size-domain";
import { sizeIdentity } from "../src/lib/size-sections";

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

const ALL_SYSTEM_IDS: SizeSystemId[] = [
  "INTERNATIONAL",
  "EU",
  "US",
  "UK",
  "IT",
  "FR",
  "DE",
  "JP",
  "CM",
  "MONDO",
  "WAIST_IN",
  "WAIST_CM",
  "BRA",
  "ONE_SIZE",
  "UNKNOWN",
];

const ALL_CATEGORY_IDS: SizeCategoryId[] = [
  "clothing",
  "footwear",
  "bag",
  "belt",
  "hat",
  "glove",
  "socks",
  "bra",
  "one_size",
  "unknown",
];

const ALL_MEASUREMENT_IDS: MeasurementTypeId[] = [
  "chest",
  "bust",
  "underbust",
  "waist",
  "hip",
  "inseam",
  "outseam",
  "rise",
  "thigh",
  "leg_opening",
  "neck",
  "shoulder",
  "sleeve",
  "back_length",
  "head_circumference",
  "foot_length",
  "foot_width",
  "hand_circumference",
  "glove_length",
  "height",
  "weight",
  "age",
  "bag_width",
  "bag_height",
  "bag_depth",
  "strap_drop",
  "belt_length",
  "ring_diameter",
];

/* S1. persistence truth mirrors the Prisma SizeSystem enum exactly. */
{
  const expectedPersisted = [
    "INTERNATIONAL",
    "EU",
    "US",
    "UK",
    "IT",
    "FR",
    "UNKNOWN",
  ].sort();
  const actualPersisted = SIZE_SYSTEMS.filter((s) => s.persisted)
    .map((s) => s.id)
    .sort();
  check(
    "S1 persisted systems equal the Prisma SizeSystem enum set",
    JSON.stringify(actualPersisted) === JSON.stringify(expectedPersisted),
    `actual=${JSON.stringify(actualPersisted)}`
  );
  check(
    "S1 every non-persisted system is flagged false",
    SIZE_SYSTEMS.every(
      (s) => s.persisted === expectedPersisted.includes(s.id)
    ),
    JSON.stringify(SIZE_SYSTEMS.map((s) => [s.id, s.persisted]))
  );
}

/* S2. systems: complete, unique, ordered. */
{
  const ids = SIZE_SYSTEMS.map((s) => s.id);
  check(
    "S2 systems registry has no duplicate ids",
    new Set(ids).size === ids.length,
    JSON.stringify(ids)
  );
  check(
    "S2 systems registry covers every SizeSystemId",
    ALL_SYSTEM_IDS.length === SIZE_SYSTEMS.length &&
      ALL_SYSTEM_IDS.every((id) => sizeSystem(id)?.id === id),
    `registry=${SIZE_SYSTEMS.length} union=${ALL_SYSTEM_IDS.length}`
  );
  const orders = SIZE_SYSTEMS.map((s) => s.order);
  check(
    "S2 system order values are unique and ascending",
    new Set(orders).size === orders.length &&
      orders.every((order, index) => index === 0 || order > orders[index - 1]),
    JSON.stringify(orders)
  );
  check(
    "S2 sizeSystemOrder sorts EU before US before IT",
    sizeSystemOrder("EU", "US") < 0 &&
      sizeSystemOrder("US", "IT") < 0,
    `eu/us=${sizeSystemOrder("EU", "US")}`
  );
}

/* S3. categories: complete, unique, valid links to measurements. */
{
  const ids = SIZE_CATEGORIES.map((c) => c.id);
  check(
    "S3 categories registry has no duplicate ids",
    new Set(ids).size === ids.length,
    JSON.stringify(ids)
  );
  check(
    "S3 categories registry covers every SizeCategoryId",
    ALL_CATEGORY_IDS.length === SIZE_CATEGORIES.length &&
      ALL_CATEGORY_IDS.every((id) => sizeCategory(id)?.id === id),
    `registry=${SIZE_CATEGORIES.length} union=${ALL_CATEGORY_IDS.length}`
  );
  check(
    "S3 every category productType is a valid SizeProductTypeId",
    SIZE_CATEGORIES.every((c) => isSizeProductTypeId(c.productType)),
    JSON.stringify(SIZE_CATEGORIES.map((c) => [c.id, c.productType]))
  );
  let badMeasurement = "";
  for (const category of SIZE_CATEGORIES) {
    for (const measurement of category.measurements) {
      if (!measurementType(measurement)) {
        badMeasurement = `${category.id} -> ${measurement}`;
        break;
      }
    }
    if (badMeasurement) break;
  }
  check(
    "S3 every category measurement exists in the measurement registry",
    badMeasurement === "",
    badMeasurement
  );
  check(
    "S3 bag category carries the four bag dimensions",
    JSON.stringify(sizeCategory("bag")?.measurements) ===
      JSON.stringify(["bag_width", "bag_height", "bag_depth", "strap_drop"]),
    JSON.stringify(sizeCategory("bag")?.measurements)
  );
}

/* S4. measurements: complete and unique. */
{
  const ids = MEASUREMENT_TYPES.map((m) => m.id);
  check(
    "S4 measurement registry has no duplicate ids",
    new Set(ids).size === ids.length,
    JSON.stringify(ids)
  );
  check(
    "S4 measurement registry covers every MeasurementTypeId",
    ALL_MEASUREMENT_IDS.length === MEASUREMENT_TYPES.length &&
      ALL_MEASUREMENT_IDS.every((id) => measurementType(id)?.id === id),
    `registry=${MEASUREMENT_TYPES.length} union=${ALL_MEASUREMENT_IDS.length}`
  );
  const VALID_UNITS = ["cm", "mm", "in", "kg", "g", "years", "months"];
  check(
    "S4 every measurement unit is a declared MeasurementUnit",
    MEASUREMENT_TYPES.every((m) => VALID_UNITS.includes(m.unit)),
    JSON.stringify(MEASUREMENT_TYPES.map((m) => [m.id, m.unit]))
  );
}

/* S5. guards reject near-miss casing / unknown values. */
{
  check(
    "S5 isSizeSystemId accepts EU and rejects eu / EURO",
    isSizeSystemId("EU") && !isSizeSystemId("eu") && !isSizeSystemId("EURO"),
    ""
  );
  check(
    "S5 isSizeCategoryId accepts clothing and rejects Clothing",
    isSizeCategoryId("clothing") && !isSizeCategoryId("Clothing"),
    ""
  );
  check(
    "S5 isMeasurementTypeId accepts waist and rejects Waist",
    isMeasurementTypeId("waist") && !isMeasurementTypeId("Waist"),
    ""
  );
}

/* S6. bridges preserve the existing wire identity. */
{
  check(
    "S6 FOOTWEAR <-> shoes round-trips",
    sizeProductTypeToDiscipline("FOOTWEAR") === "shoes" &&
      disciplineToSizeProductType("shoes") === "FOOTWEAR",
    ""
  );
  check(
    "S6 CLOTHING and non-footwear map onto the clothing discipline",
    sizeProductTypeToDiscipline("CLOTHING") === "clothing" &&
      sizeProductTypeToDiscipline("ACCESSORY") === "clothing" &&
      disciplineToSizeProductType("clothing") === "CLOTHING",
    ""
  );

  const samples: Array<{
    audience: "MEN" | "WOMEN" | "KIDS" | "UNISEX";
    productType: "CLOTHING" | "FOOTWEAR";
    system: SizeSystemId;
    value: string;
  }> = [
    { audience: "MEN", productType: "FOOTWEAR", system: "EU", value: "42" },
    { audience: "WOMEN", productType: "FOOTWEAR", system: "US", value: "8" },
    { audience: "KIDS", productType: "CLOTHING", system: "INTERNATIONAL", value: "M" },
  ];
  let mismatch = "";
  for (const sample of samples) {
    const canonical = canonicalSizeOptionId({
      context: {
        audience: sample.audience,
        productType: sample.productType,
      },
      system: sample.system,
      value: sample.value,
    });
    const legacy = sizeIdentity(
      sample.audience,
      sizeProductTypeToDiscipline(sample.productType),
      sample.system,
      sample.value
    );
    if (canonical !== legacy) {
      mismatch = `${canonical} !== ${legacy}`;
      break;
    }
  }
  check(
    "S6 canonicalSizeOptionId matches the existing sizeIdentity wire format",
    mismatch === "",
    mismatch
  );
  check(
    "S6 canonicalSizeOptionId serializes audience|discipline|system|value",
    canonicalSizeOptionId({
      context: { audience: "MEN", productType: "FOOTWEAR" },
      system: "EU",
      value: "42",
    }) === "MEN|shoes|EU|42",
    canonicalSizeOptionId({
      context: { audience: "MEN", productType: "FOOTWEAR" },
      system: "EU",
      value: "42",
    })
  );
}

/* S7. domain has no hardcoded size values (identity only, no ranges). */
{
  const hasSizeValues = [
    ...SIZE_SYSTEMS,
    ...SIZE_CATEGORIES,
    ...MEASUREMENT_TYPES,
  ].some((entry) =>
    Object.values(entry).some(
      (value) =>
        typeof value === "string" &&
        /^(XXS|XS|S|M|L|XL|2XL|3XL|XXL|XXXL|\d+(\.\d+)?)$/.test(value)
    )
  );
  check(
    "S7 registries carry no hardcoded size values",
    !hasSizeValues,
    ""
  );
}

console.log(`\nSize-domain unit: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
