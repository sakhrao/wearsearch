import {
  APPROVED_SIZE_SYSTEM_POLICIES,
  SIZE_SYSTEM_POLICY_CANDIDATES,
  integrateProductSizes,
  isApprovedPolicyRegistered,
  isValidPolicy,
  projectProductSizes,
  resolveSizeSystem,
  sizeSystem,
  summarizeSizeProjections,
  type ProductSizeInput,
  type SizeSystemPolicy,
} from "../src/lib/size-domain";

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

/* A source-specific WOMEN FOOTWEAR -> US policy used ONLY in tests. The
   production registry is empty by default (see C6.x). */
const testPolicy: SizeSystemPolicy = {
  id: "test-source-shoes-us",
  sourceName: "Test Source",
  productType: "FOOTWEAR",
  audience: "WOMEN",
  system: "US",
  note: "test fixture policy, never registered in production",
};

const livostyle = (
  over: {
    productId?: string;
    categoryName?: string | null;
    gender?: string | null;
    sourceName?: string | null;
    variants: Array<{
      id: string;
      value: string;
      system?: string | null;
      availability?: string;
    }>;
  }
): ProductSizeInput => ({
  productId: over.productId ?? "p",
  context: {
    gender: over.gender ?? "WOMEN",
    categoryName: over.categoryName ?? "Heels",
    sourceId: null,
    sourceName: over.sourceName ?? "Livostyle Open Catalog",
  },
  variants: over.variants.map((v) => ({
    variantId: v.id,
    size: {
      value: v.value,
      system: v.system === undefined ? "UNKNOWN" : v.system,
      productType: "UNKNOWN",
      audience: "UNKNOWN",
    },
    availability: v.availability ?? "AVAILABLE",
  })),
});

const projectOne = (input: ProductSizeInput, policies?: readonly SizeSystemPolicy[]) =>
  projectProductSizes(integrateProductSizes(input), policies)[0];

/* --- Explicit ---------------------------------------------------- */
{
  const us = projectOne(
    livostyle({ variants: [{ id: "1", value: "8", system: "US" }] })
  );
  check(
    "D1.1 stored US 8 is EXPLICIT and resolves to the US identity",
    us.systemResolution === "EXPLICIT" &&
      us.status === "RESOLVED" &&
      us.system === "US" &&
      us.canonicalSizeOptionId === "WOMEN|shoes|US|8" &&
      us.policyId === null,
    JSON.stringify(us)
  );

  const eu = projectOne(
    livostyle({ variants: [{ id: "1", value: "42", system: "EU" }] })
  );
  check(
    "D1.2 stored EU 42 is EXPLICIT and distinct from US",
    eu.systemResolution === "EXPLICIT" &&
      eu.canonicalSizeOptionId === "WOMEN|shoes|EU|42"
  );

  const jp = projectOne(
    livostyle({ variants: [{ id: "1", value: "25", system: "JP" }] })
  );
  check(
    "D1.3 stored JP 25 stays JP (never coerced) and is flagged non-persisted",
    jp.systemResolution === "EXPLICIT" &&
      jp.system === "JP" &&
      jp.systemPersisted === false &&
      jp.canonicalSizeOptionId === "WOMEN|shoes|JP|25"
  );

  const alpha = projectProductSizes(
    integrateProductSizes({
      productId: "p-alpha",
      context: { gender: "WOMEN", categoryName: "Dresses" },
      variants: [
        {
          variantId: "1",
          size: {
            value: "M",
            system: "INTERNATIONAL",
            productType: "CLOTHING",
            audience: "WOMEN",
          },
        },
      ],
    })
  )[0];
  check(
    "D1.4 explicit international alpha is EXPLICIT",
    alpha.systemResolution === "EXPLICIT" &&
      alpha.canonicalSizeOptionId === "WOMEN|clothing|INTERNATIONAL|M"
  );
}

/* --- System encoded in the label (Stage B owns it) --------------- */
{
  const labelEncoded = projectOne(
    livostyle({ variants: [{ id: "1", value: "US 8", system: null }] })
  );
  check(
    "D2.1 a label-encoded US 8 resolves via Stage B and is EXPLICIT (not INFERRED)",
    labelEncoded.systemResolution === "EXPLICIT" &&
      labelEncoded.status === "RESOLVED" &&
      labelEncoded.system === "US" &&
      labelEncoded.canonicalSizeOptionId === "WOMEN|shoes|US|8",
    JSON.stringify(labelEncoded)
  );
  check(
    "D2.2 the source label is preserved verbatim ('US 8')",
    labelEncoded.sourceSizeLabel === "US 8"
  );
}

