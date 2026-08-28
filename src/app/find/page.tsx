"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { usdToEur } from "@/lib/currency";
import {
  EMPTY_ANSWERS,
  GENDER_OPTIONS,
  STEP_KEYS,
  getStepState,
  type QuestionnaireAnswers,
} from "@/lib/questionnaire";

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
const QUERY_KEY = "wearsearch-find-query";

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
  Accessories: ["Style", "Material"],
  Headwear: ["Style", "Material"],
};

const GENDER_LABELS: Record<string, string> = {
  women: "Women",
  men: "Men",
  kids: "Kids",
};

function Chip({
  label,
  selected,
  onClick,
  suffix,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  suffix?: string;
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
      {suffix && (
        <span
          className={
            selected
              ? "ml-1 text-gray-300"
              : "ml-1 text-gray-400"
          }
        >
          {suffix}
        </span>
      )}
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
        // eslint-disable-next-line react-hooks/set-state-in-effect -- restores draft once on mount
        setAnswers({
          ...EMPTY_ANSWERS,
          ...parsed,
          colors: parsed.colors ?? [],
          attributes:
            parsed.attributes ?? [],
        });
      } catch {
        sessionStorage.removeItem(
          STORAGE_KEY
        );
      }
    }

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
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(answers)
    );
  }, [answers]);

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

  const sizeOptions = useMemo(() => {
    if (!meta) {
      return [];
    }
    const isShoesGroup =
      selectedCategoryGroup === "Shoes";
    return isShoesGroup
      ? meta.sizeGroups.shoes
      : meta.sizeGroups.clothing;
  }, [meta, selectedCategoryGroup]);

  const fxRate = meta?.fx?.rate ?? null;
  const budgetCurrencyLabel = fxRate
    ? "USD"
    : "EUR";

  const sizeStepLabel = useMemo(() => {
    const isShoesGroup =
      selectedCategoryGroup === "Shoes";
    return isShoesGroup
      ? "Shoe size"
      : "Clothing size";
  }, [selectedCategoryGroup]);

  const contextAttributeKeys = useMemo(() => {
    if (!meta) return [];
    const preferred =
      CONTEXT_ATTRIBUTE_GROUPS[
        selectedCategoryGroup ?? "Tops"
      ] ?? CONTEXT_ATTRIBUTE_GROUPS.Tops;
    const available = new Set(
      Object.keys(meta.attributeGroups)
    );
    return preferred.filter((key) =>
      available.has(key)
    );
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
      parts.push(answers.size);
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
       in the catalog currency. */
    const budgetCurrency: "USD" | "EUR" | null =
      min !== null || max !== null
        ? fxRate
          ? "USD"
          : "EUR"
        : null;

    const priceMin =
      min === null
        ? null
        : fxRate
          ? usdToEur(min, fxRate)
          : min;
    const priceMax =
      max === null
        ? null
        : fxRate
          ? usdToEur(max, fxRate)
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

    sessionStorage.setItem(
      QUERY_KEY,
      JSON.stringify(intent)
    );

    void router.push("/?from=find");
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

  if (!meta) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <p className="animate-pulse text-gray-500">
          Loading…
        </p>
      </main>
    );
  }

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

      <section className="mt-8 min-h-[16rem]">
        {step === 0 && (
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
                          suffix={
                            category.hasProducts
                              ? undefined
                              : "(soon)"
                          }
                          selected={
                            answers.category ===
                            category.name
                          }
                          onClick={() =>
                            setAnswer(
                              "category",
                              answers.category ===
                                category.name
                                ? null
                                : category.name
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

        {step === 1 && (
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
                    setAnswer(
                      "gender",
                      answers.gender === value
                        ? null
                        : value
                    )
                  }
                />
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="mb-1 text-lg font-semibold">
              Colors &amp; words
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
            <div className="mt-6">
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
                placeholder="Anything specific? E.g. oversized, striped, for running…"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
              />
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 className="mb-1 text-lg font-semibold">
              Size?
            </h2>
            <p className="mb-4 text-sm text-gray-500">
              Optional. {sizeStepLabel} options.
            </p>
            {sizeOptions.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {sizeOptions.map((size) => (
                  <Chip
                    key={size}
                    label={size}
                    selected={answers.size === size}
                    onClick={() =>
                      setAnswer(
                        "size",
                        answers.size === size
                          ? null
                          : size
                      )
                    }
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">
                No sizes available for this
                category.
              </p>
            )}
          </div>
        )}

        {step === 4 && (
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

        {step === 5 && (
          <div>
            <h2 className="mb-1 text-lg font-semibold">
              Any details that matter?
            </h2>
            <p className="mb-4 text-sm text-gray-500">
              Optional. These preferences help
              rank the best options first.
            </p>
            <div className="space-y-5">
              {contextAttributeKeys.map((group) => (
                <div key={group}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    {group}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {(meta.attributeGroups[group] ?? [])
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
      </section>

      <div className="mt-8 flex items-center justify-between gap-3 border-t border-gray-100 pt-6">
        <button
          type="button"
          onClick={back}
          disabled={step === 0}
          className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:invisible"
        >
          Back
        </button>

        {step === totalSteps - 1 ? (
          <button
            type="button"
            onClick={submit}
            disabled={!buildIntent()}
            className="rounded-lg bg-black px-6 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Search
          </button>
        ) : (
          <div className="flex items-center justify-end gap-2">
            {stepState.canSkip && (
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
              disabled={!canProceed}
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