import {
  CANONICAL_PLACEMENT_IDS,
  TAXONOMY_ID_ALIASES,
  isCanonicalId,
  normalizePath,
  resolveCanonicalId,
} from "../src/lib/catalog/taxonomy/ids";

let passed = 0;
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
  }
};

/* --- old id -> canonical id --- */
const legacySamples: Array<[string, string]> = [
  ["mens_bottoms_jeans", "jeans"],
  ["womens_bottoms_jeans", "jeans"],
  ["kids_bottoms_jeans_and_pants_jeans", "jeans"],
  ["mens_bottoms_jeans_skinny", "jeans::skinny"],
  ["womens_bottoms_jeans_wideleg", "jeans::wide_leg"],
  ["mens_tops_shirts", "shirts"],
  ["womens_tops_shirts_and_blouses", "shirts"],
  ["mens_bottoms_cargo_pants", "cargo"],
  ["womens_lingerie_and_sleepwear", "underwear_and_sleepwear"],
];
for (const [legacy, canonical] of legacySamples) {
  check(
    `old id -> canonical :: ${legacy} -> ${canonical}`,
    resolveCanonicalId(legacy) === canonical,
    resolveCanonicalId(legacy)
  );
}

/* --- canonical id -> itself --- */
let selfOk = true;
let selfBad = "";
for (const id of CANONICAL_PLACEMENT_IDS) {
  if (resolveCanonicalId(id) !== id || !isCanonicalId(id)) {
    selfOk = false;
    selfBad = id;
    break;
  }
}
check(
  `canonical id -> itself (${CANONICAL_PLACEMENT_IDS.length} ids)`,
  selfOk,
  selfBad
);

/* --- every alias target is a valid canonical id --- */
let aliasOk = true;
let aliasBad = "";
for (const [from, to] of Object.entries(TAXONOMY_ID_ALIASES)) {
  if (!isCanonicalId(to)) {
    aliasOk = false;
    aliasBad = `${from} -> ${to}`;
    break;
  }
}
check(
  `every legacy alias points to a canonical id (${Object.keys(TAXONOMY_ID_ALIASES).length})`,
  aliasOk,
  aliasBad
);

/* --- old path -> canonical path --- */
const oldPath = ["mens_bottoms_jeans", "mens_bottoms_jeans_skinny"];
check(
  "old path -> canonical path",
  JSON.stringify(normalizePath(oldPath)) ===
    JSON.stringify(["jeans", "jeans::skinny"]),
  JSON.stringify(normalizePath(oldPath))
);

/* --- new writes are canonical only (idempotent) --- */
const canonicalPath = normalizePath(oldPath);
check(
  "new writes stay canonical (idempotent)",
  JSON.stringify(normalizePath(canonicalPath)) === JSON.stringify(canonicalPath)
);

/* --- unknown ids are preserved --- */
check(
  "unknown id is preserved",
  resolveCanonicalId("totally_unknown_node") === "totally_unknown_node"
);

/* --- every legacy node id has an alias entry --- */
check(
  "legacy coverage (475 nodes aliased)",
  Object.keys(TAXONOMY_ID_ALIASES).length === 475,
  String(Object.keys(TAXONOMY_ID_ALIASES).length)
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
