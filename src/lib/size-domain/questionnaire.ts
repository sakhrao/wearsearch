/* H2: Questionnaire → canonical size adapter.
 *
 * The questionnaire owns the *context* of a size pick (who is wearing
 * the item, which product type the section belongs to, which sizing
 * system the section is tagged with, which category was chosen). This
 * module turns that context plus the raw picked value into the single
 * canonical size identity the Stage A–F domain already uses, by calling
 * the one authoritative normalizer (`normalizeSourceSize`).
 *
 * It never invents an identity: an unresolved value yields
 * `canonicalSizeOptionId: null` (and the pick stays UNRESOLVED), exactly
 * like the product-side pipeline. The user-visible label is left alone
 * (`Medium` stays `Medium`); only the identity is canonical.
 *
 * No second registry, no hardcoded size lists, no cross-system
 * conversion. Nothing here imports `../sizes` (the shared ORDERED_ALPHA
 * ladder is reached the one way already used by `aliases.ts`), so the
 * module is safe for both server and client bundles.
 */

import { normalizeSourceSize } from "./normalize";
import {
  isSizeAudienceId,
  isSizeSystemId,
} from "./registry";
import type {
  SizeAudienceId,
  SizeCategoryId,
  SizeProductTypeId,
  SizeSystemId,
} from "./types";
import type { NormalizationReason } from "./normalization-types";

export type QuestionnaireSizeContext = {
  audience: SizeAudienceId;
  productType: SizeProductTypeId;
  /* Raw section system (e.g. "EU", "INTERNATIONAL", or a
     non-canonical label such as "Letters"). The normalizer validates
     it: an unrecognized system never resolves. */
  system?: string | null;
  category?: SizeCategoryId | null;
};

export type QuestionnaireSizeSelection = {
  sourceLabel: string;
  /* Canonical display value when resolved, else the raw source label. */
  displayLabel: string;
  canonicalSizeOptionId: string | null;
  canonicalValue: string | null;
  system: SizeSystemId | null;
  systemPersisted: boolean;
  resolutionStatus: "RESOLVED" | "UNRESOLVED";
  reason: NormalizationReason | null;
};

export function canonicalizeQuestionnaireSize(
  value: string,
  context: QuestionnaireSizeContext
): QuestionnaireSizeSelection {
  const normalized = normalizeSourceSize(value, {
    audience: context.audience,
    productType: context.productType,
    /* The domain normalizer rejects an unknown/unsupported system at
       runtime; the cast only satisfies the narrower public type. */
    system: (context.system ?? null) as SizeSystemId | null,
    category: context.category ?? null,
  });

  return {
    sourceLabel: normalized.sourceLabel,
    displayLabel: normalized.displayLabel ?? normalized.sourceLabel,
    canonicalSizeOptionId: normalized.canonicalSizeOptionId,
    canonicalValue: normalized.canonicalValue,
    system: normalized.system,
    systemPersisted: normalized.systemPersisted,
    resolutionStatus: normalized.status,
    reason: normalized.reason,
  };
}

export type ParsedCanonicalSizeOptionId = {
  audience: SizeAudienceId | null;
  productType: SizeProductTypeId | null;
  system: SizeSystemId | null;
  value: string | null;
};

/* Inverse of `canonicalSizeOptionId` (audience|discipline|system|value)
 * for restore: recover the value/system the questionnaire should
 * preselect without re-guessing anything the URL already carries. */
export function parseCanonicalSizeOptionId(
  id: string
): ParsedCanonicalSizeOptionId | null {
  const parts = id.split("|");
  if (parts.length < 4) {
    return null;
  }
  const audienceRaw = parts[0];
  const disciplineRaw = parts[1];
  const systemRaw = parts[2];
  const value = parts.slice(3).join("|");
  if (!value) {
    return null;
  }
  return {
    audience: isSizeAudienceId(audienceRaw) ? audienceRaw : null,
    productType:
      disciplineRaw === "shoes"
        ? "FOOTWEAR"
        : disciplineRaw === "clothing"
          ? "CLOTHING"
          : null,
    system: isSizeSystemId(systemRaw) ? systemRaw : null,
    value,
  };
}
