import {
  EMPTY_ANSWERS,
  type QuestionnaireAnswers,
} from "./questionnaire";

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

export function buildEditAnswers(
  query: string,
  structuredQuery: StructuredQueryShape | null,
  intentBudget: IntentBudgetShape
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
  }

  if (structuredQuery?.category) {
    answers.category = structuredQuery.category;
  }

  if (structuredQuery?.size) {
    answers.size = structuredQuery.size;
  }

  const coveredWords = new Set<string>();

  for (const word of BLOCKED_TOKENS) {
    coverWord(coveredWords, word);
  }

  for (const word of [
    structuredQuery?.gender,
    structuredQuery?.category,
    structuredQuery?.size,
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