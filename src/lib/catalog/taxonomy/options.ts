/**
 * Client-safe taxonomy helpers: no server-only imports, safe to pull
 * into React client components.
 */
export {
  KIDS_AGE_OPTIONS,
  kidsAgeTokens,
} from "./index";
export type {
  TaxonomyGenderTree,
  TaxonomyNode,
} from "./definition";
export {
  branchHasStock,
  decideNext,
  deriveQuery,
  editablePath,
  findNodeByCategoryName,
  getGenderTree,
  getNode,
  isLeafSelection,
  nextStepIndex,
  optionsAt,
  pathToNode,
  type DerivedQuery,
  type FlowDecision,
} from "./flow";