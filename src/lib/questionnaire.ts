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

export type QuestionnaireAnswers = {
  category: string | null;
  gender: string | null;
  colors: string[];
  searchText: string;
  size: string | null;
  budgetMin: string;
  budgetMax: string;
  attributes: string[];
};

export const EMPTY_ANSWERS: QuestionnaireAnswers = {
  category: null,
  gender: null,
  colors: [],
  searchText: "",
  size: null,
  budgetMin: "",
  budgetMax: "",
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
      return (
        answers.colors.length > 0 ||
        answers.searchText.trim() !== ""
      );
    case "size":
      return answers.size !== null;
    case "budget":
      return (
        answers.budgetMin.trim() !== "" ||
        answers.budgetMax.trim() !== ""
      );
    case "details":
      return answers.attributes.length > 0;
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