/* Evidence-based search diagnostics (spec §11, K1).

   Diagnosis-only: this module NEVER changes search membership,
   Exact/Similar separation, ranking, scores, gender policy,
   category policy or filter semantics. It reads a per-product
   "strict match vector" computed by the search route with the
   exact same predicates the Exact gate uses, and produces a
   classification that distinguishes:

   A — a size constraint that has no results in scope;
   B — every constraint exists individually but no single
       product satisfies the whole combination;
   C — the matching products carry no size data at all, so the
       requested size cannot be confirmed (never reported as a
       proof that the size is absent from the catalog).
*/

export interface DiagStrictVector {
  brand: boolean | null;
  category: boolean | null;
  color: boolean | null;
  size: boolean | null;
  gender: boolean | null;
  budget: boolean | null;
  attributes: boolean | null;
  hasAnySize: boolean;
}

export interface DetectedAttribute {
  attributeName: string;
  value: string;
}

export interface SearchDiagnosticsContext {
  categoryClause: string;
  requestedCategoryIsEmpty: boolean;
  detected: {
    brand: string | null;
    category: string | null;
    colors: string[];
    size: string | null;
    gender: string | null;
    hasBudget: boolean;
    budgetMin: number | null;
    budgetMax: number | null;
    attributes: DetectedAttribute[];
  };
  unsupportedIntentWords: string[];
  presence: {
    category: boolean;
    brand: boolean;
    color: boolean;
    size: boolean;
    gender: boolean;
    budget: boolean;
    attributes: boolean;
  };
  scopedVectors: DiagStrictVector[];
  allVectors: DiagStrictVector[];
}

type ConstraintKey =
  | "brand"
  | "category"
  | "color"
  | "size"
  | "gender"
  | "budget"
  | "attributes";

const humanizeGender = (value: string): string => {
  const lower = value.toLowerCase();
  return lower.length === 0
    ? value
    : lower[0].toUpperCase() + lower.slice(1);
};

const labelOf = (
  ctx: SearchDiagnosticsContext,
  key: ConstraintKey
): string => {
  switch (key) {
    case "brand":
      return ctx.detected.brand ?? "brand";
    case "category":
      return ctx.detected.category ?? "category";
    case "color":
      return (
        ctx.detected.colors.length > 0
          ? ctx.detected.colors.join(" or ")
          : "colors"
      );
    case "size":
      return `Size ${ctx.detected.size}`;
    case "gender":
      return ctx.detected.gender
        ? humanizeGender(ctx.detected.gender)
        : "gender";
    case "budget":
      return "the budget range";
    case "attributes":
      return ctx.detected.attributes.length > 0
        ? ctx.detected.attributes
            .map(
              (attribute) =>
                `"${attribute.attributeName}"`
            )
            .join(" and ")
        : "attributes";
  }
};

const detectedKeysOf = (
  ctx: SearchDiagnosticsContext
): ConstraintKey[] => {
  const keys: ConstraintKey[] = [];

  if (ctx.detected.brand) {
    keys.push("brand");
  }

  if (
    ctx.detected.category &&
    !ctx.requestedCategoryIsEmpty
  ) {
    keys.push("category");
  }

  if (ctx.detected.colors.length > 0) {
    keys.push("color");
  }

  if (ctx.detected.size) {
    keys.push("size");
  }

  if (ctx.detected.gender) {
    keys.push("gender");
  }

  if (ctx.detected.hasBudget) {
    keys.push("budget");
  }

  if (ctx.detected.attributes.length > 0) {
    keys.push("attributes");
  }

  return keys;
};

const individualAllPresent = (
  ctx: SearchDiagnosticsContext
): boolean =>
  detectedKeysOf(ctx).every((key) =>
    ctx.presence[key] === true
  );

const anyFullCombo = (
  ctx: SearchDiagnosticsContext,
  keys: ConstraintKey[]
): boolean =>
  ctx.scopedVectors.some((vector) =>
    keys.every((key) => vector[key] === true)
  );

