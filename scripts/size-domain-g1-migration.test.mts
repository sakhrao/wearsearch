/* Stage G / G1 — public/domain consumer migration to the canonical read path.

   Pure, fixture-driven, DB-free. Covers the migrated outfit-domain
   consumers (`projectVariantSize`, `projectOfferVariantSize`,
   `sizeResolutionState`, `hasUnresolvedSize`) and proves the required
   semantics: resolved / unresolved / not-backfilled / legacy fallback /
   source-label preservation / identity preservation / unchanged behavior. */

import {
  projectOfferVariantSize,
  projectVariantSize,
  type LegacyVariantSizeRow,
} from "../src/lib/outfit/catalog";
import {
  evalSize,
  hasUnresolvedSize,
  sizeResolutionState,
} from "../src/lib/outfit/outfit-size";
import type { OutfitProduct } from "../src/lib/outfit/types";
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

const CR_M = sizeIdentity("WOMEN", "clothing", "INTERNATIONAL", "M");

const resolvedRow: LegacyVariantSizeRow = {
  canonicalSizeOptionId: CR_M,
  sizeResolutionStatus: "RESOLVED",
  sizeResolutionProvenance: "EXPLICIT",
  sizeResolutionSystem: "INTERNATIONAL",
  size: {
    system: "INTERNATIONAL",
    value: "Medium",
    normalizedValue: "M",
    productType: "CLOTHING",
  },
};

const unresolvedRow: LegacyVariantSizeRow = {
  canonicalSizeOptionId: null,
  sizeResolutionStatus: "UNRESOLVED",
  sizeResolutionProvenance: "UNRESOLVED",
  sizeResolutionSystem: null,
  size: {
    system: "UNKNOWN",
    value: "8",
    normalizedValue: "8",
    productType: "CLOTHING",
  },
};

const unresolvedKnownSystemRow: LegacyVariantSizeRow = {
  canonicalSizeOptionId: null,
  sizeResolutionStatus: "UNRESOLVED",
  sizeResolutionProvenance: "EXPLICIT",
  sizeResolutionSystem: "US",
  size: {
    system: "UNKNOWN",
    value: "8",
    normalizedValue: "8",
    productType: "FOOTWEAR",
  },
};

const notBackfilledRow: LegacyVariantSizeRow = {
  canonicalSizeOptionId: null,
  sizeResolutionStatus: null,
  sizeResolutionProvenance: null,
  sizeResolutionSystem: null,
  size: {
    system: "EU",
    value: "L",
    normalizedValue: "L",
    productType: "CLOTHING",
  },
};

/* G1-1 */
{
  const size = projectVariantSize(resolvedRow);
  check(
    "G1-1 a resolved row exposes RESOLVED + canonical identity",
    size != null &&
      size.state === "RESOLVED" &&
      size.canonicalSizeOptionId === CR_M &&
      size.system === "INTERNATIONAL",
    JSON.stringify(size)
  );
}

/* G1-2 */
{
  const size = projectVariantSize(unresolvedRow);
  check(
    "G1-2 an unresolved row stays UNRESOLVED with a null identity",
    size != null &&
      size.state === "UNRESOLVED" &&
      size.canonicalSizeOptionId === null,
    JSON.stringify(size)
  );
}

/* G1-3 */
{
  const size = projectVariantSize(unresolvedKnownSystemRow);
  check(
    "G1-3 an unresolved row can still carry a known canonical system",
    size != null &&
      size.state === "UNRESOLVED" &&
      size.system === "US" &&
      size.canonicalSizeOptionId === null,
    JSON.stringify(size)
  );
}

/* G1-4 */
{
  const size = projectVariantSize(notBackfilledRow);
  check(
    "G1-4 a not-backfilled row falls back to the legacy system",
    size != null &&
      size.state === "NOT_BACKFILLED" &&
      size.canonicalSizeOptionId === null &&
      size.system === "EU",
    JSON.stringify(size)
  );
}

/* G1-5 */
{
  const a = projectVariantSize(resolvedRow);
  const b = projectVariantSize(unresolvedRow);
  const c = projectVariantSize(notBackfilledRow);
  check(
    "G1-5 the raw source label is preserved in every state",
    a?.value === "Medium" &&
      b?.value === "8" &&
      c?.value === "L" &&
      a?.normalizedValue === "M" &&
      c?.normalizedValue === "L",
    JSON.stringify([a?.value, b?.value, c?.value])
  );
}