/* --- Missing system: the 159 live-catalog case ------------------- */
{
  const bare = ["5.5", "6", "7", "8", "9", "10", "11"];
  const observations = integrateProductSizes(
    livostyle({
      productId: "p-bare",
      variants: bare.map((value, index) => ({
        id: `v${index}`,
        value,
        system: "UNKNOWN",
      })),
    })
  );
  const projections = projectProductSizes(observations);
  check(
    "D3.1 every bare numeric stays UNRESOLVED with the empty approved registry",
    projections.length === 7 &&
      projections.every(
        (p) =>
          p.status === "UNRESOLVED" &&
          p.systemResolution === "UNRESOLVED" &&
          p.canonicalSizeOptionId === null &&
          p.reason === "INSUFFICIENT_CONTEXT"
      ),
    JSON.stringify(projections.map((p) => [p.sourceSizeLabel, p.systemResolution]))
  );
  check(
    "D3.2 bare values are never silently assigned US under the default registry",
    projections.every((p) => p.system === null && p.policyId === null)
  );
}

/* --- Source-specific inference (approved via test policy) -------- */
{
  const observations = integrateProductSizes(
    livostyle({
      productId: "p-infer",
      sourceName: "Test Source",
      variants: [{ id: "1", value: "8", system: "UNKNOWN" }],
    })
  );
  const [inferred] = projectProductSizes(observations, [testPolicy]);
  check(
    "D4.1 matching source + product type + audience resolves as INFERRED",
    inferred.systemResolution === "INFERRED" &&
      inferred.status === "RESOLVED" &&
      inferred.system === "US" &&
      inferred.canonicalSizeOptionId === "WOMEN|shoes|US|8" &&
      inferred.policyId === "test-source-shoes-us",
    JSON.stringify(inferred)
  );

  const wrongSource = projectProductSizes(
    integrateProductSizes(
      livostyle({
        productId: "p-wrong-src",
        sourceName: "Some Other Store",
        variants: [{ id: "1", value: "8", system: "UNKNOWN" }],
      })
    ),
    [testPolicy]
  )[0];
  check(
    "D4.2 wrong source does not infer",
    wrongSource.systemResolution === "UNRESOLVED" &&
      wrongSource.canonicalSizeOptionId === null
  );

  const wrongType = projectProductSizes(
    integrateProductSizes({
      productId: "p-wrong-type",
      context: {
        gender: "WOMEN",
        categoryName: "Dresses",
        sourceName: "Test Source",
      },
      variants: [
        {
          variantId: "1",
          size: { value: "8", system: "UNKNOWN", productType: "CLOTHING", audience: "WOMEN" },
        },
      ],
    }),
    [testPolicy]
  )[0];
  check(
    "D4.3 wrong product type does not infer",
    wrongType.systemResolution === "UNRESOLVED"
  );

  const missingContext = projectProductSizes(
    integrateProductSizes({
      productId: "p-missing-ctx",
      context: {
        gender: null,
        categoryName: "Heels",
        sourceName: "Test Source",
      },
      variants: [
        {
          variantId: "1",
          size: { value: "8", system: "UNKNOWN", productType: "UNKNOWN", audience: "UNKNOWN" },
        },
      ],
    }),
    [testPolicy]
  )[0];
  check(
    "D4.4 missing audience context does not infer (policy requires WOMEN)",
    missingContext.systemResolution === "UNRESOLVED"
  );

  const a = projectProductSizes(
    integrateProductSizes(
      livostyle({ sourceName: "Test Source", variants: [{ id: "1", value: "8" }] })
    ),
    [testPolicy]
  );
  const b = projectProductSizes(
    integrateProductSizes(
      livostyle({ sourceName: "Test Source", variants: [{ id: "1", value: "8" }] })
    ),
    [testPolicy]
  );
  check(
    "D4.5 inferred projection is deterministic",
    JSON.stringify(a) === JSON.stringify(b)
  );
}

/* --- Policy registry safety -------------------------------------- */
{
  check(
    "D5.1 the production approved registry is empty (no inference by default)",
    APPROVED_SIZE_SYSTEM_POLICIES.length === 0 &&
      isApprovedPolicyRegistered() === false
  );
  check(
    "D5.2 the Livostyle policy exists only as an unapproved candidate",
    SIZE_SYSTEM_POLICY_CANDIDATES.length === 1 &&
      SIZE_SYSTEM_POLICY_CANDIDATES[0].id === "livostyle-womens-shoes-us" &&
      SIZE_SYSTEM_POLICY_CANDIDATES[0].system === "US"
  );
  check(
    "D5.3 a policy without a source is invalid",
    isValidPolicy(testPolicy) === true &&
      isValidPolicy({ ...testPolicy, sourceId: null, sourceName: null }) === false
  );
  const noExplicit = resolveSizeSystem({
    explicitSystem: null,
    sourceId: null,
    sourceName: "Test Source",
    productType: "FOOTWEAR",
    audience: "WOMEN",
    value: "8",
  });
  check(
    "D5.4 resolveSizeSystem with no policies returns UNRESOLVED",
    noExplicit.provenance === "UNRESOLVED" && noExplicit.system === null
  );
}

