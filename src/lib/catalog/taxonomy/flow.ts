/**
 * Data-driven questionnaire flow.
 *
 * Every decision the questionnaire makes about "what comes next" is
 * derived from the taxonomy SHAPE only:
 *
 *   - does the selected node have selectable children?  -> show them
 *   - otherwise it is a leaf -> continue to the next attribute
 *     (Size when the node requires it, else the next applicable step)
 *
 * Nothing here branches on a category, gender or label. Adding a new
 * taxonomy branch with any depth changes the flow automatically.
 */

import {
  taxonomyTrees,
  type KidsAge,
  type TaxonomyGender,
  type TaxonomyGenderTree,
  type TaxonomyNode,
} from "./definition";

export type {
  KidsAge,
  TaxonomyGender,
  TaxonomyGenderTree,
  TaxonomyNode,
};

/** Gender tree lookup. Returns null for UNISEX / unknown. */
export function getGenderTree(
  gender: string | null
): TaxonomyGenderTree | null {
  if (gender === "men") return taxonomyTrees.MEN;
  if (gender === "women") return taxonomyTrees.WOMEN;
  if (gender === "kids") return taxonomyTrees.KIDS;
  return null;
}

/** Resolve a node, or null when the id does not exist. */
export function getNode(
  tree: TaxonomyGenderTree | null,
  id: string | null
): TaxonomyNode | null {
  if (!tree || !id) return null;
  return tree.nodes[id] ?? null;
}

/**
 * The selectable options for a position in the drill-down.
 * `path` is the chain of node ids chosen so far; passing null asks for
 * the first level (the tree roots).
 */
export function optionsAt(
  tree: TaxonomyGenderTree | null,
  path: string[]
): TaxonomyNode[] {
  if (!tree) return [];
  if (path.length === 0) {
    return tree.roots
      .map((id) => tree.nodes[id])
      .filter((node): node is TaxonomyNode => Boolean(node));
  }
  const parent = getNode(tree, path[path.length - 1]);
  if (!parent) return [];
  return parent.children
    .map((id) => tree.nodes[id])
    .filter((node): node is TaxonomyNode => Boolean(node));
}

/** True when the node can be drilled into further. */
export function hasSelectableChildren(
  tree: TaxonomyGenderTree | null,
  id: string | null
): boolean {
  return optionsAt(tree, [...(tree ? [id ?? ""] : [])]).length > 0;
}

/**
 * The flow decision after a node is selected.
 *
 * - "children"  the node has selectable options: show them next.
 * - "size"      the node is a leaf that needs the Size step.
 * - "next"      the node is a leaf that needs no conventional size:
 *               continue to the next applicable attribute instead.
 */
export type FlowDecision =
  | { kind: "children"; options: TaxonomyNode[] }
  | { kind: "size" }
  | { kind: "next" };

export function decideNext(
  tree: TaxonomyGenderTree | null,
  path: string[]
): FlowDecision {
  const options = optionsAt(tree, path);
  if (options.length > 0) {
    return { kind: "children", options };
  }
  const node = getNode(tree, path[path.length - 1] ?? null);
  if (!node) {
    /* Nothing selected yet: nothing to decide. */
    return { kind: "children", options };
  }
  return node.requiresSize
    ? { kind: "size" }
    : { kind: "next" };
}

/** True only for a leaf node, i.e. the only state that may advance. */
export function isLeafSelection(
  tree: TaxonomyGenderTree | null,
  path: string[]
): boolean {
  if (path.length === 0) return false;
  return getNode(tree, path[path.length - 1] ?? null)?.children
    .length === 0;
}

/**
 * The single place that decides which questionnaire step comes next.
 *
 * It knows the step ORDER and which steps are attributes, nothing about
 * any category: the taxonomy decision already says whether the finished
 * selection needs Size, so a leaf that needs no conventional size simply
 * steps over it.
 */
export function nextStepIndex(params: {
  steps: readonly string[];
  currentIndex: number;
  decision: FlowDecision | null;
  /** Attributes that may be skipped when the decision does not need them. */
  gatedAttributes?: readonly string[];
  /** Steps that walk the taxonomy tree itself. */
  drillStepKeys?: readonly string[];
}): number | null {
  const {
    steps,
    currentIndex,
    decision,
    gatedAttributes = ["size"],
    drillStepKeys = ["category"],
  } = params;
  const currentKey = steps[currentIndex] ?? "";

  /* Still drilling: the user has options left to answer, so no attribute
     step may be entered yet. This is the rule that keeps the flow from
     ever jumping to Size over an unanswered level. */
  if (
    decision?.kind === "children" &&
    drillStepKeys.includes(currentKey)
  ) {
    return null;
  }

  for (let i = currentIndex + 1; i < steps.length; i += 1) {
    if (
      decision &&
      decision.kind !== "children" &&
      gatedAttributes.includes(steps[i] ?? "") &&
      decision.kind !== steps[i]
    ) {
      continue;
    }
    return i;
  }
  return null;
}

/**
 * The path the category step should render.
 *
 * A finished selection releases its last level so the options behind the
 * pick stay visible and editable when the user navigates back from an
 * attribute step - the drill-down state survives instead of dead-ending
 * on a leaf that has nothing to show.
 */
export function editablePath(
  tree: TaxonomyGenderTree | null,
  path: string[],
  stepKey: string
): string[] {
  if (stepKey !== "category" || path.length === 0) return path;
  const node = getNode(tree, path[path.length - 1] ?? null);
  if (!node || node.children.length > 0) return path;
  return path.slice(0, -1);
}

