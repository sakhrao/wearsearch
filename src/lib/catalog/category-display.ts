/* Shared canonical taxonomy -> questionnaire category list.

   Single shared source of truth for the category options the Questionnaire /
   Find "Pick a category" step presents. It is derived PURELY from the
   canonical taxonomy declared in import-plan.ts (PLAN_PARENT_CATEGORIES +
   PLAN_LEAF_CATEGORIES), merged with any legacy DB-only categories so that
   nothing currently offered disappears. There is deliberately NO second
   hardcoded category list here, and NO dependence on import phases:

     - every canonical leaf is included (IMPORTABLE and PLANNED alike),
       because Questionnaire availability is independent of import
       availability.
     - parents (e.g. Bags) are never presented as selectable leaves.
     - legacy DB-only rows keep their own slug/name (never renamed).

   This module has no DB / network / I-O; it is safe for the server route
   and offline tests alike. */

import {
  CATEGORY_PLANS,
  PLAN_PARENT_CATEGORIES,
  PLAN_LEAF_CATEGORIES,
} from "./import-plan";
/* A display descriptor for one selectable category option. `group` is the
   size-semantic group the existing questionnaire logic keys on (Shoes ->
   "Shoe size", Accessories -> "Accessory size", Headwear -> "Headwear
   size", everything else -> "Clothing size"). `root`/`subgroup` drive the
   hierarchical rendering. */
export type CategoryDisplay = {
  slug: string;
  name: string;
  /* top-level branch this leaf hangs under: Clothing | Shoes | Accessories */
  root: string;
  rootSlug: string;
  /* immediate non-root parent group, or null when the leaf hangs directly
     under a root (e.g. Sneakers under Shoes; Belts under Accessories).
     For bag leaves this is "Bags" - a parent, never a selectable leaf. */
  subgroup: string | null;
  subgroupSlug: string | null;
  /* immediate canonical parent slug */
  parentSlug: string;
  /* size-semantic group for the questionnaire's labelling logic */
  group: string;
  /* provenance: "canonical" (from import-plan) vs "legacy" (DB-only) */
  source: "canonical" | "legacy";
  /* whether the DB currently stocks products in this category */
  hasProducts: boolean;
};

const parentBySlug = new Map<string, { name: string; slug: string; parentSlug?: string | null }>(
  PLAN_PARENT_CATEGORIES.map((p) => [p.slug, p])
);

/* Build the canonical display descriptors for every canonical leaf. The
   returned array keeps the stable PLAN_LEAF_CATEGORIES order (roots and
   subgroups therefore render in a deterministic, canonical order). */
export function canonicalCategoryDisplay(): CategoryDisplay[] {
  const out: CategoryDisplay[] = [];
  for (const leaf of PLAN_LEAF_CATEGORIES) {
    const parent = parentBySlug.get(leaf.parentSlug);
    if (!parent) continue;

    /* walk up to the top-level root ancestor */
    let root = parent;
    let cur: typeof parent = parent;
    while (cur.parentSlug) {
      const up = parentBySlug.get(cur.parentSlug);
      if (!up) break;
      root = up;
      cur = up;
    }

    const directUnderRoot = leaf.parentSlug === root.slug;
    const subgroupName = directUnderRoot ? null : parent.name;
    const subgroupSlug = directUnderRoot ? null : parent.slug;

    let group: string;
    if (root.slug === "shoes") group = "Shoes";
    else if (root.slug === "accessories") group = "Accessories";
    else if (root.slug === "headwear") group = "Headwear";
    else group = subgroupName ?? root.name; /* clothing: the sub-parent, e.g. Tops/Outerwear */

    out.push({
      slug: leaf.slug,
      name: leaf.name,
      root: root.name,
      rootSlug: root.slug,
      subgroup: subgroupName,
      subgroupSlug,
      parentSlug: leaf.parentSlug,
      group,
      source: "canonical",
      hasProducts: false,
    });
  }
  return out;
}

export const CATEGORY_ROOT_ORDER = ["Clothing", "Shoes", "Accessories", "Headwear"];

