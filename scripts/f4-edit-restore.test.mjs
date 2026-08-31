/* F4 Edit-search restoration contract tests (pure, no server
   needed).

   Verifies that an Edit-search handoff rebuilds questionnaire
   answers with no word duplication (structured fields cover
   their query tokens, only leftovers become free text), that
   the budget is restored with the display values + currency the
   user actually entered (never an invented conversion), and that
   older drafts without budgetCurrency keep a null default. */
import { buildEditAnswers } from "../src/lib/questionnaire-restore";
import { EMPTY_ANSWERS } from "../src/lib/questionnaire";
import { usdToEur } from "../src/lib/currency";

let passed = 0;
let failed = 0;

function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name} :: ${detail ?? ""}`);
  }
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* Mirrors find/buildIntent composition (excluding budget, which
   is numeric-only). Used to prove no duplication on re-submit.
   The system prefix mirrors R8: when a size answer carries an
   explicit system it is emitted adjacent to the value, else the
   bare value is used (never guess a system). */
function builtIntentText(answers) {
  const parts = [];
  if (answers.gender) parts.push(answers.gender);
  for (const color of answers.colors) parts.push(color);
  if (answers.size) {
    const opts = answers.size.system || "";
    const sys = opts.trim().toLowerCase();
    const known = [
      "eu",
      "us",
      "uk",
      "it",
      "fr",
      "international",
    ].includes(sys);
    parts.push(known ? `${sys} ${answers.size.value}` : answers.size.value);
  }
  if (answers.searchText.trim())
    parts.push(answers.searchText.trim());
  if (answers.category) parts.push(answers.category);
  return parts.join(" ");
}

const empty = {
  gender: null,
  brand: null,
  category: null,
  size: null,
  colors: [],
  attributes: [],
  budget: null,
};

/* 1. Full round-trip: every structured field restored, no
   leftover text, budget restored as entered. */
{
  const answers = buildEditAnswers(
    "women red linen trousers size 30 nike",
    {
      gender: "WOMEN",
      brand: "Nike",
      category: "Trousers",
      colors: ["Red"],
      size: "30",
      attributes: [{ attributeName: "Material", value: "Linen" }],
      budget: { min: 25, max: 92.6 },
    },
    { min: "30", max: "100", currency: "USD" }
  );
  check("full round-trip gender", answers.gender === "women");
  check("full round-trip category", answers.category === "Trousers");
  check("full round-trip colors", eq(answers.colors, ["Red"]));
  check(
    "full round-trip size value",
    answers.size?.value === "30"
  );
  check(
    "value-only restore keeps context fields null (no guessing)",
    answers.size &&
      answers.size.audience === null &&
      answers.size.productType === null &&
      answers.size.category === null &&
      answers.size.system === null
  );
  check("full round-trip attributes", eq(answers.attributes, ["Linen"]));
  check("full round-trip no leftover", answers.searchText === "");
  check(
    "full round-trip budget display values",
    answers.budgetMin === "30" && answers.budgetMax === "100"
  );
  check("full round-trip budget currency", answers.budgetCurrency === "USD");
  const text = builtIntentText(answers);
  check(
    "full round-trip rebuild has no repeated words",
    (() => {
      const words = text.toLowerCase().split(/\s+/);
      return words.length === new Set(words).size;
    })(),
    text
  );
}

/* 2. No duplication: red blouse nike -> Red Blouses, never
   "Red red blouse nike Blouses". */
{
  const answers = buildEditAnswers(
    "red blouse nike",
    {
      gender: null,
      brand: "Nike",
      category: "Blouses",
      colors: ["Red"],
      attributes: [],
      budget: null,
    },
    null
  );
  check("dup case colors", eq(answers.colors, ["Red"]));
  check("dup case category", answers.category === "Blouses");
  check("dup case no leftover", answers.searchText === "");
  check(
    "dup case rebuilt text deduped",
    builtIntentText(answers) === "Red Blouses",
    builtIntentText(answers)
  );
}

/* 3. Budget restored as display values + USD, not EUR. */
{
  const answers = buildEditAnswers(
    "trousers",
    {
      ...empty,
      category: "Trousers",
      budget: { min: 18.5, max: 92.6 },
    },
    { min: "20", max: "100", currency: "USD" }
  );
  check(
    "USD restored with original values",
    answers.budgetMin === "20" && answers.budgetMax === "100"
  );
  check("USD restored currency", answers.budgetCurrency === "USD");
}

/* 4. No invented conversion when FX is missing. buildEditAnswers
   never converts; a simulated find build keeps USD values as-is
   without a rate and converts via the documented rate when one
   exists (usdToEur). */
{
  const answers = buildEditAnswers(
    "blouse",
    {
      ...empty,
      budget: { min: 46.3, max: 138.89 },
    },
    { min: "50", max: "150", currency: "USD" }
  );

  const rate = null;
  const priceMin =
    answers.budgetMin === ""
      ? null
      : Number(answers.budgetMin);
  const priceMax =
    answers.budgetMax === ""
      ? null
      : Number(answers.budgetMax);
  const effectiveRate =
    answers.budgetCurrency === "USD" ? rate : null;

  check(
    "no-fx keeps USD display values untouched",
    answers.budgetMin === "50" && answers.budgetCurrency === "USD"
  );
  check(
    "no-fx no invented conversion (as-is)",
    effectiveRate === null &&
      String(priceMin) === "50" &&
      String(priceMax) === "150"
  );

  const liveRate = 1.08;
  const convertedMin =
    answers.budgetCurrency === "USD"
      ? usdToEur(priceMin, liveRate)
      : priceMin;
  check(
    "with fx USD converts via documented rate",
    convertedMin === usdToEur(50, liveRate) && convertedMin !== 50,
    String(convertedMin)
  );
}

/* 5. EUR fallback: no display values -> structuredQuery.budget
   (engine EUR) is used as the source, labeled EUR. */
{
  const answers = buildEditAnswers(
    "women blouse",
    {
      ...empty,
      gender: "WOMEN",
      category: "Blouses",
      budget: { min: 46.3, max: 120 },
    },
    null
  );
  check("EUR fallback accepts engine values", answers.budgetMin === "46.3");
  check("EUR fallback accepts engine max", answers.budgetMax === "120");
  check("EUR fallback currency", answers.budgetCurrency === "EUR");
  check("EUR fallback no leftover", answers.searchText === "");
}

/* 6. Attributes / soft filters: values restored and their query
   tokens (name + value) are covered, so no duplication. */
{
  const answers = buildEditAnswers(
    "cotton white blouse",
    {
      ...empty,
      category: "Blouses",
      colors: ["White"],
      attributes: [{ attributeName: "Material", value: "Cotton" }],
    },
    null
  );
  check("soft attributes restored", eq(answers.attributes, ["Cotton"]));
  check("soft colors restored", eq(answers.colors, ["White"]));
  check("soft tokens no leftover", answers.searchText === "");
}

/* 7. Old drafts without budgetCurrency merge to a null default. */
{
  const oldDraft = {
    category: "Blouses",
    gender: "women",
    colors: ["Red"],
    searchText: "red",
    size: null,
    budgetMin: "50",
    budgetMax: "",
    attributes: [],
  };
  const merged = {
    ...EMPTY_ANSWERS,
    ...oldDraft,
    colors: oldDraft.colors ?? [],
    attributes: oldDraft.attributes ?? [],
  };
  check("old draft keeps budget", merged.budgetMin === "50");
  check(
    "old draft budgetCurrency is null (not undefined)",
    merged.budgetCurrency === null
  );
  check("old draft budgetCurrency key exists", "budgetCurrency" in merged);
}

/* Extra: query-only restore keeps free text as-is. */
{
  const answers = buildEditAnswers(
    "hoodi",
    {
      ...empty,
    },
    null
  );
  check("no-structure keeps free text", answers.searchText === "hoodi");
  check("no-structure no budget", answers.budgetCurrency === null);
}

/* Extra: UNISEX gender is not restored into the answers. */
{
  const answers = buildEditAnswers(
    "unisex hoodie",
    {
      ...empty,
      gender: "UNISEX",
      category: "Hoodies",
    },
    null
  );
  check("UNISEX gender skipped", answers.gender === null);
  check("UNISEX token still covered", answers.searchText === "");
}

/* Extra: plural/singular category dedup. */
{
  const answers = buildEditAnswers(
    "women Blouses",
    {
      ...empty,
      gender: "WOMEN",
      category: "Blouses",
    },
    null
  );
  check("plural category dedup", answers.searchText === "");
  check("plural category rebuild", builtIntentText(answers) === "women Blouses");
}

/* Extra: multi-word brand words are covered. */
{
  const answers = buildEditAnswers(
    "the north face hoodie",
    {
      ...empty,
      brand: "The North Face",
      category: "Hoodies",
    },
    null
  );
  check("multi-word brand dedup", answers.searchText === "");
}

console.log(`\nf4-edit-restore: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}