/**
 * Does a branch lead to a category the catalog actually offers?
 *
 * A style/fit node maps to nothing by itself - it only describes the
 * pick inside its parent category. So the answer is inherited from the
 * nearest ancestor that does map to a stocked category. Without this the
 * jeans screen would render an empty list even though Jeans is in stock,
 * because none of the fits carry a category of their own.
 */
export function branchHasStock(
  tree: TaxonomyGenderTree | null,
  nodeId: string,
  hasCategory: (name: string) => boolean
): boolean {
  if (!tree) return true;
  const node = tree.nodes[nodeId];
  if (!node) return true;

  /* Start at the deepest node that actually names a category. */
  let seedId: string = node.id;
  let current: TaxonomyNode | undefined = node;
  while (current.mapTo.length === 0 && current.parentId) {
    const parent: TaxonomyNode | undefined =
      tree.nodes[current.parentId];
    if (!parent) break;
    current = parent;
    seedId = parent.id;
  }

  const queue: string[] = [seedId];
  while (queue.length > 0) {
    const node2: TaxonomyNode | undefined =
      tree.nodes[queue.shift() ?? ""];
    if (!node2) continue;
    for (const name of node2.mapTo) {
      if (hasCategory(name)) return true;
    }
    queue.push(...node2.children);
  }
  return false;
}

/** The full ancestor chain for a node id, root first. */
export function pathToNode(
  tree: TaxonomyGenderTree | null,
  id: string | null
): string[] {
  if (!tree || !id || !tree.nodes[id]) return [];
  const chain: string[] = [];
  let current: TaxonomyNode | undefined = tree.nodes[id];
  while (current) {
    chain.unshift(current.id);
    current = current.parentId
      ? tree.nodes[current.parentId]
      : undefined;
  }
  return chain;
}

/** Every node id in a tree, in document order. */
export function allNodeIds(
  tree: TaxonomyGenderTree | null
): string[] {
  return tree ? Object.keys(tree.nodes) : [];
}

/** All descendant node ids of a node (the node itself excluded). */
export function descendantIds(
  tree: TaxonomyGenderTree | null,
  id: string
): string[] {
  if (!tree) return [];
  const out: string[] = [];
  const walk = (nodeId: string) => {
    const node = tree.nodes[nodeId];
    if (!node) return;
    for (const childId of node.children) {
      out.push(childId);
      walk(childId);
    }
  };
  walk(id);
  return out;
}

/* ------------------------------------------------------------------ */
/* Query derivation                                                     */
/* ------------------------------------------------------------------ */

export interface DerivedQuery {
  /** Legacy category display name to post as the category token. */
  category: string | null;
  /** Every token contributed by the selected path, in order. */
  tokens: string[];
  /** Cross-tags contributed by the path (search-time widening only). */
  crossTags: string[];
  /** Kids age brackets available at the current selection. */
  ages: KidsAge[];
}

/**
 * Translate a selected path into what the search engine receives.
 * The legacy display name comes from the nearest node on the path that
 * maps to a real category, so existing filtering/ranking is unchanged.
 */
export function deriveQuery(
  tree: TaxonomyGenderTree | null,
  path: string[]
): DerivedQuery {
  const nodes = path
    .map((id) => getNode(tree, id))
    .filter((node): node is TaxonomyNode => Boolean(node));

  const tokens: string[] = [];
  const crossTags: string[] = [];
  const ages: KidsAge[] = [];

  for (const node of nodes) {
    for (const token of node.tokens) {
      if (!tokens.includes(token)) tokens.push(token);
    }
    for (const tag of node.crossTags) {
      if (!crossTags.includes(tag)) crossTags.push(tag);
    }
    for (const age of node.age) {
      if (!ages.includes(age)) ages.push(age);
    }
  }

  /* The category token is the deepest node's own mapping when it has
     one, otherwise the nearest ancestor that does. */
  let category: string | null = null;
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const mapTo = nodes[i]?.mapTo ?? [];
    if (mapTo.length > 0) {
      category = mapTo[0];
      break;
    }
  }

  return { category, tokens, crossTags, ages };
}

/**
 * Resolve the taxonomy node a legacy category display name belongs to,
 * restricted to the subtree of `ancestorId` when given. Used by
 * Back/Edit to reopen the drill-down on the right branch.
 */
export function findNodeByCategoryName(
  tree: TaxonomyGenderTree | null,
  categoryName: string,
  ancestorId: string | null = null
): TaxonomyNode | null {
  if (!tree) return null;
  const wanted = categoryName.trim().toLowerCase();
  if (!wanted) return null;

  const scope = ancestorId
    ? [ancestorId, ...descendantIds(tree, ancestorId)]
    : Object.keys(tree.nodes);

  for (const id of scope) {
    const node = tree.nodes[id];
    if (!node) continue;
    if (node.label.trim().toLowerCase() === wanted) {
      return node;
    }
    if (
      node.mapTo.some(
        (name) => name.trim().toLowerCase() === wanted
      )
    ) {
      return node;
    }
  }
  return null;
}

/** Node ids carrying a cross-tag anywhere in the tree. */
export function nodesWithCrossTag(
  tag: string
): string[] {
  const out: string[] = [];
  for (const gender of ["MEN", "WOMEN", "KIDS"] as const) {
    for (const node of Object.values(taxonomyTrees[gender].nodes)) {
      if (node.crossTags.includes(tag)) out.push(node.id);
    }
  }
  return out;
}