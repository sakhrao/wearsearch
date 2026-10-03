/* Stage C — deterministic Product/Variant size integration adapter.

   Pure, read-only, Prisma-free, DB-free, network-free. It only maps real
   Product / ProductVariant / ProductOfferVariant-shaped rows onto the
   Stage B normalization contract (`normalizeSourceSize`) and reports
   what actually resolves. It never writes, never persists a canonical
   size, and never alters a source label.

   Pipeline: Raw Product/Variant size -> this adapter -> Stage B
   normalization -> canonical SizeOption identity. No second registry,
   no fuzzy matching, no fallback guessing. */

import {
  categorySizeGroupKind,
} from "../size-sections";
import { normalizeSourceSize } from "./normalize";
import {
  isSizeAudienceId,
  isSizeProductTypeId,
  isSizeSystemId,
} from "./registry";
import type {
  NormalizationReason,
} from "./normalization-types";
import type {
  NormalizedSize,
  SizeNormalizationContext,
} from "./normalization-types";
import type {
  SizeAudienceId,
  SizeCategoryId,
  SizeProductTypeId,
  SizeSystemId,
} from "./types";

/* ==== Input shapes (structural subsets of the real rows) ==== */

export type ProductSizeContextInput = {
  /* Product.gender (Gender? on the real row). */
  gender?: string | null;
  /* Product.category.name. */
  categoryName?: string | null;
  /* Product.sourceId / Product.source.name. */
  sourceId?: string | null;
  sourceName?: string | null;
};

export type LegacyVariantSizeInput = {
  variantId: string;
  size: {
    value: string | null;
    system?: string | null;
    productType?: string | null;
    audience?: string | null;
  } | null;
  availability?: string | null;
};

export type OfferVariantSizeInput = {
  offerId: string;
  variantKey: string;
  sourceId?: string | null;
  sourceName?: string | null;
  sizeValue: string | null;
  sizeSystem?: string | null;
  sizeProductType?: string | null;
  sizeAudience?: string | null;
  availability?: string | null;
};

export type ProductSizeInput = {
  productId: string;
  context: ProductSizeContextInput;
  variants?: readonly LegacyVariantSizeInput[];
  offerVariants?: readonly OfferVariantSizeInput[];
};

/* ==== Output shapes ==== */

export type ProductSizeObservationOrigin = "variant" | "offer";

/* A derived, documented view over the Stage B vocabulary. It does not
   replace `NormalizedSize.reason`; it exists so coverage can be grouped
   into the four classes this stage must report. */
export type SizeObservationClass =
  | "RESOLVED"
  | "UNRESOLVED"
  | "INSUFFICIENT_CONTEXT"
  | "AMBIGUOUS";

export type ProductSizeObservation = {
  productId: string;
  origin: ProductSizeObservationOrigin;
  variantId: string | null;
  offerId: string | null;
  offerVariantKey: string | null;
  sourceId: string | null;
  sourceName: string | null;
  /* Verbatim what the catalog said. Never overwritten by the canonical. */
  sourceSizeLabel: string;
  sourceSystem: string | null;
  sourceProductType: string | null;
  sourceAudience: string | null;
  /* Verbatim availability; `available` is a conservative narrowing. */
  availability: string | null;
  available: boolean | null;
  context: SizeNormalizationContext;
  normalization: NormalizedSize;
  classification: SizeObservationClass;
};

/* ==== Context construction (only from real fields) ==== */

function mapStoredAudience(
  rawAudience: string | null | undefined,
  gender: string | null | undefined
): SizeAudienceId {
  if (
    rawAudience != null &&
    isSizeAudienceId(rawAudience) &&
    rawAudience !== "UNKNOWN"
  ) {
    return rawAudience;
  }
  if (gender != null && isSizeAudienceId(gender)) {
    return gender;
  }
  return "UNKNOWN";
}

function mapStoredProductType(
  rawProductType: string | null | undefined,
  categoryName: string | null | undefined
): SizeProductTypeId {
  if (
    rawProductType != null &&
    isSizeProductTypeId(rawProductType) &&
    rawProductType !== "UNKNOWN"
  ) {
    return rawProductType;
  }
  const name = categoryName?.trim() ?? "";
  if (name === "") {
    return "UNKNOWN";
  }
  switch (categorySizeGroupKind(name)) {
    case "shoes":
      return "FOOTWEAR";
    case "accessories":
      return "ACCESSORY";
    case "headwear":
      return "HEADWEAR";
    default:
      return "CLOTHING";
  }
}

function mapStoredSystem(
  rawSystem: string | null | undefined
): SizeSystemId | null {
  if (
    rawSystem != null &&
    isSizeSystemId(rawSystem) &&
    rawSystem !== "UNKNOWN"
  ) {
    return rawSystem;
  }
  return null;
}