/* ---- gender-aware category filtering ----

   Category -> gender compatibility is NOT a hardcoded hide-list. It is
   derived SEMANTIC-FIRST from the project's own real signals:

     - the canonical import plan's eBay path tokens (Men/Women segments),
       which classify a leaf by the genders its source listings target
       (dresses/skirts/bras are Women-only in the plan; sneakers/T-shirts
       carry both Men and Women tokens);
     - the live Product.gender distribution when the DB actually stocks a
       category (fills KIDS, confirms/mirrors UNISEX).

   Rules:
     - a category is MEN-compatible when a Men token exists (or its live
       stock is MEN);
     - WOMEN-compatible when a Women token exists (or live stock is WOMEN);
     - UNISEX-compatible when BOTH the Men and Women token sets exist (a
       genuinely shared catalog leaf) OR the live stock carries UNISEX;
     - a leaf with no gendered signal at all defaults to the adult-shared
       set (Men + Women + Unisex), and a UNISEX-only leaf is expanded so
       both Men and Women can reach it — shared categories are never
       hidden by empty inventory;
     - KIDS-compatible only from live KIDS stock - no token anywhere in
       the plan encodes a kids audience, so KIDS is data-driven only and
       never guessed.

   The taxonomy itself is untouched: this list only tells the
   questionnaire which options to show for a picked gender. */

export type CategoryGender =
  | "MEN"
  | "WOMEN"
  | "KIDS"
  | "UNISEX";

