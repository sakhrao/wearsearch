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
import {
  detailOptionGroupsFor,
  type DetailOptionGroup,
} from "@/lib/catalog/detail-options";

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
    /* gender compatibility derived by /api/meta from the import plan's
       Men/Women tokens + the live Product.gender stock; the gender step
       filters the category step on it */
    genders: ("MEN" | "WOMEN" | "KIDS" | "UNISEX")[];
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

/* One collapsible unit of the "Pick a category" step: a root whose
   leaves hang directly under it (Shoes, Accessories, Headwear) or a
   named sub-group under a root (Tops, Bottoms, Dresses & Jumpsuits,
   Outerwear, Sportswear, Swimwear & Basics, Bags). */
type CategorySection = {
  key: string;
  title: string;
  categories: Meta["categories"];
};

const GENDER_LABELS: Record<string, string> = {
  women: "Women",
  men: "Men",
  kids: "Kids",
};

/* A category option is selectable for the picked gender only when its
   meta-supplied genders contain that audience; null audience (no gender
   picked yet) shows every category, exactly as before. */
function categoryGendersCompatible(
  category: Meta["categories"][number],
  audience: ReturnType<typeof genderToAudience>
): boolean {
  return (
    audience === null ||
    category.genders.includes(audience)
  );
}

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

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`size-4 shrink-0 transition-transform duration-200 ${
        open ? "rotate-180" : ""
      }`}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

const PRIMARY_BTN =
  "inline-flex h-12 items-center justify-center gap-2 rounded-full bg-ink px-7 text-sm font-semibold text-paper shadow-sm transition-all duration-200 hover:bg-ink-soft hover:shadow-md active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none";

const SECONDARY_BTN =
  "inline-flex h-12 items-center justify-center gap-2 rounded-full border border-line bg-surface px-5 text-sm font-medium text-ink-soft transition-all duration-200 hover:border-accent-deep hover:text-ink active:scale-[0.98] disabled:invisible";

