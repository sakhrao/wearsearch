import { isNumericSize } from "./facets";

export type SizeCandidate = {
  category: string;
  value: string;
  system?: string;
};

export type CatalogSizeGroups = {
  clothing: string[];
  shoes: string[];
};

const ORDERED_ALPHA = [
  "XXS",
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "2XL",
  "XXL",
  "3XL",
  "XXXL",
  "4XL",
  "5XL",
];

function alphaOrder(value: string): number {
  const index = ORDERED_ALPHA.indexOf(value);
  return index === -1 ? ORDERED_ALPHA.length + 1 : index;
}

/* Builds the full catalog size surfaces per discipline
   (spec §6/§13). Shape guard: alphabetic values go to
   clothing, numeric values go to shoes. A shoe row holding
   an alphabetic value (historical mislabel) pollutes
   neither group. */
export function categorizeSizeList(
  sizes: SizeCandidate[]
): CatalogSizeGroups {
  const clothingSet = new Set<string>();
  const shoeNumericSet = new Set<string>();
  const shoeCustomSet = new Set<string>();

  for (const size of sizes) {
    if (size.category === "clothing") {
      if (!isNumericSize(size.value) && size.value.trim() !== "") {
        clothingSet.add(size.value);
      }
    } else if (size.category === "shoes") {
      if (isNumericSize(size.value)) {
        shoeNumericSet.add(size.value);
      } else if (
        size.value.trim() !== "" &&
        !/^[a-z]{1,3}$/i.test(size.value)
      ) {
        shoeCustomSet.add(size.value);
      }
    }
  }

  return {
    clothing: [...clothingSet].sort(
      (a, b) =>
        alphaOrder(a) - alphaOrder(b) ||
        a.localeCompare(b)
    ),
    shoes: [
      ...[...shoeNumericSet].sort(
        (a, b) =>
          parseFloat(a) - parseFloat(b) ||
          a.localeCompare(b)
      ),
      ...[...shoeCustomSet].sort(),
    ],
  };
}

/* Shoes are kept per sizing system (EU, US, UK, IT, FR) so the
   questionnaire can split them into EU vs US columns instead of
   merging every numeric scale into one alphabetical-free list. The
   system column is the catalog truth (spec §6): a value tagged US
   stays in the US bucket even if its magnitude looks European, and
   non-numeric / blank rows never pollute a system bucket. Only
   systems with at least one real numeric value are emitted. */
export function groupShoesBySystem(
  sizes: SizeCandidate[]
): Record<string, string[]> {
  const buckets = new Map<string, Set<string>>();

  for (const size of sizes) {
    if (size.category !== "shoes") {
      continue;
    }
    const value = size.value;
    if (value.trim() === "" || !isNumericSize(value)) {
      continue;
    }
    const system = size.system ?? "UNKNOWN";
    let set = buckets.get(system);
    if (!set) {
      set = new Set<string>();
      buckets.set(system, set);
    }
    set.add(value);
  }

  const result: Record<string, string[]> = {};
  for (const [system, set] of buckets) {
    result[system] = [...set].sort(
      (a, b) =>
        parseFloat(a) - parseFloat(b) ||
        a.localeCompare(b)
    );
  }
  return result;
}

/* ================================================================
   Stage 3-A: contextual size options for the questionnaire.

   The source of truth is the Product -> ProductVariant -> Size path
   restricted to purchasable variants (availability === AVAILABLE).
   audience is the PRODUCT gender (the Size clone it points at is the
   contextual one written by the Stage-2 backfill), so orphan or
   unused Size rows can never leak an option: a row only counts when
   at least one buyable variant of a product in that audience actually
   references it. No reinterpretation happens here: US 35-45 stays
   tagged US, no Men/Women guess from the number, no invented Kids or
   ranges. ordinal is used for ordering only, never to invent values.
   ================================================================ */

export type ContextualSizeAudience =
  | "MEN"
  | "WOMEN"
  | "KIDS"
  | "UNISEX";

export type ContextualProductType =
  | "CLOTHING"
  | "FOOTWEAR";

export type ContextualSizeRow = {
  audience: ContextualSizeAudience;
  productType: ContextualProductType;
  category: string;
  system: string | null;
  value: string;
  ordinal: number | null;
};

export type SizeCatalogSystem = {
  system: string;
  values: string[];
};

export type SizeCatalogCategory = {
  name: string;
  systems: SizeCatalogSystem[];
};

export type SizeCatalogEntry = {
  CLOTHING: SizeCatalogCategory[];
  FOOTWEAR: SizeCatalogCategory[];
};

export type SizeCatalog = Record<
  ContextualSizeAudience,
  SizeCatalogEntry
>;

export const SIZE_AUDIENCES: ContextualSizeAudience[] = [
  "MEN",
  "WOMEN",
  "KIDS",
  "UNISEX",
];

/** Canonical system presentation order: EU, US, then the rest
    alphabetically. */
const SYSTEM_ORDER: Record<string, number> = {
  EU: 0,
  US: 1,
  UK: 2,
  IT: 3,
  FR: 4,
};

function systemNameOrder(a: string, b: string): number {
  const ia = SYSTEM_ORDER[a] ?? 5;
  const ib = SYSTEM_ORDER[b] ?? 5;
  return ia - ib || a.localeCompare(b);
}

function sortValues(values: string[]): string[] {
  return [...values].sort((a, b) => {
    const na = parseFloat(a);
    const nb = parseFloat(b);
    if (
      isNumericSize(a) &&
      isNumericSize(b) &&
      Number.isFinite(na) &&
      Number.isFinite(nb) &&
      na !== nb
    ) {
      return na - nb;
    }
    return alphaOrder(a) - alphaOrder(b) || a.localeCompare(b);
  });
}