/* --- Unsupported / non-persisted systems ------------------------- */
{
  check(
    "D6.1 JP/BRA/ONE_SIZE are registered but non-persisted",
    sizeSystem("JP")?.persisted === false &&
      sizeSystem("BRA")?.persisted === false &&
      sizeSystem("ONE_SIZE")?.persisted === false
  );
  const bra = projectProductSizes(
    integrateProductSizes({
      productId: "p-bra",
      context: { gender: "WOMEN", categoryName: "Bras" },
      variants: [
        {
          variantId: "1",
          size: { value: "36B", system: null, productType: "CLOTHING", audience: "WOMEN" },
        },
      ],
    })
  )[0];
  check(
    "D6.2 BRA resolves as BRA (no coercion into the persisted enum)",
    bra.status === "RESOLVED" &&
      bra.system === "BRA" &&
      bra.systemPersisted === false &&
      bra.canonicalSizeOptionId === "WOMEN|clothing|BRA|36B"
  );
  const oneSize = projectProductSizes(
    integrateProductSizes({
      productId: "p-os",
      context: { gender: "WOMEN", categoryName: "Bags" },
      variants: [
        {
          variantId: "1",
          size: { value: "One Size", system: null, productType: "ACCESSORY", audience: "WOMEN" },
        },
      ],
    })
  )[0];
  check(
    "D6.3 ONE_SIZE stays ONE_SIZE, flagged non-persisted",
    oneSize.status === "RESOLVED" &&
      oneSize.system === "ONE_SIZE" &&
      oneSize.canonicalSizeOptionId === "WOMEN|clothing|ONE_SIZE|One Size"
  );
}

/* --- Age range is never fabricated ------------------------------- */
{
  const kids = projectOne(
    livostyle({
      productId: "p-kids",
      gender: "KIDS",
      categoryName: "T-Shirts",
      variants: [{ id: "1", value: "M", system: "INTERNATIONAL" }],
    })
  );
  check(
    "D7.1 no ageRange field is fabricated on the projection",
    !("ageRange" in kids) &&
      kids.status === "RESOLVED" &&
      kids.canonicalSizeOptionId === "KIDS|clothing|INTERNATIONAL|M"
  );
  const ageValue = projectProductSizes(
    integrateProductSizes({
      productId: "p-age",
      context: { gender: "KIDS", categoryName: "T-Shirts" },
      variants: [
        {
          variantId: "1",
          size: { value: "24M", system: "INTERNATIONAL", productType: "CLOTHING", audience: "KIDS" },
        },
      ],
    })
  )[0];
  check(
    "D7.2 an age-like label is not turned into a fabricated age range",
    ageValue.status === "UNRESOLVED" && ageValue.canonicalSizeOptionId === null
  );
}

/* --- Provenance stays distinct ----------------------------------- */
{
  const input = livostyle({
    productId: "p-prov",
    sourceName: "Test Source",
    variants: [{ id: "1", value: "8", system: "UNKNOWN" }],
  });
  const explicit = projectProductSizes(
    integrateProductSizes(
      livostyle({ productId: "pe", sourceName: "Test Source", variants: [{ id: "1", value: "8", system: "US" }] })
    )
  )[0];
  const inferred = projectProductSizes(integrateProductSizes(input), [testPolicy])[0];
  const unresolved = projectProductSizes(integrateProductSizes(input))[0];
  check(
    "D8.1 EXPLICIT, INFERRED and UNRESOLVED are three distinct states",
    explicit.systemResolution === "EXPLICIT" &&
      inferred.systemResolution === "INFERRED" &&
      unresolved.systemResolution === "UNRESOLVED" &&
      new Set([explicit.systemResolution, inferred.systemResolution, unresolved.systemResolution]).size === 3
  );
  const summary = summarizeSizeProjections([explicit, inferred, unresolved]);
  check(
    "D8.2 the provenance summary counts inferred resolutions explicitly",
    summary.total === 3 &&
      summary.explicit === 1 &&
      summary.inferred === 1 &&
      summary.inferredResolved === 1 &&
      summary.unresolved === 1
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
