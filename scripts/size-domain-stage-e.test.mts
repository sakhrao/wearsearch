import {
  APPROVED_SIZE_SYSTEM_POLICIES,
  SIZE_SYSTEM_POLICY_CANDIDATES,
  canonicalFieldsFromProjection,
  integrateProductSizes,
  isBackfilled,
  isDowngrade,
  planSizeBackfill,
  projectProductSizes,
  readCanonicalOrLegacySize,
  sizeProductTypeToDiscipline,
  sizePersistenceTargetKey,
  summarizeSizeProjections,
  type ProductSizeInput,
  type SizeCanonicalFields,
  type SizePersistenceEntry,
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

const emptyFields = (): SizeCanonicalFields => ({
  canonicalSizeOptionId: null,
  sizeResolutionStatus: null,
  sizeResolutionProvenance: null,
  sizeResolutionSystem: null,
});

function variantInput(over: {
  categoryName?: string;
  gender?: string | null;
  sourceName?: string;
  variants: Array<{
    id: string;
    value: string;
    system?: string | null;
    productType?: string | null;
    audience?: string | null;
    availability?: string;
  }>;
}): ProductSizeInput {
  return {
    productId: "p",
    context: {
      gender: over.gender ?? "WOMEN",
      categoryName: over.categoryName ?? "Dresses",
      sourceName: over.sourceName ?? "Livostyle Open Catalog",
    },
    variants: over.variants.map((v) => ({
      variantId: v.id,
      size: {
        value: v.value,
        system: v.system === undefined ? "UNKNOWN" : v.system,
        productType: v.productType ?? "UNKNOWN",
        audience: v.audience ?? "UNKNOWN",
      },
      availability: v.availability ?? "AVAILABLE",
    })),
  };
}

function observe(input: ProductSizeInput) {
  const observations = integrateProductSizes(input);
  const projections = projectProductSizes(
    observations,
    APPROVED_SIZE_SYSTEM_POLICIES
  );
  return observations.map((observation, i) => ({
    observation,
    projection: projections[i],
  }));
}

function toEntry(
  observation: ReturnType<typeof integrateProductSizes>[number],
  projection: ReturnType<typeof projectProductSizes>[number],
  existing: SizeCanonicalFields = emptyFields()
): SizePersistenceEntry {
  const target =
    observation.origin === "variant"
      ? { kind: "variant" as const, variantId: observation.variantId! }
      : {
          kind: "offerVariant" as const,
          offerId: observation.offerId!,
          variantKey: observation.offerVariantKey!,
        };
  return { target, existing, projection };
}

/* 1. resolved legacy size -> canonical persistence */
{
  const [{ observation, projection }] = observe(
    variantInput({
      variants: [
        {
          id: "v1",
          value: "M",
          system: "INTERNATIONAL",
          productType: "CLOTHING",
          audience: "WOMEN",
        },
      ],
    })
  );
  const fields = canonicalFieldsFromProjection(projection);
  check(
    "E1 resolved legacy size persists a canonical identity",
    fields.sizeResolutionStatus === "RESOLVED" &&
      fields.sizeResolutionProvenance === "EXPLICIT" &&
      fields.canonicalSizeOptionId === "WOMEN|clothing|INTERNATIONAL|M" &&
      fields.sizeResolutionSystem === "INTERNATIONAL",
    JSON.stringify(fields)
  );
  check(
    "E1b the planned write targets the variant row",
    sizePersistenceTargetKey({ kind: "variant", variantId: "v1" }) ===
      "variant:v1",
    observation.variantId ?? ""
  );
}

/* 2. alias -> canonical persistence */
{
  const [{ projection }] = observe(
    variantInput({
      variants: [
        {
          id: "v1",
          value: "Medium",
          system: "INTERNATIONAL",
          productType: "CLOTHING",
          audience: "WOMEN",
        },
      ],
    })
  );
  const fields = canonicalFieldsFromProjection(projection);
  check(
    "E2 an alias resolves to its canonical value",
    fields.sizeResolutionStatus === "RESOLVED" &&
      fields.canonicalSizeOptionId === "WOMEN|clothing|INTERNATIONAL|M" &&
      projection.canonicalValue === "M",
    JSON.stringify(fields)
  );
}

/* 3. explicit footwear system */
{
  const [{ projection }] = observe(
    variantInput({
      categoryName: "Heels",
      variants: [
        {
          id: "v1",
          value: "8",
          system: "US",
          productType: "FOOTWEAR",
          audience: "WOMEN",
        },
      ],
    })
  );
  const fields = canonicalFieldsFromProjection(projection);
  check(
    "E3 explicit stored footwear system persists as EXPLICIT US",
    fields.canonicalSizeOptionId === "WOMEN|shoes|US|8" &&
      fields.sizeResolutionProvenance === "EXPLICIT" &&
      fields.sizeResolutionSystem === "US",
    JSON.stringify(fields)
  );
}

/* 4. unresolved bare footwear numeric */
{
  const [{ projection }] = observe(
    variantInput({
      categoryName: "Heels",
      variants: [{ id: "v1", value: "8" }],
    })
  );
  const fields = canonicalFieldsFromProjection(projection);
  check(
    "E4 a bare footwear numeric persists as UNRESOLVED with no identity",
    fields.sizeResolutionStatus === "UNRESOLVED" &&
      fields.sizeResolutionProvenance === "UNRESOLVED" &&
      fields.canonicalSizeOptionId === null &&
      fields.sizeResolutionSystem === null,
    JSON.stringify(fields)
  );
}

/* 5. multiple variants */
{
  const rows = observe(
    variantInput({
      categoryName: "Heels",
      variants: [
        {
          id: "v1",
          value: "8",
          system: "US",
          productType: "FOOTWEAR",
          audience: "WOMEN",
        },
        {
          id: "v2",
          value: "9",
          system: "US",
          productType: "FOOTWEAR",
          audience: "WOMEN",
        },
      ],
    })
  );
  const { report } = planSizeBackfill(rows.map((r) => toEntry(r.observation, r.projection)));
  check(
    "E5 multiple variants each persist independently",
    report.total === 2 && report.resolved === 2 && report.changed === 2,
    JSON.stringify(report)
  );
}

/* 6. multiple offers */
{
  const input: ProductSizeInput = {
    productId: "p",
    context: { gender: "WOMEN", categoryName: "Heels", sourceName: "eBay" },
    offerVariants: [
      {
        offerId: "o1",
        variantKey: "sku-1",
        sourceName: "eBay",
        sizeValue: "8",
        sizeSystem: "US",
        sizeProductType: "FOOTWEAR",
        sizeAudience: "WOMEN",
        availability: "AVAILABLE",
      },
      {
        offerId: "o2",
        variantKey: "sku-2",
        sourceName: "eBay",
        sizeValue: "9",
        sizeSystem: "US",
        sizeProductType: "FOOTWEAR",
        sizeAudience: "WOMEN",
        availability: "OUT_OF_STOCK",
      },
    ],
  };
  const rows = observe(input);
  const { changes } = planSizeBackfill(
    rows.map((r) => toEntry(r.observation, r.projection))
  );
  check(
    "E6 offer variants persist at the offer-variant grain",
    changes.length === 2 &&
      changes[0].target.kind === "offerVariant" &&
      sizePersistenceTargetKey(changes[1].target) ===
        "offerVariant:o2::sku-2",
    JSON.stringify(changes.map((c) => c.target))
  );
}

/* 7. source label preservation */
{
  const input = variantInput({
    variants: [
      {
        id: "v1",
        value: "Medium",
        system: "INTERNATIONAL",
        productType: "CLOTHING",
        audience: "WOMEN",
      },
    ],
  });
  const [{ observation, projection }] = observe(input);
  const fields = canonicalFieldsFromProjection(projection);
  const read = readCanonicalOrLegacySize({
    canonical: fields,
    legacy: { sourceSizeLabel: observation.sourceSizeLabel },
  });
  check(
    "E7 the verbatim source label is preserved and never overwritten",
    projection.sourceSizeLabel === "Medium" &&
      read.sourceSizeLabel === "Medium" &&
      !JSON.stringify(fields).includes("Medium"),
    JSON.stringify(fields)
  );
}

/* 8. availability preservation */
{
  const [{ observation, projection }] = observe(
    variantInput({
      categoryName: "Heels",
      variants: [
        {
          id: "v1",
          value: "8",
          system: "US",
          productType: "FOOTWEAR",
          audience: "WOMEN",
          availability: "OUT_OF_STOCK",
        },
      ],
    })
  );
  const fields = canonicalFieldsFromProjection(projection);
  check(
    "E8 availability stays independent of the canonical fields",
    Object.keys(fields).sort().join(",") ===
      "canonicalSizeOptionId,sizeResolutionProvenance,sizeResolutionStatus,sizeResolutionSystem" &&
      observation.availability === "OUT_OF_STOCK" &&
      observation.available === false,
    Object.keys(fields).join(",")
  );
}

/* 9. explicit provenance */
{
  const [{ projection }] = observe(
    variantInput({
      variants: [
        {
          id: "v1",
          value: "M",
          system: "INTERNATIONAL",
          productType: "CLOTHING",
          audience: "WOMEN",
        },
      ],
    })
  );
  check(
    "E9 explicit provenance is persisted as EXPLICIT",
    canonicalFieldsFromProjection(projection).sizeResolutionProvenance ===
      "EXPLICIT"
  );
}

/* 10. unresolved provenance */
{
  const [{ projection }] = observe(
    variantInput({
      categoryName: "Heels",
      variants: [{ id: "v1", value: "8" }],
    })
  );
  check(
    "E10 unresolved provenance is persisted as UNRESOLVED",
    canonicalFieldsFromProjection(projection).sizeResolutionProvenance ===
      "UNRESOLVED"
  );
}

/* 11. existing sizeIdentity compatibility */
{
  const [{ observation, projection }] = observe(
    variantInput({
      variants: [
        {
          id: "v1",
          value: "M",
          system: "INTERNATIONAL",
          productType: "CLOTHING",
          audience: "WOMEN",
        },
      ],
    })
  );
  const fields = canonicalFieldsFromProjection(projection);
  const n = observation.normalization;
  const legacy = sizeIdentity(
    n.audience,
    sizeProductTypeToDiscipline(n.productType),
    n.system,
    n.canonicalValue ?? ""
  );
  check(
    "E11 the persisted id equals the existing sizeIdentity wire format",
    fields.canonicalSizeOptionId === legacy,
    `${fields.canonicalSizeOptionId} !== ${legacy}`
  );
}

/* 12. idempotent backfill */
{
  const rows = observe(
    variantInput({
      categoryName: "Heels",
      variants: [
        {
          id: "v1",
          value: "8",
          system: "US",
          productType: "FOOTWEAR",
          audience: "WOMEN",
        },
        { id: "v2", value: "9" },
      ],
    })
  );
  const first = planSizeBackfill(
    rows.map((r) => toEntry(r.observation, r.projection))
  );
  const second = planSizeBackfill(
    rows.map((r, i) => toEntry(r.observation, r.projection, first.changes[i]?.fields ?? emptyFields()))
  );
  check(
    "E12 re-running the backfill produces no changes",
    first.changes.length === 2 &&
      second.changes.length === 0 &&
      second.report.unchanged === 2,
    JSON.stringify(second.report)
  );
}

/* 13. legacy-read fallback */
{
  const fallback = readCanonicalOrLegacySize({
    canonical: emptyFields(),
    legacy: { sourceSizeLabel: "8", legacySystem: "UNKNOWN" },
  });
  const canonical = readCanonicalOrLegacySize({
    canonical: {
      canonicalSizeOptionId: "WOMEN|shoes|US|8",
      sizeResolutionStatus: "RESOLVED",
      sizeResolutionProvenance: "EXPLICIT",
      sizeResolutionSystem: "US",
    },
    legacy: { sourceSizeLabel: "8", legacySystem: "UNKNOWN" },
  });
  check(
    "E13 unbackfilled rows fall back to the legacy representation",
    fallback.usedLegacyFallback === true &&
      fallback.system === "UNKNOWN" &&
      fallback.canonicalSizeOptionId === null &&
      canonical.usedLegacyFallback === false &&
      canonical.canonicalSizeOptionId === "WOMEN|shoes|US|8",
    JSON.stringify({ fallback, canonical })
  );
}

/* 14. null canonical fields */
{
  const [{ projection }] = observe(
    variantInput({
      categoryName: "Heels",
      variants: [{ id: "v1", value: "8" }],
    })
  );
  const fields = canonicalFieldsFromProjection(projection);
  check(
    "E14 unresolved rows keep null canonical fields and are not backfilled from NULL",
    fields.canonicalSizeOptionId === null &&
      fields.sizeResolutionSystem === null &&
      isBackfilled(fields) === true &&
      isBackfilled(emptyFields()) === false,
    JSON.stringify(fields)
  );
}

/* 15. no Livostyle inference */
{
  const input = variantInput({
    categoryName: "Heels",
    variants: [
      { id: "v1", value: "6" },
      { id: "v2", value: "7.5" },
      { id: "v3", value: "9" },
    ],
  });
  const observations = integrateProductSizes(input);
  const withApproved = projectProductSizes(
    observations,
    APPROVED_SIZE_SYSTEM_POLICIES
  );
  const summary = summarizeSizeProjections(withApproved);
  check(
    "E15 the Livostyle candidate is never applied in production",
    APPROVED_SIZE_SYSTEM_POLICIES.length === 0 &&
      SIZE_SYSTEM_POLICY_CANDIDATES.length === 1 &&
      summary.inferred === 0 &&
      withApproved.every(
        (p) =>
          p.systemResolution === "UNRESOLVED" &&
          p.canonicalSizeOptionId === null
      ),
    JSON.stringify(summary)
  );
}

/* 16. never overwrite better provenance (spec §13) */
{
  const [{ observation, projection }] = observe(
    variantInput({
      categoryName: "Heels",
      variants: [{ id: "v1", value: "8" }],
    })
  );
  const explicit = {
    canonicalSizeOptionId: "WOMEN|shoes|US|8",
    sizeResolutionStatus: "RESOLVED",
    sizeResolutionProvenance: "EXPLICIT",
    sizeResolutionSystem: "US",
  } as const;
  const next = canonicalFieldsFromProjection(projection);
  const downgrade = planSizeBackfill([
    {
      target: { kind: "variant", variantId: "v1" },
      existing: explicit,
      projection,
    },
  ]);
  check(
    "E16 an EXPLICIT row is never downgraded to UNRESOLVED",
    isDowngrade(explicit, next) &&
      downgrade.changes.length === 0 &&
      downgrade.report.downgradesPrevented === 1 &&
      observation.variantId === "v1",
    JSON.stringify(downgrade.report)
  );

  const resolvedNow = observe(
    variantInput({
      categoryName: "Heels",
      variants: [
        {
          id: "v1",
          value: "8",
          system: "US",
          productType: "FOOTWEAR",
          audience: "WOMEN",
        },
      ],
    })
  )[0];
  const upgrade = planSizeBackfill([
    {
      target: { kind: "variant", variantId: "v1" },
      existing: {
        canonicalSizeOptionId: null,
        sizeResolutionStatus: "UNRESOLVED",
        sizeResolutionProvenance: "UNRESOLVED",
        sizeResolutionSystem: null,
      },
      projection: resolvedNow.projection,
    },
  ]);
  check(
    "E16b an UNRESOLVED row is upgraded when real metadata appears",
    upgrade.changes.length === 1 &&
      upgrade.changes[0].fields.sizeResolutionProvenance === "EXPLICIT"
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
