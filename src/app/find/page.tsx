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
    root: string;
    subgroup: string | null;
    source: "canonical" | "legacy";
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

/* Top-level branches of the category tree, in display order. These are
   the canonical roots; Clothing is a shell that contains the clothing
   sub-groups (Tops, Bottoms, Outerwear, ...). */
const GROUP_ORDER = [
  "Clothing",
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

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-4"
    >
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}

function ArrowIcon({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-4"
    >
      {dir === "left" ? (
        <path d="M19 12H5m6 6-6-6 6-6" />
      ) : (
        <path d="M5 12h14m-6-6 6 6-6 6" />
      )}
    </svg>
  );
}

const PRIMARY_BTN =
  "inline-flex h-12 items-center justify-center gap-2 rounded-full bg-accent px-7 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-accent-deep hover:shadow-md active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none";

const SECONDARY_BTN =
  "inline-flex h-12 items-center justify-center gap-2 rounded-full border border-line bg-surface px-5 text-sm font-medium text-ink-soft transition-all duration-200 hover:border-accent/50 hover:text-ink active:scale-[0.98] disabled:invisible";

const TERTIARY_BTN =
  "inline-flex h-12 items-center justify-center gap-1 rounded-full px-4 text-sm font-medium text-ink-faint transition-colors hover:text-accent";

function OptionCard({
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
      aria-pressed={selected}
      onClick={onClick}
      className={`flex min-h-12 items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-medium transition-all duration-200 active:scale-[0.98] ${
        selected
          ? "border-accent bg-accent-tint text-ink"
          : "border-line bg-surface text-ink-soft hover:-translate-y-px hover:border-accent/60 hover:text-ink hover:shadow-md"
      }`}
    >
      <span>{label}</span>
      {selected && (
        <span className="text-accent">
          <CheckIcon />
        </span>
      )}
    </button>
  );
}

function OptionPill({
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
      aria-pressed={selected}
      onClick={onClick}
      className={`flex min-h-11 items-center gap-1.5 rounded-full border px-4 py-2.5 text-sm font-medium transition-all duration-150 ${
        selected
          ? "border-accent bg-accent-tint text-ink"
          : "border-line bg-surface text-ink-soft hover:border-accent/50 hover:text-ink"
      }`}
    >
      {selected && (
        <span className="text-accent">
          <CheckIcon />
        </span>
      )}
      {label}
    </button>
  );
}

