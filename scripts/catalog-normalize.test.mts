import {
  cleanText,
  foldToken,
  slugToken,
  normalizeBrandToken,
  normalizeCategoryToken,
  normalizeColorName,
  parseSizeIdentity,
  parseSizeAudience,
  parseCurrency,
  normalizePriceToEurValue,
  dedupKeyFor,
} from "../src/lib/catalog/normalize";
import { DEDUP_LAYERS } from "../src/lib/catalog/types";

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

/* ---- string cleaning ---- */
check(
  "cleanText collapses whitespace",
  cleanText("  Running   Shoes  ") === "Running Shoes",
  JSON.stringify(cleanText("  Running   Shoes  "))
);
check(
  "foldToken lowercases and folds separators",
  foldToken("  Polo.Ralph*Lauren  ") === "polo ralph lauren",
  JSON.stringify(foldToken("  Polo.Ralph*Lauren  "))
);
check(
  "slugToken dash-ridges",
  slugToken("Nike Zoom Fly 5 (Running)") === "nike-zoom-fly-5-running",
  slugToken("Nike Zoom Fly 5 (Running)")
);

/* ---- brand/category tokens ---- */
check(
  "normalizeBrandToken folds raw brand",
  normalizeBrandToken("  Polo Ralph Lauren  ") === "polo ralph lauren",
  JSON.stringify(normalizeBrandToken("  Polo Ralph Lauren  "))
);
check(
  "normalizeBrandToken null-safe -> empty",
  normalizeBrandToken(null) === "",
  JSON.stringify(normalizeBrandToken(null))
);
check(
  "normalizeCategoryToken folds",
  normalizeCategoryToken("Shoes - Running") === "shoes running",
  JSON.stringify(normalizeCategoryToken("Shoes - Running"))
);

/* ---- color chips ---- */
check(
  "color navy blue -> Blue",
  normalizeColorName("nAvy blue") === "Blue",
  JSON.stringify(normalizeColorName("nAvy blue"))
);
check(
  "color unknown title-cases fallback",
  normalizeColorName("   teal ") === "Teal",
  JSON.stringify(normalizeColorName("   teal "))
);
check(
  "color empty -> null",
  normalizeColorName("") === null,
  JSON.stringify(normalizeColorName(""))
);

/* ---- size identity ---- */
check(
  "size 'EU 42' -> system EU value 42",
  JSON.stringify(parseSizeIdentity("EU 42")) === JSON.stringify({ system: "EU", value: "42" }),
  JSON.stringify(parseSizeIdentity("EU 42"))
);
check(
  "size 'US Women 8' -> system US value 8",
  JSON.stringify(parseSizeIdentity("US Women 8")) === JSON.stringify({ system: "US", value: "8" }),
  JSON.stringify(parseSizeIdentity("US Women 8"))
);
check(
  "size 'M' -> null (no system prefix, never inferred)",
  parseSizeIdentity("M") === null,
  JSON.stringify(parseSizeIdentity("M"))
);
check(
  "size audience US Women 8 -> WOMEN",
  parseSizeAudience("US Women 8") === "WOMEN",
  JSON.stringify(parseSizeAudience("US Women 8"))
);
check(
  "size audience plain 42 -> null (never inferred)",
  parseSizeAudience("42") === null,
  JSON.stringify(parseSizeAudience("42"))
);

/* ---- currency ---- */
check(
  "currency 'usd' -> USD",
  parseCurrency("usd") === "USD",
  JSON.stringify(parseCurrency("usd"))
);
check(
  "currency 'EUR' -> EUR",
  parseCurrency("EUR") === "EUR",
  JSON.stringify(parseCurrency("EUR"))
);
check(
  "currency 'GBP' -> GBP (recognized, not silently EUR)",
  parseCurrency("GBP") === "GBP",
  JSON.stringify(parseCurrency("GBP"))
);
check(
  "currency 'eeu' -> null (never guessed)",
  parseCurrency("eeu") === null,
  JSON.stringify(parseCurrency("eeu"))
);
check(
  "currency '' -> null",
  parseCurrency("") === null,
  JSON.stringify(parseCurrency(""))
);

/* ---- EUR reference (user decision #4) ---- */
check(
  "EUR 100 no rate -> 100",
  normalizePriceToEurValue(100, "EUR", null) === 100,
  String(normalizePriceToEurValue(100, "EUR", null))
);
check(
  "USD 120 @1.2 -> 100",
  normalizePriceToEurValue(120, "USD", 1.2) === 100,
  String(normalizePriceToEurValue(120, "USD", 1.2))
);
check(
  "GBP 100 with rate -> null (never derived)",
  normalizePriceToEurValue(100, "GBP", 1.05) === null,
  String(normalizePriceToEurValue(100, "GBP", 1.05))
);
check(
  "USD 100 no rate -> null (never treat as EUR)",
  normalizePriceToEurValue(100, "USD", null) === null,
  String(normalizePriceToEurValue(100, "USD", null))
);

/* ---- dedup fingerprints ---- */
check(
  "layer1 GTIN key deterministic",
  dedupKeyFor(DEDUP_LAYERS.GTIN, { gtins: [{ gtin: "0194258723419", gtinType: "EAN13" }] }) ===
    "gtin:EAN13:0194258723419",
  dedupKeyFor(DEDUP_LAYERS.GTIN, { gtins: [{ gtin: "0194258723419", gtinType: "EAN13" }] })
);
check(
  "layer2 Brand+MPN key folds brand, uppercases mpn",
  dedupKeyFor(DEDUP_LAYERS.BRAND_MPN, { brand: "Nike", mpn: "dv0652" }) === "brandmpn:nike:DV0652",
  dedupKeyFor(DEDUP_LAYERS.BRAND_MPN, { brand: "Nike", mpn: "dv0652" })
);
check(
  "layer2 without mpn -> empty (cannot express)",
  dedupKeyFor(DEDUP_LAYERS.BRAND_MPN, { brand: "Nike", mpn: null }) === "",
  dedupKeyFor(DEDUP_LAYERS.BRAND_MPN, { brand: "Nike", mpn: null })
);
check(
  "same GTIN across sources -> identical key",
  dedupKeyFor(DEDUP_LAYERS.GTIN, { gtins: [{ gtin: "0194258723419", gtinType: "EAN13" }] }) ===
    dedupKeyFor(DEDUP_LAYERS.GTIN, { gtins: [{ gtin: "0194258723419", gtinType: "EAN13" }] }) &&
    dedupKeyFor(DEDUP_LAYERS.GTIN, { gtins: [{ gtin: "0194258723419", gtinType: "EAN13" }] }) !==
      dedupKeyFor(DEDUP_LAYERS.GTIN, { gtins: [{ gtin: "4054035264704", gtinType: "EAN13" }] }),
  "distinct gtins must key distinctly"
);

console.log(`\ncatalog-normalize: passed=${passed} failed=${failed}`);
if (failed > 0) process.exit(1);