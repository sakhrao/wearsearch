import {
  buildSizeCoverage,
  integrateProductSizes,
  sizeProductTypeToDiscipline,
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

/* =================================================================
   Fixtures — plain product-shaped objects. No Prisma, no DB.
   ================================================================= */

const legacyProduct = (over: {
  productId?: string;
  gender?: string | null;
  categoryName?: string | null;
  variants: Array<{
    variantId: string;
    value: string | null;
    system?: string | null;
    productType?: string | null;
    audience?: string | null;
    availability?: string | null;
  }>;
}) => ({
  productId: over.productId ?? "p-legacy",
  context: {
    gender: over.gender ?? null,
    categoryName: over.categoryName ?? null,
    sourceId: "srcA",
    sourceName: "Source A",
  },
  variants: over.variants.map((v) => ({
    variantId: v.variantId,
    size: {
      value: v.value,
      system: v.system ?? "INTERNATIONAL",
      productType: v.productType ?? null,
      audience: v.audience ?? null,
    },
    availability: v.availability ?? "AVAILABLE",
  })),
});

/* --- 1. product with one variant --------------------------------- */
{
  const observations = integrateProductSizes(
    legacyProduct({
      productId: "p-one",
      gender: "MEN",
      categoryName: "T-Shirts",
      variants: [{ variantId: "v1", value: "M", availability: "AVAILABLE" }],
    })
  );
  const o = observations[0];
  check(
    "C1.1 one variant produces one observation",
    observations.length === 1 && o.productId === "p-one" && o.origin === "variant",
    JSON.stringify(observations)
  );
  check(
    "C1.2 one variant resolves against the product context",
    o.normalization.status === "RESOLVED" &&
      o.normalization.canonicalSizeOptionId === "MEN|clothing|INTERNATIONAL|M" &&
      o.context.audience === "MEN" &&
      o.context.productType === "CLOTHING" &&
      o.classification === "RESOLVED",
    JSON.stringify(o)
  );
}

/* --- 2. product with multiple size variants ---------------------- */
{
  const observations = integrateProductSizes(
    legacyProduct({
      productId: "p-many",
      gender: "WOMEN",
      categoryName: "Dresses",
      variants: [
        { variantId: "s", value: "S" },
        { variantId: "m", value: "M" },
        { variantId: "l", value: "L" },
        { variantId: "xl", value: "XL" },
      ],
    })
  );
  const ids = observations.map((o) => o.normalization.canonicalSizeOptionId);
  check(
    "C2.1 four variants produce four independent resolutions (never collapsed)",
    observations.length === 4 &&
      new Set(ids).size === 4 &&
      ids.every((id) => id != null && id.startsWith("WOMEN|clothing|INTERNATIONAL|")),
    JSON.stringify(ids)
  );
}

/* --- 3. multiple source labels -> one canonical size ------------- */
{
  const observations = integrateProductSizes({
    productId: "p-sources",
    context: { gender: "MEN", categoryName: "T-Shirts", sourceId: "srcA", sourceName: "Source A" },
    offerVariants: [
      {
        offerId: "o1",
        variantKey: "k1",
        sourceId: "srcA",
        sourceName: "Source A",
        sizeValue: "M",
        sizeSystem: "INTERNATIONAL",
        sizeAudience: "MEN",
        availability: "AVAILABLE",
      },
      {
        offerId: "o2",
        variantKey: "k2",
        sourceId: "srcB",
        sourceName: "Source B",
        sizeValue: "Medium",
        sizeAudience: "MEN",
        availability: "AVAILABLE",
      },
    ],
  });
  const canonicals = observations.map((o) => o.normalization.canonicalSizeOptionId);
  check(
    "C3.1 different source labels collapse to the same canonical identity",
    canonicals.length === 2 &&
      canonicals[0] === canonicals[1] &&
      canonicals[0] === "MEN|clothing|INTERNATIONAL|M"
  );
  check(
    "C3.2 each original source label is retained verbatim",
    observations[0].sourceSizeLabel === "M" &&
      observations[1].sourceSizeLabel === "Medium" &&
      observations[1].normalization.confidence === "NORMALIZED"
  );
}

/* --- 4. unavailable variant -------------------------------------- */
{
  const observations = integrateProductSizes({
    productId: "p-avail",
    context: { gender: "MEN", categoryName: "T-Shirts" },
    variants: [
      {
        variantId: "avail",
        size: { value: "M", system: "INTERNATIONAL" },
        availability: "AVAILABLE",
      },
      {
        variantId: "out",
        size: { value: "L", system: "INTERNATIONAL" },
        availability: "OUT_OF_STOCK",
      },
      {
        variantId: "unknown",
        size: { value: "XL", system: "INTERNATIONAL" },
        availability: "UNKNOWN",
      },
    ],
  });
  check(
    "C4.1 availability is preserved and narrowed without being merged",
    observations[0].availability === "AVAILABLE" &&
      observations[0].available === true &&
      observations[1].availability === "OUT_OF_STOCK" &&
      observations[1].available === false &&
      observations[2].availability === "UNKNOWN" &&
      observations[2].available === null
  );
  check(
    "C4.2 an unavailable variant still resolves canonically",
    observations[1].normalization.status === "RESOLVED" &&
      observations[1].normalization.canonicalSizeOptionId ===
        "MEN|clothing|INTERNATIONAL|L"
  );
}

/* --- 5. unresolved source size ----------------------------------- */
{
  const observations = integrateProductSizes(
    legacyProduct({
      productId: "p-unresolved",
      gender: "MEN",
      categoryName: "T-Shirts",
      variants: [
        { variantId: "sf", value: "Special Fit" },
        { variantId: "cu", value: "Custom" },
        { variantId: "r", value: "42R" },
      ],
    })
  );
  check(
    "C5.1 unknown labels stay UNRESOLVED with a null canonical id",
    observations.every(
      (o) =>
        o.normalization.status === "UNRESOLVED" &&
        o.normalization.canonicalSizeOptionId === null &&
        o.classification === "UNRESOLVED"
    ),
    JSON.stringify(observations.map((o) => o.normalization.reason))
  );
  check(
    "C5.2 unresolved observations keep their exact source label",
    observations.map((o) => o.sourceSizeLabel).join(",") ===
      "Special Fit,Custom,42R"
  );
}

/* --- 6. insufficient context ------------------------------------- */
{
  const observations = integrateProductSizes(
    legacyProduct({
      productId: "p-nocontext",
      gender: null,
      categoryName: null,
      variants: [
        { variantId: "m", value: "M" },
        { variantId: "32", value: "32", system: "US" },
      ],
    })
  );
  check(
    "C6.1 alpha with no audience/product type is INSUFFICIENT_CONTEXT",
    observations[0].classification === "INSUFFICIENT_CONTEXT" &&
      observations[0].normalization.reason === "INSUFFICIENT_CONTEXT" &&
      observations[0].context.audience === "UNKNOWN" &&
      observations[0].context.productType === "UNKNOWN"
  );
  check(
    "C6.2 numeric with a system but unknown context stays INSUFFICIENT_CONTEXT",
    observations[1].classification === "INSUFFICIENT_CONTEXT"
  );
}

/* --- 7. ambiguous size ------------------------------------------- */
{
  const observations = integrateProductSizes({
    productId: "p-ambiguous",
    context: { gender: "MEN", categoryName: "T-Shirts" },
    offerVariants: [
      {
        offerId: "o1",
        variantKey: "k1",
        sizeValue: "US 8",
        sizeSystem: "EU",
        sizeAudience: "MEN",
        availability: "AVAILABLE",
      },
    ],
  });
  check(
    "C7.1 conflicting system prefix/context is AMBIGUOUS, not guessed",
    observations[0].classification === "AMBIGUOUS" &&
      observations[0].normalization.reason === "CONFLICTING_SYSTEM" &&
      observations[0].normalization.canonicalSizeOptionId === null
  );

  const wrongShape = integrateProductSizes(
    legacyProduct({
      productId: "p-alpha-shoes",
      gender: "MEN",
      categoryName: "Sneakers",
      variants: [{ variantId: "m", value: "M" }],
    })
  );
  check(
    "C7.2 alpha under footwear is AMBIGUOUS (CONTEXT_MISMATCH)",
    wrongShape[0].classification === "AMBIGUOUS" &&
      wrongShape[0].normalization.reason === "CONTEXT_MISMATCH"
  );
}

/* --- 8. footwear numeric systems --------------------------------- */
{
  const observations = integrateProductSizes({
    productId: "p-shoes",
    context: { gender: "MEN", categoryName: "Sneakers" },
    offerVariants: [
      { offerId: "o", variantKey: "eu", sizeValue: "42", sizeSystem: "EU", sizeProductType: "FOOTWEAR", sizeAudience: "MEN", availability: "AVAILABLE" },
      { offerId: "o", variantKey: "us", sizeValue: "9", sizeSystem: "US", sizeProductType: "FOOTWEAR", sizeAudience: "MEN", availability: "AVAILABLE" },
      { offerId: "o", variantKey: "jp", sizeValue: "25", sizeSystem: "JP", sizeProductType: "FOOTWEAR", sizeAudience: "MEN", availability: "AVAILABLE" },
    ],
  });
  const [eu, us, jp] = observations;
  check(
    "C8.1 persisted numeric systems resolve with distinct identities",
    eu.normalization.canonicalSizeOptionId === "MEN|shoes|EU|42" &&
      eu.normalization.systemPersisted === true &&
      us.normalization.canonicalSizeOptionId === "MEN|shoes|US|9" &&
      us.normalization.systemPersisted === true
  );
  check(
    "C8.2 non-persisted numeric system (JP) resolves but is flagged",
    jp.normalization.status === "RESOLVED" &&
      jp.normalization.canonicalSizeOptionId === "MEN|shoes|JP|25" &&
      jp.normalization.systemPersisted === false
  );
}

/* --- 9. preservation of source label ----------------------------- */
{
  const observations = integrateProductSizes(
    legacyProduct({
      productId: "p-label",
      gender: "MEN",
      categoryName: "T-Shirts",
      variants: [
        { variantId: "1", value: "2XL" },
        { variantId: "2", value: "3xl" },
      ],
    })
  );
  check(
    "C9.1 2XL -> XXL while source '2XL' is preserved",
    observations[0].sourceSizeLabel === "2XL" &&
      observations[0].normalization.canonicalValue === "XXL"
  );
  check(
    "C9.2 3xl -> XXXL while source '3xl' is preserved",
    observations[1].sourceSizeLabel === "3xl" &&
      observations[1].normalization.canonicalValue === "XXXL"
  );
}

/* --- 10. preservation of availability (offer path) --------------- */
{
  const observations = integrateProductSizes({
    productId: "p-offer-avail",
    context: { gender: "MEN", categoryName: "T-Shirts", sourceId: "srcA", sourceName: "Source A" },
    offerVariants: [
      { offerId: "o", variantKey: "a", sizeValue: "M", sizeAudience: "MEN", availability: "PREORDER" },
      { offerId: "o", variantKey: "b", sizeValue: "L", sizeAudience: "MEN", availability: "BACKORDER" },
    ],
  });
  check(
    "C10.1 richer offer availability states are preserved verbatim",
    observations[0].availability === "PREORDER" &&
      observations[0].available === null &&
      observations[1].availability === "BACKORDER" &&
      observations[1].available === null
  );
}

/* --- 11. deterministic output ------------------------------------ */
{
  const input = legacyProduct({
    productId: "p-det",
    gender: "MEN",
    categoryName: "T-Shirts",
    variants: [
      { variantId: "1", value: "M" },
      { variantId: "2", value: "Special Fit" },
    ],
  });
  const a = integrateProductSizes(input);
  const b = integrateProductSizes(input);
  check(
    "C11.1 integration is byte-for-byte deterministic",
    JSON.stringify(a) === JSON.stringify(b)
  );
  const coverageA = buildSizeCoverage(a);
  const coverageB = buildSizeCoverage(b);
  check(
    "C11.2 coverage is byte-for-byte deterministic",
    JSON.stringify(coverageA) === JSON.stringify(coverageB)
  );
}

/* --- 12. coverage statistics ------------------------------------- */
{
  const observations = [
    ...integrateProductSizes(
      legacyProduct({
        productId: "p-cov",
        gender: "MEN",
        categoryName: "T-Shirts",
        variants: [
          { variantId: "1", value: "M" },
          { variantId: "2", value: "L" },
          { variantId: "3", value: "Special Fit" },
        ],
      })
    ),
    ...integrateProductSizes({
      productId: "p-cov-shoes",
      context: {
        gender: "MEN",
        categoryName: "Sneakers",
        sourceId: "srcA",
        sourceName: "Source A",
      },
      offerVariants: [
        { offerId: "o", variantKey: "eu", sizeValue: "42", sizeSystem: "EU", sizeProductType: "FOOTWEAR", sizeAudience: "MEN", availability: "AVAILABLE" },
      ],
    }),
  ];
  const report = buildSizeCoverage(observations);
  check(
    "C12.1 observation-level totals are exact",
    report.observations.total === 4 &&
      report.observations.resolved === 3 &&
      report.observations.unresolved === 1 &&
      report.observations.resolutionPercentage === 75
  );
  check(
    "C12.2 breakdowns are keyed from real context dimensions",
    report.byProductType.CLOTHING !== undefined &&
      report.byProductType.CLOTHING.total === 3 &&
      report.byProductType.FOOTWEAR.total === 1 &&
      report.bySource["Source A"].total === 4 &&
      report.byStatus.RESOLVED === 3 &&
      report.byStatus.UNRESOLVED === 1
  );
  check(
    "C12.3 unique-label coverage and unresolved reason are exposed",
    report.uniqueSourceLabels.total === 4 &&
      report.uniqueSourceLabels.resolved === 3 &&
      report.byUnresolvedReason.UNKNOWN_VALUE === 1 &&
      report.byCanonicalSize["MEN|clothing|INTERNATIONAL|M"] === 1
  );
}

/* --- 13. unresolved vocabulary ----------------------------------- */
{
  const observations = integrateProductSizes(
    legacyProduct({
      productId: "p-vocab",
      gender: "MEN",
      categoryName: "T-Shirts",
      variants: [
        { variantId: "1", value: "Special Fit" },
        { variantId: "2", value: "Special Fit" },
        { variantId: "3", value: "42R" },
      ],
    })
  );
  const report = buildSizeCoverage(observations);
  check(
    "C13.1 unresolved vocabulary is sorted by occurrence count",
    report.unresolvedVocabulary.length === 2 &&
      report.unresolvedVocabulary[0].sourceLabel === "Special Fit" &&
      report.unresolvedVocabulary[0].count === 2 &&
      report.unresolvedVocabulary[1].sourceLabel === "42R"
  );
  check(
    "C13.2 vocabulary carries reasons, contexts and source",
    report.unresolvedVocabulary[0].reasons.includes("UNKNOWN_VALUE") &&
      report.unresolvedVocabulary[0].sources.includes("Source A") &&
      report.unresolvedVocabulary[0].contexts.length === 1
  );
}

/* --- 14. existing sizeIdentity compatibility --------------------- */
{
  const observations = integrateProductSizes(
    legacyProduct({
      productId: "p-wire",
      gender: "MEN",
      categoryName: "Sneakers",
      variants: [
        { variantId: "1", value: "42", system: "EU", productType: "FOOTWEAR", audience: "MEN" },
      ],
    })
  );
  const resolved = observations[0].normalization;
  const n = observations[0];
  check(
    "C14.1 canonical id equals the existing sizeIdentity wire format",
    resolved.canonicalSizeOptionId ===
      sizeIdentity(
        n.context.audience,
        sizeProductTypeToDiscipline(n.context.productType),
        resolved.system,
        resolved.canonicalValue ?? ""
      )
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
