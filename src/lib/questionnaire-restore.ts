import {
  EMPTY_ANSWERS,
  type QuestionnaireAnswers,
  type SizeAnswer,
} from "./questionnaire";
import {
  findNodeByCategoryName,
  getGenderTree,
  pathToNode,
} from "./catalog/taxonomy";
import type {
  ContextualSizeAudience,
  ContextualProductType,
} from "./sizes";
import { parseCanonicalSizeOptionId } from "./size-domain/questionnaire";

export type StructuredQueryShape = {
  gender?: string | null;
  brand?: string | null;
  category?: string | null;
  size?: string | null;
  colors?: string[] | null;
  attributes?: {
    attributeName: string;
    value: string;
  }[] | null;
  budget?: {
    min: number | null;
    max: number | null;
  } | null;
};

/* H2: the canonical size filter the results URL carries, used to
   restore the size step without re-guessing context. */
export type CanonicalSizeFilterShape = {
  size?: string[] | null;
  sizeSystem?: string[] | null;
};

export type IntentBudgetShape = {
  min?: string | null;
  max?: string | null;
  currency?: "USD" | "EUR" | null;
} | null;

const canon = (word: string): string =>
  word.toLowerCase().replace(/[^a-z0-9]/g, "");

const singular = (word: string): string =>
  word.endsWith("s") ? word.slice(0, -1) : word;

const BLOCKED_TOKENS = new Set(["size", "sizes"]);

function coverWord(
  covered: Set<string>,
  word: string
) {
  const c = canon(word);
  if (c === "") {
    return;
  }
  covered.add(c);
  covered.add(singular(c));
}

/* H2: rebuild the size answer from the canonical filter the results URL
   carries. A resolved identity restores the value + system + identity
   (so the chip preselects by identity, never by a label guess); a bare
   system pin restores an UNRESOLVED answer with that system. */
function sizeAnswerFromCanonical(
  filter: CanonicalSizeFilterShape | null | undefined
): SizeAnswer | null {
  const identity = (filter?.size ?? []).find(
    (entry) => entry.trim() !== ""
  );
  if (identity) {
    const parsed = parseCanonicalSizeOptionId(identity);
    const audience: ContextualSizeAudience | null =
      parsed?.audience === "MEN" ||
      parsed?.audience === "WOMEN" ||
      parsed?.audience === "KIDS" ||
      parsed?.audience === "UNISEX"
        ? parsed.audience
        : null;
    const productType: ContextualProductType | null =
      parsed?.productType === "CLOTHING" ||
      parsed?.productType === "FOOTWEAR"
        ? parsed.productType
        : null;
    return {
      value: parsed?.value ?? identity,
      audience,
      productType,
      category: null,
      system: parsed?.system ?? null,
      canonicalSizeOptionId: identity,
      resolutionStatus: "RESOLVED",
    };
  }

  const systemPin = (filter?.sizeSystem ?? []).find(
    (entry) => entry.trim() !== ""
  );
  if (systemPin) {
    return {
      value: "",
      audience: null,
      productType: null,
      category: null,
      system: systemPin,
      canonicalSizeOptionId: null,
      resolutionStatus: "UNRESOLVED",
    };
  }

  return null;
}

export function buildEditAnswers(
  query: string,
  structuredQuery: StructuredQueryShape | null,
  intentBudget: IntentBudgetShape,
  canonicalSize?: CanonicalSizeFilterShape | null
): QuestionnaireAnswers {
  const answers: QuestionnaireAnswers = {
    ...EMPTY_ANSWERS,
    colors: structuredQuery?.colors ?? [],
    attributes: (structuredQuery?.attributes ?? []).map(
      ({ value }) => value
    ),
  };

  if (
    structuredQuery?.gender &&
    structuredQuery.gender !== "UNISEX"
  ) {
    answers.gender = structuredQuery.gender.toLowerCase();
  } else if (structuredQuery?.gender === "UNISEX") {
    /* Unisex is no longer offered as a questionnaire gender option
       (the gender step is Women / Men / Kids), so a UNISEX-detected
       query restores no gender: the user picks the audience the
       shared item is actually worn by. The gender token is still
       covered so it never leaks into free text. */
    answers.gender = null;
  }

  if (structuredQuery?.category) {
    answers.category = structuredQuery.category;
    /* Also resolve where the restored category lives in the taxonomy
       tree, so Back/Edit reopens the drill-down on the same branch the
       user had picked instead of resetting to the top level. */
    const tree = getGenderTree(answers.gender);
    const node = findNodeByCategoryName(
      tree,
      structuredQuery.category
    );
    answers.categoryId = node?.id ?? null;
    answers.categoryPath = node
      ? pathToNode(tree, node.id)
      : [];
  }

  /* H2: a canonical size filter (from the results URL) is authoritative.
     Otherwise fall back to the legacy bare token still present in `q`.
     A bare token restores the value only: the QR string carries no
     audience/system/category context, and re-guessing one would be
     reinterpretation (Stage 3-A forbids inventing context). */
  const restoredSize = sizeAnswerFromCanonical(canonicalSize);
  if (restoredSize) {
    answers.size = restoredSize;
  } else if (structuredQuery?.size) {
    answers.size = {
      value: structuredQuery.size,
      audience: null,
      productType: null,
      category: null,
      system: null,
      canonicalSizeOptionId: null,
      resolutionStatus: "UNRESOLVED",
    };
  }

  const coveredWords = new Set<string>();

  for (const word of BLOCKED_TOKENS) {
    coverWord(coveredWords, word);
  }

  for (const word of [
    structuredQuery?.gender,
    structuredQuery?.category,
    structuredQuery?.size,
    answers.size?.value,
    ...(structuredQuery?.brand ?? "").split(/\s+/),
    ...(structuredQuery?.colors ?? []),
  ]) {
    if (word) {
      coverWord(coveredWords, word);
    }
  }

  for (const attribute of structuredQuery?.attributes ?? []) {
    coverWord(coveredWords, attribute.attributeName);
    coverWord(coveredWords, attribute.value);
  }

  const leftoverWords = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !coveredWords.has(canon(token)));

  answers.searchText = leftoverWords.join(" ");

  const displayMin = intentBudget?.min ?? null;
  const displayMax = intentBudget?.max ?? null;
  const budget = structuredQuery?.budget ?? null;

  if (displayMin != null || displayMax != null) {
    answers.budgetMin = displayMin ?? "";
    answers.budgetMax = displayMax ?? "";
    answers.budgetCurrency = intentBudget?.currency ?? null;
  } else if (budget && (budget.min != null || budget.max != null)) {
    answers.budgetMin =
      budget.min == null ? "" : String(budget.min);
    answers.budgetMax =
      budget.max == null ? "" : String(budget.max);
    answers.budgetCurrency = "EUR";
  } else {
    answers.budgetCurrency = null;
  }

  return answers;
}