/* G1-6 */
{
  const size = projectVariantSize(resolvedRow);
  check(
    "G1-6 the migrated identity equals the wire sizeIdentity",
    size?.canonicalSizeOptionId ===
      sizeIdentity("WOMEN", "clothing", "INTERNATIONAL", "M")
  );
}

/* G1-7 */
{
  check(
    "G1-7 a variant with no size row projects to null",
    projectVariantSize({ ...notBackfilledRow, size: null }) === null &&
      projectVariantSize(resolvedRow)?.value === "Medium"
  );
}

/* G1-8 */
{
  const size = projectOfferVariantSize(
    {
      canonicalSizeOptionId: null,
      sizeResolutionStatus: null,
      sizeResolutionProvenance: null,
      sizeResolutionSystem: null,
    },
    "M",
    "EU"
  );
  check(
    "G1-8 an offer chip routes through the boundary as NOT_BACKFILLED",
    size != null &&
      size.state === "NOT_BACKFILLED" &&
      size.value === "M" &&
      size.system === "EU" &&
      size.canonicalSizeOptionId === null,
    JSON.stringify(size)
  );
}

/* G1-9 */
{
  const id = sizeIdentity("WOMEN", "clothing", "INTERNATIONAL", "M");
  const size = projectOfferVariantSize(
    {
      canonicalSizeOptionId: id,
      sizeResolutionStatus: "RESOLVED",
      sizeResolutionProvenance: "EXPLICIT",
      sizeResolutionSystem: "INTERNATIONAL",
    },
    "M",
    null
  );
  check(
    "G1-9 a backfilled offer exposes its canonical identity",
    size != null &&
      size.state === "RESOLVED" &&
      size.canonicalSizeOptionId === id &&
      size.system === "INTERNATIONAL",
    JSON.stringify(size)
  );
}

/* G1-10 */
{
  const product = (variants: OutfitProduct["variants"]): OutfitProduct =>
    ({
      id: "p",
      name: "P",
      price: "1",
      currency: "EUR",
      productUrl: "https://x",
      imageUrl: null,
      availability: "AVAILABLE",
      gender: "WOMEN",
      brand: null,
      category: null,
      variants,
      attributes: [],
    }) as OutfitProduct;

  const variant = (value: string, state: OutfitProduct["variants"][number]["size"]) =>
    ({
      price: "1",
      currency: "EUR",
      availability: "AVAILABLE",
      color: null,
      size: state,
    });

  check(
    "G1-10 sizeResolutionState defaults a missing state to NOT_BACKFILLED",
    sizeResolutionState(projectVariantSize(notBackfilledRow)) ===
      "NOT_BACKFILLED" &&
      sizeResolutionState(null) === "NOT_BACKFILLED" &&
      sizeResolutionState(projectVariantSize(resolvedRow)) === "RESOLVED"
  );

  const withUnresolved = product([
    variant("Medium", projectVariantSize(resolvedRow)),
    variant("8", projectVariantSize(unresolvedKnownSystemRow)),
  ]);
  const withoutUnresolved = product([
    variant("Medium", projectVariantSize(resolvedRow)),
    variant("L", projectVariantSize(notBackfilledRow)),
  ]);
  check(
    "G1-11 hasUnresolvedSize distinguishes UNRESOLVED from NOT_BACKFILLED",
    hasUnresolvedSize(withUnresolved) &&
      !hasUnresolvedSize(withoutUnresolved)
  );
}

/* G1-12 */
{
  const product = {
    id: "p",
    name: "P",
    price: "1",
    currency: "EUR",
    productUrl: "https://x",
    imageUrl: null,
    availability: "AVAILABLE",
    gender: "WOMEN",
    brand: null,
    category: null,
    variants: [
      {
        price: "1",
        currency: "EUR",
        availability: "AVAILABLE",
        color: null,
        size: projectVariantSize(resolvedRow),
      },
    ],
    attributes: [],
  } as OutfitProduct;

  check(
    "G1-12 migrated variant data keeps exact-match behavior unchanged",
    evalSize(product, { value: "Medium" }).match === "exact-available" &&
      evalSize(product, { value: "M" }).match === "exact-available" &&
      evalSize(product, { value: "XL" }).match === "none"
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
