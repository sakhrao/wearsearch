/* F3 URL-state contract tests (pure, no server needed).

   Verifies that the canonical results URL is the single source
   of truth for the basic search: parsing a /?q=..&min=..&max=..
   &cur=..&soft=.. URL reproduces the exact /api/search call
   (q, priceMin, priceMax, soft) the /find questionnaire builds,
   including the USD -> EUR budget conversion via the fx rate. */
import {
  decodeSearchUrl,
  parseSearchUrl,
  encodeSearchUrl,
  buildSearchQueryString,
  searchIntentKey,
} from "../src/lib/search-url";
import { usdToEur } from "../src/lib/currency";

let passed = 0;
let failed = 0;

function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name} :: ${detail ?? ""}`);
  }
}

const FX = 1.08;

/* 1. Query-only URL -> ready intent without budget */
{
  const parsed = parseSearchUrl(
    new URLSearchParams("q=women+black+sneakers"),
    FX
  );
  check(
    "query-only is ready",
    parsed.kind === "ready",
    parsed.kind
  );
  check(
    "query-only keeps query",
    parsed.kind === "ready" &&
      parsed.intent.query === "women black sneakers",
    parsed.kind === "ready" ? parsed.intent.query : ""
  );
  check(
    "query-only has no budget",
    parsed.kind === "ready" &&
      parsed.intent.params.priceMin === null &&
      parsed.intent.params.priceMax === null &&
      parsed.intent.params.budgetCurrency === null,
    JSON.stringify(parsed)
  );
  check(
    "query-only needs no fx",
    parsed.kind === "ready" && !parsed.needsFx
  );
}

/* 2. USD budget URL -> EUR engine bounds via fx */
{
  const parsed = parseSearchUrl(
    new URLSearchParams(
      "q=women+black+sneakers&min=50&max=150&cur=USD"
    ),
    FX
  );
  check(
    "USD budget is ready with fx",
    parsed.kind === "ready",
    parsed.kind
  );
  if (parsed.kind === "ready") {
    check(
      "USD budget converts to EUR bound",
      parsed.intent.params.priceMin === String(usdToEur(50, FX)) &&
        parsed.intent.params.priceMax === String(usdToEur(150, FX)),
      `${parsed.intent.params.priceMin} / ${parsed.intent.params.priceMax}`
    );
    check(
      "USD budget keeps display values + currency",
      parsed.intent.params.budgetDisplayMin === "50" &&
        parsed.intent.params.budgetDisplayMax === "150" &&
        parsed.intent.params.budgetCurrency === "USD"
    );
  }
}

/* 3. EUR budget URL -> no conversion */
{
  const parsed = parseSearchUrl(
    new URLSearchParams("q=trousers&min=50&max=80&cur=EUR"),
    FX
  );
  check(
    "EUR budget is ready",
    parsed.kind === "ready",
    parsed.kind
  );
  if (parsed.kind === "ready") {
    check(
      "EUR budget passes bounds through",
      parsed.intent.params.priceMin === "50" &&
        parsed.intent.params.priceMax === "80" &&
        parsed.intent.params.budgetCurrency === "EUR"
    );
  }
}

/* 4. Budget URL without cur -> defaults to USD when fx exists */
{
  const parsed = parseSearchUrl(
    new URLSearchParams("q=jeans&min=50&max=100"),
    FX
  );
  check(
    "no-cur budget defaults to USD with fx",
    parsed.kind === "ready" &&
      parsed.intent.params.budgetCurrency === "USD" &&
      parsed.intent.params.priceMin === String(usdToEur(50, FX)),
    JSON.stringify(parsed)
  );
}

/* 5. USD budget cannot resolve without an fx rate */
{
  const parsed = parseSearchUrl(
    new URLSearchParams("q=jeans&min=50&cur=USD"),
    null
  );
  check(
    "USD budget without fx waits",
    parsed.kind === "wait-fx" && parsed.needsFx === true,
    parsed.kind
  );
  const eur = parseSearchUrl(
    new URLSearchParams("q=jeans&min=50&cur=EUR"),
    null
  );
  check(
    "EUR budget needs no fx",
    eur.kind === "ready" && !eur.needsFx,
    eur.kind
  );
}

/* 6. Empty / missing query -> empty */
{
  const parsed = parseSearchUrl(
    new URLSearchParams(""),
    FX
  );
  check(
    "no query is empty",
    parsed.kind === "empty" && !parsed.needsFx,
    parsed.kind
  );
  const blank = parseSearchUrl(
    new URLSearchParams("q=   "),
    FX
  );
  check(
    "blank query is empty",
    blank.kind === "empty",
    blank.kind
  );
}

/* 7. Attributes pass through and are included in the key */
{
  const parsed = parseSearchUrl(
    new URLSearchParams("q=shirt&soft=cotton,dark"),
    FX
  );
  check(
    "soft attributes pass through",
    parsed.kind === "ready" &&
      parsed.intent.params.soft === "cotton,dark",
    JSON.stringify(parsed)
  );
}

/* 8. URL round-trip is stable on canonical inputs */
{
  const canonical = "q=women+black+sneakers&min=50&max=150&cur=USD";
  const parsed = parseSearchUrl(new URLSearchParams(canonical), FX);
  check(
    "canonical URL round-trips byte-stable",
    parsed.kind === "ready" &&
      buildSearchQueryString(parsed.intent) === canonical,
    parsed.kind === "ready"
      ? buildSearchQueryString(parsed.intent)
      : ""
  );
  const queryOnly = parseSearchUrl(
    new URLSearchParams("q=hoodies"),
    FX
  );
  check(
    "query-only URL round-trips",
    queryOnly.kind === "ready" &&
      buildSearchQueryString(queryOnly.intent) === "q=hoodies",
    queryOnly.kind === "ready"
      ? buildSearchQueryString(queryOnly.intent)
      : ""
  );
}

/* 9. /find intent -> URL -> / parse reproduces the same call */
{
  const findIntent = {
    query: "women sneakers",
    params: {
      priceMin: String(usdToEur(50, FX)),
      priceMax: String(usdToEur(150, FX)),
      soft: null,
      budgetCurrency: "USD",
      budgetDisplayMin: "50",
      budgetDisplayMax: "150",
    },
  };
  const url = buildSearchQueryString(findIntent);
  check(
    "find intent builds display URL",
    url === "q=women+sneakers&min=50&max=150&cur=USD",
    url
  );
  const parsed = parseSearchUrl(new URLSearchParams(url), FX);
  check(
    "find intent reproduces engine call after round trip",
    parsed.kind === "ready" &&
      parsed.intent.query === findIntent.query &&
      parsed.intent.params.priceMin === findIntent.params.priceMin &&
      parsed.intent.params.priceMax === findIntent.params.priceMax &&
      parsed.intent.params.soft === findIntent.params.soft &&
      parsed.intent.params.budgetDisplayMin ===
        findIntent.params.budgetDisplayMin &&
      parsed.intent.params.budgetDisplayMax ===
        findIntent.params.budgetDisplayMax &&
      parsed.intent.params.budgetCurrency ===
        findIntent.params.budgetCurrency,
    JSON.stringify(parsed)
  );
}

/* 10. Encoding omits absent pieces; cur only with a budget */
{
  const noBudget = buildSearchQueryString({
    query: "shirt",
    params: {
      priceMin: null,
      priceMax: null,
      soft: null,
      budgetCurrency: null,
      budgetDisplayMin: null,
      budgetDisplayMax: null,
    },
  });
  check(
    "no-budget intent encodes query only",
    noBudget === "q=shirt",
    noBudget
  );
  const softOnly = buildSearchQueryString({
    query: "shirt",
    params: {
      priceMin: null,
      priceMax: null,
      soft: "slim",
      budgetCurrency: "USD",
      budgetDisplayMin: null,
      budgetDisplayMax: null,
    },
  });
  check(
    "no-budget intent drops cur even if set",
    softOnly === "q=shirt&soft=slim",
    softOnly
  );
}

/* 11. Key dedupe: same resolved search -> same key */
{
  const a = parseSearchUrl(
    new URLSearchParams("q=jacket&min=50&cur=USD"),
    FX
  );
  const b = parseSearchUrl(
    new URLSearchParams("q=jacket&min=46.3&cur=EUR"),
    FX
  );
  check(
    "same resolved bounds share a key",
    a.kind === "ready" &&
      b.kind === "ready" &&
      searchIntentKey(a.intent) === searchIntentKey(b.intent),
    a.kind === "ready" && b.kind === "ready"
      ? `${searchIntentKey(a.intent)} vs ${searchIntentKey(b.intent)}`
      : ""
  );
  const c = parseSearchUrl(
    new URLSearchParams("q=jacket&min=60&cur=USD"),
    FX
  );
  check(
    "different bounds differ in key",
    a.kind === "ready" &&
      c.kind === "ready" &&
      searchIntentKey(a.intent) !== searchIntentKey(c.intent)
  );
  check(
    "soft differs in key",
    parseSearchUrl(new URLSearchParams("q=jacket"), FX).kind === "ready" &&
      parseSearchUrl(
        new URLSearchParams("q=jacket&soft=cotton"),
        FX
      ).kind === "ready" &&
      searchIntentKey(
        parseSearchUrl(new URLSearchParams("q=jacket"), FX).intent
      ) !==
        searchIntentKey(
          parseSearchUrl(
            new URLSearchParams("q=jacket&soft=cotton"),
            FX
          ).intent
        )
  );
}

/* 12. decodeSearchUrl surfaces the raw display pieces */
{
  const decoded = decodeSearchUrl(
    new URLSearchParams(
      "q=blouse&min=20.5&max=99.9&cur=EUR&soft=silk"
    )
  );
  check(
    "decode exposes display budget + soft",
    decoded.query === "blouse" &&
      decoded.min === "20.5" &&
      decoded.max === "99.9" &&
      decoded.cur === "EUR" &&
      decoded.soft === "silk",
    JSON.stringify(decoded)
  );
  const lazy = decodeSearchUrl(
    new URLSearchParams("q=blouse&min=20.0")
  );
  check(
    "decode normalizes numeric display values",
    lazy.min === "20",
    lazy.min
  );
}

/* 13. Unknown params (from=find legacy) are ignored */
{
  const parsed = parseSearchUrl(
    new URLSearchParams("q=hoodies&from=find"),
    FX
  );
  check(
    "legacy from=find does not leak into state",
    parsed.kind === "ready" &&
      parsed.intent.query === "hoodies" &&
      parsed.intent.params.priceMin === null &&
      parsed.intent.params.priceMax === null &&
      buildSearchQueryString(parsed.intent) === "q=hoodies",
    JSON.stringify(parsed)
  );
}

/* 14. encodeSearchUrl keeps intent fields separate */
{
  const intent = {
    query: "coat",
    params: {
      priceMin: "46.3",
      priceMax: "138.89",
      soft: null,
      budgetCurrency: "USD",
      budgetDisplayMin: "50",
      budgetDisplayMax: "150",
    },
  };
  const encoded = encodeSearchUrl(intent);
  check(
    "encode separates display vs engine",
    encoded.min === "50" &&
      encoded.max === "150" &&
      encoded.cur === "USD" &&
      encoded.query === "coat" &&
      encoded.soft === null,
    JSON.stringify(encoded)
  );
}

console.log(
  `\nurl-state: ${passed} passed, ${failed} failed`
);
process.exit(failed === 0 ? 0 : 1);