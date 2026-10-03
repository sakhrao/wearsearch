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
  "gender",
  "category",
  "size",
  "colors",
  "budget",
  "details",
];

/* The Who (gender) / What (category) steps are mandatory: they cannot
   be skipped and Next only enables once answered. The category step
   filters its options by the picked gender, so answering Who first
   makes What genuinely gender-aware. All other steps are optional:
   Next requires an answer (otherwise the only way forward is Skip). */
export const REQUIRED_STEPS = new Set<StepKey>([
  "gender",
  "category",
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
  if (gender === "unisex") return "UNISEX";
  return null;
}

export type QuestionnaireAnswers = {
  category: string | null;
  /* Stable taxonomy ID of the deepest picked node (e.g.
     "mens_bottoms_jeans_skinny"). It is additive: `category` remains
     the legacy display-name token every downstream consumer already
     understands. */
  categoryId: string | null;
  /* The chain of taxonomy node ids from the root down to `categoryId`.
     The questionnaire replays this path on Back/Edit. */
  categoryPath: string[];
  /* Query tokens derived from the taxonomy path (style/fit words plus
     cross-tags). Kept separate from `detailTokens` so a taxonomy change
     recomputes them without disturbing the user's own detail chips. */
  taxonomyTokens: string[];
  /* Kids age bracket (Babies 0-3 / Kids 4-14), the filterable kids
     attribute. */
  kidsAge: string | null;
  gender: string | null;
  colors: string[];
  searchText: string;
  size: SizeAnswer | null;
  budgetMin: string;
  budgetMax: string;
  budgetCurrency: "USD" | "EUR" | null;
  attributes: string[];
  /* Structured detail picks that the current catalog cannot match via
     its attribute groups: every value is appended to the query as a
     real text token on submit (never a UI-only filter). Attribute
     groups the catalog DOES expose keep their picks in `attributes`. */
  detailTokens: string[];
};

/* The size answer is contextual (Stage 3-A): the questionnaire
   stores which value was picked and what context it belongs to.
   H2 adds the canonical identity the Stage A–F domain derives from
   that context: `canonicalSizeOptionId` is the identity the search
   channel filters on (null when the value is unresolved - never a
   guessed identity), while `value` stays the untouched source label
   the step displays (`Medium` stays `Medium`). */
export type SizeAnswer = {
  value: string;
  audience: ContextualSizeAudience | null;
  productType: ContextualProductType | null;
  category: string | null;
  system: string | null;
  canonicalSizeOptionId: string | null;
  resolutionStatus: "RESOLVED" | "UNRESOLVED";
};

export const EMPTY_ANSWERS: QuestionnaireAnswers = {
  category: null,
  categoryId: null,
  categoryPath: [],
  taxonomyTokens: [],
  kidsAge: null,
  gender: null,
  colors: [],
  searchText: "",
  size: null,
  budgetMin: "",
  budgetMax: "",
  budgetCurrency: null,
  attributes: [],
  detailTokens: [],
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
        answers.detailTokens.length > 0 ||
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