const TERTIARY_BTN =
  "inline-flex h-12 items-center justify-center gap-1 rounded-full px-4 text-sm font-medium text-ink-faint transition-colors hover:text-accent-deep";

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
      className={`flex min-h-14 items-center justify-center gap-2 rounded-2xl border px-5 py-3.5 text-sm font-medium transition-all duration-200 active:scale-[0.98] ${
        selected
          ? "border-accent-deep bg-accent-tint text-ink"
          : "border-line bg-surface text-ink-soft hover:-translate-y-px hover:border-accent/60 hover:text-ink hover:shadow-md"
      }`}
    >
      <span>{label}</span>
      {selected && (
        <span className="text-accent-deep">
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
      className={`flex min-h-12 items-center gap-1.5 rounded-full border px-4 py-3 text-sm font-medium transition-all duration-150 ${
        selected
          ? "border-accent-deep bg-accent-tint text-ink"
          : "border-line bg-surface text-ink-soft hover:border-accent/50 hover:text-ink"
      }`}
    >
      {selected && (
        <span className="text-accent-deep">
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

export function FindQuestionnaire({
  embedded = false,
}: {
  embedded?: boolean;
}) {
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
  const [openSection, setOpenSection] =
    useState<string | null>(null);

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
      .then((data: Meta) => {
        setMeta(data);
        /* A restored edit-search draft can arrive with a category that
           the restored gender no longer stocks (e.g. UNISEX + Bras).
           Remove that invalid selection exactly once, when the options
           land - without touching anything else the user staged. */
        setAnswers((previous) => {
          const audience = genderToAudience(
            previous.gender
          );
          if (!audience || !previous.category) {
            return previous;
          }
          const compatible = data.categories.some(
            (category) =>
              category.name === previous.category &&
              categoryGendersCompatible(
                category,
                audience
              )
          );
          return compatible
            ? previous
            : {
                ...previous,
                category: null,
                size: null,
              };
        });
      })
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

/* Build the collapsed category sections for the "Pick a category" step.
   Top level = canonical root (Clothing / Shoes / Accessories / Headwear);
   a root becomes one collapsible section (Shoes, Accessories, Headwear)
   when its leaves hang directly under it, and its named sub-groups become
   their own collapsible sections (Tops, Bottoms, Bags, ...) otherwise.
   Every canonical leaf (IMPORTABLE and PLANNED alike) and every preserved
   legacy DB-only category appears exactly once.

   Gender awareness: once a gender is picked, only the categories whose
   real gender compatibility (plan tokens + live stock) includes that
   audience are offered, so Men never sees Bras/Skirts/Dresses and Women
   always does; unisex shows the adult-shared leaves; kids shows only the
   categories with actual kids stock. No gender -> every category. */
  const genderAudience = genderToAudience(answers.gender);

  const visibleCategories = useMemo(() => {
    if (!meta) return [];
    if (genderAudience === null) return meta.categories;
    return meta.categories.filter((category) =>
      categoryGendersCompatible(category, genderAudience)
    );
  }, [meta, genderAudience]);

  const categorySections = useMemo(() => {
    const rootMap = new Map<string, { leaves: Meta["categories"]; subgroups: Map<string, Meta["categories"]> }>();
    for (const category of visibleCategories) {
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
    /* Collapse the upfront category list into a compact set of sections:
       an accordion unit per root (e.g. Shoes, Accessories) when the root
       has no sub-groups, and per sub-group (Tops, Bottoms, Bags, ...)
       otherwise, each keeping just the categories underneath it. */
    const out: CategorySection[] = [];
    for (const root of GROUP_ORDER) {
      const entry = rootMap.get(root);
      if (!entry) continue;
      if (entry.subgroups.size === 0) {
        if (entry.leaves.length > 0) {
          out.push({
            key: `root:${root}`,
            title: root,
            categories: entry.leaves,
          });
        }
        continue;
      }
      if (entry.leaves.length > 0) {
        out.push({
          key: `root:${root}`,
          title: root,
          categories: entry.leaves,
        });
      }
      for (const [subgroup, items] of entry.subgroups) {
        out.push({
          key: `sub:${root}/${subgroup}`,
          title: subgroup,
          categories: items,
        });
      }
    }
    return out;
  }, [visibleCategories]);

  /* The section holding the picked category stays expanded so the
     selection is never hidden behind a collapsed header. */
  const selectedSectionKey = useMemo(() => {
    if (!answers.category) {
      return null;
    }
    return (
      categorySections.find((section) =>
        section.categories.some(
          (category) =>
            category.name === answers.category
        )
      )?.key ?? null
    );
  }, [categorySections, answers.category]);

  function isSectionExpanded(key: string): boolean {
    return key === openSection;
  }

  /* keep the section holding the current pick open; a manual open
     elsewhere overrides it for as long as it stays open. Synced here in
     render (documented React pattern) instead of an effect so a manual
     collapse is never undone by a stale revision of the pick. */
  const [lastPickedSectionKey, setLastPickedSectionKey] =
    useState<string | null>(null);
  if (lastPickedSectionKey !== selectedSectionKey) {
    setLastPickedSectionKey(selectedSectionKey);
    if (selectedSectionKey) {
      setOpenSection(selectedSectionKey);
    }
  }

  function toggleSection(key: string) {
    setOpenSection((previous) =>
      previous === key ? null : key
    );
  }

  /* The single open section, resolved against what still exists so a
     gender switch that removes the pick's section never leaves us
     pointing at a vanished header. */
  const openKey = useMemo(() => {
    if (openSection === null) {
      return null;
    }
    return categorySections.some(
      (section) => section.key === openSection
    )
      ? openSection
      : null;
  }, [categorySections, openSection]);

  /* One category section card: header always, options only while this
     section is the one on screen. In the closed grid every card shows
     just its header; in the open view the single focused section shows
     its header plus the option cards. */
  function renderSection(section: CategorySection) {
    const open = isSectionExpanded(section.key);
    const selectedIn =
      answers.category !== null &&
      section.categories.some(
        (category) =>
          category.name === answers.category
      );
    return (
      <div
        key={section.key}
        className="overflow-hidden rounded-2xl border border-line bg-surface"
      >
        <button
          type="button"
          aria-expanded={open}
          onClick={() => toggleSection(section.key)}
          className="flex w-full items-center justify-between gap-2 bg-surface px-5 py-4 text-left transition-colors hover:bg-ink/[0.02]"
        >
          <span
            className={`flex items-center gap-2 text-sm font-medium ${selectedIn ? "text-ink" : "text-ink-soft"}`}
          >
            {selectedIn && (
              <span className="text-accent-deep">
                <CheckIcon />
              </span>
            )}
            {section.title}
          </span>
          <span className="flex items-center gap-2.5">
            <span className="text-xs tabular-nums text-ink-faint">
              {section.categories.length}
            </span>
            <span
              className={open ? "text-accent-deep" : "text-ink-faint"}
            >
              <ChevronIcon open={open} />
            </span>
          </span>
        </button>
        {open && (
          <div className="border-t border-line p-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {section.categories.map((category) => (
                <OptionCard
                  key={category.slug}
                  label={category.name}
                  selected={answers.category === category.name}
                  onClick={() => pickCategory(category.name)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

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

  /* Detail chips are context-aware structured options for the picked
     category's product type (shoes/headwear/accessories/general
     clothing each have their own vocabulary). Every option maps to
     real search behaviour: when its group matches an attribute group
     the catalog actually exposes the pick is a soft attribute filter,
     otherwise the value becomes a real query token on submit. Only
     attribute-backed groups render their catalog values (deduped),
     so nothing offered can silently produce zero results. */
  const detailGroups = useMemo<DetailOptionGroup[]>(() => {
    if (!meta || !answers.category) {
      return [];
    }
    const category = meta.categories.find(
      (c) => c.name === answers.category
    );
    if (!category) {
      return [];
    }
    return detailOptionGroupsFor({
      root: category.root,
      group: category.group,
      slug: category.slug,
    }).map((optionGroup) => {
      const attributeValues =
        optionGroup.attributeKey != null
          ? meta.attributeGroups[
              optionGroup.attributeKey
            ]
          : undefined;
      return {
        name: optionGroup.name,
        attributeKey: optionGroup.attributeKey,
        values: attributeValues
          ? [
              ...new Set([
                ...attributeValues,
                ...optionGroup.values,
              ]),
            ]
          : optionGroup.values,
      };
    });
  }, [meta, answers.category]);

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
      ask: "Who is it for?",
      hint: "For Women, Men or Kids — we'll tailor the categories, sizes and results to the person you're shopping for.",
    },
    1: {
      ask: "What are you shopping for?",
      hint: "Pick a category tuned to your pick — you can change it later.",
    },
    2: {
      ask: "What size do you need?",
      hint: `Optional · ${sizeStepLabel} options that fit your picks.`,
    },
    3: {
      ask: "Which colors do you like?",
      hint: "Optional · pick as many as you like, tap again to remove.",
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

  /* A detail chip is attribute-backed only when its group maps to an
     attribute group the catalog ACTUALLY exposes; such picks become
     soft filters. Every other chip is added to detailTokens and turns
     into a real query token on submit — never a UI-only filter. */
  function toggleDetail(
    optionGroup: DetailOptionGroup,
    value: string
  ) {
    const attributeBacked =
      optionGroup.attributeKey != null &&
      meta?.attributeGroups[
        optionGroup.attributeKey
      ] != null;
    setAnswers((previous) => {
      if (attributeBacked) {
        const inAttrs =
          previous.attributes.includes(value);
        return {
          ...previous,
          attributes: inAttrs
            ? previous.attributes.filter(
                (item) => item !== value
              )
            : [...previous.attributes, value],
        };
      }
      const inTokens =
        previous.detailTokens.includes(value);
      return {
        ...previous,
        detailTokens: inTokens
          ? previous.detailTokens.filter(
              (item) => item !== value
            )
          : [...previous.detailTokens, value],
      };
    });
  }

  function isDetailSelected(
    value: string
  ): boolean {
    return (
      answers.attributes.includes(value) ||
      answers.detailTokens.includes(value)
    );
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
      const nextGender = cleared ? null : value;
      const audience = genderToAudience(nextGender);
      /* switching gender immediately re-filters the category options:
         a category that no longer fits the new gender is cleared here,
         never left half-selected behind a vanished option */
      const categoryStillValid =
        !previous.category ||
        !audience ||
        meta?.categories.some(
          (category) =>
            category.name === previous.category &&
            categoryGendersCompatible(
              category,
              audience
            )
        );
      const categoryCleared =
        previous.category !== null &&
        !categoryStillValid;
      return {
        ...previous,
        gender: nextGender,
        /* Only toggling the same gender OFF keeps the size context
           (gender-less but otherwise intact). A real gender switch or
           a category invalidation makes the audience/category context
           of the size answer stale, so the size is cleared with it. */
        size:
          cleared ? previous.size : null,
        category: categoryCleared
          ? null
          : previous.category,
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
    /* Structured detail chips that are not attribute-backed become
       REAL query tokens, exactly as if the user typed them. */
    for (const token of answers.detailTokens) {
      if (token.trim()) {
        parts.push(token.trim());
      }
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
    const Shell = embedded ? "div" : "main";
    return (
      <Shell
        className={
          embedded
            ? "mx-auto flex w-full max-w-2xl flex-col items-center justify-center gap-4 px-4 py-6"
            : "mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center gap-4 px-4"
        }
      >
        <p className="text-center text-ink-soft">
          {metaError}
        </p>
        <Link
          href="/"
          className="text-sm font-medium text-accent-deep underline-offset-4 hover:underline"
        >
          Back to search
        </Link>
      </Shell>
    );
  }

  /* F5: the page shell (header, progress, title) is always
     rendered so SSR produces a meaningful first paint. Only
     the data-dependent option area waits, showing a localized
     loader while /api/meta is in flight. */
  const copy = stepCopy[step];
  const Shell = embedded ? "div" : "main";
  const Heading = embedded ? "h2" : "h1";

  return (
    <Shell
      className={
        embedded
          ? "flex min-h-0 w-full flex-1 flex-col"
          : "wizard-window mx-auto flex w-full max-w-2xl flex-col px-5 pb-6 pt-7"
      }
    >
      {/* Small header */}
      <div className="flex items-center justify-between gap-4">
        {embedded ? (
          <span />
        ) : (
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm font-medium text-ink-faint transition-colors hover:text-accent-deep"
          >
            <ArrowIcon dir="left" />
            Search
          </Link>
        )}
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-faint">
          Your preferences
        </p>
      </div>

      {/* Minimal progress */}
      <div className="mt-5 flex items-center gap-4">
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
            className="h-full rounded-full bg-accent-deep transition-all duration-500 ease-out"
            style={{
              width:
                ((step + 1) / totalSteps) * 100 +
                "%",
            }}
          />
        </div>
      </div>

      {/* Question */}
      <div className="mt-5 text-center">
        <Heading className="font-display text-2xl font-medium tracking-tight text-ink sm:text-3xl">
          {copy.ask}
        </Heading>
        <p className="mt-3 text-ink-soft">
          {copy.hint}
        </p>
      </div>

      <section
        className="min-h-0 flex-1 overflow-y-auto"
        aria-busy={!meta}
      >
        {meta && (
          <div key={step} className="step-animate">
            {step === 0 && (
              <div className="mx-auto grid w-full max-w-lg grid-cols-1 gap-4 sm:grid-cols-3">
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

{step === 1 && (
              categorySections.length === 0 ? (
                <div className="mx-auto max-w-sm rounded-2xl border border-line bg-surface px-5 py-6 text-center">
                  <p className="text-sm text-ink-soft">
                    There are no categories in
                    stock for that audience yet —
                    go back and pick another.
                  </p>
                </div>
              ) : openKey === null ? (
                <div className="mx-auto w-full max-w-3xl">
                  <p className="mb-4 text-xs font-medium uppercase tracking-[0.14em] text-ink-faint">
                    Tap a section to expand it
                  </p>
                  <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {categorySections.map((section) =>
                      renderSection(section)
                    )}
                  </div>
                </div>
              ) : (
                <div className="mx-auto w-full max-w-2xl">
                  {categorySections
                    .filter(
                      (section) =>
                        section.key === openKey
                    )
                    .map((section) =>
                      renderSection(section)
                    )}
                </div>
              )
            )}

            {step === 3 && (
              <div>
                <div className="mx-auto mb-4 max-w-sm">
                  <FieldInput
                    id="find-color-filter"
                    value={colorFilter}
                    onChange={setColorFilter}
                    placeholder="Search colors…"
                    icon
                  />
                </div>
                <div className="flex flex-wrap justify-center gap-3">
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
                {meta.colors.length === 0 && (
                  <p className="mt-4 text-center text-sm text-ink-faint">
                    No colors are available from the
                    current catalog right now — you
                    can skip this step.
                  </p>
                )}
              </div>
            )}

            {step === 2 && (
              <div>
                {sizeSections.length > 0 ? (
                  <div className="space-y-8">
                    {sizeSections.map((section) =>
                      section.label !== null ? (
                        <div key={section.label}>
                          <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
                            {section.label}
                          </h2>
                          <div className="flex flex-wrap justify-center gap-3.5">
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
                          className="flex flex-wrap justify-center gap-2.5"
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
                  <p className="text-center text-xs text-warning">
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
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-deep text-paper">
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
                    <div className="flex flex-wrap gap-3.5">
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
                            selected={isDetailSelected(
                              value
                            )}
                            onClick={() =>
                              toggleDetail(
                                group,
                                value
                              )
                            }
                          />
                        ))}
                    </div>
                  </div>
                ))}
                {detailGroups.length === 0 && (
                  <p className="mx-auto max-w-sm rounded-2xl border border-line bg-surface px-5 py-4 text-center text-sm text-ink-soft">
                    This category has no structured details
                    yet — describe what matters in your own
                    words above.
                  </p>
                )}
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

      {/* Bottom navigation — stays pinned at the bottom of the window */}
      <div className="mt-auto flex shrink-0 items-center justify-between gap-4 border-t border-line pb-1 pt-6">
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
    </Shell>
  );
}