export function rangeLabel(
  system: string,
  values: string[]
): string {
  const first = values[0];
  const last = values[values.length - 1];
  return first === last
    ? `${system} (${first})`
    : `${system} (${first}\u2013${last})`;
}

export function buildSizeCatalog(
  rows: ContextualSizeRow[]
): SizeCatalog {
  const catalog: SizeCatalog = {
    MEN: { CLOTHING: [], FOOTWEAR: [] },
    WOMEN: { CLOTHING: [], FOOTWEAR: [] },
    KIDS: { CLOTHING: [], FOOTWEAR: [] },
    UNISEX: { CLOTHING: [], FOOTWEAR: [] },
  };

  /* audience -> productType -> category -> system -> (value, ordinal) */
  const tree =
    new Map<
      ContextualSizeAudience,
      Map<
        ContextualProductType,
        Map<string, Map<string, Map<string, number | null>>>
      >
    >();

  for (const row of rows) {
    const { audience, productType, category, system, value, ordinal } =
      row;
    if (!catalog[audience]) {
      continue;
    }
    if (value.trim() === "") {
      continue;
    }
    let byPt = tree.get(audience);
    if (!byPt) {
      byPt = new Map();
      tree.set(audience, byPt);
    }
    let byCat = byPt.get(productType);
    if (!byCat) {
      byCat = new Map();
      byPt.set(productType, byCat);
    }
    let bySys = byCat.get(category);
    if (!bySys) {
      bySys = new Map();
      byCat.set(category, bySys);
    }
    let byVal = bySys.get(system ?? "UNKNOWN");
    if (!byVal) {
      byVal = new Map();
      bySys.set(system ?? "UNKNOWN", byVal);
    }
    if (!byVal.has(value)) {
      byVal.set(value, ordinal);
    }
  }

  for (const [audience, byPt] of tree) {
    const entry = catalog[audience];
    for (const [productType, byCat] of byPt) {
      for (const [category, bySys] of [...byCat.entries()].sort((a, b) =>
        a[0].localeCompare(b[0])
      )) {
        const systems: SizeCatalogSystem[] = [];
        for (const [system, byVal] of [...bySys.entries()].sort((a, b) =>
          systemNameOrder(a[0], b[0])
        )) {
          const pairs = [...byVal.entries()];
          const hasOrdinals = pairs.every(
            ([, ordinal]) => ordinal != null
          );
          pairs.sort((a, b) => {
            if (hasOrdinals) {
              return (
                (a[1] ?? Number.MAX_SAFE_INTEGER) -
                  (b[1] ?? Number.MAX_SAFE_INTEGER) ||
                a[0].localeCompare(b[0])
              );
            }
            const na = parseFloat(a[0]);
            const nb = parseFloat(b[0]);
            if (
              isNumericSize(a[0]) &&
              isNumericSize(b[0]) &&
              Number.isFinite(na) &&
              Number.isFinite(nb) &&
              na !== nb
            ) {
              return na - nb;
            }
            return (
              alphaOrder(a[0]) - alphaOrder(b[0]) ||
              a[0].localeCompare(b[0])
            );
          });
          systems.push({
            system,
            values: pairs.map(([value]) => value),
          });
        }
        entry[productType].push({ name: category, systems });
      }
    }
  }

  return catalog;
}

export type SizeSection = {
  label: string | null;
  system: string | null;
  productType: ContextualProductType;
  values: string[];
};

/** Sections for one questionnaire context. Shoes become one column
    per system (EU, US, ...); clothing collapses into a single generic
    section. UNISEX products are merged for MEN and WOMEN exactly like
    the engine's genderMatches (spec §2/§12): they are eligible for
    adult audiences but never bleed a MEN/WOMEN row into another
    audience. KIDS is kids-only: an adult unisex shoe size is never
    offered to a children's context (Kids -> no sections when no KIDS
    rows exist). */
export function sizeSectionsFor(params: {
  audience: ContextualSizeAudience | null;
  categoryName: string | null;
  catalog: SizeCatalog;
}): SizeSection[] {
  const { audience, categoryName, catalog } = params;
  if (!audience || !categoryName) {
    return [];
  }
  const audiences: ContextualSizeAudience[] =
    audience === "UNISEX" || audience === "KIDS"
      ? [audience]
      : [audience, "UNISEX"];

  const mergedBySystem = new Map<string, Set<string>>();
  let productType: ContextualProductType | null = null;

  for (const aud of audiences) {
    const entry = catalog[aud];
    if (!entry) {
      continue;
    }
    for (const pt of ["CLOTHING", "FOOTWEAR"] as const) {
      const category = entry[pt].find(
        (c) => c.name === categoryName
      );
      if (!category) {
        continue;
      }
      if (productType === null) {
        productType = pt;
      }
      for (const system of category.systems) {
        const set =
          mergedBySystem.get(system.system) ??
          new Set<string>();
        for (const value of system.values) {
          set.add(value);
        }
        mergedBySystem.set(system.system, set);
      }
    }
  }

  if (productType === null || mergedBySystem.size === 0) {
    return [];
  }

  if (productType === "FOOTWEAR") {
    const systems = [...mergedBySystem.keys()].sort(
      systemNameOrder
    );
    return systems.map((system) => {
      const values = sortValues([
        ...mergedBySystem.get(system)!,
      ]);
      return {
        label: rangeLabel(system, values),
        system,
        productType: "FOOTWEAR",
        values,
      };
    });
  }

  const values = sortValues([
    ...new Set(
      [...mergedBySystem.values()].flatMap((set) => [
        ...set,
      ])
    ),
  ]);
  return [
    {
      label: null,
      system: null,
      productType: "CLOTHING",
      values,
    },
  ];
}