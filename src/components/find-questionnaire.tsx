"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  eurToUsd,
  usdToEur,
} from "@/lib/currency";
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
import { sizeCategoryIdForCategory } from "@/lib/catalog/size-vocabulary";
import { canonicalizeQuestionnaireSize } from "@/lib/size-domain/questionnaire";
import { isPersistedSizeSystem } from "@/lib/size-domain/normalize";
import { isSizeSystemId } from "@/lib/size-domain/registry";
import {
  detailOptionGroupsFor,
  type DetailOptionGroup,
} from "@/lib/catalog/detail-options";
import {
  KIDS_AGE_OPTIONS,
  branchHasStock as taxonomyBranchHasStock,
  decideNext as taxonomyDecideNext,
  deriveQuery as taxonomyDeriveQuery,
  nextStepIndex as taxonomyNextStepIndex,
  optionsAt as taxonomyOptionsAt,
  type DerivedQuery,
  type TaxonomyGenderTree,
  type TaxonomyNode as TaxonomyNodeView,
} from "@/lib/catalog/taxonomy/options";

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
  /* Highest stocked product price per category, in the EUR reference
     (computed by /api/meta against the live fx rate). The budget step
     sizes its sliders against this so the Maximum covers the most
     expensive product in the picked category. */
  priceMaxEurByCategory: Record<string, number>;
  /* Additive taxonomy tree (stable IDs per gender). The category step
     drills down this tree; the flat `categories` array above stays the
     source of every legacy display name the engine understands. */
  taxonomy?: {
    version: string;
    trees: Record<
      "MEN" | "WOMEN" | "KIDS",
      TaxonomyGenderTree
    >;
    migrationMap: Record<string, string[]>;
  };
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
    /* H2: canonical size filter (identities) and system pins for
       unresolved picks - never a raw size token in `query`. */
    size: string[];
    sizeSystem: string[];
  };
};

type Answers = QuestionnaireAnswers;

/**
 * The tokens a taxonomy path contributes to the query: the node tokens
 * plus any cross-tags. Cross-tags widen the search (an "activewear"
 * pick admits every tagged category) without ever becoming a step of
 * their own.
 */
function taxonomyTokensFor(
  derived: DerivedQuery
): string[] {
  return [
    ...derived.tokens,
    ...derived.crossTags,
  ];
}

/* The taxonomy tree for the picked gender, or null when the payload is
   unavailable / the audience has no tree (the legacy flat list is then
   used as the fallback). */
function taxonomyTreeFromMeta(
  meta: Meta | null,
  gender: string | null
): TaxonomyGenderTree | null {
  if (!meta?.taxonomy) return null;
  const audience = genderToAudience(gender);
  if (!audience || audience === "UNISEX") return null;
  return meta.taxonomy.trees[audience] ?? null;
}

/**
 * True when a branch leads to a category the catalog actually offers
 * this audience. Used to hide branches with no stock so the drill-down
 * never dead-ends. The structural walk lives in the taxonomy engine
 * (branchHasStock) where it is unit tested; this only supplies the
 * audience-specific answer to "is this category stocked?".
 */
function taxonomyBranchHasCategory(
  meta: Meta | null,
  audience: "MEN" | "WOMEN" | "KIDS" | "UNISEX" | null
): (name: string) => boolean {
  if (!meta) return () => true;
  const wanted = audience ?? "UNISEX";
  return (name: string) =>
    meta.categories.some(
      (category) =>
        category.name === name &&
        categoryGendersCompatible(category, wanted)
    );
}

/* One question the user actually saw, recorded so Back can replay the
   real presentation history instead of walking the taxonomy hierarchy.
   The path is the full category drill path (a resolved leaf included);
   an attribute step carries whatever path was on screen. */
/* One presented view. `drill` is the node whose children were on screen
   (empty at the taxonomy root) and `selection` is the child picked at that
   level, so Back can restore the exact question the user answered - and
   its highlighted pick - instead of guessing a taxonomy parent. */
type NavView = {
  step: number;
  drill: string[];
  selection: string | null;
};

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
  "inline-flex h-12 items-center justify-center gap-2 rounded-full border border-line bg-paper-soft px-5 text-sm font-medium text-ink transition-all duration-200 hover:border-ink hover:shadow-sm active:scale-[0.98] disabled:invisible";