/* Only bra carries meaning at the size-category level for Stage B; the
   remaining categories are optional and left conservative. */
function mapStoredCategory(
  categoryName: string | null | undefined
): SizeCategoryId | null {
  const name = categoryName?.trim().toLowerCase() ?? "";
  if (name === "") {
    return null;
  }
  if (name === "bra" || name === "bras") {
    return "bra";
  }
  switch (categorySizeGroupKind(categoryName ?? "")) {
    case "shoes":
      return "footwear";
    case "headwear":
      return "hat";
    default:
      return "clothing";
  }
}

function classificationOf(size: NormalizedSize): SizeObservationClass {
  if (size.status === "RESOLVED") {
    return "RESOLVED";
  }
  switch (size.reason) {
    case "INSUFFICIENT_CONTEXT":
      return "INSUFFICIENT_CONTEXT";
    case "CONTEXT_MISMATCH":
    case "CONFLICTING_SYSTEM":
      return "AMBIGUOUS";
    default:
      return "UNRESOLVED";
  }
}

function narrowAvailability(
  availability: string | null | undefined
): boolean | null {
  if (availability === "AVAILABLE") return true;
  if (availability === "OUT_OF_STOCK") return false;
  return null;
}

function buildContext(
  input: ProductSizeContextInput,
  overrides: {
    system?: string | null;
    productType?: string | null;
    audience?: string | null;
  }
): SizeNormalizationContext {
  return {
    audience: mapStoredAudience(overrides.audience, input.gender),
    productType: mapStoredProductType(
      overrides.productType,
      input.categoryName
    ),
    system: mapStoredSystem(overrides.system),
    category: mapStoredCategory(input.categoryName),
    ageRange: null,
  };
}

/* ==== Integration entry point ==== */

function observe(
  input: ProductSizeInput,
  origin: ProductSizeObservationOrigin,
  identity: {
    variantId?: string | null;
    offerId?: string | null;
    offerVariantKey?: string | null;
  },
  source: { sourceId?: string | null; sourceName?: string | null },
  size: {
    value: string;
    system?: string | null;
    productType?: string | null;
    audience?: string | null;
  },
  availability: string | null,
  context: SizeNormalizationContext
): ProductSizeObservation {
  const normalization = normalizeSourceSize(size.value, context);
  return {
    productId: input.productId,
    origin,
    variantId: identity.variantId ?? null,
    offerId: identity.offerId ?? null,
    offerVariantKey: identity.offerVariantKey ?? null,
    sourceId: source.sourceId ?? input.context.sourceId ?? null,
    sourceName: source.sourceName ?? input.context.sourceName ?? null,
    sourceSizeLabel: size.value,
    sourceSystem: size.system ?? null,
    sourceProductType: size.productType ?? null,
    sourceAudience: size.audience ?? null,
    availability,
    available: narrowAvailability(availability),
    context,
    normalization,
    classification: classificationOf(normalization),
  };
}

/* Deterministic: variants first (input order), then offer variants
   (input order); rows with no size value produce no observation. */
export function integrateProductSizes(
  input: ProductSizeInput
): ProductSizeObservation[] {
  const observations: ProductSizeObservation[] = [];

  for (const variant of input.variants ?? []) {
    const value = variant.size?.value ?? null;
    if (value == null || value.trim() === "") {
      continue;
    }
    const context = buildContext(input.context, {
      system: variant.size?.system,
      productType: variant.size?.productType,
      audience: variant.size?.audience,
    });
    observations.push(
      observe(
        input,
        "variant",
        { variantId: variant.variantId },
        {},
        {
          value,
          system: variant.size?.system,
          productType: variant.size?.productType,
          audience: variant.size?.audience,
        },
        variant.availability ?? null,
        context
      )
    );
  }

  for (const offerVariant of input.offerVariants ?? []) {
    const value = offerVariant.sizeValue ?? null;
    if (value == null || value.trim() === "") {
      continue;
    }
    const context = buildContext(input.context, {
      system: offerVariant.sizeSystem,
      productType: offerVariant.sizeProductType,
      audience: offerVariant.sizeAudience,
    });
    observations.push(
      observe(
        input,
        "offer",
        { offerId: offerVariant.offerId, offerVariantKey: offerVariant.variantKey },
        {
          sourceId: offerVariant.sourceId,
          sourceName: offerVariant.sourceName,
        },
        {
          value,
          system: offerVariant.sizeSystem,
          productType: offerVariant.sizeProductType,
          audience: offerVariant.sizeAudience,
        },
        offerVariant.availability ?? null,
        context
      )
    );
  }

  return observations;
}

/* ==== Re-export the Stage B reason vocabulary for consumers ==== */
export type { NormalizationReason };
