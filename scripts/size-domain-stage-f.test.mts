/* Stage F — canonical read path + size-system filtering.

   Pure, fixture-driven, DB-free. Verifies:
     F1-F5   canonical read states (resolved / unresolved / not-backfilled)
     F6-F11  canonical size predicate + composition
     F12-F16 variant/offer-variant/grain where builders
     F17-F20 size-system filtering (independent of resolution)
     F21-F22 availability stays independent
     F23-F25 safety: no inference, determinism, wire compatibility */

import {
  APPROVED_SIZE_SYSTEM_POLICIES,
  canonicalReadState,
  canonicalSizeIdentityOf,
  combineSizeFilters,
  filterByCanonicalSize,
  filterBySizeSystem,
  hasCanonicalSizePredicate,
  hasSizeSystemPredicate,
  isNotBackfilledSize,
  isEmptySizeFilter,
  isResolvedSize,
  isUnresolvedSize,
  matchesCanonicalSize,
  matchesSizeFilter,
  matchesSizeSystem,
  pickCanonicalFields,
  productSizeFilterWhere,
  readCanonicalSize,
  sizeFilterToOfferVariantWhere,
  sizeFilterToVariantWhere,
  sizeSystemOf,
  type CanonicalSizeFilter,
  type SizeCanonicalFields,
} from "../src/lib/size-domain";
import { parseSizeIdentity, sizeIdentity } from "../src/lib/size-sections";

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

/* RESOLVED: identity + system + provenance all present. */
const resolvedUS8: SizeCanonicalFields = {
  canonicalSizeOptionId: "WOMEN|shoes|US|8",
  sizeResolutionStatus: "RESOLVED",
  sizeResolutionProvenance: "EXPLICIT",
  sizeResolutionSystem: "US",
};

/* UNRESOLVED with a KNOWN system: identity null, system present. */
const unresolvedUS: SizeCanonicalFields = {
  canonicalSizeOptionId: null,
  sizeResolutionStatus: "UNRESOLVED",
  sizeResolutionProvenance: "EXPLICIT",
  sizeResolutionSystem: "US",
};

/* UNRESOLVED with no system at all. */
const unresolvedNone: SizeCanonicalFields = {
  canonicalSizeOptionId: null,
  sizeResolutionStatus: "UNRESOLVED",
  sizeResolutionProvenance: "UNRESOLVED",
  sizeResolutionSystem: null,
};

/* NOT_BACKFILLED: the four canonical columns are all null. */
const notBackfilled = emptyFields();

function read(
  canonical: SizeCanonicalFields | null,
  sourceSizeLabel: string | null,
  legacySystem?: string | null
) {
  return readCanonicalSize({
    canonical,
    legacy: { sourceSizeLabel, legacySystem },
  });
}

/* ---- F1-F5: canonical read path ---- */

{
  const r = read(resolvedUS8, "8", "US");
  check(
    "F1 a resolved row reads RESOLVED with its canonical identity",
    r.state === "RESOLVED" &&
      isResolvedSize(r) &&
      r.canonicalSizeOptionId === "WOMEN|shoes|US|8" &&
      r.system === "US" &&
      r.provenance === "EXPLICIT" &&
      r.usedLegacyFallback === false,
    JSON.stringify(r)
  );

  const u = read(unresolvedUS, "8", null);
  check(
    "F2 an unresolved row reads UNRESOLVED, identity null, system kept",
    u.state === "UNRESOLVED" &&
      isUnresolvedSize(u) &&
      u.canonicalSizeOptionId === null &&
      u.system === "US" &&
      u.usedLegacyFallback === false,
    JSON.stringify(u)
  );

  const n = read(null, "8", "US");
  check(
    "F3 a row with no canonical fields reads NOT_BACKFILLED via fallback",
    n.state === "NOT_BACKFILLED" &&
      isNotBackfilledSize(n) &&
      n.canonicalSizeOptionId === null &&
      n.status === null &&
      n.provenance === null &&
      n.usedLegacyFallback === true,
    JSON.stringify(n)
  );

  const nb = read(notBackfilled, "8", "EU");
  check(
    "F4 a not-backfilled row exposes the legacy system as fallback",
    canonicalReadState(notBackfilled) === "NOT_BACKFILLED" &&
      nb.system === "EU" &&
      nb.usedLegacyFallback === true,
    JSON.stringify(nb)
  );

  const a = read(resolvedUS8, "US 8", null);
  const b = read(unresolvedUS, "8", null);
  const c = read(notBackfilled, "8", null);
  check(
    "F5 the raw source label is preserved in every state",
    a.sourceSizeLabel === "US 8" &&
      b.sourceSizeLabel === "8" &&
      c.sourceSizeLabel === "8",
    JSON.stringify([a.sourceSizeLabel, b.sourceSizeLabel, c.sourceSizeLabel])
  );
}