const GENDER_SEGMENT_PATTERN =
  /^(Men|Women)(?:'s)?(?:(\s)|$)/i;

export function planGendersForLeaf(
  slug: string
): Set<CategoryGender> {
  const plan = CATEGORY_PLANS.find(
    (entry) => entry.slug === slug
  );
  const genders = new Set<CategoryGender>();
  if (!plan) return genders;

  let hasMen = false;
  let hasWomen = false;
  for (const path of plan.sourceCategoryTokens) {
    for (const segment of path.split("|")) {
      const match = segment.match(GENDER_SEGMENT_PATTERN);
      if (!match) continue;
      if ((match[1] ?? "").toLowerCase() === "men") {
        hasMen = true;
      } else {
        hasWomen = true;
      }
    }
  }
  if (hasMen) genders.add("MEN");
  if (hasWomen) genders.add("WOMEN");
  /* both Men AND Women listings -> an adult-shared (unisex) catalog leaf */
  if (hasMen && hasWomen) genders.add("UNISEX");
  return genders;
}

/* Merge the plan affinity with the live stock genders. Product data
   supplies KIDS and can surface UNISEX for a leaf whose plan is
   single-gender but whose actual stock crosses audiences.

   SEMANTIC-FIRST: a category's budget starts from what we KNOW it is
   for (the plan's Men/Women listings). It is narrowed only by that
   knowledge and by live stock — never by inventory emptiness:

     - a canonical leaf with no gendered signal is a shared adult
       catalog leaf (Men + Women + Unisex): data absence never hides
       a semantically-shared category (e.g. Watches shows for both
       even with zero stock);
     - a UNISEX-only leaf still reaches both adult audiences: a
       shared category (e.g. Backpacks) is never locked behind one
       gender pick;
     - KIDS is data-driven only: no plan token anywhere encodes a
       kids audience, so Kids compatibility never comes from the
       semantic default — only from live KIDS stock;
     - legacy DB-only rows keep today's conservative behaviour. */
export function mergeCategoryGenders(deps: {
  planGenders: Set<CategoryGender>;
  productGenders: Set<CategoryGender>;
  isLegacy: boolean;
}): CategoryGender[] {
  const { planGenders, productGenders, isLegacy } = deps;
  const merged = new Set<CategoryGender>();

  for (const gender of planGenders) {
    merged.add(gender);
  }
  for (const gender of productGenders) {
    merged.add(gender);
  }

  if (merged.size === 0) {
    /* Neither the plan nor the stock says anything gendered: offer the
       category to every adult audience (semantic shared default for
       canonical leaves, conservative default for legacy rows). */
    void isLegacy;
    merged.add("MEN");
    merged.add("WOMEN");
    merged.add("UNISEX");
  }

  /* A shared (unisex) leaf reaches both adult audiences: when the
     merged set is UNISEX-only, ensure Men and Women can still see it. */
  if (merged.has("UNISEX")) {
    merged.add("MEN");
    merged.add("WOMEN");
  }

  return (
    ["MEN", "WOMEN", "KIDS", "UNISEX"] as const
  ).filter((gender) => merged.has(gender));
}

/* ---- legacy merge helpers ---- */

/* Root accessory/headwear categories are stored as flat roots in the DB;
   used only to place LEGACY (DB-only) categories onto a sensible group. */
const SLUG_TO_GROUP: Record<string, string> = {
  beanies: "Headwear",
  caps: "Headwear",
  hats: "Headwear",
  belts: "Accessories",
  sunglasses: "Accessories",
  ties: "Accessories",
  watches: "Accessories",
};

/* Map a legacy category's current DB parent name to the canonical root it
   belongs under, so legacy items keep showing near their siblings. */
const LEGACY_PARENT_ROOT: Record<string, string> = {
  Tops: "Clothing",
  Bottoms: "Clothing",
  "Dresses & Jumpsuits": "Clothing",
  Outerwear: "Clothing",
  Sportswear: "Clothing",
  "Swimwear & Basics": "Clothing",
  Shoes: "Shoes",
  Accessories: "Accessories",
  Headwear: "Headwear",
};

/* A minimal projection of the DB Category row the merge needs. */
export type DbCategoryRow = {
  slug: string;
  name: string;
  id: string;
  parentName: string | null;
};

/* Merge the canonical taxonomy with legacy DB-only categories into the full
   questionnaire option list. Canonical wins on slug overlap (no duplicates);
   legacy rows keep their own names and are tagged source "legacy". */
export function buildQuestionnaireCategories(deps: {
  dbRows: DbCategoryRow[];
  usedProductCategoryIds: Set<string>;
}): CategoryDisplay[] {
  const { dbRows, usedProductCategoryIds } = deps;
  const canonical = canonicalCategoryDisplay();
  const canonicalLeafSlugs = new Set(canonical.map((d) => d.slug));
  /* structural parents / roots are never selectable leaf options */
  const parentSlugs = new Set(PLAN_PARENT_CATEGORIES.map((p) => p.slug));

  /* Which canonical slugs actually stock products (via their DB row id). */
  const dbById = new Map(dbRows.map((r) => [r.id, r]));
  const productSlugs = new Set<string>();
  for (const id of usedProductCategoryIds) {
    const row = dbById.get(id);
    if (row) productSlugs.add(row.slug);
  }

  const out: CategoryDisplay[] = canonical.map((d) => ({
    ...d,
    hasProducts: productSlugs.has(d.slug),
  }));

  /* Legacy DB-only categories: present in DB, not a canonical leaf, and
     not a structural parent. Their own names are preserved. */
  for (const row of dbRows) {
    if (canonicalLeafSlugs.has(row.slug)) continue;
    if (parentSlugs.has(row.slug)) continue;
    /* root rows (no parent) are structural top-level branches, never a
       selectable leaf option (e.g. the legacy "headwear" root) */
    if (row.parentName === null) continue;
    const parentName = row.parentName;
    const group = parentName ?? SLUG_TO_GROUP[row.slug] ?? row.name;
    const slugGroup = SLUG_TO_GROUP[row.slug];
    const root =
      (parentName ? LEGACY_PARENT_ROOT[parentName] : undefined) ??
      (slugGroup === "Headwear" || slugGroup === "Accessories" ? slugGroup : "Clothing");
    const rootSlug = root.toLowerCase();
    const subgroup = root === "Clothing" && parentName ? parentName : null;
    out.push({
      slug: row.slug,
      name: row.name,
      root,
      rootSlug,
      subgroup,
      subgroupSlug: subgroup ? subgroup.toLowerCase().replace(/\s+/g, "-") : null,
      parentSlug: row.slug,
      group,
      source: "legacy",
      hasProducts: usedProductCategoryIds.has(row.id),
    });
  }

  return out;
}
