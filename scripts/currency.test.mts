import {
  roundMoney,
  usdToEur,
  eurToUsd,
  parseUsdPerEurEnv,
  getFxRate,
  resetFxCacheForTests,
  normalizePriceToEur,
  priceWithinBudget,
  priceWithinBudgetBand,
} from "../src/lib/currency";

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

const RATE = 1.1645;

check(
  "U1 roundMoney keeps two decimals",
  roundMoney(42.93679) === 42.94 &&
    roundMoney(12.5) === 12.5 &&
    roundMoney(12.345) === 12.35,
  `${roundMoney(42.93679)},${roundMoney(12.5)},${roundMoney(12.345)}`
);

check(
  "U2 usdToEur divides by the real rate (never 1:1)",
  usdToEur(50, RATE) === 42.94 &&
    usdToEur(80, RATE) === 68.7,
  `${usdToEur(50, RATE)},${usdToEur(80, RATE)}`
);

check(
  "U3 eurToUsd multiplies by the real rate",
  eurToUsd(42.94, RATE) === 50,
  `${eurToUsd(42.94, RATE)}`
);

check(
  "U4 round-trip preserves the budget within cents",
  Math.abs(
    eurToUsd(usdToEur(75.99, RATE), RATE) - 75.99
  ) < 0.05,
  `${eurToUsd(usdToEur(75.99, RATE), RATE)}`
);

check(
  "U5 env override is honored when valid",
  (() => {
    process.env.FX_RATE_USD_PER_EUR = "1.2";
    const fromEnv = parseUsdPerEurEnv();
    process.env.FX_RATE_USD_PER_EUR = "";
    return fromEnv === 1.2;
  })(),
  `fromEnv=${parseUsdPerEurEnv()}`
);

check(
  "U6 missing/invalid env yields null (structure stays ready)",
  parseUsdPerEurEnv() === null,
  `got=${parseUsdPerEurEnv()}`
);

/* Frankfurter unreachable: must degrade gracefully, never
   throw, never invent a rate. */
resetFxCacheForTests();
process.env.FX_RATE_USD_PER_EUR = "";
const savedFetch = globalThis.fetch;
globalThis.fetch = (() =>
  Promise.reject(
    new Error("simulated Frankfurter outage")
  )) as typeof fetch;
const outageFx = await getFxRate();
globalThis.fetch = savedFetch;
resetFxCacheForTests();

check(
  "U7 Frankfurter outage degrades to rate=null/source=none without throwing",
  outageFx.rate === null &&
    outageFx.source === "none",
  JSON.stringify(outageFx)
);

check(
  "U8 no rate -> conversion is skipped (raw EUR passed through)",
  usdToEur(60, 1.1645) !== 60 &&
    usdToEur(60, 1.0) === 60 &&
    outageFx.rate === null,
  `usdToEur(60,1.1645)=${usdToEur(60, 1.1645)}`
);

/* =============================================================
   K2 pure budget semantics (EUR reference currency).

   Seeds are stored EUR, provider rows USD. The engine compares
   EUR-normalized values through the single currency layer, so
   both evaluate in the same frame; the original stored price
   and currency are never rewritten.
============================================================= */

const usd25 = Math.round((25 / RATE) * 100) / 100;

check(
  "N1 normalize to EUR reference (USD divided, all else as-is)",
  normalizePriceToEur(25, "EUR", RATE) === 25 &&
    normalizePriceToEur(25, "eur", RATE) === 25 &&
    normalizePriceToEur(25, "  usd ", RATE) === usd25 &&
    normalizePriceToEur(25, null, RATE) === 25 &&
    normalizePriceToEur(25, "", RATE) === 25 &&
    normalizePriceToEur(25, "XYZ", RATE) === 25 &&
    normalizePriceToEur(25, "USD", null) === 25 &&
    normalizePriceToEur(25, "USD", 0) === 25 &&
    Number.isNaN(
      normalizePriceToEur(Number.NaN, "USD", RATE)
    ),
  `usd25=${usd25}`
);