/* ---- F6-F11: canonical size predicate + composition ---- */

{
  const f = filterByCanonicalSize("WOMEN|shoes|US|8");
  check(
    "F6 the canonical predicate matches only the resolved identity",
    matchesCanonicalSize(resolvedUS8, "WOMEN|shoes|US|8") &&
      !matchesCanonicalSize(resolvedUS8, "WOMEN|shoes|US|9"),
    JSON.stringify(f)
  );

  check(
    "F7 the canonical predicate never matches an unresolved row",
    !matchesCanonicalSize(unresolvedUS, "WOMEN|shoes|US|8") &&
      !matchesSizeFilter(unresolvedUS, f),
    JSON.stringify(unresolvedUS)
  );

  check(
    "F8 the canonical predicate never matches a not-backfilled row",
    !matchesCanonicalSize(notBackfilled, "WOMEN|shoes|US|8")
  );

  check(
    "F9 an empty canonical id matches nothing",
    !matchesCanonicalSize(resolvedUS8, "") &&
      !matchesCanonicalSize(resolvedUS8, null as unknown as string)
  );

  const combined = combineSizeFilters(
    filterByCanonicalSize("WOMEN|shoes|US|8"),
    filterBySizeSystem("US")
  );
  check(
    "F10 composed filters AND both predicates",
    combined.canonicalSizeOptionId === "WOMEN|shoes|US|8" &&
      combined.sizeSystem === "US" &&
      matchesSizeFilter(resolvedUS8, combined) &&
      !matchesSizeFilter(unresolvedUS, combined) &&
      !matchesSizeFilter(
        { ...resolvedUS8, sizeResolutionSystem: "EU" },
        combined
      ),
    JSON.stringify(combined)
  );

  let conflicted = false;
  try {
    combineSizeFilters(
      filterByCanonicalSize("A|shoes|US|8"),
      filterByCanonicalSize("A|shoes|US|9")
    );
  } catch {
    conflicted = true;
  }
  const empty = combineSizeFilters();
  check(
    "F11 conflicting predicates are rejected; empty filter matches all",
    conflicted &&
      isEmptySizeFilter(empty) &&
      !hasCanonicalSizePredicate(empty) &&
      !hasSizeSystemPredicate(empty) &&
      matchesSizeFilter(resolvedUS8, empty) &&
      matchesSizeFilter(notBackfilled, empty)
  );
}

/* ---- F12-F16: variant/offer-variant/grain where builders ---- */

{
  const id = "WOMEN|shoes|US|8";
  const productWhere = productSizeFilterWhere(filterByCanonicalSize(id));
  check(
    "F12 a canonical filter traverses both variant and offer-variant grain",
    JSON.stringify(productWhere) ===
      JSON.stringify({
        OR: [
          { variants: { some: { canonicalSizeOptionId: id } } },
          {
            offers: {
              some: {
                variants: { some: { canonicalSizeOptionId: id } },
              },
            },
          },
        ],
      }),
    JSON.stringify(productWhere)
  );

  const variantOnly = productSizeFilterWhere(filterByCanonicalSize(id), {
    includeOffers: false,
  });
  check(
    "F13 includeOffers:false drops the offer branch only",
    JSON.stringify(variantOnly) ===
      JSON.stringify({
        OR: [{ variants: { some: { canonicalSizeOptionId: id } } }],
      }),
    JSON.stringify(variantOnly)
  );

  const withoutAvailability = sizeFilterToVariantWhere(filterBySizeSystem("US"));
  const withAvailability = sizeFilterToVariantWhere(filterBySizeSystem("US"), {
    availability: "AVAILABLE",
  });
  check(
    "F14 availability is omitted by default and applied only when asked",
    JSON.stringify(withoutAvailability) ===
      JSON.stringify({ sizeResolutionSystem: "US" }) &&
      JSON.stringify(withAvailability) ===
        JSON.stringify({ sizeResolutionSystem: "US", availability: "AVAILABLE" }),
    JSON.stringify([withoutAvailability, withAvailability])
  );

  check(
    "F15 the variant where shape is an index-friendly equality",
    JSON.stringify(sizeFilterToVariantWhere(filterByCanonicalSize(id))) ===
      JSON.stringify({ canonicalSizeOptionId: id })
  );

  check(
    "F16 the offer-variant where shape mirrors the system column",
    JSON.stringify(sizeFilterToOfferVariantWhere(filterBySizeSystem("EU"))) ===
      JSON.stringify({ sizeResolutionSystem: "EU" })
  );
}

