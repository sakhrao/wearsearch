/* Currency handling for the USD budget surface.

   Cataloge prices are stored in EUR. The questionnaire asks
   for a budget in USD (as agreed) but we never assume the
   stored EUR number equals USD. When a reliable rate is
   available the USD budget is converted to EUR for the
   engine; otherwise nothing is invented and the UI falls
   back to the catalog currency.

   Rate sources, in order:
     1. FX_RATE_USD_PER_EUR env override (deterministic,
        e.g. for offline/test environments).
     2. Frankfurter API (free, no key), ECB reference rates,
        refreshed daily. Cached in-process (3h on success,
        5min on failure). */
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