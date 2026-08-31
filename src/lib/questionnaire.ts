import type {
  ContextualSizeAudience,
  ContextualProductType,
} from "./sizes";

export type StepKey =
  | "category"
  | "gender"
  | "colors"
  | "size"
  | "budget"
  | "details";

export const STEP_KEYS: StepKey[] = [
  "category",
  "gender",
  "colors",
  "size",
  "budget",
  "details",
];

/* The What / Who steps are mandatory: they cannot be
   skipped and Next only enables once answered. All other
   steps are optional: Next requires an answer (otherwise
   the only way forward is Skip). */
export const REQUIRED_STEPS = new Set<StepKey>([
  "category",
  "gender",
]);

export const GENDER_OPTIONS = [
  "women",
  "men",
  "kids",
] as const;

export function isValidGender(
  value: string
): boolean {
  return (
    GENDER_OPTIONS as readonly string[]
  ).includes(value);
}

export function genderToAudience(
  gender: string | null
): ContextualSizeAudience | null {
  if (gender === "women") return "WOMEN";
  if (gender === "men") return "MEN";
  if (gender === "kids") return "KIDS";
  return null;
}

export type QuestionnaireAnswers = {
  category: string | null;
  gender: string | null;
  colors: string[];
  searchText: string;
  size: SizeAnswer | null;
  budgetMin: string;
  budgetMax: string;
  budgetCurrency: "USD" | "EUR" | null;
  attributes: string[];
};

/* The size answer is contextual (Stage 3-A): the questionnaire
   stores which value was picked and what context it belongs to. The
   URL/q payload stays a bare value token — context lives in this
   answer only, never in the query string (URL/q semantics are 3-C). */
export type SizeAnswer = {
  value: string;
  audience: ContextualSizeAudience | null;
  productType: ContextualProductType | null;
  category: string | null;
  system: string | null;
};

export const EMPTY_ANSWERS: QuestionnaireAnswers = {
  category: null,
  gender: null,
  colors: [],
  searchText: "",
  size: null,
  budgetMin: "",
  budgetMax: "",
  budgetCurrency: null,
  attributes: [],
};

export function hasStepAnswer(
  key: StepKey,
  answers: QuestionnaireAnswers
): boolean {
  switch (key) {
    case "category":
      return answers.category !== null;
    case "gender":
      return answers.gender !== null;
    case "colors":
      return answers.colors.length > 0;
    case "size":
      return answers.size !== null;
    case "budget":
      return (
        answers.budgetMin.trim() !== "" ||
        answers.budgetMax.trim() !== ""
      );
    case "details":
      return (
        answers.attributes.length > 0 ||
        answers.searchText.trim() !== ""
      );
  }
}

export type StepState = {
  key: StepKey;
  index: number;
  required: boolean;
  hasAnswer: boolean;
  canSkip: boolean;
  canNext: boolean;
};

export function getStepState(
  key: StepKey,
  answers: QuestionnaireAnswers
): StepState {
  const index = STEP_KEYS.indexOf(key);
  const required = REQUIRED_STEPS.has(key);
  const hasAnswer = hasStepAnswer(key, answers);
  return {
    key,
    index,
    required,
    hasAnswer,
    canSkip: !required,
    canNext: hasAnswer,
  };
}