import {
  STEP_KEYS,
  REQUIRED_STEPS,
  GENDER_OPTIONS,
  isValidGender,
  EMPTY_ANSWERS,
  getStepState,
  hasStepAnswer,
} from "../src/lib/questionnaire";

let passed = 0;
let failed = 0;

function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name} :: ${detail}`);
  }
}

function fillAnswers(overrides) {
  return {
    ...EMPTY_ANSWERS,
    ...overrides,
  };
}

/* 1. Step structure: six steps in the fixed order */
{
  check(
    "STEP_KEYS has 6 steps in order",
    STEP_KEYS.length === 6 &&
      STEP_KEYS.join(",") ===
        "category,gender,colors,size,budget,details",
    STEP_KEYS.join(",")
  );
  check(
    "REQUIRED_STEPS = exactly {category, gender}",
    REQUIRED_STEPS.size === 2 &&
      REQUIRED_STEPS.has("category") &&
      REQUIRED_STEPS.has("gender"),
    [...REQUIRED_STEPS].join(",")
  );
}

/* 2. Required steps (What / Who): cannot be skipped; Next is
   disabled without an answer and enabled once answered */
{
  for (const key of ["category", "gender"]) {
    const empty = getStepState(key, EMPTY_ANSWERS);
    check(
      `"${key}" is required`,
      empty.required === true,
      `required=${empty.required}`
    );
    check(
      `"${key}" cannot be skipped`,
      empty.canSkip === false,
      `canSkip=${empty.canSkip}`
    );
    check(
      `"${key}" Next disabled without an answer`,
      empty.canNext === false,
      `canNext=${empty.canNext}`
    );

    const filled = getStepState(
      key,
      fillAnswers({ [key]: "x" })
    );
    check(
      `"${key}" Next enabled once answered`,
      filled.canNext === true,
      `canNext=${filled.canNext}`
    );
  }
}

/* 3. Optional steps: Skip always available; Next only with an
   answer (otherwise the only way forward is Skip) */
{
  for (const key of ["colors", "size", "budget", "details"]) {
    const empty = getStepState(key, EMPTY_ANSWERS);
    check(
      `"${key}" is optional`,
      empty.required === false,
      `required=${empty.required}`
    );
    check(
      `"${key}" can be skipped`,
      empty.canSkip === true,
      `canSkip=${empty.canSkip}`
    );
    check(
      `"${key}" Next disabled without an answer`,
      empty.canNext === false,
      `canNext=${empty.canNext}`
    );

    const overrides = {
      colors: fillAnswers({ colors: ["Black"] }),
      size: fillAnswers({ size: "M" }),
      budget: fillAnswers({ budgetMax: "80" }),
      details: fillAnswers({ attributes: ["Cotton"] }),
    };
    const filled = getStepState(key, overrides[key]);
    check(
      `"${key}" Next enabled with an answer`,
      filled.canNext === true,
      `canNext=${filled.canNext}`
    );
  }
}

/* 4. The colors step also counts free words as an answer */
{
  const wordsOnly = fillAnswers({
    searchText: "oversized striped",
  });
  check(
    "colors step counts free words as an answer",
    hasStepAnswer("colors", wordsOnly) === true,
    `hasAnswer=${hasStepAnswer("colors", wordsOnly)}`
  );
}

/* 5. Gender options: only Men / Women / Kids — no Unisex offered,
   matching the engine's Men/Women/Kids + UNISEX-admission policy */
{
  check(
    "GENDER_OPTIONS are exactly women/men/kids",
    GENDER_OPTIONS.length === 3 &&
      GENDER_OPTIONS.includes("women") &&
      GENDER_OPTIONS.includes("men") &&
      GENDER_OPTIONS.includes("kids"),
    GENDER_OPTIONS.join(",")
  );
  check(
    "unisex is not offered as a user choice",
    GENDER_OPTIONS.includes("unisex") === false &&
      isValidGender("unisex") === false,
    `GENDER_OPTIONS=${GENDER_OPTIONS.join(",")}`
  );
  check(
    "men/women/kids are valid gender answers",
    isValidGender("men") &&
      isValidGender("women") &&
      isValidGender("kids"),
    "expected true"
  );
}

console.log(`\n=== RESULT: ${passed}/${passed + failed} passed ===`);
process.exit(failed === 0 ? 0 : 1);