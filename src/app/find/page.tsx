"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { usdToEur } from "@/lib/currency";
import { buildSearchQueryString } from "@/lib/search-url";
import {
  EMPTY_ANSWERS,
  GENDER_OPTIONS,
  STEP_KEYS,
  genderToAudience,
  getStepState,
  type QuestionnaireAnswers,
} from "@/lib/questionnaire";
import {
  sizeSectionsFor,
  type SizeCatalog,
  type SizeSection,
} from "@/lib/sizes";

type Meta = {
  success: boolean;
  categories: {
    name: string;
    slug: string;
    group: string;
    parent: string | null;
    hasProducts: boolean;
  }[];
  colors: string[];
  sizes: string[];
  sizeGroups: { clothing: string[]; shoes: string[] };
  shoeSizeGroups: Record<string, string[]>;
  sizeCatalog: SizeCatalog;
  brands: string[];
  attributeGroups: Record<string, string[]>;
  fx: {
    rate: number | null;
    asOf: string | null;
    source: "ecb-frankfurter" | "env" | "none";
    from: string;
    to: string;
  } | null;
};

type FindIntent = {
  query: string;
  params: {
    priceMin: string | null;
    priceMax: string | null;
    soft: string | null;
    budgetCurrency: "USD" | "EUR" | null;
    budgetDisplayMin: string | null;
    budgetDisplayMax: string | null;
  };
};

type Answers = QuestionnaireAnswers;

const STORAGE_KEY = "wearsearch-find-answers";

const GROUP_ORDER = [
  "Tops",
  "Bottoms",
  "Shoes",
  "Accessories",
  "Headwear",
];

const CONTEXT_ATTRIBUTE_GROUPS: Record<
  string,
  string[]
> = {
  Tops: ["Sleeve", "Collar", "Fit", "Material", "Style", "Pattern"],
  Bottoms: ["Fit", "Material", "Style", "Pattern"],
  Shoes: ["Style", "Material"],
};

/* The catalog stocks products only in Tops / Bottoms / Shoes (the
   Accessories and Headwear categories are still empty), so no
   accessory/headwear attribute rows exist to derive option groups
   from; these present the recognized attribute groups only. Size
   options are never fabricated (Stage 3-A): when the contextual
   size catalog yields nothing for a category the step reports "No
   sizes available" instead of inventing belt/watch/cap sizes. */
const ACCESSORY_DETAIL_GROUPS: {
  name: string;
  values: string[];
}[] = [
  { name: "Type", values: ["Classic", "Modern", "Sport", "Formal"] },
  { name: "Shape", values: ["Slim", "Standard", "Compact"] },
  { name: "Material", values: ["Leather", "Metal", "Fabric", "Synthetic"] },
  { name: "Use", values: ["Everyday", "Formal", "Outdoor", "Gift"] },
];

const HEADWEAR_DETAIL_GROUPS: {
  name: string;
  values: string[];
}[] = [
  { name: "Type", values: ["Snapback", "Bucket", "Fedora", "Wide-Brim"] },
  { name: "Shape", values: ["Fitted", "Adjustable", "Stretch"] },
  { name: "Material", values: ["Wool", "Cotton", "Polyester", "Straw"] },
  { name: "Coverage", values: ["Full", "Partial", "None"] },
];

const GENDER_LABELS: Record<string, string> = {
  women: "Women",
  men: "Men",
  kids: "Kids",
};

