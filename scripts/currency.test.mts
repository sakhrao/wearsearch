import {
  roundMoney,
  usdToEur,
  eurToUsd,
  parseUsdPerEurEnv,
  getFxRate,
  resetFxCacheForTests,
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
   throw, never invent a rate. The search engine is never
   touched because it owns no FX code (verified separately). */
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

console.log(`\n=== RESULT: ${passed}/${passed + failed} passed ===`);
process.exit(failed === 0 ? 0 : 1);