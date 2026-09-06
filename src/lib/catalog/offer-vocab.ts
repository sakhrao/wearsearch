/* Real questionnaire vocabulary derived from ProductOfferVariant data
   (the Phase-0 commerce layer). The Color/Size dictionary tables were
   written by older imports and are empty for a Phase-0 catalog, so the
   questionnaire colors/sizes MUST come from the actual offer rows that
   ARE populated. Everything here is pure (DB-free) and returns only
   canonical chips that the /api/search engine also understands, so a
   picked chip genuinely gates results instead of being display-only.

   Both /api/meta (option surfaces) and /api/search (detection +
   projection matching) share these helpers so a chip always round-trips:
   meta.colors -> chip -> query token -> detected color -> offer match. */

import { cleanText, normalizeColorName } from "./normalize";
import { ORDERED_ALPHA } from "../sizes";

/* ==== Colors ==== */

const MULTI_COLOR_FOLDS = new Set([
  "multi color",
  "multicolor",
  "multi",
  "mixed",
]);

const singleWord = (word: string): string =>
  word.endsWith("s") ? word.slice(0, -1) : word;

/* Raw offer color -> canonical chip. Real plural spellings ("Blacks",
   "Beiges") and brand colorways ("Dark Brown") collapse onto a single
   capitalised chip; the KNOWN fold table drives the common colours so
   "Gray" and "Denim" land on the same chips search already knows. */
export function canonicalColorFromOffer(
  color: string | null | undefined
): string | null {
  if (!color) return null;
  const trimmed = cleanText(color);
  if (!trimmed) return null;

  const direct = normalizeColorName(trimmed);
  if (direct) return direct;

  const folded = trimmed.toLowerCase().replace(/\s+/g, " ");
  if (MULTI_COLOR_FOLDS.has(folded)) return "Multi";

  /* Plural fallback: "Blacks" -> "Black", "Dark Browns" -> "Dark Brown". */
  const stripped = singleWord(folded);
  const viaSingular = normalizeColorName(stripped);
  if (viaSingular && stripped.length >= 3) return viaSingular;

  return null;
}

/* ==== Sizes ==== */

const SIZE_WORD_BY_FOLD: Record<string, string> = {
  xxs: "XXS",
  xs: "XS",
  s: "S",
  m: "M",
  l: "L",
  xl: "XL",
  xxl: "XXL",
  "2xl": "2XL",
  "3xl": "3XL",
  "xxxl": "XXXL",
  "4xl": "4XL",
  "5xl": "5XL",
  "extra small": "XS",
  "extra small extra small": "XXS",
  small: "S",
  medium: "M",
  large: "L",
  "extra large": "XL",
  "double extra large": "XXL",
  "one size": "One Size",
  onesize: "One Size",
};

const SIZE_NOISE = new Set([
  "variation",
  "free",
  "unknown",
  "n a",
  "n/a",
  "custom",
]);

const NUMERIC_SPAN = /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/;
const OPEN_NUMERIC = /^(\d+(?:\.\d+)?)\s*-$/;
const BRA_SIZE = /^(\d{2})([a-z]{1,3})$/i;

function alphaIndex(value: string): number | null {
  const index = ORDERED_ALPHA.indexOf(value);
  return index === -1 ? null : index;
}

function expandAlphaRange(token: string): string[] {
  const [fromRaw, toRaw] = token.split("-");
  const fromIndex = alphaIndex(fromRaw);
  const toIndex = alphaIndex(toRaw);
  if (fromIndex === null || toIndex === null) return [];
  const [lo, hi] =
    fromIndex <= toIndex
      ? [fromIndex, toIndex]
      : [toIndex, fromIndex];
  const out: string[] = [];
  for (let i = lo; i <= hi; i++) out.push(ORDERED_ALPHA[i]);
  return out;
}

/* Normalize one raw size token (after comma/slash splitting) into its
   canonical chips. Numbers stay numbers, alpha sizes fold to the
   uppercase canonical form, ranges expand to their member values, a
   bra size ("36B") is kept whole, and noise ("Variation", quoting
   leftovers) never produces a chip. */
function normalizeSizeToken(token: string): string[] {
  const cleaned = cleanText(token.replace(/^["']|["']$/g, ""));
  if (!cleaned) return [];
  const folded = cleaned.toLowerCase().replace(/\s+/g, " ");
  if (SIZE_NOISE.has(folded)) return [];
  if (folded === "one size") return ["One Size"];

  const wordSize = SIZE_WORD_BY_FOLD[folded];
  if (wordSize) return [wordSize];

  const bra = cleaned.match(BRA_SIZE);
  if (bra) return [cleaned.toUpperCase()];

  if (cleaned.includes("-")) {
    if (/^[a-z]+\s*-\s*[a-z0-9]+$/i.test(cleaned)) {
      const expanded = expandAlphaRange(cleaned.replace(/\s+/g, ""));
      if (expanded.length > 0) return expanded;
    }
    const numericSpan = cleaned.match(NUMERIC_SPAN);
    if (numericSpan) {
      const lo = parseFloat(numericSpan[1]);
      const hi = parseFloat(numericSpan[2]);
      if (
        Number.isFinite(lo) &&
        Number.isFinite(hi) &&
        lo < hi &&
        hi - lo <= 60 &&
        Number.isInteger(lo) &&
        Number.isInteger(hi)
      ) {
        const out: string[] = [];
        for (let n = lo; n <= hi; n++) out.push(String(n));
        return out;
      }
    }
    const openEnded = cleaned.match(OPEN_NUMERIC);
    if (openEnded) return [String(parseFloat(openEnded[1]))];
    return [];
  }

  if (/^\d+(\.\d+)?$/.test(cleaned)) {
    return [cleaned];
  }

  /* A standalone alphabetic size ("M", "XL", "Medium") folds through
     the word table; anything else is unrecognized and dropped. */
  const standalone = SIZE_WORD_BY_FOLD[folded];
  return standalone ? [standalone] : [];
}

/* Split a raw offer size string into its canonical chips. Handles the
   real messy shapes found in the catalog: "S/M L/XL 2XL/3XL",
   "XS, S, M, L, XL, 2XL", "XS-2XL", "6-12", 'S 7"', "One Size". */
export function expandOfferSizeChips(
  raw: string | null | undefined
): string[] {
  if (!raw) return [];
  const cleaned = cleanText(raw);
  if (!cleaned) return [];

  const foldedWhole = cleaned.toLowerCase().replace(/\s+/g, " ");
  if (SIZE_NOISE.has(foldedWhole)) return [];

  if (foldedWhole === "one size") return ["One Size"];

  const tokens = cleaned
    .replace(/[/,]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .flatMap(normalizeSizeToken);

  /* A value like 'S 7"' yields both "S" and "7"; each is a real size
     the catalog carries, so both stay. */
  return [...new Set(tokens)];
}