function Chip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-4 py-2 text-sm transition-colors ${
        selected
          ? "border-black bg-black text-white"
          : "border-gray-300 bg-white text-gray-700 hover:border-gray-500"
      }`}
    >
      {label}
    </button>
  );
}

export default function FindPage() {
  const router = useRouter();
  const [meta, setMeta] =
    useState<Meta | null>(null);
  const [metaError, setMetaError] = useState<
    string | null
  >(null);

  const [step, setStep] = useState(0);
  const [answers, setAnswers] =
    useState<Answers>(EMPTY_ANSWERS);
  const [sessionReady, setSessionReady] =
    useState(false);
  const [colorFilter, setColorFilter] =
    useState("");

  useEffect(() => {
    const saved = sessionStorage.getItem(
      STORAGE_KEY
    );
    if (saved) {
      try {
        const parsed = JSON.parse(
          saved
        ) as Partial<Answers>;
        const restored: Answers = {
          ...EMPTY_ANSWERS,
          ...parsed,
          colors: parsed.colors ?? [],
          attributes:
            parsed.attributes ?? [],
        };
        // F4: rewrite the restored draft immediately so the
        // answers-persistence effect (which runs on the first
        // committed render with the untouched default) can
        // never clobber it with EMPTY_ANSWERS.
        sessionStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(restored)
        );
        // eslint-disable-next-line react-hooks/set-state-in-effect -- restore draft/flags once on mount
        setAnswers(restored);
      } catch {
        sessionStorage.removeItem(
          STORAGE_KEY
        );
      }
    }

    setSessionReady(true);

    fetch("/api/meta")
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            `Meta request failed: ${response.status}`
          );
        }
        return response.json();
      })
      .then((data: Meta) => setMeta(data))
      .catch(() =>
        setMetaError(
          "Could not load options. Please refresh the page."
        )
      );
  }, []);

  useEffect(() => {
    if (!sessionReady) return;
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(answers)
    );
  }, [answers, sessionReady]);

  const groupedCategories = useMemo(() => {
    if (!meta) return [];
    const groups = new Map<
      string,
      Meta["categories"]
    >();
    for (const category of meta.categories) {
      if (category.name === category.group) {
        continue;
      }
      const list =
        groups.get(category.group) ?? [];
      list.push(category);
      groups.set(category.group, list);
    }
    return GROUP_ORDER.filter((name) =>
      groups.has(name)
    ).map((group) => ({
      group,
      items: groups.get(group)!,
    }));
  }, [meta]);

  const selectedCategoryGroup = useMemo(() => {
    if (!meta || !answers.category) {
      return null;
    }
    return (
      meta.categories.find(
        (category) =>
          category.name === answers.category
      )?.group ?? null
    );
  }, [meta, answers.category]);

  /* Stage 3-A: size options come from the contextual catalog. The
     section list is audience + category driven (productType comes
     from the selected category), so women | Sneakers shows EU and US
     columns with only the values that buyable women's or unisex
     products actually carry, while accessories/headwear (no data)
     yield nothing -> "No sizes available for this category." No size
     is ever invented. */
  const sizeSections = useMemo<SizeSection[]>(() => {
    if (!meta) {
      return [];
    }
    return sizeSectionsFor({
      audience: genderToAudience(answers.gender),
      categoryName: answers.category,
      catalog: meta.sizeCatalog,
    });
  }, [meta, answers.gender, answers.category]);

  const fxRate = meta?.fx?.rate ?? null;
  /* A restored Edit-search draft pins the budget display
     currency (USD or EUR); a fresh flow keeps the F3
     default: USD when a rate is available, else EUR. */
  const budgetCurrencyLabel =
    answers.budgetCurrency ?? (fxRate ? "USD" : "EUR");

  const sizeStepLabel = useMemo(() => {
    const group = selectedCategoryGroup;
    if (group === "Shoes") {
      return "Shoe size";
    }
    if (group === "Accessories") {
      return "Accessory size";
    }
    if (group === "Headwear") {
      return "Headwear size";
    }
    return "Clothing size";
  }, [selectedCategoryGroup]);

  /* Detail chips. Accessories and Headwear get their own recognized
     option groups; Tops/Bottoms/Shoes keep the catalog-driven
     attribute groups (only groups present in the catalog). */
  const detailGroups = useMemo<
    { name: string; values: string[] }[]
  >(() => {
    if (!meta) {
      return [];
    }
    if (selectedCategoryGroup === "Accessories") {
      return ACCESSORY_DETAIL_GROUPS;
    }
    if (selectedCategoryGroup === "Headwear") {
      return HEADWEAR_DETAIL_GROUPS;
    }
    const preferred =
      CONTEXT_ATTRIBUTE_GROUPS[
        selectedCategoryGroup ?? "Tops"
      ] ?? CONTEXT_ATTRIBUTE_GROUPS.Tops;
    const available = new Set(
      Object.keys(meta.attributeGroups)
    );
    return preferred
      .filter((key) => available.has(key))
      .map((group) => ({
        name: group,
        values: meta.attributeGroups[group],
      }));
  }, [meta, selectedCategoryGroup]);

  const totalSteps = STEP_KEYS.length;

  const stepKey = STEP_KEYS[step];

  const stepState = getStepState(
    stepKey,
    answers
  );

  const canProceed = stepState.canNext;

  function setAnswer<K extends keyof Answers>(
    key: K,
    value: Answers[K]
  ) {
    setAnswers((previous) => ({
      ...previous,
      [key]: value,
    }));
  }

  function toggleInList(
    key: "colors" | "attributes",
    value: string
  ) {
    setAnswers((previous) => ({
      ...previous,
      [key]: previous[key].includes(value)
        ? previous[key].filter(
            (item) => item !== value
          )
        : [...previous[key], value],
    }));
  }

  /* Changing What/Who invalidates the size context, so the size
     answer is cleared the moment the category or gender actually
     changes (never via an effect, so a restored Edit-search draft
     that arrives pre-answered isn't wiped). */
  function pickCategory(name: string) {
    setAnswers((previous) => {
      const cleared = previous.category === name;
      return {
        ...previous,
        category: cleared ? null : name,
        size: cleared ? previous.size : null,
      };
    });
  }

  function pickGender(value: string) {
    setAnswers((previous) => {
      const cleared = previous.gender === value;
      return {
        ...previous,
        gender: cleared ? null : value,
        size: cleared ? previous.size : null,
      };
    });
  }

  function isSizeChipSelected(
    section: SizeSection,
    value: string
  ): boolean {
    const picked = answers.size;
    if (!picked || picked.value !== value) {
      return false;
    }
    if (
      picked.system !== null ||
      picked.productType !== null ||
      picked.category !== null ||
      picked.audience !== null
    ) {
      return (
        section.system === picked.system &&
        section.productType === picked.productType
      );
    }
    /* value-only restored pick: pre-select only when the value is
       unambiguous (a single section carries it), never guess. */
    let matches = 0;
    for (const other of sizeSections) {
      if (other.values.includes(value)) {
        matches += 1;
        if (matches > 1) {
          return false;
        }
      }
    }
    return matches === 1 && section.values.includes(value);
  }

  function pickSize(section: SizeSection, value: string) {
    if (isSizeChipSelected(section, value)) {
      setAnswers((previous) => ({
        ...previous,
        size: null,
      }));
      return;
    }
    setAnswers((previous) => ({
      ...previous,
      size: {
        value,
        audience: genderToAudience(previous.gender),
        productType: section.productType,
        category: previous.category,
        system: section.system,
      },
    }));
  }

  function back() {
    if (step > 0) {
      setStep(step - 1);
    }
  }

  function next() {
    if (canProceed && step < totalSteps - 1) {
      setStep(step + 1);
    }
  }

  function buildIntent(): FindIntent | null {
    const parts: string[] = [];

    if (answers.gender) {
      parts.push(answers.gender);
    }
    for (const color of answers.colors) {
      parts.push(color);
    }
    if (answers.size) {
      /* R8: carry the size system the user explicitly chose (EU/US/
         UK/IT/FR/INTERNATIONAL) as an adjacent token so the engine's
         existing strict parser (detectSizeSystem +
         variantMatchesSizeSystem) enforces it instead of collapsing
         to bare-size legacy matching. When the section has no system
         (e.g. a generic CLOTHING section) or an unrecognized value,
         we emit the bare size exactly as before - never guess. */
      const sys = answers.size.system
        ?.trim()
        .toLowerCase();
      const systemIsKnown =
        sys != null &&
        [
          "eu",
          "us",
          "uk",
          "it",
          "fr",
          "international",
        ].includes(sys);
      parts.push(
        systemIsKnown
          ? `${sys} ${answers.size.value}`
          : answers.size.value
      );
    }
    if (answers.searchText.trim()) {
      parts.push(answers.searchText.trim());
    }
    if (answers.category) {
      parts.push(answers.category);
    }

    if (parts.length === 0) {
      return null;
    }

    const rawMin = answers.budgetMin.trim();
    const rawMax = answers.budgetMax.trim();
    const min =
      rawMin && Number.isFinite(Number(rawMin))
        ? Number(rawMin)
        : null;
    const max =
      rawMax && Number.isFinite(Number(rawMax))
        ? Number(rawMax)
        : null;

    const fxRate = meta?.fx?.rate ?? null;

    /* The engine always matches against the stored price
       (EUR). A USD budget is converted to EUR via the real
       rate; never assumed to equal EUR 1:1. Without a
       reliable rate nothing is invented: the budget stays
       in the catalog currency. A restored Edit-search
       draft pins budgetCurrency, so a USD-entered budget
       stays USD and a EUR budget stays EUR. */
    const budgetCurrency: "USD" | "EUR" | null =
      min !== null || max !== null
        ? answers.budgetCurrency ??
          (fxRate ? "USD" : "EUR")
        : null;

    const rate =
      budgetCurrency === "USD" ? fxRate : null;

    const priceMin =
      min === null
        ? null
        : rate !== null
          ? usdToEur(min, rate)
          : min;
    const priceMax =
      max === null
        ? null
        : rate !== null
          ? usdToEur(max, rate)
          : max;

    return {
      query: parts.join(" "),
      params: {
        priceMin:
          priceMin === null
            ? null
            : String(priceMin),
        priceMax:
          priceMax === null
            ? null
            : String(priceMax),
        soft:
          answers.attributes.length > 0
            ? answers.attributes.join(",")
            : null,
        budgetCurrency,
        budgetDisplayMin:
          min === null ? null : String(min),
        budgetDisplayMax:
          max === null ? null : String(max),
      },
    };
  }

  function submit() {
    const intent = buildIntent();
    if (!intent) {
      return;
    }

    /* The built search becomes a plain URL on the results
       page; the URL is the single source of truth. */
    void router.push(`/?${buildSearchQueryString(intent)}`);
  }

  if (metaError) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center gap-4 px-4">
        <p className="text-center text-gray-600">
          {metaError}
        </p>
        <Link
          href="/"
          className="text-sm underline"
        >
          Back to search
        </Link>
      </main>
    );
  }

  /* F5: the page shell (header, progress, title) is always
     rendered so SSR produces a meaningful first paint. Only
     the data-dependent option area waits, showing a localized
     loader while /api/meta is in flight. */
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:py-12">
      <div className="mb-6 flex items-center justify-between gap-4">
        <Link
          href="/"
          className="text-sm text-gray-500 hover:text-black"
        >
          ← Direct search
        </Link>
        <span className="text-xs font-medium text-gray-400">
          Step {step + 1} of {totalSteps}
        </span>
      </div>

      <h1 className="text-2xl font-bold sm:text-3xl">
        Find your perfect clothing
      </h1>
      <p className="mt-1 text-sm text-gray-500">
        Answer a few quick questions. The first two
        steps are required; the rest are optional —
        skip anything you don&apos;t care about.
      </p>

      <div
        className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-gray-200"
        role="progressbar"
        aria-valuenow={step + 1}
        aria-valuemin={1}
        aria-valuemax={totalSteps}
      >
        <div
          className="h-full rounded-full bg-black transition-all duration-300"
          style={{
            width:
              ((step + 1) / totalSteps) * 100 +
              "%",
          }}
        />
      </div>

      <section
        className="mt-8 min-h-[16rem]"
        aria-busy={!meta}
      >
        {meta && step === 0 && (
          <div>
            <h2 className="mb-1 text-lg font-semibold">
              What are you looking for?
            </h2>
            <p className="mb-4 text-sm text-gray-500">
              Required. Pick a category.
            </p>
            <div className="space-y-5">
              {groupedCategories.map((group) => {
                const items = group.items.slice();
                return (
                  <div key={group.group}>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                      {group.group}
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {items.map((category) => (
                        <Chip
                          key={category.slug}
                          label={category.name}
                          selected={
                            answers.category ===
                            category.name
                          }
                          onClick={() =>
                            pickCategory(
                              category.name
                            )
                          }
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {meta && step === 1 && (
          <div>
            <h2 className="mb-1 text-lg font-semibold">
              Who is it for?
            </h2>
            <p className="mb-4 text-sm text-gray-500">
              Required.
            </p>
            <div className="flex flex-wrap gap-2">
              {GENDER_OPTIONS.map((value) => (
                <Chip
                  key={value}
                  label={
                    GENDER_LABELS[value] ?? value
                  }
                  selected={
                    answers.gender === value
                  }
                  onClick={() =>
                            pickGender(value)
                          }
                />
              ))}
            </div>
          </div>
        )}

        {meta && step === 2 && (
          <div>
            <h2 className="mb-1 text-lg font-semibold">
              Colors
            </h2>
            <p className="mb-4 text-sm text-gray-500">
              Optional. Pick one or more colors (tap
              again to deselect).
            </p>
            <div className="mb-4">
              <input
                id="find-color-filter"
                type="search"
                value={colorFilter}
                onChange={(event) =>
                  setColorFilter(
                    event.target.value
                  )
                }
                placeholder="Search colors…"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {meta.colors
                .filter((color) =>
                  colorFilter.trim()
                    ? color
                        .toLowerCase()
                        .includes(
                          colorFilter
                            .trim()
                            .toLowerCase()
                        )
                    : true
                )
                .map((color) => (
                  <Chip
                    key={color}
                    label={color}
                    selected={answers.colors.includes(
                      color
                    )}
                    onClick={() =>
                      toggleInList(
                        "colors",
                        color
                      )
                    }
                  />
                ))}
            </div>
            {colorFilter.trim() !== "" &&
              meta.colors.filter((color) =>
                color
                  .toLowerCase()
                  .includes(
                    colorFilter
                      .trim()
                      .toLowerCase()
                  )
              ).length === 0 && (
                <p className="mt-3 text-sm text-gray-400">
                  No colors match “{colorFilter}”.
                </p>
)}
          </div>
        )}

{meta && step === 3 && (
          <div>
            <h2 className="mb-1 text-lg font-semibold">
              Size?
            </h2>
            <p className="mb-4 text-sm text-gray-500">
              Optional. {sizeStepLabel} options.
            </p>
            {sizeSections.length > 0 ? (
              <div className="space-y-5">
                {sizeSections.map((section) =>
                  section.label !== null ? (
                    <div key={section.label}>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                        {section.label}
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {section.values.map((size) => (
                          <Chip
                            key={size}
                            label={size}
                            selected={isSizeChipSelected(
                              section,
                              size
                            )}
                            onClick={() =>
                              pickSize(section, size)
                            }
                          />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div
                      key="sizes"
                      className="flex flex-wrap gap-2"
                    >
                      {section.values.map((size) => (
                        <Chip
                          key={size}
                          label={size}
                          selected={isSizeChipSelected(
                            section,
                            size
                          )}
                          onClick={() =>
                            pickSize(section, size)
                          }
                        />
                      ))}
                    </div>
                  )
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400">
                No sizes available for this
                category.
              </p>
            )}
          </div>
        )}

        {meta && step === 4 && (
          <div>
            <h2 className="mb-1 text-lg font-semibold">
              Budget?
            </h2>
            <p className="mb-4 text-sm text-gray-500">
              Optional. Set a {budgetCurrencyLabel}{" "}
              range.
            </p>
            <div className="space-y-5">
              <div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-700">
                    Min
                  </span>
                  <span className="text-gray-500">
                    {budgetCurrencyLabel}{" "}
                    {answers.budgetMin === ""
                      ? 0
                      : answers.budgetMin}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={1}
                  aria-label={`Minimum budget in ${budgetCurrencyLabel}`}
                  value={
                    answers.budgetMin === ""
                      ? 0
                      : Number(answers.budgetMin)
                  }
                  onChange={(event) => {
                    const value = Number(
                      event.target.value
                    );
                    const maxNumber =
                      answers.budgetMax === ""
                        ? 0
                        : Number(answers.budgetMax);
                    if (
                      maxNumber > 0 &&
                      value > maxNumber
                    ) {
                      setAnswer(
                        "budgetMax",
                        String(value)
                      );
                    }
                    setAnswer(
                      "budgetMin",
                      String(value)
                    );
                  }}
                  className="w-full accent-black"
                />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-700">
                    Max
                  </span>
                  <span className="text-gray-500">
                    {budgetCurrencyLabel}{" "}
                    {answers.budgetMax === ""
                      ? 200
                      : answers.budgetMax}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={1}
                  aria-label={`Maximum budget in ${budgetCurrencyLabel}`}
                  value={
                    answers.budgetMax === ""
                      ? 200
                      : Number(answers.budgetMax)
                  }
                  onChange={(event) => {
                    const value = Number(
                      event.target.value
                    );
                    const minNumber =
                      answers.budgetMin === ""
                        ? 0
                        : Number(answers.budgetMin);
                    if (
                      minNumber > 0 &&
                      value < minNumber
                    ) {
                      setAnswer(
                        "budgetMin",
                        String(value)
                      );
                    }
                    setAnswer(
                      "budgetMax",
                      String(value)
                    );
                  }}
                  className="w-full accent-black"
                />
              </div>
            </div>
            {fxRate ? (
              <p className="mt-3 text-xs text-gray-400">
                Budgets are compared in a single reference
                currency: your USD range is converted with the
                ECB reference rate (1 EUR ≈{" "}
                {fxRate.toFixed(4)} USD,{" "}
                {meta?.fx?.asOf ?? "latest"}), and every
                product&apos;s price is normalized the same way
                before matching. Each card still shows the
                original price in its original currency.
                Products outside your range but within 35% still
                show under “Similar”.
              </p>
            ) : (
              <p className="mt-3 text-xs text-amber-600">
                Budgets are compared in EUR (reference
                currency). No reliable USD rate is available
                right now, so prices are matched at their stored
                value — nothing is invented. Conversion is
                applied automatically once a rate is configured
                or reachable.
              </p>
            )}
          </div>
        )}

        {meta && step === 5 && (
          <div>
            <h2 className="mb-1 text-lg font-semibold">
              Any details that matter?
            </h2>
            <p className="mb-4 text-sm text-gray-500">
              Optional. These preferences help
              rank the best options first.
            </p>
            <div className="space-y-5">
              <div>
                <label
                  htmlFor="find-search-text"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  Your own words
                </label>
                <input
                  id="find-search-text"
                  type="text"
                  value={answers.searchText}
                  onChange={(event) =>
                    setAnswer(
                      "searchText",
                      event.target.value
                    )
                  }
                  placeholder="Anything specific? E.g. oversized, striped, for running."
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
                />
              </div>
              {detailGroups.map((group) => (
                <div key={group.name}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    {group.name}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {group.values
                      .filter(
                        (value) =>
                          value.trim().toLowerCase() !==
                            "n/a" &&
                          value.trim() !== ""
                      )
                      .map((value) => (
                        <Chip
                          key={value}
                          label={value}
                          selected={answers.attributes.includes(
                            value
                          )}
                          onClick={() =>
                            toggleInList(
                              "attributes",
                              value
                            )
                          }
                        />
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!meta && (
          <div
            className="flex min-h-[16rem] flex-col items-center justify-center gap-3"
            role="status"
          >
            <div
              className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-black"
              aria-hidden="true"
            />
            <p className="text-sm text-gray-500">
              Loading options…
            </p>
          </div>
        )}
      </section>

      <div className="mt-8 flex items-center justify-between gap-3 border-t border-gray-100 pt-6">
        <button
          type="button"
          onClick={back}
          disabled={!meta || step === 0}
          className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:invisible"
        >
          Back
        </button>

        {step === totalSteps - 1 ? (
          <button
            type="button"
            onClick={submit}
            disabled={!meta || !buildIntent()}
            className="rounded-lg bg-black px-6 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Search
          </button>
        ) : (
          <div className="flex items-center justify-end gap-2">
            {meta && stepState.canSkip && (
              <button
                type="button"
                onClick={() =>
                  setStep(step + 1)
                }
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-500 hover:bg-gray-100"
              >
                Skip
              </button>
            )}
            <button
              type="button"
              onClick={next}
              disabled={!meta || !canProceed}
              className="rounded-lg bg-black px-6 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </main>
  );
}