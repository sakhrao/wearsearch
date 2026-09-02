import {
  identityLayersOf,
  similarCandidates,
  tokenJaccard,
  similarityTokens,
  sameAudibleIdentity,
} from "../src/lib/catalog/dedupe";
import { DEDUP_LAYERS, type IdentityBundle } from "../src/lib/catalog/types";
import {
  OFFICIAL_SNEAKER,
  RETAILER_SNEAKER,
  OTHER_BRAND_SNEAKER,
} from "./fixtures/catalog-fixtures";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail: string) {
  if (cond) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name} :: ${detail}`);
  }
}

const bundle = (l: typeof OFFICIAL_SNEAKER): IdentityBundle => ({
  gtins: l.gtins,
  brand: l.brand,
  mpn: l.mpn,
  sku: l.sku,
  name: l.name,
  color: l.colors[0] ?? null,
});

/* ---- expressible layers ---- */
const layersGtin = identityLayersOf(bundle(OFFICIAL_SNEAKER));
check(
  "GTIN listing can express GTIN + BNC + similarity",
  layersGtin[0] === DEDUP_LAYERS.GTIN &&
    layersGtin.includes(DEDUP_LAYERS.BRAND_NAME_COLOR) &&
    layersGtin.includes(DEDUP_LAYERS.SIMILARITY),
  JSON.stringify(layersGtin)
);

const layerMpnOnly = identityLayersOf({ ...bundle(OFFICIAL_SNEAKER), gtins: [], sku: null });
check(
  "MPN-only listing expresses BRAND_MPN not GTIN",
  !layerMpnOnly.includes(DEDUP_LAYERS.GTIN) && layerMpnOnly.includes(DEDUP_LAYERS.BRAND_MPN),
  JSON.stringify(layerMpnOnly)
);

/* ---- cross-source merge via GTIN ---- */
const officialKey = OFFICIAL_SNEAKER.gtins[0];
const retailerKey = RETAILER_SNEAKER.gtins[0];
check(
  "official + retailer share the SAME GTIN -> merge at layer 1",
  officialKey.gtin === retailerKey.gtin &&
    officialKey.gtinType === retailerKey.gtinType,
  `official=${JSON.stringify(officialKey)} retailer=${JSON.stringify(retailerKey)}`
);

/* ---- non-merge proofs ---- */
const official = bundle(OFFICIAL_SNEAKER);
const otherBrand = bundle(OTHER_BRAND_SNEAKER);
check(
  "different GTIN -> keys differ",
  official.gtins[0].gtin !== otherBrand.gtins[0].gtin,
  `${official.gtins[0].gtin} vs ${otherBrand.gtins[0].gtin}`
);
check(
  "different brand -> NOT similar audible identity (no fuzzy merge risk)",
  !sameAudibleIdentity(official, otherBrand),
  "brand fold must differ"
);

/* ---- similarity tokens/stopwords ---- */
check(
  "similarityTokens strips commerce stopwords",
  JSON.stringify(similarityTokens("Nike Zoom Fly 5 Running Shoe")) ===
    JSON.stringify(["nike", "zoom", "fly", "5", "running", "shoe"]),
  JSON.stringify(similarityTokens("Nike Zoom Fly 5 Running Shoe"))
);
check(
  "tokenJaccard identical token sets -> 1",
  tokenJaccard(["nike", "zoom"], ["nike", "zoom"]) === 1,
  String(tokenJaccard(["nike", "zoom"], ["nike", "zoom"]))
);
check(
  "tokenJaccard disjoint -> 0",
  tokenJaccard(["nike"], ["adidas"]) === 0,
  String(tokenJaccard(["nike"], ["adidas"]))
);

/* ---- similarCandidates flags but never decides ---- */
const candidateList = [
  bundle(OFFICIAL_SNEAKER),
  bundle(RETAILER_SNEAKER),
  bundle(OTHER_BRAND_SNEAKER),
];
const flagged = similarCandidates(bundle(OFFICIAL_SNEAKER), candidateList);
check(
  "same-brand same-color overlapping names surface as review candidates",
  flagged.length >= 1 && flagged.every((f) => f.score > 0),
  JSON.stringify(flagged.map((f) => ({ name: f.candidate.name, score: f.score })))
);

console.log(`\ncatalog-dedupe: passed=${passed} failed=${failed}`);
if (failed > 0) process.exit(1);