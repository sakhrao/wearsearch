import { validateListing, sampleIsWellFormed } from "../src/lib/catalog/validation";
import {
  OFFICIAL_SNEAKER,
  MISSING_URL_SNEAKER,
  NON_POSITIVE_PRICE_WATCH,
  FABRICATED_URL_HAT,
  GBP_WATCH,
  UNMAPPED_BRAND_HOODIE,
} from "./fixtures/catalog-fixtures";
import type { OfferAvailability } from "../src/lib/catalog/types";

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

const ACCEPT_EXTERNAL = { brandResolved: "Nike", categoryResolved: "shoes", fxRate: 1.1 };
const NO_RATE_EXTERNAL = { brandResolved: "Nike", categoryResolved: "shoes", fxRate: null };
const UNMAPPED_EXTERNAL = { brandResolved: null, categoryResolved: null, fxRate: 1.1 };

/* ---- accept path ---- */
const accept = validateListing(OFFICIAL_SNEAKER, { external: ACCEPT_EXTERNAL });
check(
  "well-formed EUR Nike listing ACCEPTs with mappings",
  accept.status === "ACCEPT",
  JSON.stringify(accept)
);

/* ---- reject path (irrecoverable shape) ---- */
for (const [name, listing] of [
  ["missing/fabricated source url REJECTs", MISSING_URL_SNEAKER],
  ["non-positive price REJECTs", NON_POSITIVE_PRICE_WATCH],
  ["example.com/exp- fabricated url REJECTs", FABRICATED_URL_HAT],
  ["unknown availability state REJECTs",
    { ...OFFICIAL_SNEAKER, availability: "LOW_STOCK" as unknown as OfferAvailability }],
] as const) {
  const verdict = validateListing(listing, { external: ACCEPT_EXTERNAL });
  check(
    name,
    verdict.status === "REJECT",
    JSON.stringify(verdict)
  );
}

/* ---- quarantine path ---- */
const unmapped = validateListing(UNMAPPED_BRAND_HOODIE, { external: UNMAPPED_EXTERNAL });
check(
  "unmapped brand -> QUARANTINE (never badge as-is)",
  unmapped.status === "QUARANTINE" && unmapped.reasons.some((r) => r.includes("unmapped brand token")),
  JSON.stringify(unmapped)
);

const gbpNoRate = validateListing(GBP_WATCH, { external: NO_RATE_EXTERNAL });
check(
  "GBP without fx -> QUARANTINE (never treated as EUR)",
  gbpNoRate.status === "QUARANTINE" &&
    gbpNoRate.reasons.some((r) => r.includes("cannot derive normalizedEur")),
  JSON.stringify(gbpNoRate)
);

const gbpWithRate = validateListing(GBP_WATCH, { external: { ...NO_RATE_EXTERNAL, fxRate: 1.1 } });
check(
  "GBP with fx rate STILL QUARANTINEs (no GBP derivation supported)",
  gbpWithRate.status === "QUARANTINE",
  JSON.stringify(gbpWithRate)
);

/* unmapped category alone */
const noCategory = validateListing(OFFICIAL_SNEAKER, { external: { brandResolved: "Nike", categoryResolved: null, fxRate: 1.1 } });
check(
  "unmapped category -> QUARANTINE (source taxonomy never leaks)",
  noCategory.status === "QUARANTINE" && noCategory.reasons.some((r) => r.includes("unmapped category token")),
  JSON.stringify(noCategory)
);

/* salePrice > original */
const saleUp = validateListing(
  { ...OFFICIAL_SNEAKER, salePrice: 150 },
  { external: ACCEPT_EXTERNAL }
);
check(
  "salePrice > original -> QUARANTINE",
  saleUp.status === "QUARANTINE" && saleUp.reasons.some((r) => r.includes("salePrice greater")),
  JSON.stringify(saleUp)
);

/* malformed gtin */
const badGtin = validateListing(
  { ...OFFICIAL_SNEAKER, gtins: [{ gtin: "", gtinType: "EAN13" }] },
  { external: ACCEPT_EXTERNAL }
);
check(
  "malformed gtin -> REJECT",
  badGtin.status === "REJECT",
  JSON.stringify(badGtin)
);

/* ---- sampleIsWellFormed (structural only, ignores resolvables) ---- */
check(
  "sample well-formed-ish passes structural gate",
  sampleIsWellFormed(OFFICIAL_SNEAKER),
  "n/a"
);
check(
  "sample with missing url fails structural gate",
  !sampleIsWellFormed(MISSING_URL_SNEAKER),
  "n/a"
);

console.log(`\ncatalog-validation: passed=${passed} failed=${failed}`);
if (failed > 0) process.exit(1);