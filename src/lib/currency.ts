/* Currency handling (single conversion layer).

   The catalog stores every price in its ORIGINAL product
   currency (seed products are EUR, provider-feed products are
   USD). The search engine compares budgets in a single
   reference currency - EUR - so raw USD prices are normalized
   to EUR at compare time via ANOTHER_EUR below. The original
   price and currency are never rewritten; the card still shows
   the original price in its original currency.

   The engine never assumes a stored EUR number equals USD. The
   budget surface (questionnaire) collects USD and converts to
   EUR for the engine via the same layer; direct API callers
   pass EUR bounds.

   Rate sources, in order:
     1. FX_RATE_USD_PER_EUR env override (deterministic,
        e.g. for offline/test environments).
     2. Frankfurter API (free, no key), ECB reference rates,
        refreshed daily. Cached in-process (3h on success,
        5min on failure).

   When no rate is available (offline, no override) the engine
   degrades to comparing stored values as-is - documented
   behavior, never an invented rate. */
export type FxRate = {
  rate: number | null;
  asOf: string | null;
  source: "ecb-frankfurter" | "env" | "none";
};

const SUCCESS_TTL_MS = 3 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 5 * 60 * 1000;

let cachedFx: FxRate | null = null;
let cachedAt = 0;

/* Test-only: drops the in-process cache so a fresh
   resolution (or failure) can be observed. */
export function resetFxCacheForTests(): void {
  cachedFx = null;
  cachedAt = 0;
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function usdToEur(usd: number, rate: number): number {
  return roundMoney(usd / rate);
}

export function eurToUsd(eur: number, rate: number): number {
  return roundMoney(eur * rate);
}

/* Normalize a stored price to the EUR reference currency.
   USD is divided by the rate; every other / missing / invalid
   currency is treated as EUR-stored (the schema default and
   the sync invariant for every provider row). Invalid prices
   pass through untouched and are excluded by the budget
   predicates (they cannot satisfy any bound). */
export function normalizePriceToEur(
  price: number,
  currency: string | null | undefined,
  rate: number | null
): number {
  if (!Number.isFinite(price)) {
    return price;
  }
  const code = (currency ?? "EUR").trim().toUpperCase();
  return code === "USD" &&
    rate !== null &&
    Number.isFinite(rate) &&
    rate > 0
    ? usdToEur(price, rate)
    : price;
}

export function priceWithinBudget(
  price: number,
  currency: string | null | undefined,
  min: number | null,
  max: number | null,
  rate: number | null
): boolean {
  if (!Number.isFinite(price)) {
    return false;
  }
  const normalized = normalizePriceToEur(
    price,
    currency,
    rate
  );
  return (
    (min === null || normalized >= min) &&
    (max === null || normalized <= max)
  );
}

/* Budget "compatible" band used by the Similar path: inside
   ±35% of the requested EUR bounds (mirrors spec §8). */
export function priceWithinBudgetBand(
  price: number,
  currency: string | null | undefined,
  min: number | null,
  max: number | null,
  rate: number | null
): boolean {
  if (!Number.isFinite(price)) {
    return false;
  }
  const normalized = normalizePriceToEur(
    price,
    currency,
    rate
  );
  return (
    (min === null || normalized >= min * 0.65) &&
    (max === null || normalized <= max * 1.35)
  );
}

export function parseUsdPerEurEnv(): number | null {
  const raw = process.env.FX_RATE_USD_PER_EUR;
  if (!raw) {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value > 0
    ? value
    : null;
}

async function fetchFrankfurter(): Promise<FxRate> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    1500
  );

  try {
    const response = await fetch(
      "https://api.frankfurter.app/latest?from=EUR&to=USD",
      {
        signal: controller.signal,
        cache: "no-store",
      }
    );
    if (!response.ok) {
      throw new Error(
        `fx http ${response.status}`
      );
    }
    const data = (await response.json()) as {
      date?: string;
      rates?: Record<string, number>;
    };
    const rate = data.rates?.USD;
    if (
      !data.date ||
      typeof rate !== "number" ||
      !Number.isFinite(rate) ||
      rate <= 0
    ) {
      throw new Error("fx payload invalid");
    }
    return {
      rate,
      asOf: data.date,
      source: "ecb-frankfurter",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function getFxRate(): Promise<FxRate> {
  const now = Date.now();

  if (
    cachedFx &&
    now - cachedAt <
      (cachedFx.rate !== null
        ? SUCCESS_TTL_MS
        : FAILURE_TTL_MS)
  ) {
    return cachedFx;
  }

  const fromEnv = parseUsdPerEurEnv();
  if (fromEnv) {
    cachedFx = {
      rate: fromEnv,
      asOf: null,
      source: "env",
    };
    cachedAt = now;
    return cachedFx;
  }

  try {
    cachedFx = await fetchFrankfurter();
  } catch {
    cachedFx = {
      rate: null,
      asOf: null,
      source: "none",
    };
  }
  cachedAt = now;
  return cachedFx;
}