const f33 = usdToEur(33.99, RATE);
const f110 = usdToEur(109.99, RATE);

check(
  "K1 budget max-only (EUR stored)",
  priceWithinBudget(25, "EUR", null, 30, RATE) &&
    !priceWithinBudget(31, "EUR", null, 30, RATE),
  `cf: 25<=30 in, 31>30 out`
);

check(
  "K2 USD inside the normalized bound passes Exact (was excluded raw: $33.99 > €30)",
  priceWithinBudget(33.99, "USD", null, 30, RATE),
  `$33.99 -> ${f33} EUR <= 30`
);

check(
  "K3 USD above the normalized bound is excluded (was accepted raw: $109.99 >= €95)",
  !priceWithinBudget(109.99, "USD", 95, null, RATE),
  `$109.99 -> ${f110} EUR < 95`
);

check(
  "K4 min+max both ends honoured (EUR)",
  priceWithinBudget(20, "EUR", 10, 30, RATE) &&
    !priceWithinBudget(9.99, "EUR", 10, 30, RATE) &&
    !priceWithinBudget(30.01, "EUR", 10, 30, RATE),
  "20 in [10,30]; 9.99/30.01 out"
);

check(
  "K5 mixed EUR+USD rows evaluate together in one query",
  priceWithinBudget(20, "EUR", 15, 35, RATE) &&
    priceWithinBudget(33.99, "USD", 15, 35, RATE) &&
    !priceWithinBudget(33.99, "USD", 15, 29.1, RATE),
  `eur20 + usd(${f33}) in [15,35]; usd out of [15,29.10]`
);

check(
  "K6 budget without a currency label reads as EUR (min-only / max-only / both)",
  priceWithinBudget(25, null, null, 30, RATE) &&
    priceWithinBudget(25, null, 25, null, RATE) &&
    priceWithinBudget(25, null, 20, 30, RATE),
  "bare EUR bounds"
);

check(
  "K7 min>max matches nothing (any currency)",
  !priceWithinBudget(50, "EUR", 90, 30, RATE) &&
    !priceWithinBudget(50, "USD", 90, 30, RATE) &&
    !priceWithinBudget(50, "EUR", 60, null, RATE) &&
    !priceWithinBudget(50, "EUR", null, 40, RATE),
  "inconsistent 90..30 and single-ended misses"
);

check(
  "K8 invalid price never matches; unknown currency treated as EUR",
  !priceWithinBudget(Number.NaN, "USD", null, 30, RATE) &&
    priceWithinBudget(25, "XYZ", null, 30, RATE),
  "NaN excluded, XYZ read as EUR"
);

check(
  "K9 ±35% band still admits a normalized price just outside the hard bound",
  priceWithinBudgetBand(33.99, "USD", 35, 40, RATE) &&
    !priceWithinBudget(33.99, "USD", 35, 40, RATE),
  `usd(${f33}) similar-only in [35,40]`
);

/* =============================================================
   Live engine checks against the running localhost server.

   Rate-adaptive: uses the SAME meta.fx rate the engine used
   (env override first, then Frankfurter). When no rate is
   reachable the engine degrades to raw compare and the USD
   flips are skipped (status quo, unit-covered above).
============================================================= */

let skipped = 0;

function skip(name: string, detail: string) {
  skipped += 1;
  console.log(`SKIP ${name} :: ${detail}`);
}

const liveMeta = await fetch(
  "http://localhost:3000/api/meta"
).then((r) => r.json());
const liveRate = liveMeta?.fx?.rate ?? null;

type LiveVariant = {
  price: number | string;
  currency?: string | null;
};

type LiveProduct = {
  id: number | string;
  price: number | string;
  currency?: string | null;
  name?: string;
  variants?: LiveVariant[];
};

type LiveSearchResponse = {
  exactProducts?: LiveProduct[];
  similarProducts?: LiveProduct[];
  exactCount?: number;
  diagnostics?: string[];
};