const TERTIARY_BTN =
  "inline-flex h-12 items-center justify-center gap-1 rounded-full px-4 text-sm font-medium text-ink-soft transition-colors hover:text-ink";

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
      className={`flex h-full min-h-0 min-w-0 items-center justify-center gap-1.5 overflow-hidden rounded-xl border px-2 py-1 text-center text-[13px] font-medium leading-tight transition-all duration-200 active:scale-[0.98] sm:gap-2 sm:rounded-2xl sm:px-4 sm:py-2.5 sm:text-sm ${
        selected
          ? "border-ink bg-ink text-paper shadow-md"
          : "border-line bg-paper-soft text-ink-soft hover:-translate-y-px hover:border-ink/40 hover:text-ink hover:shadow-md"
      }`}
    >
      <span className="min-w-0 break-words">{label}</span>
      {selected && (
        <span className="shrink-0 text-paper">
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
      className={`flex h-full min-h-0 w-full items-center justify-center gap-1.5 overflow-hidden rounded-full border px-2 py-1 text-[13px] font-medium leading-tight transition-all duration-150 sm:px-4 sm:py-2 sm:text-sm ${
        selected
          ? "border-ink bg-ink text-paper"
          : "border-line bg-paper-soft text-ink-soft hover:border-ink/40 hover:text-ink"
      }`}
    >
      {selected && (
        <span className="shrink-0 text-paper">
          <CheckIcon />
        </span>
      )}
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

/* Pick a column count from the option count (the design's 3 -> 1x3,
   4 -> 2x2, 5-6 -> 2x3, 7-8 -> 2x4, 9-12 -> 3x3/3x4 mapping) and the
   measured width, so a narrow phone drops a column instead of letting
   the labels crush together. */
function computeColumns(
  count: number,
  width: number,
  gap: number,
  minCell: number,
  maxCols: number
): number {
  const byWidth = Math.max(
    1,
    Math.floor((width + gap) / (minCell + gap))
  );
  let desired: number;
  if (count <= 3) desired = count;
  else if (count === 4) desired = 2;
  else if (count <= 6) desired = 3;
  else if (count <= 8) desired = 4;
  else if (count <= 10) desired = 3;
  else desired = maxCols;
  return Math.max(
    1,
    Math.min(count, desired, byWidth, maxCols)
  );
}

/* Fills its flex box with every option visible at once: columns come
   from the count and measured width, row height from the measured
   height, so a step never scrolls. Rows shrink to fit and are centred
   when they are capped. */
function FitGrid({
  count,
  minCell,
  maxCols = 6,
  className,
  children,
}: {
  count: number;
  minCell: number;
  maxCols?: number;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setSize((previous) =>
        previous.w === rect.width && previous.h === rect.height
          ? previous
          : { w: rect.width, h: rect.height }
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const gap = size.w >= 640 ? 12 : 8;
  const columns = computeColumns(
    count,
    size.w,
    gap,
    minCell,
    maxCols
  );
  const rows = Math.max(1, Math.ceil(count / columns));
  const rawRow =
    size.h > 0
      ? (size.h - (rows - 1) * gap) / rows
      : 0;
  const maxRow = size.w >= 640 ? 96 : 72;
  const rowHeight = Math.max(0, Math.min(rawRow, maxRow));

  return (
    <div
      ref={ref}
      className={className}
      style={{
        display: "grid",
        gap: `${gap}px`,
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gridAutoRows:
          rowHeight > 0
            ? `${rowHeight}px`
            : "1.5rem",
        alignContent: rowHeight > 0 ? "center" : "start",
      }}
    >
      {children}
    </div>
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
        className={`h-11 w-full rounded-full border border-line bg-paper-soft text-sm text-ink shadow-sm outline-none transition placeholder:text-ink-faint hover:border-ink/40 focus:border-ink/70 focus:ring-4 focus:ring-ink/10 ${
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
  /* The exact sequence of views the user has seen. Back restores the
     previous presented question - with its own drill level and answer -
     never a taxonomy parent guessed from the current selection. */
  const [history, setHistory] = useState<NavView[]>([
    { step: 0, drill: [], selection: null },
  ]);
  /* The taxonomy question currently on screen: `categoryDrill` is the
     node whose children are rendered (empty = root) and
     `categorySelection` is the child picked at this level, used for the
     highlight. Kept separate from answers.categoryPath, because while
     drilling a branch the answer path and the presented level are not the
     same thing. */
  const [categoryDrill, setCategoryDrill] = useState<string[]>(
    []
  );
  const [categorySelection, setCategorySelection] =
    useState<string | null>(null);
  /* Which way the last step change moved, so the step carousel slides
     in from the direction of travel (presentation only). */
  const [direction, setDirection] = useState<1 | -1>(1);
  const [answers, setAnswers] =
    useState<Answers>(EMPTY_ANSWERS);
  const [colorFilter, setColorFilter] =
    useState("");
  const [openSection, setOpenSection] =
    useState<string | null>(null);
  /* Details is a multi-group filter (up to ~55 chips). One group is
     shown at a time behind a compact switcher so every chip in the
     active group stays visible on one screen; stored by name so a
     category change falls back to the first group cleanly. */
  const [detailGroupName, setDetailGroupName] =
    useState<string | null>(null);
  const optionsRef = useRef<HTMLElement | null>(null);

  /* Any step change (forward, backward, or expanding/collapsing a
     category section) restarts the options area at its top so a deep
     internal scroll never carries over between steps. */
  useEffect(() => {
    optionsRef.current?.scrollTo({ top: 0, left: 0 });
  }, [step, openSection]);

  /* A saved draft is a ONE-SHOT handoff, never a persistent answer
     store. It is read back exactly once on mount (the results-page
     "Edit search" button writes it just before routing here), then
     removed immediately. No later effect re-persists answers, so a
     page refresh or a fresh visit to /find always starts clean, and
     the embedded home-page questionnaire can never leak its choices
     into the /find flow after a reload. */
  useEffect(() => {
    const saved = sessionStorage.getItem(
      STORAGE_KEY
    );
    let restoredDraft: Answers | null = null;
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
        restoredDraft = restored;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- restore draft/flags once on mount
        setAnswers(restored);
        /* A restored draft is a finished selection, so the level it was
           answered from is everything before the leaf. */
        setCategoryDrill(
          restored.categoryPath.slice(0, -1)
        );
        setCategorySelection(
          restored.categoryPath.length > 0
            ? (restored.categoryPath[
                restored.categoryPath.length - 1
              ] ?? null)
            : null
        );
      } catch {
        /* malformed draft - start clean */
      }
      sessionStorage.removeItem(STORAGE_KEY);
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
      .then((data: Meta) => {
        setMeta(data);
        /* A restored edit-search draft can arrive with a category that
           the restored gender no longer stocks (e.g. UNISEX + Bras).
           Remove that invalid selection exactly once, when the options
           land - without touching anything else the user staged. */
        if (restoredDraft?.category) {
          const audience = genderToAudience(
            restoredDraft.gender
          );
          const compatible =
            !audience ||
            data.categories.some(
              (category) =>
                category.name ===
                  restoredDraft?.category &&
                categoryGendersCompatible(
                  category,
                  audience
                )
            );
          if (!compatible) {
            setAnswers((previous) => ({
              ...previous,
              category: null,
              size: null,
              categoryId: null,
              categoryPath: [],
              taxonomyTokens: [],
            }));
            setCategoryDrill([]);
            setCategorySelection(null);
          }
        }
      })
      .catch(() =>
        setMetaError(
          "Could not load options. Please refresh the page."
        )
      );
  }, []);

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

  /* ---- Taxonomy drill-down -------------------------------------------
     The category step is a generic walk down the taxonomy tree. Nothing
     here knows about Jeans or Shirts: the path state is the only source
     of truth, and the options for the current level come straight from
     the selected node's `children`. The number of levels is whatever the
     data says it is - one, three or five.

     Selecting a node that HAS selectable children drills into them and
     does not advance. Only reaching a leaf resolves the answer and lets
     the flow continue to Size (or to the next attribute when the leaf
     needs no conventional size). */
  const taxonomyTree = useMemo(
    () => taxonomyTreeFromMeta(meta, answers.gender),
    [meta, answers.gender]
  );

  /* A gender switch starts a different tree, so the drill path is
     dropped (never via an effect, so a restored draft isn't wiped). */
  const [lastDrillGender, setLastDrillGender] = useState<string | null>(answers.gender);
  if (lastDrillGender !== answers.gender) {
    setLastDrillGender(answers.gender);
  }

  /* The path actually rendered: the restored/stored one, clamped to what
     still exists in the current tree. */
  const taxonomyPath = useMemo(() => {
    const path = answers.categoryPath ?? [];
    if (!taxonomyTree || path.length === 0) return [];
    const valid = path.filter((id) => taxonomyTree.nodes[id]);
    /* a truncated path must still end on a real node */
    return valid.length > 0 ? valid : [];
  }, [answers.categoryPath, taxonomyTree]);

  /* Data-driven decision: children -> keep drilling, leaf -> advance. */
  const taxonomyDecision = useMemo(
    () => taxonomyDecideNext(taxonomyTree, taxonomyPath),
    [taxonomyTree, taxonomyPath]
  );

  const taxonomyAtLeaf =
    taxonomyDecision.kind !== "children" &&
    taxonomyPath.length > 0;

  /* Labels for the breadcrumb, root first. */
  const taxonomyTrail = useMemo(
    () =>
      taxonomyPath
        .map((id) => taxonomyTree?.nodes[id])
        .filter((node): node is TaxonomyNodeView => Boolean(node)),
    [taxonomyPath, taxonomyTree]
  );

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
        className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_10px_30px_-20px_rgba(0,0,0,0.3)]"
      >
        <button
          type="button"
          aria-expanded={open}
          onClick={() => toggleSection(section.key)}
          className="flex min-h-0 w-full flex-1 items-center justify-between gap-2 bg-paper-soft px-5 py-4 text-left transition-colors hover:bg-line"
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
          <div className="border-t border-line bg-surface p-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
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

  /* Stage 3-A: size options are the union, per category, of every size
     the catalog carries for it (all audiences) with the full standard
     surface for its product type (orders fit every possible size). The
     picked gender no longer narrows the list; footwear shows EU/US/UK
     columns with all possible numeric sizes, clothing the whole alpha
     ladder (see sizeSectionsFor). */
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

  /* The budget sliders cap at the most expensive stocked product in
     the picked category (any category's max is the priciest buyable
     product there, normalized to the EUR reference by /api/meta). The
     value is expressed in the budget display currency and rounded up
     a whole unit so the Maximum genuinely covers the top price; no
     catalog max falls back to a flat 200. */
  const budgetSliderMax = useMemo(() => {
    const maxEur =
      meta?.priceMaxEurByCategory?.[
        answers.category ?? ""
      ];
    if (
      maxEur == null ||
      !Number.isFinite(maxEur) ||
      maxEur <= 0
    ) {
      return 200;
    }
    const rate = meta?.fx?.rate ?? null;
    const display =
      budgetCurrencyLabel === "USD" &&
      rate !== null &&
      Number.isFinite(rate) &&
      rate > 0
        ? eurToUsd(maxEur, rate)
        : maxEur;
    return Math.max(1, Math.ceil(display));
  }, [
    meta,
    answers.category,
    budgetCurrencyLabel,
  ]);

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
        values: (
          attributeValues
            ? [
                ...new Set([
                  ...attributeValues,
                  ...optionGroup.values,
                ]),
              ]
            : optionGroup.values
        ).filter(
          (value) =>
            value.trim().toLowerCase() !== "n/a" &&
            value.trim() !== ""
        ),
      };
    });
  }, [meta, answers.category]);

  const activeDetailGroup =
    detailGroups.find(
      (group) => group.name === detailGroupName
    ) ??
    detailGroups[0] ??
    null;

  const filteredColors = useMemo(() => {
    if (!meta) return [];
    const needle = colorFilter.trim().toLowerCase();
    return needle
      ? meta.colors.filter((color) =>
          color.toLowerCase().includes(needle)
        )
      : meta.colors;
  }, [meta, colorFilter]);

  const totalSteps = STEP_KEYS.length;

  const stepKey = STEP_KEYS[step];

  const stepState = getStepState(
    stepKey,
    answers
  );

  /* The single source of truth for "which step comes next": the taxonomy
     shape decides whether Size applies and whether the selection is
     finished, the questionnaire only knows the step order. */
  const nextStep = taxonomyNextStepIndex({
    steps: STEP_KEYS,
    currentIndex: step,
    decision: taxonomyDecision,
  });

  /* Leaf-only gate: the category step can only advance once the
     selection has reached a node with no selectable children. Any branch
     still offering children keeps the user on the step - this is read
     from the taxonomy shape, never from a category name. */
  const categoryNeedsDeeperPick =
    stepKey === "category" &&
    taxonomyTree !== null &&
    taxonomyDecision.kind === "children" &&
    taxonomyPath.length > 0;

  /* On the category step the options are exactly the children of the
     level currently on screen (`categoryDrill`); the picked child is
     highlighted from `categorySelection`. */
  const taxonomyRenderPath = categoryDrill;

  const taxonomyRenderOptions =
    taxonomyOptionsAt(taxonomyTree, taxonomyRenderPath).filter((node) =>
      taxonomyBranchHasStock(
        taxonomyTree,
        node.id,
        taxonomyBranchHasCategory(meta, genderAudience)
      )
    );

  /* Size is skipped - not blocked - when the finished selection needs no
     conventional size, so the step can never dead-end. */
  const sizeIsSkipped =
    stepKey === "size" && nextStep !== null && nextStep > step;

  const sizeStepApplies =
    stepKey === "size"
      ? taxonomyPath.length === 0 || !taxonomyAtLeaf || sizeIsSkipped
      : true;

  const canProceed =
    stepState.canNext && !categoryNeedsDeeperPick && sizeStepApplies;

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
        categoryId: cleared ? null : (previous.categoryPath.at(-1) ?? null),
        size: cleared ? previous.size : null,
      };
    });
  }

  /**
   * The one and only selection handler for the category step.
   *
   * It never decides what comes next from a category name: it appends
   * the node to the path and re-derives the answer from the resulting
   * path. A node with selectable children stays on the step (the caller
   * renders those children); only a leaf resolves the answer, because a
   * leaf is the single state allowed to advance to Size.
   */
  function pickTaxonomyNode(node: TaxonomyNodeView) {
    /* The displayed level is `categoryDrill`; the picked child is
       `node`. Tapping the already-picked child clears it (staying on the
       same level); any other tap selects from the level on screen, so a
       re-pick never stacks onto a stale deeper pick. */
    const leafPicked = categorySelection === node.id;
    const selection = leafPicked ? null : node.id;
    const answerPath = selection
      ? [...categoryDrill, selection]
      : categoryDrill;

    const decision = taxonomyDecideNext(taxonomyTree, answerPath);

    setAnswers((previous) => {
      const derived = taxonomyDeriveQuery(
        taxonomyTree,
        answerPath
      );
      return {
        ...previous,
        category: derived.category,
        categoryId: selection,
        categoryPath: answerPath,
        size: null,
        taxonomyTokens: taxonomyTokensFor(derived),
      };
    });

    /* A branch keeps the user on the category step but opens its
       children: remember the question just answered (with the branch
       highlighted) so Back can return to it. */
    if (selection && decision.kind === "children") {
      setHistory((entries) => [
        ...entries,
        { step, drill: categoryDrill, selection },
      ]);
      setCategoryDrill([...categoryDrill, selection]);
      setCategorySelection(null);
      return;
    }

    /* A finished leaf selection moves straight on to the next applicable
       attribute. Record the answered picker view before the automatic
       advance, so Back lands on the question the user answered - with the
       leaf still selected. */
    if (
      selection &&
      answerPath.length > 0 &&
      stepKey === "category"
    ) {
      const target = taxonomyNextStepIndex({
        steps: STEP_KEYS,
        currentIndex: step,
        decision,
      });
      if (target !== null) {
        setHistory((entries) => [
          ...entries,
          { step, drill: categoryDrill, selection },
          { step: target, drill: categoryDrill, selection },
        ]);
        setCategorySelection(selection);
        setDirection(1);
        setStep(target);
        return;
      }
    }

    /* Clearing a pick (or a level with no next step) stays on the picker:
       that cleared view is itself something Back can return to. */
    setHistory((entries) => [
      ...entries,
      { step, drill: categoryDrill, selection },
    ]);
    setCategorySelection(selection);
  }

  function pickKidsAge(value: string) {
    setAnswers((previous) => ({
      ...previous,
      kidsAge:
        previous.kidsAge === value
          ? null
          : value,
    }));
  }

  function pickGender(value: string) {
    /* The drill level and the category answer are cleared together when a
       real gender switch invalidates the category, so no stale taxonomy
       node is left on screen. */
    const audienceForView = genderToAudience(
      answers.gender === value ? null : value
    );
    const categoryStillValidForView =
      !answers.category ||
      !audienceForView ||
      meta?.categories.some(
        (category) =>
          category.name === answers.category &&
          categoryGendersCompatible(
            category,
            audienceForView
          )
      );
    const categoryClearedForView =
      answers.category !== null &&
      !categoryStillValidForView;
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
        /* A real gender switch moves to a different taxonomy tree, so
           the old drill path can never apply; clear it with the
           category instead of leaving stale ids behind. */
        categoryId: categoryCleared
          ? null
          : previous.categoryId,
        categoryPath: categoryCleared
          ? []
          : previous.categoryPath,
        taxonomyTokens: categoryCleared
          ? []
          : previous.taxonomyTokens,
      };
    });
    if (categoryClearedForView) {
      setCategoryDrill([]);
      setCategorySelection(null);
    }
  }

  /* The canonical SizeCategoryId of the picked category, reusing the
     questionnaire's own vocabulary classification. Null when the
     category is unknown to the payload (the normalizer then keeps only
     category-independent values resolvable). */
  function sizeCategoryIdForName(name: string | null) {
    const found = name
      ? meta?.categories.find(
          (category) => category.name === name
        )
      : undefined;
    if (!found) {
      return null;
    }
    return sizeCategoryIdForCategory({
      slug: found.slug,
      name: found.name,
      rootSlug: found.root,
      group: found.group,
    });
  }

  /* H2: turn a section chip into its canonical identity using the
     current context. The section owns productType/system; the picked
     category owns the category context; the gender owns the audience. */
  function canonicalizeSizeFor(
    section: SizeSection,
    value: string
  ) {
    return canonicalizeQuestionnaireSize(value, {
      audience: genderToAudience(answers.gender) ?? "UNKNOWN",
      productType: section.productType,
      system: section.system,
      category: sizeCategoryIdForName(answers.category),
    });
  }

  function isSizeChipSelected(
    section: SizeSection,
    value: string
  ): boolean {
    const picked = answers.size;
    if (!picked) {
      return false;
    }

    /* H2: a canonical pick preselects by identity, so a restored
       "M" still lights up the "Medium" chip it belongs to. */
    if (picked.canonicalSizeOptionId) {
      return (
        canonicalizeSizeFor(section, value)
          .canonicalSizeOptionId ===
        picked.canonicalSizeOptionId
      );
    }

    if (picked.value !== value) {
      return false;
    }
    if (
      picked.system !== null ||
      picked.productType !== null ||
      picked.category !== null ||
      picked.audience !== null
    ) {
      return (
        section.productType === picked.productType &&
        (picked.system === null ||
          section.system === picked.system)
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
    setAnswers((previous) => {
      const selection = canonicalizeQuestionnaireSize(value, {
        audience:
          genderToAudience(previous.gender) ?? "UNKNOWN",
        productType: section.productType,
        system: section.system,
        category: sizeCategoryIdForName(previous.category),
      });
      return {
        ...previous,
        size: {
          value,
          audience: genderToAudience(previous.gender),
          productType: section.productType,
          category: previous.category,
          system: selection.system,
          canonicalSizeOptionId:
            selection.canonicalSizeOptionId,
          resolutionStatus: selection.resolutionStatus,
        },
      };
    });
  }

  /* Back replays the real presentation history: it restores the exact
     previous view (step + category drill level) and leaves every answer
     in place, so the user can change it. Downstream answers are only
     invalidated by the change handlers when a change actually makes them
     stale - never by the act of going back. */
  function back() {
    if (history.length <= 1) {
      return;
    }
    const previous = history[history.length - 2];
    const previousPath = previous.selection
      ? [...previous.drill, previous.selection]
      : previous.drill;
    setHistory((entries) => entries.slice(0, -1));
    setDirection(-1);
    setStep(previous.step);
    setCategoryDrill(previous.drill);
    setCategorySelection(previous.selection);
    setAnswers((current) => {
      if (
        current.categoryPath.length ===
          previousPath.length &&
        current.categoryPath.every(
          (id, index) => id === previousPath[index]
        )
      ) {
        return current;
      }
      const tree = taxonomyTreeFromMeta(meta, current.gender);
      const derived = taxonomyDeriveQuery(
        tree,
        previousPath
      );
      return {
        ...current,
        category: derived.category,
        categoryId: previous.selection,
        categoryPath: previousPath,
        taxonomyTokens: taxonomyTokensFor(derived),
      };
    });
    setOpenSection(null);
  }

  function next() {
    if (canProceed && nextStep !== null) {
      setHistory((entries) => [
        ...entries,
        {
          step: nextStep,
          drill: categoryDrill,
          selection: categorySelection,
        },
      ]);
      setDirection(1);
      setStep(nextStep);
    }
  }

  function buildIntent(): FindIntent | null {
    const parts: string[] = [];

    /* H2: the size pick never becomes a free-text `q` token. A resolved
       pick contributes its canonical identity; an unresolved pick (or a
       system-only pin) contributes at most an honest `sizeSystem`
       filter. The canonical decision is made at the database boundary -
       the questionnaire only forwards the identity it derived. */
    let size: string[] = [];
    let sizeSystem: string[] = [];

    if (answers.gender) {
      parts.push(answers.gender);
    }
    for (const color of answers.colors) {
      parts.push(color);
    }
    if (answers.size) {
      const picked = answers.size;
      if (
        picked.resolutionStatus === "RESOLVED" &&
        picked.canonicalSizeOptionId
      ) {
        size = [picked.canonicalSizeOptionId];
      } else if (
        picked.system !== null &&
        isSizeSystemId(picked.system) &&
        isPersistedSizeSystem(picked.system)
      ) {
        sizeSystem = [picked.system];
      }
    }
    /* Structured detail chips that are not attribute-backed become
       REAL query tokens, exactly as if the user typed them. */
    for (const token of answers.detailTokens) {
      if (token.trim()) {
        parts.push(token.trim());
      }
    }
    /* Taxonomy-derived tokens (style/fit words picked in the drill-down
       plus any cross-tag) travel with the query the same way. */
    for (const token of answers.taxonomyTokens ?? []) {
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
    /* The kids age bracket is a real query token, never a UI-only
       filter: a "kids" search narrows to the bracket named. */
    if (answers.kidsAge) {
      const option = KIDS_AGE_OPTIONS.find(
        (item) => item.id === answers.kidsAge
      );
      if (option) {
        parts.push(option.tokens[0]);
      }
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
        size,
        sizeSystem,
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
      <div className="wizard-head flex items-center justify-between gap-4">
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
      <div className="wizard-progress mt-5 flex items-center gap-4">
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
      <div className="wizard-question mt-5 text-center">
        <Heading className="font-display text-2xl font-medium tracking-tight text-ink sm:text-3xl">
          {copy.ask}
        </Heading>
        <p className="mt-3 text-ink-soft">
          {copy.hint}
        </p>
      </div>

      <section
        ref={optionsRef}
        className="min-h-0 flex-1 overflow-hidden"
        aria-busy={!meta}
      >
        {meta && (
          <div
            key={step}
            className={`flex h-full min-h-0 w-full flex-col ${
              direction === -1 ? "step-slide-prev" : "step-slide-next"
            }`}
          >
            {step === 0 && (
              <FitGrid
                count={GENDER_OPTIONS.length}
                minCell={88}
                maxCols={3}
                className="mx-auto min-h-0 w-full max-w-2xl flex-1"
              >
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
              </FitGrid>
            )}

            {step === 1 && answers.gender === "kids" && (
              <div className="mx-auto w-full max-w-2xl shrink-0 pb-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-ink-faint">
                  Age group
                </p>
                <div className="grid w-full auto-rows-[2.5rem] grid-cols-2 gap-2">
                  {KIDS_AGE_OPTIONS.map((option) => (
                    <OptionCard
                      key={option.id}
                      label={option.label}
                      selected={
                        answers.kidsAge === option.id
                      }
                      onClick={() =>
                        pickKidsAge(option.id)
                      }
                    />
                  ))}
                </div>
              </div>
            )}

            {step === 1 &&
            taxonomyTree !== null ? (
              <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
                {taxonomyRenderPath.length > 0 && (
                  <button
                    type="button"
                    onClick={back}
                    className="mb-2 inline-flex shrink-0 items-center gap-2 text-sm font-medium text-accent-deep"
                  >
                    <ChevronIcon open={false} />
                    {taxonomyRenderPath.length > 1
                      ? taxonomyTree?.nodes[
                          taxonomyRenderPath[
                            taxonomyRenderPath.length - 2
                          ] ?? ""
                        ]?.label
                      : "All categories"}
                  </button>
                )}
                {taxonomyTrail.length > 0 && (
                  <p className="mb-1 text-xs font-medium uppercase tracking-[0.14em] text-ink-faint">
                    {taxonomyTrail
                      .map((node) => node.label)
                      .join(" / ")}
                  </p>
                )}
                <p className="mb-2 shrink-0 text-sm text-ink-soft">
                  {taxonomyRenderPath.length === 0
                    ? "Pick a category"
                    : `Pick a ${taxonomyTrail[taxonomyTrail.length - 1]?.type === "fit" ? "fit" : "detail"}`}
                </p>
                {taxonomyRenderOptions.length === 0 ? (
                  <div className="m-auto max-w-sm rounded-2xl border border-line bg-paper-soft px-5 py-6 text-center">
                    <p className="text-sm text-ink-soft">
                      Nothing in stock here yet — go
                      back and pick another.
                    </p>
                  </div>
                ) : (
                  <FitGrid
                    count={taxonomyRenderOptions.length}
                    minCell={88}
                    maxCols={6}
                    className="min-h-0 w-full flex-1"
                  >
                    {taxonomyRenderOptions.map((node) => (
                      <OptionCard
                        key={node.id}
                        label={node.label}
                        selected={
                          categorySelection === node.id
                        }
                        onClick={() =>
                          pickTaxonomyNode(node)
                        }
                      />
                    ))}
                  </FitGrid>
                )}
              </div>
            ) : step === 1 && (
              categorySections.length === 0 ? (
                <div className="mx-auto max-w-sm rounded-2xl border border-line bg-paper-soft px-5 py-6 text-center">
                  <p className="text-sm text-ink-soft">
                    There are no categories in
                    stock for that audience yet —
                    go back and pick another.
                  </p>
                </div>
              ) : openKey === null ? (
                <div className="mx-auto w-full max-w-3xl">
                  <p className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-ink-faint">
                    Tap a section to expand it
                  </p>
                  <div className="grid w-full auto-rows-[3.25rem] grid-cols-2 gap-2 sm:grid-cols-3">
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
              <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
                <div className="mx-auto mb-2 w-full max-w-sm shrink-0">
                  <FieldInput
                    id="find-color-filter"
                    value={colorFilter}
                    onChange={setColorFilter}
                    placeholder="Search colors…"
                    icon
                  />
                </div>
                {meta.colors.length === 0 ? (
                  <p className="m-auto max-w-sm text-center text-sm text-ink-faint">
                    No colors are available from the
                    current catalog right now — you
                    can skip this step.
                  </p>
                ) : filteredColors.length === 0 ? (
                  <p className="m-auto text-center text-sm text-ink-faint">
                    No colors match “{colorFilter}”.
                  </p>
                ) : (
                  <FitGrid
                    count={filteredColors.length}
                    minCell={72}
                    maxCols={8}
                    className="min-h-0 w-full flex-1"
                  >
                    {filteredColors.map((color) => (
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
                  </FitGrid>
                )}
              </div>
            )}

            {step === 2 && (
              <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-2">
                {sizeSections.length > 0 ? (
                  sizeSections.map((section) =>
                    section.label !== null ? (
                      <div
                        key={section.label}
                        className="flex min-h-0 flex-1 flex-col"
                      >
                        <h2 className="mb-1 shrink-0 text-center text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
                          {section.label}
                        </h2>
                        <FitGrid
                          count={section.values.length}
                          minCell={56}
                          maxCols={8}
                          className="min-h-0 w-full flex-1"
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
                        </FitGrid>
                      </div>
                    ) : (
                      <FitGrid
                        key="sizes"
                        count={section.values.length}
                        minCell={56}
                        maxCols={8}
                        className="min-h-0 w-full flex-1"
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
                      </FitGrid>
                    )
                  )
                ) : (
                  <div className="m-auto max-w-sm rounded-2xl border border-line bg-paper-soft px-5 py-6 text-center">
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
              <div className="mx-auto flex h-full min-h-0 w-full max-w-md flex-col justify-center gap-4 overflow-hidden">
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
                    max={budgetSliderMax}
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
                    className="w-full accent-[var(--ink)]"
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
                        ? budgetSliderMax
                        : answers.budgetMax}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={budgetSliderMax}
                    step={1}
                    aria-label={`Maximum budget in ${budgetCurrencyLabel}`}
                    value={
                      answers.budgetMax === ""
                        ? budgetSliderMax
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
                    className="w-full accent-[var(--ink)]"
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
                <div className="wizard-details mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col gap-3">
                <div className="wizard-details-banner flex shrink-0 items-center gap-2 rounded-xl border border-accent/20 bg-accent-tint px-3 py-2">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-deep text-paper">
                    <CheckIcon />
                  </span>
                  <p className="text-xs leading-snug">
                    <span className="font-semibold text-ink">
                      We&apos;ve got your preferences.
                    </span>{" "}
                    <span className="text-ink-soft">
                      Let&apos;s find something you&apos;ll love.
                    </span>
                  </p>
                </div>

                <div className="shrink-0">
                  <label
                    htmlFor="find-search-text"
                    className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint"
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

                {detailGroups.length === 0 ? (
                  <p className="m-auto max-w-sm rounded-2xl border border-line bg-paper-soft px-5 py-4 text-center text-sm text-ink-soft">
                    This category has no structured details
                    yet — describe what matters in your own
                    words above.
                  </p>
                ) : (
                  <>
                    <div
                      role="tablist"
                      aria-label="Detail groups"
                      className="wizard-detail-tabs flex shrink-0 flex-wrap gap-1.5"
                    >
                      {detailGroups.map((group) => {
                        const active =
                          group.name ===
                          activeDetailGroup?.name;
                        return (
                          <button
                            key={group.name}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() =>
                              setDetailGroupName(
                                group.name
                              )
                            }
                            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                              active
                                ? "border-ink bg-ink text-paper"
                                : "border-line bg-paper-soft text-ink-soft hover:border-ink/40 hover:text-ink"
                            }`}
                          >
                            {group.name}
                          </button>
                        );
                      })}
                    </div>
                    {activeDetailGroup && (
                      <FitGrid
                        key={activeDetailGroup.name}
                        count={
                          activeDetailGroup.values.length
                        }
                        minCell={64}
                        maxCols={8}
                        className="min-h-0 w-full flex-1"
                      >
                        {activeDetailGroup.values.map(
                          (value) => (
                            <OptionPill
                              key={value}
                              label={value}
                              selected={isDetailSelected(
                                value
                              )}
                              onClick={() =>
                                toggleDetail(
                                  activeDetailGroup,
                                  value
                                )
                              }
                            />
                          )
                        )}
                      </FitGrid>
                    )}
                  </>
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
      <div className="wizard-actions mt-auto flex shrink-0 items-center justify-between gap-4 border-t border-line pb-1 pt-6">
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
                onClick={() => {
                  setHistory((entries) => [
                    ...entries,
                    {
                      step: step + 1,
                      drill: categoryDrill,
                      selection: categorySelection,
                    },
                  ]);
                  setDirection(1);
                  setStep(step + 1);
                }}
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