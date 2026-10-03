import {
  normalizeSourceSize,
  normalizeSourceSizeChart,
  sizeProductTypeToDiscipline,
  type SizeNormalizationContext,
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

const ctx = (
  partial: Partial<SizeNormalizationContext> &
    Pick<SizeNormalizationContext, "audience" | "productType">
): SizeNormalizationContext => partial;

/* --- A. exact --------------------------------------------------- */
{
  const m = normalizeSourceSize("M", ctx({ audience: "MEN", productType: "CLOTHING" }));
  check(
    "A1 canonical M resolves EXACT with the wire id",
    m.status === "RESOLVED" &&
      m.confidence === "EXACT" &&
      m.canonicalSizeOptionId === "MEN|clothing|INTERNATIONAL|M" &&
      m.canonicalValue === "M" &&
      m.displayLabel === "M" &&
      m.system === "INTERNATIONAL" &&
      m.systemPersisted === true,
    JSON.stringify(m)
  );

  const os = normalizeSourceSize(
    "One Size",
    ctx({ audience: "UNKNOWN", productType: "ACCESSORY" })
  );
  check(
    "A2 One Size resolves to the non-persisted ONE_SIZE system",
    os.status === "RESOLVED" &&
      os.canonicalSizeOptionId === "UNKNOWN|clothing|ONE_SIZE|One Size" &&
      os.system === "ONE_SIZE" &&
      os.systemPersisted === false &&
      os.confidence === "EXACT",
    JSON.stringify(os)
  );

  const eu = normalizeSourceSize(
    "42",
    ctx({ audience: "MEN", productType: "FOOTWEAR", system: "EU" })
  );
  check(
    "A3 context-resolved numeric EU 42 is NORMALIZED",
    eu.status === "RESOLVED" &&
      eu.confidence === "NORMALIZED" &&
      eu.canonicalSizeOptionId === "MEN|shoes|EU|42",
    JSON.stringify(eu)
  );
}

/* --- B. explicit display aliases -------------------------------- */
{
  const medium = normalizeSourceSize(
    "Medium",
    ctx({ audience: "MEN", productType: "CLOTHING" })
  );
  const med = normalizeSourceSize(
    "Med",
    ctx({ audience: "MEN", productType: "CLOTHING" })
  );
  check(
    "B1 Medium/Med resolve to canonical M via the alias registry",
    medium.canonicalValue === "M" &&
      medium.confidence === "NORMALIZED" &&
      med.canonicalValue === "M" &&
      med.confidence === "NORMALIZED",
    `${JSON.stringify(medium)} ${JSON.stringify(med)}`
  );

  const twoXl = normalizeSourceSize(
    "2XL",
    ctx({ audience: "WOMEN", productType: "CLOTHING" })
  );
  check(
    "B2 2XL reconciles to the single canonical XXL",
    twoXl.canonicalValue === "XXL" &&
      twoXl.canonicalSizeOptionId === "WOMEN|clothing|INTERNATIONAL|XXL" &&
      twoXl.confidence === "NORMALIZED",
    JSON.stringify(twoXl)
  );

  const threeXl = normalizeSourceSize(
    "3xl",
    ctx({ audience: "MEN", productType: "CLOTHING" })
  );
  check(
    "B3 3xl reconciles to the single canonical XXXL",
    threeXl.canonicalValue === "XXXL" && threeXl.confidence === "NORMALIZED",
    JSON.stringify(threeXl)
  );
}

/* --- C. whitespace / casing / source preservation ---------------- */
{
  const spaced = normalizeSourceSize(
    " M ",
    ctx({ audience: "MEN", productType: "CLOTHING" })
  );
  const lower = normalizeSourceSize(
    "m",
    ctx({ audience: "MEN", productType: "CLOTHING" })
  );
  check(
    "C1 whitespace and case fold to the same EXACT canonical M",
    spaced.status === "RESOLVED" &&
      spaced.confidence === "EXACT" &&
      spaced.canonicalValue === "M" &&
      lower.status === "RESOLVED" &&
      lower.confidence === "EXACT",
    `${JSON.stringify(spaced)} ${JSON.stringify(lower)}`
  );
  check(
    "C2 the raw source label is preserved verbatim",
    spaced.sourceLabel === " M " && lower.sourceLabel === "m",
    `${spaced.sourceLabel}|${lower.sourceLabel}`
  );
}

/* --- D. numeric semantics --------------------------------------- */
{
  const noSystem = normalizeSourceSize(
    "32",
    ctx({ audience: "MEN", productType: "CLOTHING" })
  );
  check(
    "D1 bare 32 without a system is INSUFFICIENT_CONTEXT",
    noSystem.status === "UNRESOLVED" &&
      noSystem.reason === "INSUFFICIENT_CONTEXT",
    JSON.stringify(noSystem)
  );

  const noProductType = normalizeSourceSize(
    "32",
    ctx({ audience: "MEN", productType: "UNKNOWN", system: "EU" })
  );
  check(
    "D2 numeric with UNKNOWN productType is INSUFFICIENT_CONTEXT",
    noProductType.status === "UNRESOLVED" &&
      noProductType.reason === "INSUFFICIENT_CONTEXT",
    JSON.stringify(noProductType)
  );

  const footwearWaist = normalizeSourceSize(
    "32",
    ctx({ audience: "MEN", productType: "FOOTWEAR", system: "WAIST_IN" })
  );
  check(
    "D3 waist system on footwear is CONTEXT_MISMATCH",
    footwearWaist.status === "UNRESOLVED" &&
      footwearWaist.reason === "CONTEXT_MISMATCH",
    JSON.stringify(footwearWaist)
  );

  const waist = normalizeSourceSize(
    "32",
    ctx({ audience: "MEN", productType: "CLOTHING", system: "WAIST_IN" })
  );
  check(
    "D4 waist numeric resolves as a non-persisted length system",
    waist.status === "RESOLVED" &&
      waist.system === "WAIST_IN" &&
      waist.systemPersisted === false,
    JSON.stringify(waist)
  );

  const decimal = normalizeSourceSize(
    "8,5",
    ctx({ audience: "MEN", productType: "FOOTWEAR", system: "EU" })
  );
  check(
    "D5 a decimal size keeps its source representation",
    decimal.status === "RESOLVED" && decimal.canonicalValue === "8,5",
    JSON.stringify(decimal)
  );
}

/* --- E. context disambiguation ---------------------------------- */
{
  const men = normalizeSourceSize(
    "M",
    ctx({ audience: "MEN", productType: "CLOTHING" })
  );
  const women = normalizeSourceSize(
    "M",
    ctx({ audience: "WOMEN", productType: "CLOTHING" })
  );
  const distinct =
    men.canonicalSizeOptionId !== women.canonicalSizeOptionId;
  check(
    "E1 the same M under MEN/WOMEN yields distinct identities",
    men.canonicalSizeOptionId === "MEN|clothing|INTERNATIONAL|M" &&
      women.canonicalSizeOptionId === "WOMEN|clothing|INTERNATIONAL|M" &&
      distinct,
    `${men.canonicalSizeOptionId} ${women.canonicalSizeOptionId}`
  );

  const footwear = normalizeSourceSize(
    "M",
    ctx({ audience: "MEN", productType: "FOOTWEAR" })
  );
  const euM = normalizeSourceSize(
    "M",
    ctx({ audience: "MEN", productType: "CLOTHING", system: "EU" })
  );
  const unknownAudience = normalizeSourceSize(
    "M",
    ctx({ audience: "UNKNOWN", productType: "CLOTHING" })
  );
  check(
    "E2 alpha on footwear / EU system is CONTEXT_MISMATCH",
    footwear.reason === "CONTEXT_MISMATCH" &&
      euM.reason === "CONTEXT_MISMATCH",
    `${footwear.reason} ${euM.reason}`
  );
  check(
    "E3 UNKNOWN audience is INSUFFICIENT_CONTEXT (no universal M)",
    unknownAudience.status === "UNRESOLVED" &&
      unknownAudience.reason === "INSUFFICIENT_CONTEXT",
    JSON.stringify(unknownAudience)
  );

  const adultAge = normalizeSourceSize(
    "M",
    ctx({
      audience: "MEN",
      productType: "CLOTHING",
      ageRange: { minMonths: 0, maxMonths: 24 },
    })
  );
  const kidsAge = normalizeSourceSize(
    "M",
    ctx({
      audience: "KIDS",
      productType: "CLOTHING",
      ageRange: { minMonths: 0, maxMonths: 24 },
    })
  );
  const badRange = normalizeSourceSize(
    "M",
    ctx({
      audience: "KIDS",
      productType: "CLOTHING",
      ageRange: { minMonths: 24, maxMonths: 12 },
    })
  );
  check(
    "E4 ageRange is KIDS-only and validated",
    adultAge.reason === "CONTEXT_MISMATCH" &&
      kidsAge.status === "RESOLVED" &&
      badRange.reason === "CONTEXT_MISMATCH",
    `${adultAge.reason} ${kidsAge.status} ${badRange.reason}`
  );
}

/* --- F. system prefixes + bra ----------------------------------- */
{
  const eu = normalizeSourceSize(
    "EU 42",
    ctx({ audience: "MEN", productType: "FOOTWEAR" })
  );
  const us = normalizeSourceSize(
    "US 8",
    ctx({ audience: "MEN", productType: "FOOTWEAR" })
  );
  check(
    "F1 a leading persisted system token sets the system",
    eu.system === "EU" && us.system === "US",
    `${eu.system} ${us.system}`
  );

  const conflict = normalizeSourceSize(
    "EU 42",
    ctx({ audience: "MEN", productType: "FOOTWEAR", system: "US" })
  );
  check(
    "F2 a prefix conflicting with the context system is refused",
    conflict.status === "UNRESOLVED" &&
      conflict.reason === "CONFLICTING_SYSTEM",
    JSON.stringify(conflict)
  );

  const jp = normalizeSourceSize(
    "JP 25",
    ctx({ audience: "MEN", productType: "FOOTWEAR" })
  );
  check(
    "F3 a source non-persisted system stays representable but unpersisted",
    jp.status === "RESOLVED" &&
      jp.system === "JP" &&
      jp.systemPersisted === false,
    JSON.stringify(jp)
  );

  const multi = normalizeSourceSize(
    "42 (US 9)",
    ctx({ audience: "MEN", productType: "FOOTWEAR", system: "EU" })
  );
  check(
    "F4 a multi-system value is not guessed",
    multi.status === "UNRESOLVED" && multi.reason === "UNKNOWN_VALUE",
    JSON.stringify(multi)
  );

  const bra = normalizeSourceSize(
    "36B",
    ctx({
      audience: "UNKNOWN",
      productType: "CLOTHING",
      category: "bra",
    })
  );
  check(
    "F5 a registered bra size resolves under category=bra",
    bra.status === "RESOLVED" &&
      bra.system === "BRA" &&
      bra.systemPersisted === false &&
      bra.canonicalSizeOptionId === "UNKNOWN|clothing|BRA|36B",
    JSON.stringify(bra)
  );

  const noCategory = normalizeSourceSize(
    "36B",
    ctx({ audience: "MEN", productType: "CLOTHING" })
  );
  check(
    "F6 a bra shape without category=bra is INSUFFICIENT_CONTEXT",
    noCategory.status === "UNRESOLVED" &&
      noCategory.reason === "INSUFFICIENT_CONTEXT",
    JSON.stringify(noCategory)
  );

  const badCup = normalizeSourceSize(
    "42R",
    ctx({ audience: "MEN", productType: "CLOTHING" })
  );
  check(
    "F7 42R (unregistered cup) is UNKNOWN_VALUE, never a bra",
    badCup.status === "UNRESOLVED" && badCup.reason === "UNKNOWN_VALUE",
    JSON.stringify(badCup)
  );
}

/* --- G. unknown / malformed / bad context ----------------------- */
{
  const cases: Array<[string, string, string]> = [
    ["Special Fit", "UNKNOWN_VALUE", "special fit"],
    ["Custom", "UNKNOWN_VALUE", "custom"],
    ["XXX", "UNKNOWN_VALUE", "xxx"],
    ["", "EMPTY_INPUT", "empty"],
    ["   ", "EMPTY_INPUT", "whitespace"],
    ["!!!", "MALFORMED_INPUT", "punctuation"],
  ];
  for (const [input, reason, label] of cases) {
    const result = normalizeSourceSize(
      input,
      ctx({ audience: "MEN", productType: "CLOTHING" })
    );
    check(
      `G1 ${label} -> ${reason}`,
      result.status === "UNRESOLVED" && result.reason === reason,
      JSON.stringify(result)
    );
  }

  const badSystem = normalizeSourceSize("42", {
    audience: "MEN",
    productType: "FOOTWEAR",
    system: "EURO" as unknown as SizeSystemId,
  });
  check(
    "G2 an invalid system is UNSUPPORTED_SYSTEM",
    badSystem.status === "UNRESOLVED" &&
      badSystem.reason === "UNSUPPORTED_SYSTEM",
    JSON.stringify(badSystem)
  );
}

/* --- H. wire-format regression (sizeIdentity compatibility) ------ */
{
  const samples: Array<{
    input: string;
    context: SizeNormalizationContext;
  }> = [
    {
      input: "Medium",
      context: ctx({ audience: "MEN", productType: "CLOTHING" }),
    },
    {
      input: "42",
      context: ctx({
        audience: "MEN",
        productType: "FOOTWEAR",
        system: "EU",
      }),
    },
    {
      input: "2XL",
      context: ctx({ audience: "WOMEN", productType: "CLOTHING" }),
    },
  ];
  let mismatch = "";
  for (const sample of samples) {
    const result = normalizeSourceSize(sample.input, sample.context);
    if (result.status !== "RESOLVED" || !result.canonicalSizeOptionId) {
      mismatch = `unresolved ${sample.input}`;
      break;
    }
    const legacy = sizeIdentity(
      result.audience,
      sizeProductTypeToDiscipline(result.productType),
      result.system,
      result.canonicalValue ?? ""
    );
    if (legacy !== result.canonicalSizeOptionId) {
      mismatch = `${legacy} !== ${result.canonicalSizeOptionId}`;
      break;
    }
  }
  check(
    "H1 canonical ids reproduce the existing sizeIdentity wire format",
    mismatch === "",
    mismatch
  );
  check(
    "H2 Medium under MEN/CLOTHING equals sizeIdentity(MEN,clothing,INTERNATIONAL,M)",
    normalizeSourceSize(
      "Medium",
      ctx({ audience: "MEN", productType: "CLOTHING" })
    ).canonicalSizeOptionId ===
      sizeIdentity("MEN", "clothing", "INTERNATIONAL", "M"),
    ""
  );
}

/* --- I. size chart normalization -------------------------------- */
{
  const clothing = normalizeSourceSizeChart(
    {
      columns: [{ label: "Chest" }, { label: "Waist" }],
      rows: [
        { sizeLabel: "M", values: [96, 80] },
        { sizeLabel: "Custom", values: [1, 2] },
      ],
    },
    ctx({ audience: "MEN", productType: "CLOTHING" })
  );
  check(
    "I1 chart columns resolve through the measurement registry",
    clothing.columns[0].measurement === "chest" &&
      clothing.columns[0].unit === "cm" &&
      clothing.columns[0].resolved === true &&
      clothing.columns[1].measurement === "waist",
    JSON.stringify(clothing.columns)
  );
  check(
    "I2 resolved rows carry the canonical id + raw measurements",
    clothing.rows[0].status === "RESOLVED" &&
      clothing.rows[0].canonicalSizeOptionId ===
        "MEN|clothing|INTERNATIONAL|M" &&
      JSON.stringify(clothing.rows[0].values.map((v) => v.number)) ===
        "[96,80]",
    JSON.stringify(clothing.rows[0])
  );
  check(
    "I3 an unresolved row stays explicit and is never attached",
    clothing.rows[1].status === "UNRESOLVED" &&
      clothing.rows[1].canonicalSizeOptionId === null &&
      clothing.unresolvedRowCount === 1 &&
      clothing.status === "partial",
    JSON.stringify(clothing.rows[1])
  );

  const bag = normalizeSourceSizeChart(
    {
      columns: [
        { label: "Width" },
        { label: "Height" },
        { label: "Depth" },
        { label: "Strap Drop" },
      ],
      rows: [{ sizeLabel: "One Size", values: [30, 40, 12, 55] }],
    },
    ctx({
      audience: "UNKNOWN",
      productType: "ACCESSORY",
      category: "bag",
    })
  );
  check(
    "I4 bag columns resolve dynamically (no universal Chest/Waist)",
    JSON.stringify(bag.columns.map((c) => c.measurement)) ===
      JSON.stringify(["bag_width", "bag_height", "bag_depth", "strap_drop"]),
    JSON.stringify(bag.columns.map((c) => c.measurement))
  );

  const inches = normalizeSourceSizeChart(
    {
      columns: [{ label: "Foot Length", unit: "in" }],
      rows: [{ sizeLabel: "42", values: [27] }],
    },
    ctx({
      audience: "MEN",
      productType: "FOOTWEAR",
      system: "EU",
    })
  );
  check(
    "I5 inches are preserved verbatim, never converted",
    inches.columns[0].unit === "in" &&
      inches.rows[0].values[0].number === 27 &&
      inches.rows[0].values[0].unit === "in" &&
      inches.columns[0].measurement === "foot_length",
    JSON.stringify(inches.rows[0].values[0])
  );

  const unknownColumn = normalizeSourceSizeChart(
    {
      columns: [{ label: "Mystery" }, { label: "Width" }],
      rows: [{ sizeLabel: "M", values: [1, 2] }],
    },
    ctx({ audience: "MEN", productType: "CLOTHING" })
  );
  check(
    "I6 unknown/ambiguous columns are explicit, not silently dropped",
    unknownColumn.columns[0].resolved === false &&
      unknownColumn.columns[0].reason === "UNKNOWN_VALUE" &&
      unknownColumn.columns[1].resolved === false &&
      unknownColumn.unresolvedColumnCount === 2 &&
      unknownColumn.status === "partial",
    JSON.stringify(unknownColumn.columns)
  );

  const chartSystem = normalizeSourceSizeChart(
    {
      system: "EU",
      columns: [{ label: "Foot Length" }],
      rows: [{ sizeLabel: "42", values: [27] }],
    },
    ctx({ audience: "MEN", productType: "FOOTWEAR" })
  );
  check(
    "I7 the chart system supplies the row context system",
    chartSystem.rows[0].status === "RESOLVED" &&
      chartSystem.rows[0].canonicalSizeOptionId === "MEN|shoes|EU|42" &&
      chartSystem.system === "EU",
    JSON.stringify(chartSystem.rows[0])
  );

  const noFabrication = normalizeSourceSizeChart(
    {
      columns: [{ label: "Chest" }],
      rows: [{ sizeLabel: "M", values: [null] }],
    },
    ctx({ audience: "MEN", productType: "CLOTHING" })
  );
  check(
    "I8 missing measurements stay null (no fabrication)",
    noFabrication.rows[0].values[0].number === null &&
      noFabrication.rows[0].values[0].raw === null,
    JSON.stringify(noFabrication.rows[0].values[0])
  );

  const empty = normalizeSourceSizeChart(
    { columns: [], rows: [] },
    ctx({ audience: "MEN", productType: "CLOTHING" })
  );
  check(
    "I9 an empty chart is missing, not available",
    empty.status === "missing",
    JSON.stringify(empty)
  );
}

console.log(
  `\nSize-domain normalization unit: ${passed} passed, ${failed} failed`
);
process.exit(failed === 0 ? 0 : 1);