async function liveSearch(
  params: Record<string, string>
): Promise<LiveSearchResponse> {
  const qs = new URLSearchParams(params);
  const res = await fetch(
    `http://localhost:3000/api/search?${qs.toString()}`
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as LiveSearchResponse;
}

const ids = (list: LiveProduct[] | undefined) =>
  new Set((list ?? []).map((p) => String(p.id)));

const sneakersAll = await liveSearch({ q: "sneakers" });
const exactIds = ids(sneakersAll.exactProducts);
const allProducts: LiveProduct[] = [
  ...(sneakersAll.exactProducts ?? []),
  ...(sneakersAll.similarProducts ?? []),
];
const usdSneaker = allProducts.find(
  (p) =>
    typeof p.currency === "string" &&
    p.currency.trim().toUpperCase() === "USD" &&
    Number.isFinite(Number(p.price)) &&
    Number(p.price) > 0 &&
    exactIds.has(String(p.id))
);

if (liveRate === null || !usdSneaker) {
  skip(
    "I1..I3 USD boundary flips need a rate + a USD sneaker",
    `rate=${liveRate ?? "none"} usdSneaker=${usdSneaker ? usdSneaker.id : "none"}`
  );
} else {
  const raw = Number(usdSneaker.price);
  const pn = usdToEur(raw, liveRate);
  const id = String(usdSneaker.id);

  const asMax = await liveSearch({
    q: "sneakers",
    priceMax: String(pn),
  });
  check(
    "I1 USD product enters Exact at its EUR-normalized boundary (raw was above the bound)",
    ids(asMax.exactProducts).has(id),
    `pn=${pn} raw=${raw} max=${pn} inExact=${ids(asMax.exactProducts).has(id)}`
  );

  const asMaxMinus = await liveSearch({
    q: "sneakers",
    priceMax: String(pn - 0.01),
  });
  check(
    "I2 excluded one cent below the normalized boundary",
    !ids(asMaxMinus.exactProducts).has(id),
    `max=${(pn - 0.01).toFixed(2)} inExact=${ids(asMaxMinus.exactProducts).has(id)}`
  );

  const asMinPlus = await liveSearch({
    q: "sneakers",
    priceMin: String(pn + 0.01),
  });
  check(
    "I3 excluded just above the normalized boundary although the raw price passed that gate",
    !ids(asMinPlus.exactProducts).has(id),
    `raw=${raw} min=${(pn + 0.01).toFixed(2)} inExact=${ids(asMinPlus.exactProducts).has(id)}`
  );
}

const inconsistent = await liveSearch({
  q: "sneakers",
  priceMin: "80",
  priceMax: "50",
});
check(
  "I4 min>max returns no Exact and names the budget range problem",
  inconsistent.exactCount === 0 &&
    (inconsistent.diagnostics ?? []).some(
      (m: string) => m.includes("budget range")
    ),
  `exact=${inconsistent.exactCount} diag=[${(inconsistent.diagnostics ?? []).join(" | ")}]`
);

const multiVar = allProducts.find(
  (p) => (p.variants?.length ?? 0) > 1
);
if (multiVar) {
  const vPrices = (multiVar.variants ?? []).map(
    (v) => Number(v.price)
  );
  const oneCurrency = (multiVar.variants ?? []).every(
    (v) =>
      (v.currency ?? "EUR") ===
      (multiVar.currency ?? "EUR")
  );
  check(
    "V1 budget unit is the product starting price (lowest variant) and all variants share one currency",
    Number(multiVar.price) === Math.min(...vPrices) &&
      oneCurrency,
    `${multiVar.name}: product=${multiVar.price} variants=[${vPrices.join(",")}]`
  );
} else {
  skip("V1 needs a multi-variant sneaker", "none found");
}

console.log(
  `\n=== RESULT: ${passed}/${passed + failed} passed (${skipped} skipped) ===`
);
process.exit(failed === 0 ? 0 : 1);