function FieldInput({
  id,
  value,
  onChange,
  placeholder,
  icon,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  icon?: boolean;
}) {
  return (
    <div className="relative">
      {icon && (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="pointer-events-none absolute left-4 top-1/2 size-4.5 -translate-y-1/2 text-ink-faint"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      )}
      <input
        id={id}
        type={icon ? "search" : "text"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={`h-11 w-full rounded-full border border-line bg-surface text-sm text-ink shadow-sm outline-none transition placeholder:text-ink-faint hover:border-ink/30 focus:border-accent/40 focus:ring-4 focus:ring-accent/10 ${
          icon ? "pl-11 pr-4" : "px-4"
        }`}
      />
    </div>
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

  /* Build the hierarchical category tree for the "Pick a category" step.
     Top level = canonical root (Clothing / Shoes / Accessories / Headwear);
     within a root, leaves with a `subgroup` (e.g. Tops, Bags) are nested
     under that sub-header, and leaves with no subgroup are offered directly
     under the root. Every canonical leaf (IMPORTABLE and PLANNED alike) and
     every preserved legacy DB-only category appears exactly once. */
  const categoryTree = useMemo(() => {
    if (!meta) return [];
    const rootMap = new Map<string, { leaves: Meta["categories"]; subgroups: Map<string, Meta["categories"]> }>();
    for (const category of meta.categories) {
      const root = category.root;
      const entry = rootMap.get(root) ?? {
        leaves: [],
        subgroups: new Map<string, Meta["categories"]>(),
      };
      if (category.subgroup) {
        const list = entry.subgroups.get(category.subgroup) ?? [];
        list.push(category);
        entry.subgroups.set(category.subgroup, list);
      } else {
        entry.leaves.push(category);
      }
      rootMap.set(root, entry);
    }
    return GROUP_ORDER.filter((root) => rootMap.has(root)).map((root) => {
      const entry = rootMap.get(root)!;
      return { root, leaves: entry.leaves, subgroups: [...entry.subgroups.entries()] };
    });
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

  /* Conversation-style ask + helper line per step. */
  const stepCopy: Record<
    number,
    { ask: string; hint: string }
  > = {
    0: {
      ask: "What are you shopping for?",
      hint: "Pick a category to start — you can change it later.",
    },
    1: {
      ask: "Who is it for?",
      hint: "We'll tailor the options to the person you're shopping for.",
    },
    2: {
      ask: "Which colors do you like?",
      hint: "Optional · pick as many as you like, tap again to remove.",
    },
    3: {
      ask: "What size do you need?",
      hint: `Optional · ${sizeStepLabel} options that fit your picks.`,
    },
    4: {
      ask: "What's your budget?",
      hint: `Optional · set a range in ${budgetCurrencyLabel}.`,
    },
    5: {
      ask: "Anything else that matters?",
      hint: "Optional · tell us in your own words or pick a detail.",
    },
  };

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
        <p className="text-center text-ink-soft">
          {metaError}
        </p>
        <Link
          href="/"
          className="text-sm font-medium text-accent underline-offset-4 hover:underline"
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
  const copy = stepCopy[step];

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-16 pt-8 sm:pt-12">
      {/* Small header */}
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm font-medium text-ink-faint transition-colors hover:text-accent"
        >
          <ArrowIcon dir="left" />
          Search
        </Link>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-faint">
          Your preferences
        </p>
      </div>

      {/* Minimal progress */}
      <div className="mt-6 flex items-center gap-4">
        <span className="shrink-0 text-sm font-medium text-ink-soft">
          Step {step + 1} of {totalSteps}
        </span>
        <div
          className="h-1 w-full overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-valuenow={step + 1}
          aria-valuemin={1}
          aria-valuemax={totalSteps}
          aria-label={`Step ${step + 1} of ${totalSteps}`}
        >
          <div
            className="h-full rounded-full bg-accent transition-all duration-500 ease-out"
            style={{
              width:
                ((step + 1) / totalSteps) * 100 +
                "%",
            }}
          />
        </div>
      </div>

      {/* Question */}
      <div className="mt-10 text-center">
        <h1 className="font-display text-3xl font-medium tracking-tight text-ink sm:text-4xl">
          {copy.ask}
        </h1>
        <p className="mt-3 text-ink-soft">
          {copy.hint}
        </p>
      </div>

      <section
        className="mt-9 min-h-[16rem]"
        aria-busy={!meta}
      >
        {meta && (
          <div key={step} className="step-animate">
            {step === 0 && (
              <div className="space-y-6">
                {categoryTree.map((group) => (
                  <div key={group.root}>
                    <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
                      {group.root}
                    </h2>
                    {group.leaves.length > 0 && (
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {group.leaves.map((category) => (
                          <OptionCard
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
                    )}
                    {group.subgroups.map(
                      ([subgroup, items]) => (
                        <div
                          key={subgroup}
                          className="mt-4"
                        >
                          <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-ink-soft">
                            {subgroup}
                          </h3>
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                            {items.map((category) => (
                              <OptionCard
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
                      )
                    )}
                  </div>
                ))}
              </div>
            )}

            {step === 1 && (
              <div className="mx-auto grid max-w-md gap-3">
                {GENDER_OPTIONS.map((value) => (
                  <OptionCard
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
            )}

            {step === 2 && (
              <div>
                <div className="mx-auto mb-6 max-w-sm">
                  <FieldInput
                    id="find-color-filter"
                    value={colorFilter}
                    onChange={setColorFilter}
                    placeholder="Search colors…"
                    icon
                  />
                </div>
                <div className="flex flex-wrap justify-center gap-2">
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
                      <OptionPill
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
                    <p className="mt-4 text-center text-sm text-ink-faint">
                      No colors match “{colorFilter}”.
                    </p>
                  )}
              </div>
            )}

            {step === 3 && (
              <div>
                {sizeSections.length > 0 ? (
                  <div className="space-y-6">
                    {sizeSections.map((section) =>
                      section.label !== null ? (
                        <div key={section.label}>
                          <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
                            {section.label}
                          </h2>
                          <div className="flex flex-wrap justify-center gap-2">
                            {section.values.map((size) => (
                              <OptionPill
                                key={size}
                                label={size}
                                selected={isSizeChipSelected(
                                  section,
                                  size
                                )}
                                onClick={() =>
                                  pickSize(
                                    section,
                                    size
                                  )
                                }
                              />
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div
                          key="sizes"
                          className="flex flex-wrap justify-center gap-2"
                        >
                          {section.values.map((size) => (
                            <OptionPill
                              key={size}
                              label={size}
                              selected={isSizeChipSelected(
                                section,
                                size
                              )}
                              onClick={() =>
                                pickSize(
                                  section,
                                  size
                                )
                              }
                            />
                          ))}
                        </div>
                      )
                    )}
                  </div>
                ) : (
                  <div className="mx-auto max-w-sm rounded-2xl border border-line bg-surface px-5 py-6 text-center">
                    <p className="text-sm text-ink-soft">
                      No sizes are available for your
                      picks right now — you can skip
                      this step.
                    </p>
                  </div>
                )}
              </div>
            )}

            {step === 4 && (
              <div className="mx-auto max-w-md space-y-6">
                <div>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-medium text-ink">
                      Minimum
                    </span>
                    <span className="tabular-nums text-ink-soft">
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
                    className="w-full accent-[var(--accent)]"
                  />
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-medium text-ink">
                      Maximum
                    </span>
                    <span className="tabular-nums text-ink-soft">
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
                    className="w-full accent-[var(--accent)]"
                  />
                </div>
                <p className="text-center text-xs leading-relaxed text-ink-faint">
                  {budgetCurrencyLabel === "USD"
                    ? `Your budget is compared fairly across currencies
                       using the ECB reference rate (1 EUR ≈
                       ${fxRate?.toFixed(4) ?? "—"} USD,
                       ${meta?.fx?.asOf ?? "latest"}). Cards
                       always show each product's original price.
                       Matches just outside your range appear under
                       Similar.`
                    : `Prices are matched at their listed value. No
                       rate is needed for ${budgetCurrencyLabel}{" "}
                       budgets — nothing is invented or converted.`}
                </p>
                {!fxRate && budgetCurrencyLabel === "USD" && (
                  <p className="text-center text-xs text-amber-700">
                    No reliable USD rate is available right now, so
                    your budget is matched at its listed value. Nothing
                    is invented — conversion applies automatically once
                    a rate is reachable.
                  </p>
                )}
              </div>
            )}

            {step === 5 && (
              <div className="space-y-8">
                <div className="mx-auto flex max-w-lg items-center gap-3 rounded-2xl border border-accent/20 bg-accent-tint px-5 py-4">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-white">
                    <CheckIcon />
                  </span>
                  <p className="text-sm leading-snug">
                    <span className="font-semibold text-ink">
                      We&apos;ve got your preferences.
                    </span>{" "}
                    <span className="text-ink-soft">
                      Let&apos;s find something you&apos;ll love.
                    </span>
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="find-search-text"
                    className="mb-3 block text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint"
                  >
                    Your own words
                  </label>
                  <FieldInput
                    id="find-search-text"
                    value={answers.searchText}
                    onChange={(value) =>
                      setAnswer("searchText", value)
                    }
                    placeholder="Anything specific? E.g. oversized, striped, for running."
                  />
                </div>

                {detailGroups.map((group) => (
                  <div key={group.name}>
                    <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
                      {group.name}
                    </h2>
                    <div className="flex flex-wrap gap-2">
                      {group.values
                        .filter(
                          (value) =>
                            value.trim().toLowerCase() !==
                              "n/a" &&
                            value.trim() !== ""
                        )
                        .map((value) => (
                          <OptionPill
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
            )}
          </div>
        )}

        {!meta && (
          <div
            className="flex min-h-[16rem] flex-col items-center justify-center gap-3"
            role="status"
          >
            <div
              className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent"
              aria-hidden="true"
            />
            <p className="text-sm text-ink-soft">
              Finding your options…
            </p>
          </div>
        )}
      </section>

      {/* Bottom navigation */}
      <div className="mt-10 flex items-center justify-between gap-3 border-t border-line pt-6">
        <button
          type="button"
          onClick={back}
          disabled={!meta || step === 0}
          className={SECONDARY_BTN}
        >
          <ArrowIcon dir="left" />
          Back
        </button>

        {step === totalSteps - 1 ? (
          <button
            type="button"
            onClick={submit}
            disabled={!meta || !buildIntent()}
            className={PRIMARY_BTN}
          >
            See my matches
            <ArrowIcon dir="right" />
          </button>
        ) : (
          <div className="flex items-center gap-2">
            {meta && stepState.canSkip && (
              <button
                type="button"
                onClick={() => setStep(step + 1)}
                className={TERTIARY_BTN}
              >
                Skip for now
                <ArrowIcon dir="right" />
              </button>
            )}
            <button
              type="button"
              onClick={next}
              disabled={!meta || !canProceed}
              className={PRIMARY_BTN}
            >
              Continue
              <ArrowIcon dir="right" />
            </button>
          </div>
        )}
      </div>
    </main>
  );
}