const removableKeys = (
  ctx: SearchDiagnosticsContext,
  keys: ConstraintKey[]
): ConstraintKey[] =>
  keys.filter((removed) =>
    ctx.scopedVectors.some((vector) =>
      keys.every(
        (key) => key === removed || vector[key] === true
      )
    )
  );

const combinationConflictMessage = (
  ctx: SearchDiagnosticsContext,
  keys: ConstraintKey[]
): string => {
  const labels = keys.map((key) => labelOf(ctx, key));
  const message = `All of your preferences exist individually (${labels.join(
    ", "
  )}), but no single product matches all of them together.`;

  const removable = removableKeys(ctx, keys);

  if (removable.length === 1) {
    return `${message} Removing ${labelOf(
      ctx,
      removable[0]
    )} would find matching products.`;
  }

  return message;
};

/* Products that match every detected constraint except the size
   ("otherwise-matching"). Used to decide whether missing size data
   is the reason the requested size cannot be confirmed. */
const otherwiseMatchingProducts = (
  ctx: SearchDiagnosticsContext,
  keys: ConstraintKey[]
): DiagStrictVector[] =>
  ctx.scopedVectors.filter((vector) =>
    keys
      .filter((key) => key !== "size")
      .every((key) => vector[key] === true)
  );

const sizeValueExistsInCatalog = (
  ctx: SearchDiagnosticsContext
): boolean =>
  ctx.allVectors.some(
    (vector) => vector.size === true
  );

export const buildSearchDiagnostics = (
  ctx: SearchDiagnosticsContext
): string[] => {
  const messages: string[] = [];

  messages.push(
    "No products match all your preferences."
  );

  if (ctx.unsupportedIntentWords.length > 0) {
    messages.push(
      `No products in the catalog for "${ctx.unsupportedIntentWords[0]}".`
    );
  }

  if (
    ctx.requestedCategoryIsEmpty &&
    ctx.detected.category
  ) {
    messages.push(
      "This category currently has no products in the catalog."
    );
    return messages;
  }

  const detectedKeys = detectedKeysOf(ctx);

  if (!ctx.presence.brand && ctx.detected.brand) {
    messages.push(
      `No ${ctx.detected.brand} products are currently available${ctx.categoryClause}.`
    );
  }

  if (
    ctx.detected.colors.length > 0 &&
    !ctx.presence.color
  ) {
    messages.push(
      `No products in ${ctx.detected.colors.join(
        " or "
      )} are currently available${ctx.categoryClause}.`
    );
  }

  if (ctx.detected.size && !ctx.presence.size) {
    const candidates = otherwiseMatchingProducts(
      ctx,
      detectedKeys
    );

    const candidatesAllWithoutSizeData =
      candidates.length > 0 &&
      candidates.every(
        (candidate) => !candidate.hasAnySize
      );

    if (candidatesAllWithoutSizeData) {
      messages.push(
        `Some products match your other preferences but carry no size information in the catalog, so Size ${ctx.detected.size} cannot be confirmed for this combination.`
      );
    } else if (!sizeValueExistsInCatalog(ctx)) {
      messages.push(
        `Size ${ctx.detected.size} is entirely unavailable in the catalog.`
      );
    } else {
      messages.push(
        `Size ${ctx.detected.size} is currently unavailable in the catalog for this combination.`
      );
    }
  }

  if (!ctx.presence.gender && ctx.detected.gender) {
    messages.push(
      `No ${ctx.detected.gender.toLowerCase()} products are currently available${ctx.categoryClause}.`
    );
  }

  if (ctx.detected.hasBudget && !ctx.presence.budget) {
    messages.push(
      `No products match your budget range (${ctx.detected.budgetMin} - ${ctx.detected.budgetMax})${ctx.categoryClause}.`
    );
  }

  if (
    detectedKeys.length >= 1 &&
    individualAllPresent(ctx) &&
    !anyFullCombo(ctx, detectedKeys)
  ) {
    messages.push(
      combinationConflictMessage(ctx, detectedKeys)
    );
  }

  return messages;
};