/**
 * Taxonomy structure + questionnaire flow policy.
 *
 * The flow assertions are deliberately written as "pick a node, ask the
 * flow what comes next" - never as an expectation about a specific
 * category in the UI - so they stay valid for any future taxonomy
 * shape.
 */
import {
  taxonomyDefinition,
  taxonomyTrees,
  crossTagCategoryNames,
  migrateSlug,
  KIDS_AGE_OPTIONS,
  CROSS_TAG_TOKENS,
} from "../src/lib/catalog/taxonomy";
import {
  decideNext,
  deriveQuery,
  editablePath,
  findNodeByCategoryName,
  getGenderTree,
  isLeafSelection,
  nextStepIndex,
  optionsAt,
  pathToNode,
} from "../src/lib/catalog/taxonomy/flow";
import { PLAN_LEAF_CATEGORIES } from "../src/lib/catalog/import-plan";
import { readFileSync } from "node:fs";

let passed = 0;
let failed = 0;

function check(
  name: string,
  cond: boolean,
  detail?: unknown
) {
  if (cond) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name} :: ${detail ?? ""}`);
  }
}

const GENDERS = ["MEN", "WOMEN", "KIDS"] as const;

/* Legacy DB-only category names preserved by the seed. */
const legacyNames = new Set([
  "Jumpers",
  "Running Trainers",
  "Beanies",
  "Hats",
  "Caps",
  "Ties",
]);

const canonicalNames = new Set(
  PLAN_LEAF_CATEGORIES.map((c) => c.name)
);

/**
 * Select nodes by their labels, one level at a time, exactly like the
 * questionnaire does. Returns the resulting path.
 */
function drill(
  gender: string,
  labels: string[]
): string[] {
  const tree = getGenderTree(gender);
  if (!tree) return [];
  let path: string[] = [];
  for (const label of labels) {
    const options = optionsAt(tree, path);
    const match = options.find(
      (node) => node.label === label
    );
    if (!match) {
      return [...path, `<<missing:${label}>>`];
    }
    path = [...path, match.id];
  }
  return path;
}

/* ================================================================== */
/* 1. Structure                                                         */
/* ================================================================== */

{
  const tree = taxonomyTrees.MEN;
  check(
    "MEN tree exposes roots",
    tree.roots.length > 0,
    String(tree.roots.length)
  );
  check(
    "every node id is a stable lowercase snake id",
    GENDERS.every((g) =>
      Object.keys(taxonomyTrees[g].nodes).every((id) =>
        /^[a-z0-9_]+$/.test(id)
      )
    ),
    "bad id"
  );
  check(
    "every child id resolves to a real node",
    GENDERS.every((g) => {
      const nodes = taxonomyTrees[g].nodes;
      return Object.values(nodes).every((node) =>
        node.children.every((id) => Boolean(nodes[id]))
      );
    }),
    "dangling child"
  );
  check(
    "every non-root node has a resolvable parent",
    GENDERS.every((g) => {
      const nodes = taxonomyTrees[g].nodes;
      return Object.values(nodes).every((node) =>
        node.parentId ? Boolean(nodes[node.parentId]) : tree_isRoot(node)
      );
    }),
    "bad parent"
  );
  function tree_isRoot(node: { parentId: string | null }): boolean {
    return node.parentId === null;
  }
  check(
    "every node has a type",
    GENDERS.every((g) =>
      Object.values(taxonomyTrees[g].nodes).every((node) =>
        [
          "category",
          "subcategory",
          "style",
          "fit",
          "variant",
          "attribute",
        ].includes(node.type)
      )
    ),
    "bad type"
  );
  check(
    "the tree has more than one depth (variable depth is real)",
    GENDERS.some((g) => {
      const nodes = taxonomyTrees[g].nodes;
      return Object.values(nodes).some((node) =>
        node.children.some((id) => nodes[id]?.children.length > 0)
      );
    }),
    "expected nested children"
  );
  check(
    "at least one branch is 4+ levels deep",
    GENDERS.some((g) => {
      const nodes = taxonomyTrees[g].nodes;
      return Object.values(nodes).some(
        (node) => (nodes[node.parentId ?? ""]?.parentId ?? null) !== null
      );
    }),
    "expected deep nesting"
  );
}

/* Every leaf that maps to a category must use a name the engine knows. */
{
  const bad: string[] = [];
  for (const gender of GENDERS) {
    for (const node of Object.values(
      taxonomyTrees[gender].nodes
    )) {
      if (node.children.length > 0) continue;
      if (node.mapTo.length === 0) continue;
      for (const name of node.mapTo) {
        if (
          !canonicalNames.has(name) &&
          !legacyNames.has(name)
        ) {
          bad.push(`${node.id} -> ${name}`);
        }
      }
    }
  }
  check(
    "every leaf mapTo resolves to a category the engine knows",
    bad.length === 0,
    bad.join(", ")
  );
}

/* ================================================================== */
/* 2. Acceptance test 1: Men -> Bottoms -> Jeans => Style/Fit screen    */
/* ================================================================== */

{
  const path = drill("men", ["Bottoms", "Jeans"]);
  const decision = decideNext(getGenderTree("men"), path);
  check(
    "T1 men>Jeans shows children, not Size",
    decision.kind === "children" &&
      decision.options.length > 0,
    JSON.stringify(decision.kind)
  );
  check(
    "T1 the jeans children are fits",
    decision.kind === "children" &&
      decision.options.every((o) => o.type === "fit"),
    decision.kind === "children"
      ? decision.options.map((o) => o.type).join(",")
      : ""
  );
  check(
    "T1 the expected fits are offered",
    decision.kind === "children" &&
      [
        "Skinny",
        "Slim",
        "Regular",
        "Straight",
        "Tapered",
        "Bootcut",
        "Relaxed",
        "Loose/Baggy",
      ].every((label) =>
        decision.options.some((o) => o.label === label)
      ),
    decision.kind === "children"
      ? decision.options.map((o) => o.label).join(",")
      : ""
  );

  /* Once a fit is chosen it is a leaf: Size is next. */
  const leafPath = drill("men", [
    "Bottoms",
    "Jeans",
    "Loose/Baggy",
  ]);
  const leafDecision = decideNext(
    getGenderTree("men"),
    leafPath
  );
  check(
    "T1 men>Jeans>Loose/Baggy reaches Size",
    leafDecision.kind === "size",
    leafDecision.kind
  );
  check(
    "T1 the leaf selection is a leaf",
    isLeafSelection(getGenderTree("men"), leafPath),
    "not a leaf"
  );
}

/* ================================================================== */
/* 3. Acceptance test 2: Women -> Bottoms -> Jeans => Style/Fit screen */
/* ================================================================== */

{
  const path = drill("women", ["Bottoms", "Jeans"]);
  const decision = decideNext(
    getGenderTree("women"),
    path
  );
  check(
    "T2 women>Jeans shows children, not Size",
    decision.kind === "children",
    decision.kind
  );
  check(
    "T2 the women's fits are offered",
    decision.kind === "children" &&
      [
        "Skinny",
        "Slim",
        "Regular",
        "Straight",
        "Tapered",
        "Bootcut & Flare",
        "Wide-Leg",
        "Mom Jeans",
        "Boyfriend Jeans",
      ].every((label) =>
        decision.options.some((o) => o.label === label)
      ),
    decision.kind === "children"
      ? decision.options.map((o) => o.label).join(",")
      : ""
  );

  /* The men's and women's fits are genuinely different sets, so a men's
     pick can never leak a women's-only style. */
  const menFits = decideNext(
    getGenderTree("men"),
    drill("men", ["Bottoms", "Jeans"])
  );
  check(
    "T2 women's jeans offers Wide-Leg and men's does not",
    decision.kind === "children" &&
      menFits.kind === "children" &&
      decision.options.some((o) => o.label === "Wide-Leg") &&
      !menFits.options.some((o) => o.label === "Wide-Leg"),
    "fit sets overlap"
  );
}

/* ================================================================== */
/* 4. Acceptance test 3: Men -> Tops -> Shirts -> Dress Shirts => Fit  */
/* ================================================================== */

{
  const path = drill("men", [
    "Tops",
    "Shirts",
    "Dress Shirts",
  ]);
  const decision = decideNext(getGenderTree("men"), path);
  check(
    "T3 men>Dress Shirts shows a fit level",
    decision.kind === "children" &&
      decision.options.every((o) => o.type === "fit"),
    decision.kind === "children"
      ? decision.options.map((o) => `${o.label}:${o.type}`).join(",")
      : decision.kind
  );
  check(
    "T3 the expected fits are offered",
    decision.kind === "children" &&
      [
        "Classic Fit",
        "Slim Fit",
        "Super Slim Fit",
        "Athletic Fit",
      ].every((label) =>
        decision.options.some((o) => o.label === label)
      ),
    decision.kind === "children"
      ? decision.options.map((o) => o.label).join(",")
      : ""
  );

  const casual = drill("men", [
    "Tops",
    "Shirts",
    "Casual Shirts",
  ]);
  const casualDecision = decideNext(
    getGenderTree("men"),
    casual
  );
  check(
    "T3 casual shirts offer their own styles",
    casualDecision.kind === "children" &&
      [
        "Oxford Button-Down",
        "Flannel/Plaid",
        "Denim",
        "Linen",
        "Cuban Collar",
      ].every((label) =>
        casualDecision.options.some((o) => o.label === label)
      ),
    casualDecision.kind === "children"
      ? casualDecision.options.map((o) => o.label).join(",")
      : ""
  );
}

/* ================================================================== */
/* 5. Acceptance test 4: Men -> Bottoms -> Shorts => Style screen      */
/* ================================================================== */

{
  const path = drill("men", ["Bottoms", "Shorts"]);
  const decision = decideNext(getGenderTree("men"), path);
  check(
    "T4 men>Shorts shows a style level",
    decision.kind === "children" &&
      decision.options.every((o) => o.type === "style"),
    decision.kind === "children"
      ? decision.options.map((o) => o.type).join(",")
      : decision.kind
  );
  check(
    "T4 the expected shorts styles are offered",
    decision.kind === "children" &&
      [
        "Chino Shorts",
        "Denim Shorts",
        "Cargo Shorts",
        "Sweat Shorts",
        "Bermuda Shorts",
      ].every((label) =>
        decision.options.some((o) => o.label === label)
      ),
    decision.kind === "children"
      ? decision.options.map((o) => o.label).join(",")
      : ""
  );
}

/* ================================================================== */
/* 6. Acceptance test 5: a childless selection advances                */
/* ================================================================== */

{
  /* Every branch that terminates must resolve to size or next - never
     to another level. */
  const unresolved: string[] = [];
  for (const gender of GENDERS) {
    const tree = getGenderTree(gender);
    for (const node of Object.values(tree?.nodes ?? {})) {
      if (node.children.length > 0) continue;
      const decision = decideNext(tree, [node.id]);
      if (decision.kind === "children") {
        unresolved.push(node.id);
      }
      if (
        decision.kind === "size" &&
        !node.requiresSize
      ) {
        unresolved.push(`${node.id} (size but requiresSize=false)`);
      }
      if (
        decision.kind === "next" &&
        node.requiresSize
      ) {
        unresolved.push(`${node.id} (next but requiresSize=true)`);
      }
    }
  }
  check(
    "T5 every leaf resolves to Size or the next attribute",
    unresolved.length === 0,
    unresolved.join(", ")
  );

  const accessories = drill("men", [
    "Accessories",
    "Watches",
  ]);
  check(
    "T5 an accessory without a conventional size skips Size",
    decideNext(getGenderTree("men"), accessories).kind ===
      "next",
    decideNext(getGenderTree("men"), accessories).kind
  );
  const clothing = drill("men", ["Bottoms", "Jeans", "Slim"]);
  check(
    "T5 clothing still routes to Size",
    decideNext(getGenderTree("men"), clothing).kind === "size",
    decideNext(getGenderTree("men"), clothing).kind
  );
}

/* ================================================================== */
/* 7. Acceptance test 6: nested children recurse to a leaf            */
/* ================================================================== */

{
  /* Suits: Suits & Tailoring -> Suits -> Suit Type -> Two-Piece */
  const suitsType = drill("men", [
    "One-Pieces",
    "Suits & Tailoring",
    "Suits",
    "Suit Type",
  ]);
  check(
    "T6 a third level offers a fourth level",
    decideNext(getGenderTree("men"), suitsType).kind ===
      "children",
    decideNext(getGenderTree("men"), suitsType).kind
  );
  /* The suit type itself is not terminal: its fits come next. */
  const suitsLeaf = drill("men", [
    "One-Pieces",
    "Suits & Tailoring",
    "Suits",
    "Suit Type",
    "Two-Piece",
  ]);
  check(
    "T6 a suit type still asks for the fit",
    decideNext(getGenderTree("men"), suitsLeaf).kind ===
      "children",
    decideNext(getGenderTree("men"), suitsLeaf).kind
  );
  const suited = drill("men", [
    "One-Pieces",
    "Suits & Tailoring",
    "Suits",
    "Suit Type",
    "Two-Piece",
    "Slim",
  ]);
  check(
    "T6 drilling five levels deep finally reaches Size",
    suited.every((id) => !id.startsWith("<<")) &&
      decideNext(getGenderTree("men"), suited).kind === "size",
    decideNext(getGenderTree("men"), suited).kind
  );
  check(
    "T6 both suit types offer the same fits",
    ["Two-Piece", "Three-Piece"].every((type) => {
      const options = decideNext(getGenderTree("men"), [
        "mens_onepieces",
        "mens_onepieces_suits_and_tailoring",
        "mens_onepieces_suits_and_tailoring_suits",
        "mens_onepieces_suits_and_tailoring_suits_suit_type",
        `mens_onepieces_suits_and_tailoring_suits_suit_type_${type
          .toLowerCase()
          .replace(/-/g, "")}`,
      ]);
      return (
        options.kind === "children" &&
        ["Slim", "Modern", "Classic"].every((fit) =>
          options.options.some((o) => o.label === fit)
        )
      );
    }),
    "suit fits differ"
  );

  /* Tuxedos -> Lapel Style -> Shawl Lapel */
  const lapel = drill("men", [
    "One-Pieces",
    "Suits & Tailoring",
    "Tuxedos",
    "Lapel Style",
    "Shawl Lapel",
  ]);
  check(
    "T6 the lapel branch terminates at Size",
    lapel.every((id) => !id.startsWith("<<")) &&
      decideNext(getGenderTree("men"), lapel).kind === "size",
    lapel.join(",")
  );

  /* Dresses -> Casual Dresses -> Wrap Dress */
  const dress = drill("women", [
    "One-Pieces",
    "Dresses",
    "Casual Dresses",
    "Wrap Dress",
  ]);
  check(
    "T6 women's dresses drill type then style",
    dress.every((id) => !id.startsWith("<<")) &&
      decideNext(getGenderTree("women"), dress).kind === "size",
    dress.join(",")
  );

  /* Depth is genuinely variable across the tree. */
  const depths = new Set<number>();
  for (const gender of GENDERS) {
    const tree = getGenderTree(gender.toLowerCase());
    for (const id of Object.keys(tree?.nodes ?? {})) {
      depths.add(pathToNode(tree, id).length);
    }
  }
  check(
    "T6 the tree spans at least three different depths",
    depths.size >= 3,
    [...depths].sort().join(",")
  );
  check(
    "T6 some branches are only one level deep",
    [...depths].includes(1),
    [...depths].sort().join(",")
  );
  check(
    "T6 some branches are four levels deep",
    [...depths].includes(4),
    [...depths].sort().join(",")
  );
}

/* ================================================================== */
/* 8. Cross-tags are labels, never steps                               */
/* ================================================================== */

{
  const joggers = drill("men", [
    "Bottoms",
    "Joggers & Sweatpants",
  ]);
  const decision = decideNext(getGenderTree("men"), joggers);
  check(
    "joggers branch offers styles and never an Activewear step",
    joggers.every((id) => !id.includes("activewear")) &&
      decision.kind === "children" &&
      !decision.options.some((o) =>
        o.label.toLowerCase().includes("activewear")
      ),
    decision.kind === "children"
      ? decision.options.map((o) => o.label).join(",")
      : decision.kind
  );
  check(
    "joggers styles are offered",
    decision.kind === "children" &&
      ["Fleece", "Cargo", "Twill"].every((label) =>
        decision.options.some((o) => o.label === label)
      ),
    decision.kind === "children"
      ? decision.options.map((o) => o.label).join(",")
      : ""
  );

  const derived = deriveQuery(getGenderTree("men"), [
    ...joggers,
    "Fleece",
  ]);
  check(
    "a cross-tag reaches the query as a token",
    derived.crossTags.includes("activewear"),
    derived.crossTags.join(",")
  );

  const names = crossTagCategoryNames("activewear");
  check(
    "T-activewear expands to several categories",
    names.length > 1,
    names.join(", ")
  );
  check(
    "T-activewear covers joggers and leggings",
    ["Joggers", "Leggings"].every((n) =>
      names.includes(n)
    ),
    names.join(", ")
  );
  check(
    "T-activewear never leaks an unrelated category",
    !names.includes("Dresses") &&
      !names.includes("Formal Shoes"),
    names.join(", ")
  );
  check(
    "T-activewear is not a category row",
    !canonicalNames.has("Activewear"),
    "Activewear must stay a label"
  );
  check(
    "T-cross-tag tokens are recognized",
    CROSS_TAG_TOKENS.activewear === "activewear" &&
      CROSS_TAG_TOKENS.sportswear === "activewear" &&
      CROSS_TAG_TOKENS.gym === "activewear",
    JSON.stringify(CROSS_TAG_TOKENS)
  );
}

/* ================================================================== */
/* 9. Derived query keeps the engine contract                         */
/* ================================================================== */

{
  const path = drill("men", [
    "Bottoms",
    "Jeans",
    "Loose/Baggy",
  ]);
  const derived = deriveQuery(getGenderTree("men"), path);
  check(
    "a jeans path still posts the legacy category name",
    derived.category === "Jeans",
    String(derived.category)
  );
  check(
    "the fit reaches the query as a token",
    derived.tokens.some((t) =>
      t.includes("loose") || t.includes("baggy")
    ),
    derived.tokens.join(",")
  );
  check(
    "a legacy category name still resolves to a node",
    findNodeByCategoryName(
      getGenderTree("men"),
      "Jeans"
    )?.id === "mens_bottoms_jeans",
    String(
      findNodeByCategoryName(getGenderTree("men"), "Jeans")?.id
    )
  );
  check(
    "resolving is gender scoped (women jeans never resolve mens)",
    findNodeByCategoryName(
      getGenderTree("women"),
      "Jeans"
    )?.id === "womens_bottoms_jeans",
    String(
      findNodeByCategoryName(getGenderTree("women"), "Jeans")
        ?.id
    )
  );
  check(
    "an unknown name resolves to null",
    findNodeByCategoryName(
      getGenderTree("men"),
      "Wingdings"
    ) === null,
    "expected null"
  );
}

/* ================================================================== */
/* 10. Back / Edit replays the path                                    */
/* ================================================================== */

{
  const path = drill("men", [
    "Bottoms",
    "Jeans",
    "Loose/Baggy",
  ]);
  check(
    "T21 the stored path replays to the same level",
    pathToNode(getGenderTree("men"), path.at(-1) ?? "")
      .join(",") === path.join(","),
    path.join(",")
  );
  const backOne = path.slice(0, -1);
  check(
    "T21 stepping back re-exposes the fit options",
    decideNext(getGenderTree("men"), backOne).kind ===
      "children",
    decideNext(getGenderTree("men"), backOne).kind
  );
  const changed = drill("men", [
    "Bottoms",
    "Jeans",
    "Straight",
  ]);
  const derived = deriveQuery(getGenderTree("men"), changed);
  check(
    "T21 changing the fit recomputes the query",
    derived.tokens.some((t) => t.includes("straight")) &&
      !derived.tokens.some((t) => t.includes("loose")),
    derived.tokens.join(",")
  );
  check(
    "T21 the category survives a fit change",
    derived.category === "Jeans",
    String(derived.category)
  );
}

/* ================================================================== */
/* 11. Kids                                                             */
/* ================================================================== */

{
  const path = drill("kids", ["Bottoms", "Jeans & Pants", "Jeans"]);
  const decision = decideNext(getGenderTree("kids"), path);
  check(
    "T-kids jeans offers its own fit level",
    decision.kind === "children" &&
      decision.options.every((o) => o.type === "fit"),
    decision.kind === "children"
      ? decision.options.map((o) => o.label).join(",")
      : decision.kind
  );
  const derived = deriveQuery(getGenderTree("kids"), path);
  check(
    "T-kids nodes carry the age attribute",
    derived.ages.length > 0,
    derived.ages.join(",")
  );
  check(
    "T-kids age brackets are defined",
    KIDS_AGE_OPTIONS.length === 2 &&
      KIDS_AGE_OPTIONS.every((o) => o.tokens.length > 0),
    JSON.stringify(KIDS_AGE_OPTIONS)
  );
  const babies = drill("kids", [
    "One-Pieces",
    "Infants",
  ]);
  const babyDerived = deriveQuery(
    getGenderTree("kids"),
    babies
  );
  check(
    "T-kids the infants branch is a 0-3 bracket",
    babyDerived.ages.includes("0-3"),
    babyDerived.ages.join(",")
  );
}

/* ================================================================== */
/* 12. Migration map (no DB renames)                                   */
/* ================================================================== */

{
  const unmapped = PLAN_LEAF_CATEGORIES.filter(
    (c) =>
      !(c.slug in taxonomyDefinition.migrationMap)
  );
  check(
    "T-migration every canonical slug is mapped",
    unmapped.length === 0,
    unmapped.map((c) => c.slug).join(", ")
  );

  const dangling: string[] = [];
  for (const ids of Object.values(
    taxonomyDefinition.migrationMap
  )) {
    for (const id of ids) {
      const known = GENDERS.some((g) =>
        Boolean(taxonomyTrees[g].nodes[id])
      );
      if (!known) dangling.push(id);
    }
  }
  check(
    "T-migration every mapped id exists",
    dangling.length === 0,
    dangling.join(", ")
  );
  check(
    "T-migration resolves a legacy slug",
    migrateSlug("joggers").length > 0,
    JSON.stringify(migrateSlug("joggers"))
  );
  check(
    "T-migration returns empty for an unknown slug",
    migrateSlug("nope").length === 0,
    "expected empty"
  );
}

/* ================================================================== */
/* 13. No hardcoded category logic in the flow engine                 */
/* ================================================================== */

{
  const source = readFileSync(
    new URL(
      "../src/lib/catalog/taxonomy/flow.ts",
      import.meta.url
    ),
    "utf8"
  );
  /* Every literal that names a category would be a hardcoded branch. */
  const categoryLiterals = [
    "Jeans",
    "Shirts",
    "Shorts",
    "Dresses",
    "Sneakers",
    "Jackets",
    "Underwear",
  ];
  const found = categoryLiterals.filter((name) =>
    source.includes(`"${name}"`)
  );
  check(
    "T-14 the flow engine names no category",
    found.length === 0,
    found.join(", ")
  );
}

/* ================================================================== */
/* 14. Every path in the brief, verified by drilling                  */
/* ================================================================== */

{
  /* Men -> Bottoms -> Jeans -> fit -> Size */
  const menJeans = drill("men", ["Bottoms", "Jeans", "Slim"]);
  check(
    "S1 men>jeans>slim lands on Size",
    decideNext(getGenderTree("men"), menJeans).kind === "size",
    decideNext(getGenderTree("men"), menJeans).kind
  );

  /* Men -> Tops -> Shirts -> Dress Shirts -> Formal fit -> Size */
  const formal = drill("men", [
    "Tops",
    "Shirts",
    "Dress Shirts",
    "Formal Fit",
  ]);
  check(
    "S2 men>dress shirts>formal fit lands on Size",
    formal.every((id) => !id.startsWith("<<")) &&
      decideNext(getGenderTree("men"), formal).kind === "size",
    decideNext(getGenderTree("men"), formal).kind
  );

  /* Men -> Bottoms -> Cargo Pants -> style -> Size */
  const cargo = drill("men", [
    "Bottoms",
    "Cargo Pants",
    "Utility Baggy Cargo",
  ]);
  check(
    "S3 men>cargo pants>style lands on Size",
    cargo.every((id) => !id.startsWith("<<")) &&
      decideNext(getGenderTree("men"), cargo).kind === "size",
    decideNext(getGenderTree("men"), cargo).kind
  );

  /* Women -> Bottoms -> Skirts -> style -> Size */
  const skirtStyles = decideNext(
    getGenderTree("women"),
    drill("women", ["Bottoms", "Skirts"])
  );
  check(
    "S4 women>skirts offers the six requested styles",
    skirtStyles.kind === "children" &&
      [
        "Pencil",
        "Pleated",
        "A-Line",
        "Slit",
        "Tiered & Ruffle",
        "Denim",
      ].every((label) =>
        skirtStyles.options.some((o) => o.label === label)
      ),
    skirtStyles.kind === "children"
      ? skirtStyles.options.map((o) => o.label).join(",")
      : ""
  );
  const skirt = drill("women", ["Bottoms", "Skirts", "A-Line"]);
  check(
    "S4 women>skirts>a-line lands on Size",
    decideNext(getGenderTree("women"), skirt).kind === "size",
    decideNext(getGenderTree("women"), skirt).kind
  );

  /* Kids -> Bottoms -> Skirts -> Skort -> material -> Size */
  const skort = decideNext(
    getGenderTree("kids"),
    drill("kids", ["Bottoms", "Skirts", "Skort"])
  );
  check(
    "S5 kids>skirts>skort is not terminal",
    skort.kind === "children",
    skort.kind
  );
  check(
    "S5 kids>skirts>skort offers its materials",
    skort.kind === "children" &&
      ["Tutu", "Denim", "Chino", "Jersey"].every((label) =>
        skort.options.some((o) => o.label === label)
      ),
    skort.kind === "children"
      ? skort.options.map((o) => o.label).join(",")
      : ""
  );
  const tutu = drill("kids", [
    "Bottoms",
    "Skirts",
    "Skort",
    "Tutu",
  ]);
  check(
    "S5 kids>skirts>skort>tutu lands on Size",
    tutu.every((id) => !id.startsWith("<<")) &&
      decideNext(getGenderTree("kids"), tutu).kind === "size",
    decideNext(getGenderTree("kids"), tutu).kind
  );
}

/* ================================================================== */
/* 15. Step resolution: Size is skipped, never blocked                 */
/* ================================================================== */

{
  const STEPS = ["gender", "category", "size", "colors", "budget", "details"];
  const categoryIndex = STEPS.indexOf("category");

  /* A leaf that needs a size lands on it. */
  const jeans = drill("men", ["Bottoms", "Jeans", "Slim"]);
  check(
    "N1 a leaf that needs a size goes to the size step",
    nextStepIndex({
      steps: STEPS,
      currentIndex: categoryIndex,
      decision: decideNext(getGenderTree("men"), jeans),
    }) === STEPS.indexOf("size"),
    "expected the size step"
  );

  /* A leaf that needs no conventional size steps OVER size. */
  const watch = drill("men", ["Accessories", "Watches"]);
  check(
    "N2 a leaf that needs no size skips the size step",
    nextStepIndex({
      steps: STEPS,
      currentIndex: categoryIndex,
      decision: decideNext(getGenderTree("men"), watch),
    }) === STEPS.indexOf("colors"),
    nextStepIndex({
      steps: STEPS,
      currentIndex: categoryIndex,
      decision: decideNext(getGenderTree("men"), watch),
    })
  );

  /* A node that still has children never advances. */
  check(
    "N3 a branch with children cannot advance",
    nextStepIndex({
      steps: STEPS,
      currentIndex: categoryIndex,
      decision: decideNext(
        getGenderTree("men"),
        drill("men", ["Bottoms", "Jeans"])
      ),
    }) === null,
    nextStepIndex({
      steps: STEPS,
      currentIndex: categoryIndex,
      decision: decideNext(
        getGenderTree("men"),
        drill("men", ["Bottoms", "Jeans"])
      ),
    })
  );
  check(
    "N3 a mid-hierarchy node cannot advance either",
    nextStepIndex({
      steps: STEPS,
      currentIndex: categoryIndex,
      decision: decideNext(
        getGenderTree("men"),
        drill("men", ["Bottoms", "Trousers & Pants", "Cargo Pants"])
      ),
    }) === null,
    "unanswered level must block the flow"
  );
  check(
    "N3 only a finished selection opens the next step",
    nextStepIndex({
      steps: STEPS,
      currentIndex: categoryIndex,
      decision: decideNext(getGenderTree("men"), jeans),
    }) !== null,
    "leaf must advance"
  );

  /* From any attribute step the flow moves on one step at a time. */
  check(
    "N4 an attribute step advances to the next one",
    nextStepIndex({
      steps: STEPS,
      currentIndex: STEPS.indexOf("size"),
      decision: decideNext(getGenderTree("men"), jeans),
    }) === STEPS.indexOf("colors"),
    "unexpected"
  );
  check(
    "N4 the last step has nowhere to go",
    nextStepIndex({
      steps: STEPS,
      currentIndex: STEPS.length - 1,
      decision: decideNext(getGenderTree("men"), jeans),
    }) === null,
    "expected null"
  );
}

/* ================================================================== */
/* 16. Back / Edit inside the drill-down keeps the hierarchy          */
/* ================================================================== */

{
  const leaf = drill("men", ["Bottoms", "Jeans", "Slim"]);
  check(
    "B1 returning to the category step releases the leaf",
    editablePath(getGenderTree("men"), leaf, "category").join(",") ===
      leaf.slice(0, -1).join(","),
    editablePath(getGenderTree("men"), leaf, "category").join(",")
  );
  check(
    "B1 the released level re-exposes its options",
    optionsAt(
      getGenderTree("men"),
      editablePath(getGenderTree("men"), leaf, "category")
    ).length === 8,
    "expected the fit options"
  );
  check(
    "B1 a branch in progress is not released",
    editablePath(
      getGenderTree("men"),
      drill("men", ["Bottoms", "Jeans"]),
      "category"
    ).length === 2,
    "branch should stay put"
  );
  check(
    "B1 an attribute step keeps the full path",
    editablePath(getGenderTree("men"), leaf, "size").length === 3,
    "path truncated on an attribute step"
  );
  check(
    "B1 the restored path is a valid chain again",
    pathToNode(
      getGenderTree("men"),
      leaf[leaf.length - 1] ?? ""
    ).join(",") === leaf.join(","),
    "path no longer replays"
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}