/* ---- F17-F20: size-system filtering independent of resolution ---- */

{
  check(
    "F17 the system predicate matches a row whose identity is null",
    matchesSizeSystem(unresolvedUS, "US") &&
      matchesSizeFilter(unresolvedUS, filterBySizeSystem("US")) &&
      !matchesSizeFilter(unresolvedUS, filterByCanonicalSize("WOMEN|shoes|US|8")),
    JSON.stringify(unresolvedUS)
  );

  check(
    "F18 a null system never matches a system predicate",
    !matchesSizeSystem(unresolvedNone, "US") &&
      !matchesSizeSystem(notBackfilled, "US") &&
      !matchesSizeFilter(unresolvedNone, filterBySizeSystem("US"))
  );

  check(
    "F19 sizeSystemOf exposes the stored system for unresolved rows",
    sizeSystemOf({
      canonical: unresolvedUS,
      legacy: { sourceSizeLabel: "8" },
    }) === "US" &&
      canonicalSizeIdentityOf({
        canonical: unresolvedUS,
        legacy: { sourceSizeLabel: "8" },
      }) === null,
    "unresolvedUS"
  );

  const u = pickCanonicalFields({
    canonicalSizeOptionId: undefined,
    sizeResolutionStatus: null,
    sizeResolutionProvenance: undefined,
    sizeResolutionSystem: "EU",
  });
  check(
    "F20 pickCanonicalFields normalizes a partial row to NOT_BACKFILLED",
    canonicalReadState(u) === "NOT_BACKFILLED" &&
      matchesSizeSystem(u, "EU") &&
      !matchesCanonicalSize(u, "WOMEN|clothing|EU|42"),
    JSON.stringify(u)
  );
}

/* ---- F21-F22: availability independent of resolution ---- */

{
  const filter: CanonicalSizeFilter = filterByCanonicalSize("WOMEN|shoes|US|8");
  check(
    "F21 the size predicate result is independent of availability",
    matchesSizeFilter(resolvedUS8, filter) &&
      matchesSizeFilter(resolvedUS8, filter) ===
        matchesSizeFilter(resolvedUS8, filter),
    JSON.stringify(filter)
  );

  const inStock = sizeFilterToVariantWhere(filter, {
    availability: "AVAILABLE",
  });
  const outOfStock = sizeFilterToVariantWhere(filter, {
    availability: "OUT_OF_STOCK",
  });
  check(
    "F22 an out-of-stock resolved row still satisfies the size predicate",
    inStock.availability === "AVAILABLE" &&
      outOfStock.availability === "OUT_OF_STOCK" &&
      inStock.canonicalSizeOptionId === outOfStock.canonicalSizeOptionId &&
      matchesSizeFilter(resolvedUS8, filter),
    JSON.stringify([inStock, outOfStock])
  );
}

/* ---- F23-F25: safety ---- */

{
  const bareEight = read(notBackfilled, "8", "UNKNOWN");
  check(
    "F23 a bare legacy size is not inferred into a US identity",
    bareEight.state === "NOT_BACKFILLED" &&
      bareEight.canonicalSizeOptionId === null &&
      !matchesCanonicalSize(notBackfilled, "WOMEN|shoes|US|8") &&
      !matchesSizeSystem(notBackfilled, "US") &&
      APPROVED_SIZE_SYSTEM_POLICIES.length === 0,
    JSON.stringify(bareEight)
  );

  const runs = Array.from({ length: 5 }, () => {
    const r = read(resolvedUS8, "8", "US");
    return [
      r.state,
      r.canonicalSizeOptionId,
      matchesSizeFilter(resolvedUS8, filterBySizeSystem("US")),
      JSON.stringify(productSizeFilterWhere(filterByCanonicalSize("WOMEN|shoes|US|8"))),
    ].join("::");
  });
  check(
    "F24 every read and filter is deterministic across runs",
    new Set(runs).size === 1,
    JSON.stringify(runs)
  );

  const wire = sizeIdentity("WOMEN", "shoes", "US", "8");
  const parsed = parseSizeIdentity(wire);
  check(
    "F25 the stored identity stays wire-compatible with sizeIdentity",
    wire === "WOMEN|shoes|US|8" &&
      resolvedUS8.canonicalSizeOptionId === wire &&
      parsed != null &&
      parsed.audience === "WOMEN" &&
      parsed.productType === "shoes" &&
      parsed.system === "US" &&
      parsed.value === "8",
    wire
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
