import {
  taxonomyDefinition,
  taxonomyTrees,
  type KidsAge,
  type TaxonomyGender,
  type TaxonomyGenderTree,
  type TaxonomyNode,
  type AppTaxonomy,
} from "./definition";

export type {
  AppTaxonomy,
  KidsAge,
  TaxonomyGender,
  TaxonomyGenderTree,
  TaxonomyNode,
};
export { taxonomyDefinition, taxonomyTrees };

/**
 * Cross-tag query vocabulary. A cross-tag is a label spanning
 * categories, never a category row and never a questionnaire step: it
 * only widens what the search accepts.
 */
export const CROSS_TAG_TOKENS: Record<string, string> = {
  activewear: "activewear",
  sportswear: "activewear",
  athletic: "activewear",
  gym: "activewear",
  workout: "activewear",
  training: "activewear",
};

/**
 * All legacy DB category display names reachable through a cross-tag.
 * "activewear" therefore resolves to the union of every tagged
 * category, across all three genders.
 */
export function crossTagCategoryNames(tag: string): string[] {
  const out = new Set<string>();
  for (const gender of ["MEN", "WOMEN", "KIDS"] as const) {
    for (const node of Object.values(
      taxonomyTrees[gender].nodes
    )) {
      if (!node.crossTags.includes(tag)) continue;
      for (const name of node.mapTo) out.add(name);
      for (const childId of node.children) {
        const child = taxonomyTrees[gender].nodes[childId];
        if (!child) continue;
        /* a node inherits the tag for search purposes */
        for (const name of child.mapTo) out.add(name);
      }
    }
  }
  return [...out];
}

/**
 * Kids age brackets - the filterable kids attribute. The bracket is
 * carried as a real query token, never a UI-only filter.
 */
export const KIDS_AGE_OPTIONS: Array<{
  id: string;
  label: string;
  age: KidsAge;
  tokens: string[];
}> = [
  {
    id: "babies",
    label: "Babies (0-3)",
    age: "0-3",
    tokens: ["baby", "babies", "infant", "toddler"],
  },
  {
    id: "kids",
    label: "Kids (4-14)",
    age: "4-14",
    tokens: ["kids", "children"],
  },
];

/** Query tokens for a kids age bracket id. */
export function kidsAgeTokens(
  ageId: string | null
): string[] {
  if (!ageId) return [];
  const option = KIDS_AGE_OPTIONS.find(
    (item) => item.id === ageId
  );
  return option ? [...option.tokens] : [];
}

/** Map a legacy DB slug to its new taxonomy IDs (reference only). */
export function migrateSlug(slug: string): string[] {
  return taxonomyDefinition.migrationMap[slug] ?? [];
}

/** Full taxonomy payload for /api/meta. */
export function taxonomyForApi(): AppTaxonomy {
  return taxonomyDefinition;
}

export {
  allNodeIds,
  decideNext,
  descendantIds,
  deriveQuery,
  editablePath,
  findNodeByCategoryName,
  getGenderTree,
  getNode,
  hasSelectableChildren,
  isLeafSelection,
  nextStepIndex,
  nodesWithCrossTag,
  optionsAt,
  pathToNode,
  type DerivedQuery,
  type FlowDecision,
} from "./flow";