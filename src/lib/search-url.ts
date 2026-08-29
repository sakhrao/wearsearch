/* URL encoding of the basic search state (F3).

   The URL is the single source of truth for the basic search:
     /?q=women+black+sneakers&min=50&max=150&cur=USD&soft=cotton
   - q      built query string (required)
   - min    user-facing budget lower bound (display currency)
   - max    user-facing budget upper bound (display currency)
   - cur    display currency of the budget: USD | EUR (only when
            a budget is present)
   - soft   comma-separated chosen attributes (optional; only when
            the questionnaire produced attribute choices)

   Local result filters (facet chips) are intentionally NOT in the
   URL at this stage: F3 covers the basic search state only.

   min/max/cur carry DISPLAY values. When cur=USD the engine bound
   is derived with usdToEur(...) using the same fx rate the /find
   page used, so a pasted URL reproduces the identical /api/search
   call. Without a usable rate a USD budget cannot be resolved and
   the caller must wait for the fx rate (needsFx). */
import { usdToEur } from "@/lib/currency";

export type BudgetCurrency = "USD" | "EUR";

export type SearchIntentParams = {
  priceMin: string | null;
  priceMax: string | null;
  soft: string | null;
  budgetCurrency: BudgetCurrency | null;
  budgetDisplayMin: string | null;
  budgetDisplayMax: string | null;
};

export type SearchIntent = {
  query: string;
  params: SearchIntentParams;
};

export type SearchUrlDecoded = {
  query: string;
  min: string | null;
  max: string | null;
  cur: BudgetCurrency | null;
  soft: string | null;
};

function toNullableNumber(raw: string | null): number | null {
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function normalizeCur(raw: string | null): BudgetCurrency | null {
  if (raw === "USD") {
    return "USD";
  }
  if (raw === "EUR") {
    return "EUR";
  }
  return null;
}

export function decodeSearchUrl(
  search: URLSearchParams
): SearchUrlDecoded {
  const query = (search.get("q") ?? "").trim();
  const minNum = toNullableNumber(search.get("min"));
  const maxNum = toNullableNumber(search.get("max"));
  const soft = search.get("soft")?.trim() || null;
  const hasBudget = minNum !== null || maxNum !== null;

  return {
    query,
    min: minNum !== null ? String(minNum) : null,
    max: maxNum !== null ? String(maxNum) : null,
    cur: hasBudget ? normalizeCur(search.get("cur")) : null,
    soft,
  };
}

export type ParseResult =
  | { kind: "empty"; intent: null; needsFx: false }
  | { kind: "ready"; intent: SearchIntent; needsFx: false }
  | { kind: "wait-fx"; intent: null; needsFx: true };

export function parseSearchUrl(
  search: URLSearchParams,
  fxRate: number | null
): ParseResult {
  const decoded = decodeSearchUrl(search);
  const { query, min, max, cur, soft } = decoded;

  if (!query) {
    return { kind: "empty", intent: null, needsFx: false };
  }

  const hasBudget = min !== null || max !== null;

  let budgetCurrency: BudgetCurrency | null = null;
  if (hasBudget) {
    budgetCurrency =
      cur ?? (fxRate !== null ? "USD" : "EUR");
  }

  let priceMin: string | null = null;
  let priceMax: string | null = null;

  if (hasBudget) {
    if (budgetCurrency === "USD") {
      if (fxRate === null) {
        return {
          kind: "wait-fx",
          intent: null,
          needsFx: true,
        };
      }
      priceMin =
        min !== null
          ? String(usdToEur(Number(min), fxRate))
          : null;
      priceMax =
        max !== null
          ? String(usdToEur(Number(max), fxRate))
          : null;
    } else {
      priceMin = min;
      priceMax = max;
    }
  }

  return {
    kind: "ready",
    intent: {
      query,
      params: {
        priceMin,
        priceMax,
        soft,
        budgetCurrency,
        budgetDisplayMin: min,
        budgetDisplayMax: max,
      },
    },
    needsFx: false,
  };
}

export function searchIntentKey(intent: SearchIntent): string {
  const { priceMin, priceMax, soft } = intent.params;
  return [
    intent.query,
    priceMin ?? "",
    priceMax ?? "",
    soft ?? "",
  ].join("\u0000");
}

export function encodeSearchUrl(
  intent: SearchIntent
): SearchUrlDecoded {
  const { query, params } = intent;
  return {
    query,
    min: params.budgetDisplayMin,
    max: params.budgetDisplayMax,
    cur: params.budgetCurrency,
    soft: params.soft,
  };
}

export function buildSearchQueryString(
  intent: SearchIntent
): string {
  const decoded = encodeSearchUrl(intent);
  const params = new URLSearchParams();

  if (decoded.query) {
    params.set("q", decoded.query);
  }
  if (decoded.min) {
    params.set("min", decoded.min);
  }
  if (decoded.max) {
    params.set("max", decoded.max);
  }
  if (decoded.cur && (decoded.min || decoded.max)) {
    params.set("cur", decoded.cur);
  }
  if (decoded.soft) {
    params.set("soft", decoded.soft);
  }

  return params.toString();
}