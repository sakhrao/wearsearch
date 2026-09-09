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

export const ORDERED_ALPHA = [
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

/** Full standard size surfaces per category type. The questionnaire
    step always offers every conceivable size ("all possible sizes for
    each category"), so a category's list is the union of these complete
    standard ranges with whatever the catalog actually carries for that
    category — any audience, any system. Clothing gets the full alpha
    ladder; footwear gets complete EU/US/UK numeric scales that always
    appear, even when the catalog has no rows for one of them. */
export const STANDARD_CLOTHING_SIZES = ORDERED_ALPHA;

function footRange(from: number, to: number): string[] {
  return Array.from({ length: to - from + 1 }, (_, i) =>
    String(from + i)
  );
}

export const STANDARD_FOOTWEAR_SYSTEMS: Record<string, string[]> = {
  EU: footRange(35, 50),
  US: footRange(4, 14),
  UK: footRange(3, 13),
};

/** Sections for one questionnaire context. The list no longer depends
    on the picked gender: every size the catalog carries for the category
    (across all audiences, MEN/WOMEN/KIDS/UNISEX) is merged, then unioned
    with the full standard surface for the category's product type, so
    the step shows all possible sizes. Clothing collapses into a single
    generic list (up to one column per system for a category that mixes
    systems, e.g. belts waist + letters); footwear becomes one column per
    system — EU, US, UK always present, plus any catalog systems such as
    IT or FR. A category finds no catalog rows still falls back to the
    standard clothing surface rather than offering nothing. */
export function sizeSectionsFor(params: {
  audience: ContextualSizeAudience | null;
  categoryName: string | null;
  catalog: SizeCatalog;
}): SizeSection[] {
  const { audience, categoryName, catalog } = params;
  if (!audience || !categoryName) {
    return [];
  }

  const mergedBySystem = new Map<string, Set<string>>();
  let productType: ContextualProductType | null = null;

  for (const aud of SIZE_AUDIENCES) {
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
      if (productType !== pt) {
        continue;
      }
      for (const system of category.systems) {
        const set =
          mergedBySystem.get(system.system) ?? new Set<string>();
        for (const value of system.values) {
          set.add(value);
        }
        mergedBySystem.set(system.system, set);
      }
    }
  }

  if (productType === "FOOTWEAR") {
    const knownSystems = new Set<string>(
      [...mergedBySystem.keys()].filter(
        (system) => system.toLowerCase() !== "unknown"
      )
    );
    for (const system of Object.keys(STANDARD_FOOTWEAR_SYSTEMS)) {
      knownSystems.add(system);
    }
    const sections: SizeSection[] = [...knownSystems]
      .sort(systemNameOrder)
      .map((system) => {
        const values = sortValues([
          ...new Set([
            ...(mergedBySystem.get(system) ?? new Set<string>()),
            ...(STANDARD_FOOTWEAR_SYSTEMS[system] ?? []),
          ]),
        ]);
        return {
          label: rangeLabel(system, values),
          system,
          productType: "FOOTWEAR",
          values,
        };
      });
    /* A shoes row whose store system is missing (catalog rows carry
       no system signal) renders as ONE extra generic value list, never
       an invented EU/US/US-band label. */
    const unknown = mergedBySystem.get("UNKNOWN");
    if (unknown && unknown.size > 0) {
      sections.push({
        label: null,
        system: null,
        productType: "FOOTWEAR",
        values: sortValues([...unknown]),
      });
    }
    return sections;
  }

  /* Clothing — or a category with no catalog rows at all, which
     defaults to the complete standard clothing surface. */
  const values = sortValues([
    ...new Set([
      ...STANDARD_CLOTHING_SIZES,
      ...[...mergedBySystem.values()].flatMap((set) => [...set]),
    ]),
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