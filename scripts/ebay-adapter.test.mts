/* eBay adapter unit tests (Phase 1) - mocked transport, no DB.

   Covers: OAuth token handling + cache, search success + pagination,
   API errors, malformed results, missing fields, price/currency,
   availability mapping, GTIN/MPN/SKU extraction, color/size, variants,
   dedup identity layers, quarantine/reject gates, idempotent re-sync
   semantics, purchase-url preservation, source traceability, and
   guaranteed NO credential leakage.

   Run: npx tsx scripts/ebay-adapter.test.mts
*/

import { loadEbayConfig } from "../src/lib/catalog/adapters/ebay/config";
import {
  createEbayAuthClient,
  createTokenCache,
  makeBasicAuthHeader,
  buildTokenBody,
  EbayTokenError,
  type TokenResponse,
} from "../src/lib/catalog/adapters/ebay/auth";
import {
  createEbayBrowseClient,
  buildSearchUrl,
  EbayApiError,
} from "../src/lib/catalog/adapters/ebay/client";
import {
  ebayItemToNormalizedListing,
  extractAspects,
  availabilityFromCondition,
  gtinFromValue,
} from "../src/lib/catalog/adapters/ebay/normalize";
import { validateListing } from "../src/lib/catalog/validation";
import { identityLayersOf } from "../src/lib/catalog/dedupe";
import type { DedupLayer } from "../src/lib/catalog/types";
import { DEDUP_LAYERS } from "../src/lib/catalog/types";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name} :: ${detail}`);
  }
}

/* ---- helpers ---- */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function ebayItem(partial: Record<string, unknown> = {}) {
  return {
    itemId: "111111111111",
    title: "Nike Air Zoom Pegasus 40",
    itemWebUrl: "https://www.ebay.com/itm/111111111111",
    itemAffiliateWebUrl: "https://www.ebay.com/itm/111111111111?aff=1",
    shortDescription: "New in box running shoe",
    image: { imageUrl: "https://i.ebayimg.com/00/x.jpg" },
    price: { value: "120.00", currency: "USD" },
    condition: "New",
    buyingOptions: ["FIXED_PRICE"],
    seller: { username: "sneakercove" },
    categoryPath: "Shoes>Running Shoes",
    localizedAspects: [
      { name: "Brand", value: "Nike" },
      { name: "MPN", value: "DH4072-002" },
      { name: "Color", value: "Black" },
      { name: "Size", value: "US 10" },
    ],
    ...partial,
  };
}

const BASE_CFG = {
  browseBase: "https://api.ebay.com/buy/browse/v1",
  marketplaceId: "EBAY_US",
  keywords: ["nike", "pegasus"],
  categoryIds: [],
};

const AUTH_CFG = {
  clientId: "test-client-id-PRD-0000000",
  clientSecret: "test-secret-value",
  tokenUrl: "https://api.ebay.com/identity/v1/oauth2/token",
  scope: "https://api.ebay.com/oauth/api_scope/buy.browse",
};

/* =========================================================
   OAuth / token handling
   ========================================================= */

async function tokenTest() {
  const next: TokenResponse = {
    access_token: "tok-1",
    expires_in: 7200,
    token_type: "Application Access Token",
  };
  const seenAuth: string[] = [];
  const seenBodies: string[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const h = init?.headers as Record<string, string> | undefined;
    seenAuth.push(String(h?.["Authorization"] ?? ""));
    seenBodies.push(String(init?.body ?? ""));
    return jsonResponse(next);
  };

  const cache = createTokenCache();
  const auth = createEbayAuthClient(AUTH_CFG, fetchImpl, cache);

  const t1 = await auth.getToken();
  const t2 = await auth.getToken();
  check("token acquired", t1 === "tok-1", t1);
  check("cached token is the same", t2 === t1, t2);
  check("token cached + reused (one network call)", seenAuth.length === 1, `seen=${seenAuth.length}`);

  /* Request used Basic auth with base64(client:secret) and form body. */
  const expectedHeader = makeBasicAuthHeader(AUTH_CFG.clientId, AUTH_CFG.clientSecret);
  check(
    "Authorization uses Basic base64(client:secret)",
    seenAuth[0] === expectedHeader,
    seenAuth[0]
  );
  check(
    "client secret is NOT the raw secret anywhere in the auth value",
    !seenAuth[0].includes(AUTH_CFG.clientSecret),
    seenAuth[0]
  );
  check(
    "token request body is the client-credentials form",
    seenBodies[0] === buildTokenBody(AUTH_CFG.scope),
    seenBodies[0]
  );
}

async function tokenExpiryTest() {
  let now = 1_000_000;
  const next: TokenResponse = { access_token: "tok-A", expires_in: 7200 };
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse(next);
  };
  const cache = createTokenCache(() => now);
  const auth = createEbayAuthClient(AUTH_CFG, fetchImpl, cache);

  /* First call acquires at t=1_000_000; stored expiresAt = 1_000_000 +
     7200*1000 = 8_200_000. With a 120s buffer the token is reused only
     while now < 8_080_000. */
  const t1 = await auth.getToken();
  check("first token", t1 === "tok-A", t1);

  now = 8_000_000; /* 7000s elapsed -> still within buffer */
  const t2 = await auth.getToken();
  check("reused before expiry buffer", t2 === "tok-A" && calls === 1, `calls=${calls}`);

  now = 8_100_000; /* 7100s elapsed -> past 7080s buffer boundary */
  const t3 = await auth.getToken();
  check("re-acquires after expiry buffer", t3 === "tok-A" && calls === 2, `calls=${calls}`);
}

async function tokenErrorTest() {
  const fetchImpl = async () =>
    jsonResponse({ error: "invalid_client", error_description: "unauthorized" }, 401);
  const auth = createEbayAuthClient(AUTH_CFG, fetchImpl, createTokenCache());
  try {
    await auth.getToken();
    check("bad credentials throws", false, "did not throw");
  } catch (err) {
    check("bad credentials throws EbayTokenError", err instanceof EbayTokenError, String(err));
    check(
      "token error exposes status + code, never the secret",
      err instanceof EbayTokenError &&
        err.status === 401 &&
        err.code === "invalid_client" &&
        !err.message.includes(AUTH_CFG.clientSecret),
      err instanceof EbayTokenError ? err.message : "n/a"
    );
  }
}

/* =========================================================
   Search success + pagination
   ========================================================= */

async function searchPaginationTest() {
  const urls: string[] = [];
  const page1 = {
    itemSummaries: [ebayItem({ itemId: "100000000001" })],
    total: 60,
    limit: 50,
    offset: 0,
    next: "https://api.ebay.com/buy/browse/v1/item_summary/search?q=nike&offset=50",
  };
  const page2 = {
    itemSummaries: [ebayItem({ itemId: "100000000002" })],
    total: 60,
    limit: 50,
    offset: 50,
  };
  const fetchImpl = async (url: string) => {
    urls.push(url);
    return jsonResponse(url.includes("offset=50") ? page2 : page1);
  };
  const client = createEbayBrowseClient(BASE_CFG, async () => "tok", fetchImpl);

  const r1 = await client.searchPage({ limit: 50, offset: 0 });
  check("search page 1 returns 1 item", r1.itemSummaries.length === 1, String(r1.itemSummaries.length));
  check("search page 1 total exposed", r1.total === 60, String(r1.total));

  const r2 = await client.searchPage({ limit: 50, offset: 50 });
  check("pagination offset advanced", r2.offset === 50 && r2.itemSummaries[0].itemId === "100000000002", r2.offset + "");

  /* Build-search-url determinism + required params */
  const built = buildSearchUrl(BASE_CFG, { limit: 50, offset: 0 });
  check(
    "search URL contains q + limit + fieldgroups=FULL + sort",
    built.includes("q=nike+pegasus") &&
      built.includes("limit=50") &&
      built.includes("fieldgroups=FULL") &&
      built.includes("sort=best_match"),
    built
  );
  check(
    "search URL never contains the token or secret",
    !built.includes("tok") && !built.includes(AUTH_CFG.clientSecret),
    built
  );
}

async function searchErrorTest() {
  const fetchImpl = async () =>
    jsonResponse({ errors: [{ message: "bad", longMessage: "Invalid limit" }] }, 400);
  const client = createEbayBrowseClient(BASE_CFG, async () => "tok", fetchImpl);
  try {
    await client.searchPage({ limit: 99999, offset: 0 });
    check("API 400 throws", false, "did not throw");
  } catch (err) {
    check(
      "API 400 -> EbayApiError with detail",
      err instanceof EbayApiError && err.status === 400 && err.detail.includes("Invalid limit"),
      err instanceof EbayApiError ? err.detail : "n/a"
    );
    check("API error message has no token/secret", err instanceof EbayApiError && !err.message.includes(AUTH_CFG.clientSecret), String(err));
  }
}

async function networkErrorTest() {
  const fetchImpl = async () => {
    throw new Error("ECONNRESET");
  };
  const client = createEbayBrowseClient(BASE_CFG, async () => "tok", fetchImpl);
  try {
    await client.searchPage({ limit: 10, offset: 0 });
    check("network error throws", false, "did not throw");
  } catch (err) {
    check("network error -> EbayApiError", err instanceof EbayApiError, String(err));
  }
}

/* =========================================================
   Normalization: fields, price/currency, availability,
   GTIN/MPN/SKU, color/size, variants
   ========================================================= */

async function normalizeFieldsTest() {
  const l = ebayItemToNormalizedListing(ebayItem());
  check("non-null for well-formed item", l !== null, "null");
  if (!l) return;
  check("externalListingId = itemId", l.externalListingId === "111111111111", l.externalListingId);
  check("name + description", l.name.includes("Pegasus") && l.description === "New in box running shoe", l.name);
  check("imageUrl preserved", l.imageUrl === "https://i.ebayimg.com/00/x.jpg", l.imageUrl ?? "");
  check("sourceProductUrl preserved", l.sourceProductUrl === "https://www.ebay.com/itm/111111111111", l.sourceProductUrl);
  check(
    "purchase url prefers affiliate (traceability)",
    l.purchaseUrl?.includes("aff=1") === true,
    l.purchaseUrl ?? ""
  );
  check("brand from aspects", l.brand === "Nike", l.brand ?? "");
  check("mpn from aspects", l.mpn === "DH4072-002", l.mpn ?? "");
  check("category from categoryPath", l.category === "Shoes>Running Shoes", l.category ?? "");
  check("color normalized to chip", l.colors[0] === "Black", String(l.colors));
  check(
    "attributes include seller + categoryPath (source traceability)",
    l.attributes.some((a) => a.name === "seller" && a.value === "sneakercove"),
    JSON.stringify(l.attributes)
  );
}

async function normalizeMissingFieldsTest() {
  /* No itemId -> null */
  const noId = ebayItemToNormalizedListing({ title: "x" });
  check("no itemId -> null", noId === null, "not null");

  /* Missing image / missing aspects still normalize (gates decide later) */
  const sparse = ebayItemToNormalizedListing(
    ebayItem({ image: undefined, localizedAspects: undefined, seller: undefined })
  );
  check("sparse item still normalizes", sparse !== null, "null");
  if (sparse) {
    check("missing image -> null imageUrl", sparse.imageUrl === null, sparse.imageUrl ?? "");
    check("missing aspects -> null brand", sparse.brand === null, sparse.brand ?? "");
    check("title-only identity survives", sparse.externalListingId === "111111111111", sparse.externalListingId);
  }
}

async function normalizePriceCurrencyTest() {
  const usd = ebayItemToNormalizedListing(ebayItem({ price: { value: "120.00", currency: "USD" } }));
  check("USD price captured", usd?.originalPrice === 120 && usd?.originalCurrency === "USD", `${usd?.originalPrice} ${usd?.originalCurrency}`);

  const eur = ebayItemToNormalizedListing(ebayItem({ price: { value: "99.50", currency: "EUR" } }));
  check("EUR price captured", eur?.originalPrice === 99.5 && eur?.originalCurrency === "EUR", `${eur?.originalPrice} ${eur?.originalCurrency}`);

  const badPrice = ebayItemToNormalizedListing(ebayItem({ price: { value: "0", currency: "USD" } }));
  /* originalPrice defaults 0 -> validation REJECTS it (non-positive) */
  const v = validateListing(badPrice!, { external: { brandResolved: "b", categoryResolved: "c", fxRate: 0.9 } });
  check("non-positive price -> REJECT", v.status === "REJECT", JSON.stringify(v));

  const badCurrency = ebayItemToNormalizedListing(ebayItem({ price: { value: "50.00", currency: "XYZ" } }));
  check(
    "explicit unsupported currency 'XYZ' is PRESERVED through normalization (not nulled/substituted)",
    badCurrency?.originalCurrency === "XYZ",
    badCurrency?.originalCurrency ?? "null"
  );
  const v2 = validateListing(badCurrency!, { external: { brandResolved: "b", categoryResolved: "c", fxRate: 0.9 } });
  check("unknown currency -> REJECT", v2.status === "REJECT" && v2.reasons[0].includes("originalCurrency"), JSON.stringify(v2));
}

async function normalizeAvailabilityTest() {
  check(
    "New condition -> AVAILABLE",
    availabilityFromCondition("New", ["FIXED_PRICE"]) === "AVAILABLE",
    availabilityFromCondition("New", ["FIXED_PRICE"])
  );
  check(
    "No condition + FIXED_PRICE -> AVAILABLE",
    availabilityFromCondition(null, ["FIXED_PRICE"]) === "AVAILABLE",
    availabilityFromCondition(null, ["FIXED_PRICE"])
  );
  check(
    "No condition + no buying option -> UNKNOWN",
    availabilityFromCondition(null, []) === "UNKNOWN",
    availabilityFromCondition(null, [])
  );
  check(
    "Pre-order -> PREORDER",
    availabilityFromCondition("Pre-order", []) === "PREORDER",
    availabilityFromCondition("Pre-order", [])
  );
  /* Listing-level availability carried onto the normalized listing */
  const l = ebayItemToNormalizedListing(ebayItem({ condition: "Used", buyingOptions: ["FIXED_PRICE"] }));
  check("listing availability = AVAILABLE", l?.availability === "AVAILABLE", l?.availability);
}

async function normalizeGtinMpnSkuTest() {
  /* UPC from localized aspects */
  const upc = ebayItemToNormalizedListing(
    ebayItem({ localizedAspects: [{ name: "UPC", value: "0194258723419" }, { name: "Brand", value: "Nike" }] })
  );
  check("UPC aspect -> gtin", upc?.gtins?.length === 1 && upc?.gtins[0].gtin === "0194258723419", JSON.stringify(upc?.gtins));
  check("UPC gtin type detected", upc?.gtins[0].gtinType === "EAN13", upc?.gtins[0].gtinType);

  const junk = gtinFromValue("not-a-gtin");
  check("junk gtin rejected", junk === null, JSON.stringify(junk));

  const short = gtinFromValue("12345");
  check("too-short gtin rejected", short === null, JSON.stringify(short));

  const mpn = ebayItemToNormalizedListing(
    ebayItem({ localizedAspects: [{ name: "MPN", value: "ABC-123" }, { name: "Brand", value: "Adidas" }] })
  );
  check("MPN extracted", mpn?.mpn === "ABC-123", mpn?.mpn ?? "");

  const skuOnly = ebayItemToNormalizedListing(
    ebayItem({ variations: [{ variationId: "v1", sku: "SKU-42", price: { value: "10", currency: "USD" } }] })
  );
  check("variant SKU preserved", skuOnly?.variants?.[0]?.sku === "SKU-42", skuOnly?.variants?.[0]?.sku ?? "");
}

async function normalizeColorSizeTest() {
  const l = ebayItemToNormalizedListing(
    ebayItem({ localizedAspects: [{ name: "Color", value: "Navy Blue" }, { name: "Size", value: "US 10" }] })
  );
  check("color normalized", l?.colors[0] === "Blue", String(l?.colors));
  /* The single variant carries the listing's real colour + size. */
  check("single variant has color+size", l?.variants?.[0]?.color === "Blue" && l?.variants?.[0]?.size?.value === "10", JSON.stringify(l?.variants));
  check("variant size system detected", l?.variants?.[0]?.size?.system === "US", l?.variants?.[0]?.size?.system + "");
}

async function normalizeVariantsTest() {
  const multi = ebayItemToNormalizedListing(
    ebayItem({
      variations: [
        { variationId: "v-1", sku: "SKU-BLK-10", color: "Black", size: "US 10", price: { value: "120", currency: "USD" } },
        { variationId: "v-2", sku: "SKU-BLK-11", color: "Black", size: "US 11", price: { value: "120", currency: "USD" } },
      ],
    })
  );
  check("two variants parsed", multi?.variants?.length === 2, String(multi?.variants?.length));
  if (multi?.variants) {
    check(
      "variant preserves externalVariantId + sku + color + size",
      multi.variants[0].id === "v-1" &&
        multi.variants[0].sku === "SKU-BLK-10" &&
        multi.variants[0].color === "Black" &&
        multi.variants[0].size?.value === "10",
      JSON.stringify(multi.variants[0])
    );
  }
  /* No variations + no aspects -> no variants manufactured */
  const none = ebayItemToNormalizedListing(ebayItem({ localizedAspects: [{ name: "Brand", value: "Nike" }] }));
  check("no manufactured variants when absent", none?.variants === undefined, JSON.stringify(none?.variants));
}

/* =========================================================
   Validation: quarantine + reject, purchase-url guard
   ========================================================= */

async function validationGatesTest() {
  const ok = ebayItemToNormalizedListing(ebayItem());
  const acc = validateListing(ok!, { external: { brandResolved: "b", categoryResolved: "c", fxRate: 1.0 } });
  check("complete USD+EUR-acceptable upstream (fx rate present) -> ACCEPT", acc.status === "ACCEPT", JSON.stringify(acc));

  /* Unresolved brand/category -> quarantine (not reject) */
  const q = validateListing(ok!, { external: { brandResolved: null, categoryResolved: null, fxRate: 1.0 } });
  check("unmapped brand+category -> QUARANTINE", q.status === "QUARANTINE", JSON.stringify(q));

  /* USD without fx -> quarantine (never invent EUR) */
  const noFx = validateListing(ok!, { external: { brandResolved: "b", categoryResolved: "c", fxRate: null } });
  check("USD without fx rate -> QUARANTINE", noFx.status === "QUARANTINE" && noFx.reasons.some((r) => r.includes("normalizedEur")), JSON.stringify(noFx));

  /* Missing purchase URL -> REJECT */
  const noUrl = ebayItemToNormalizedListing(
    ebayItem({ itemWebUrl: "", itemAffiliateWebUrl: "" })
  );
  const rejectUrl = validateListing(noUrl!, { external: { brandResolved: "b", categoryResolved: "c", fxRate: 1.0 } });
  check("missing purchase/source URL -> REJECT", rejectUrl.status === "REJECT" && rejectUrl.reasons.some((r) => r.includes("url")), JSON.stringify(rejectUrl));

  /* Missing title -> REJECT */
  const noTitle = ebayItemToNormalizedListing(
    ebayItem({ title: "   " })
  );
  const rejectTitle = validateListing(noTitle!, { external: { brandResolved: "b", categoryResolved: "c", fxRate: 1.0 } });
  check("blank title -> REJECT", rejectTitle.status === "REJECT", JSON.stringify(rejectTitle));
}

/* =========================================================
   Config validation (loadEbayConfig): missing-vs-present env
   ========================================================= */

async function configValidationTest() {
  const baseEnv: Partial<NodeJS.ProcessEnv> = {};

  /* Missing credentials -> ok:false with NAMES only, never values. */
  const missing = loadEbayConfig(baseEnv);
  check("missing credentials -> not ok", missing.ok === false, JSON.stringify(missing));
  if (!missing.ok) {
    check(
      "missing report lists ONLY env NAMES (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET)",
      missing.missing.includes("EBAY_CLIENT_ID") && missing.missing.includes("EBAY_CLIENT_SECRET"),
      JSON.stringify(missing.missing)
    );
    check(
      "missing report never contains any candidate value",
      JSON.stringify(missing).includes("-PRD-") === false,
      JSON.stringify(missing)
    );
  }

  /* One credential missing -> still not ok, both named. */
  const partial: Partial<NodeJS.ProcessEnv> = { EBAY_CLIENT_ID: "abc-PRD-123" };
  const partialStatus = loadEbayConfig(partial);
  check("partial credentials -> not ok + client-secret named", partialStatus.ok === false && !partialStatus.ok && partialStatus.missing.includes("EBAY_CLIENT_SECRET"), JSON.stringify(partialStatus));

  /* Present credentials -> ok with parsed config and an opaque authRef. */
  const full: Partial<NodeJS.ProcessEnv> = {
    EBAY_CLIENT_ID: "app-PRD-0000000000",
    EBAY_CLIENT_SECRET: "secret-value",
    EBAY_ENV: "sandbox",
    EBAY_MARKETPLACE_ID: "EBAY_UK",
    EBAY_KEYWORDS: "nike,adidas",
    EBAY_CATEGORY_IDS: "15709, 11450",
    EBAY_SAMPLE_SIZE: "5",
    EBAY_MAX_LISTINGS: "300",
  };
  const ok = loadEbayConfig(full);
  check("present credentials -> ok", ok.ok === true, JSON.stringify(ok));
  if (ok.ok) {
    check("environment parsed as sandbox", ok.config.environment === "sandbox", ok.config.environment);
    check("authRef is opaque (environment only, no secret)", ok.authRef === "ebay:sandbox", ok.authRef);
    check("marketplace parsed", ok.config.marketplaceId === "EBAY_UK", ok.config.marketplaceId);
    check("keywords parsed (whitespace trimmed)", ok.config.keywords.join(",") === "nike,adidas", JSON.stringify(ok.config.keywords));
    check("category ids parsed (whitespace trimmed)", ok.config.categoryIds.join(",") === "15709,11450", JSON.stringify(ok.config.categoryIds));
    check("sample/max parsed", ok.config.sampleSize === 5 && ok.config.maxListings === 300, `${ok.config.sampleSize}/${ok.config.maxListings}`);
    check("client secret is NEVER echoed in config (replaced by configured flag)", !JSON.stringify(ok).includes("secret-value"), JSON.stringify(ok));
  }
}

/* =========================================================
   Aspect extraction (extractAspects)
   ========================================================= */

async function extractAspectsTest() {
  const summary = {
    localizedAspects: [
      { name: "Brand", value: "Nike" },
      { name: "Company", value: "Nike Inc" },
      { name: "MPN", value: "DV0652-002" },
      { name: "UPC", value: "0194258723419" },
      { name: "Color", value: "Black" },
      { name: "Size", value: "US 10" },
      { name: "Gender", value: "Women" },
      { name: "Condition", value: "New" },
    ],
  };
  const aspects = extractAspects(summary);
  check("brand extracted from Brand aspect", aspects.brand === "Nike", aspects.brand ?? "");
  check("brand dedup keeps first (Company ignored)", aspects.brand === "Nike", aspects.brand ?? "");
  check("mpn extracted", aspects.mpn === "DV0652-002", aspects.mpn ?? "");
  check("gtin parsed from UPC aspect", aspects.gtin?.gtin === "0194258723419" && aspects.gtin.gtinType === "EAN13", JSON.stringify(aspects.gtin));
  check("color extracted", aspects.color === "Black", aspects.color ?? "");
  check("size extracted", aspects.size === "US 10", aspects.size ?? "");
  check("gender inferred from Gender aspect", aspects.gender === "WOMEN", aspects.gender ?? "");
  check("condition extracted", aspects.condition === "New", aspects.condition ?? "");
  check("every aspect preserved verbatim in raw (audit/traceability)", aspects.raw.length === 8, `${aspects.raw.length}`);

  /* Unknown aspect names are passed through but never mapped. */
  const junk = extractAspects({ localizedAspects: [{ name: "CustomAttr", value: "zzz" }] });
  check("unknown aspect ignored but preserved", junk.brand === null && junk.raw.length === 1, JSON.stringify(junk));
}

/* =========================================================
   Dedup identity layers (pure)
   ========================================================= */

async function dedupLayersTest() {
  const l = ebayItemToNormalizedListing(
    ebayItem({ localizedAspects: [
      { name: "Brand", value: "Nike" },
      { name: "MPN", value: "DV0652" },
      { name: "UPC", value: "0194258723419" },
    ] })
  );
  const bundle = { gtins: l!.gtins!, brand: l!.brand, mpn: l!.mpn, sku: l!.sku, name: l!.name, color: l!.colors[0] ?? null };
  const layers = identityLayersOf(bundle);
  check("GTIN layer present (UPC aspect)", layers.includes(DEDUP_LAYERS.GTIN as DedupLayer), JSON.stringify(layers));
  check("BRAND_MPN layer present", layers.includes(DEDUP_LAYERS.BRAND_MPN as DedupLayer), JSON.stringify(layers));
  check("BRAND_NAME_COLOR layer present", layers.includes(DEDUP_LAYERS.BRAND_NAME_COLOR as DedupLayer), JSON.stringify(layers));

  const noBrand = ebayItemToNormalizedListing(ebayItem({ localizedAspects: [] }));
  const bundle2 = { gtins: [], brand: noBrand!.brand, mpn: null, sku: null, name: noBrand!.name, color: null };
  const layers2 = identityLayersOf(bundle2);
  check("identity-less listing only has soft fallback layers", !layers2.includes(DEDUP_LAYERS.GTIN as DedupLayer) && !layers2.includes(DEDUP_LAYERS.BRAND_MPN as DedupLayer), JSON.stringify(layers2));
}

/* =========================================================
   No credential leakage + deterministic normalization
   ========================================================= */

async function leakageTest() {
  const l = ebayItemToNormalizedListing(ebayItem());
  const json = JSON.stringify(l);
  const allErrors: string[] = [];
  /* Exercise error paths and ensure no secret ever surfaces. */
  const fetchErr = async () => { throw new Error("net"); };
  try { await createEbayBrowseClient(BASE_CFG, async () => AUTH_CFG.clientSecret, fetchErr).searchPage({ limit: 1, offset: 0 }); }
  catch (e) { allErrors.push(String(e)); }

  const checkNoSecret = (where: string, s: string) =>
    check(`no secret in ${where}`, !s.includes(AUTH_CFG.clientSecret) && !s.includes(AUTH_CFG.clientId.replace(/^.../, "")), "");

  checkNoSecret("normalized JSON", json);
  for (const e of allErrors) checkNoSecret("error string", e);
}

async function deterministicTest() {
  const raw = ebayItem();
  const a = ebayItemToNormalizedListing(raw);
  const b = ebayItemToNormalizedListing(raw);
  check("deterministic normalization (deep equal)", JSON.stringify(a) === JSON.stringify(b), "differs");
}

/* =========================================================
   Run + report
   ========================================================= */

async function main() {
  await tokenTest();
  await tokenExpiryTest();
  await tokenErrorTest();
  await searchPaginationTest();
  await searchErrorTest();
  await networkErrorTest();
  await normalizeFieldsTest();
  await normalizeMissingFieldsTest();
  await normalizePriceCurrencyTest();
  await normalizeAvailabilityTest();
  await normalizeGtinMpnSkuTest();
  await normalizeColorSizeTest();
  await normalizeVariantsTest();
  await validationGatesTest();
  await dedupLayersTest();
  await configValidationTest();
  await extractAspectsTest();
  await leakageTest();
  await deterministicTest();

  console.log(`\n===== ebay-adapter tests: ${passed} passed, ${failed} failed =====`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("unhandled", err);
  process.exit(1);
});
