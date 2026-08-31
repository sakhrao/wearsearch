import {
  SHOE_CATEGORY_NAMES,
  categoryDiscipline,
} from "./facets";

/* F19b: the client-side Size facet is split into per-family
   sections that reflect what the CURRENT result products actually
   carry. A section is shown only when at least one result product
   belongs to it; its chips are the exact size values those
   products own (per-product dedup), never catalog-wide values and
   never values from another family. Shoes are split into US/EU
   sections purely from variant.size.system - the stored system,
   never from the numeric value.

   The family taxonomy mirrors /api/meta SLUG_TO_GROUP plus the seed
   category tree (Accessories: socks/belts/sunglasses/ties/watches,
   Headwear: beanies/hats/caps). Category NAME is authoritative on
   the wire. */

export type SizeSectionKey =
  | "clothing"
  | "shoes-us"
  | "shoes-eu"
  | "accessories"
  | "headwear";

export const SIZE_SECTION_ORDER: SizeSectionKey[] = [
  "clothing",
  "shoes-us",
  "shoes-eu",
  "accessories",
  "headwear",
];

export const SIZE_SECTION_LABELS: Record<
  SizeSectionKey,
  string
> = {
  clothing: "Clothing Size",
  "shoes-us": "Shoe Size (US)",
  "shoes-eu": "Shoe Size (EU)",
  accessories: "Accessories Size",
  headwear: "Headwear Size",
};

type SizeGroupKind =
  | "shoes"
  | "clothing"
  | "accessories"
  | "headwear";

const SHOE_CATEGORY_SET = new Set(
  SHOE_CATEGORY_NAMES
);

const ACCESSORY_CATEGORY_NAMES = new Set([
  "Belts",
  "Sunglasses",
  "Ties",
  "Watches",
]);

const HEADWEAR_CATEGORY_NAMES = new Set([
  "Beanies",
  "Hats",
  "Caps",
]);

export function categorySizeGroupKind(
  categoryName: string | null
): SizeGroupKind {
  const name = categoryName ?? "";
  if (SHOE_CATEGORY_SET.has(name)) {
    return "shoes";
  }
  if (ACCESSORY_CATEGORY_NAMES.has(name)) {
    return "accessories";
  }
  if (HEADWEAR_CATEGORY_NAMES.has(name)) {
    return "headwear";
  }
  return "clothing";
}

export function variantSizeSection(
  kind: SizeGroupKind,
  system: string | null
): SizeSectionKey {
  if (kind === "shoes") {
    return system === "EU" ? "shoes-eu" : "shoes-us";
  }
  return kind;
}

export type SizeSectionInput = {
  gender?: string | null;
  category: { name: string | null } | null;
  variants: {
    size: {
      value: string | null | undefined;
      system?: string | null;
    } | null;
  }[];
};

/* --- Stage 3-B: contextual size identity -------------------------
   A physical size is referenced by audience + productType + system
   + value. Category is deliberately NOT part of the identity (Men
   EU 42 is the same physical size for Sneakers and Boots), so the
   facet never creates duplicate chips for one size. System is part
   of the identity (EU 42 != US 42). Audience comes from the product
   gender and is validated 1:1 against Size.audience for every
   AVAILABLE sized variant in the live catalog. */

export const AUDIENCE_DISPLAY_LABELS: Record<
  string,
  string
> = {
  MEN: "Men",
  WOMEN: "Women",
  KIDS: "Kids",
  UNISEX: "Unisex",
};

export function normalizeAudience(
  gender: string | null
): string {
  return gender ?? "UNKNOWN";
}

export function sizeIdentity(
  audience: string,
  productType: string,
  system: string | null,
  value: string
): string {
  return [
    audience,
    productType,
    system ?? "NONE",
    value,
  ].join("|");
}

export function parseSizeIdentity(
  identity: string
): {
  audience: string;
  productType: string;
  system: string | null;
  value: string;
} | null {
  const parts = identity.split("|");
  if (parts.length !== 4) {
    return null;
  }
  const [audience, productType, system, value] = parts;
  if (!audience || !productType || !value) {
    return null;
  }
  return {
    audience,
    productType,
    system: system === "NONE" ? null : system,
    value,
  };
}

export type SizeSectionChip = {
  identity: string;
  value: string;
};

export type SizeSectionColumn = {
  /* null: the section has a single audience and renders without a
     column heading (identical to the pre-3-B markup). */
  audience: string | null;
  chips: SizeSectionChip[];
};

/* UNISEX sizes fold into the MEN and WOMEN columns only - never
   KIDS - mirroring the 3-A questionnaire merge while staying
   impossible to leak kids results. */

const MAIN_AUDIENCES = ["MEN", "WOMEN", "KIDS"];

type SizeRow = {
  productType: string;
  system: string | null;
  value: string;
};

type SizeEntry = {
  audience: string;
  rows: SizeRow[];
};

function productSizeRows(
  product: SizeSectionInput
): {
  audience: string;
  section: SizeSectionKey;
  row: SizeRow;
}[] {
  const kind = categorySizeGroupKind(
    product.category?.name ?? null
  );
  const audience = normalizeAudience(
    product.gender ?? null
  );
  const productType = categoryDiscipline(
    product.category?.name ?? null
  );
  const seen = new Set<string>();
  const rows: {
    audience: string;
    section: SizeSectionKey;
    row: SizeRow;
  }[] = [];

  for (const variant of product.variants) {
    const size = variant.size;
    if (!size || !size.value) {
      continue;
    }
    const dedupKey = `${size.system ?? "NONE"}|${size.value}`;
    if (seen.has(dedupKey)) {
      continue;
    }
    seen.add(dedupKey);
    rows.push({
      audience,
      section: variantSizeSection(
        kind,
        size.system ?? null
      ),
      row: {
        productType,
        system: size.system ?? null,
        value: size.value,
      },
    });
  }

  return rows;
}

function buildSectionColumns(
  entries: SizeEntry[],
  main: string[]
): SizeSectionColumn[] {
  /* Single-audience windows (one main audience, or only UNISEX /
     unknown rows) render ONE heading-less column, identical to the
     pre-3-B markup. Mixed windows split into one column per main
     audience (MEN, WOMEN, KIDS), with UNISEX folded into MEN and
     WOMEN only. Rows with an unrecognized audience (e.g. null
     gender) only surface when no main column exists - the live
     catalog has zero such rows, and a MEN/WOMEN chip that could
     never match them would break the count invariant. */
  const foldTargets: string[] = main.filter(
    (audience) =>
      audience === "MEN" || audience === "WOMEN"
  );
  const unisexEntry = entries.find(
    (entry) => entry.audience === "UNISEX"
  );
  const others = entries.filter(
    (entry) =>
      entry.audience !== "UNISEX" &&
      !MAIN_AUDIENCES.includes(entry.audience)
  );

  const columns: {
    audience: string;
    sources: SizeEntry[];
  }[] = main.map((audience) => ({
    audience,
    sources: entries.filter(
      (entry) => entry.audience === audience
    ),
  }));

  if (unisexEntry) {
    if (foldTargets.length > 0) {
      for (const column of columns) {
        if (foldTargets.includes(column.audience)) {
          column.sources.push(unisexEntry);
        }
      }
    } else {
      columns.push({
        audience: "UNISEX",
        sources: [unisexEntry],
      });
    }
  }

  if (columns.length === 0) {
    const chips: SizeSectionChip[] = [];
    const seen = new Set<string>();

    for (const entry of others) {
      for (const row of entry.rows) {
        const identity = sizeIdentity(
          entry.audience,
          row.productType,
          row.system,
          row.value
        );
        if (seen.has(identity)) {
          continue;
        }
        seen.add(identity);
        chips.push({ identity, value: row.value });
      }
    }

    return [{ audience: null, chips }];
  }

  return columns.map((column) => {
    const chips: SizeSectionChip[] = [];
    const seen = new Set<string>();

    for (const entry of column.sources) {
      for (const row of entry.rows) {
        const identity = sizeIdentity(
          column.audience,
          row.productType,
          row.system,
          row.value
        );
        if (seen.has(identity)) {
          continue;
        }
        seen.add(identity);
        chips.push({ identity, value: row.value });
      }
    }

    return { audience: column.audience, chips };
  });
}

/* F19b + Stage 3-B: per-family Size sections, each holding the
   audience columns that the CURRENT result products actually carry.
   The displayed size values come from the products in the window
   only - never from the query text, the catalog, or hardcoded
   ranges. A window with several audiences (e.g. MEN + WOMEN +
   UNISEX) splits the section into columns; a single-audience
   window renders exactly one column with no heading. */
export function buildSizeSectionColumns(
  products: SizeSectionInput[]
): Record<SizeSectionKey, SizeSectionColumn[]> {
  const perSection: Record<
    SizeSectionKey,
    SizeEntry[]
  > = {
    clothing: [],
    "shoes-us": [],
    "shoes-eu": [],
    accessories: [],
    headwear: [],
  };

  for (const product of products) {
    for (const row of productSizeRows(product)) {
      let entry = perSection[row.section].find(
        (candidate) =>
          candidate.audience === row.audience
      );

      if (!entry) {
        entry = { audience: row.audience, rows: [] };
        perSection[row.section].push(entry);
      }

      if (
        !entry.rows.some(
          (candidate) =>
            candidate.productType ===
              row.row.productType &&
            candidate.system === row.row.system &&
            candidate.value === row.row.value
        )
      ) {
        entry.rows.push(row.row);
      }
    }
  }

  const result: Record<
    SizeSectionKey,
    SizeSectionColumn[]
  > = {
    clothing: [],
    "shoes-us": [],
    "shoes-eu": [],
    accessories: [],
    headwear: [],
  };

  for (const key of SIZE_SECTION_ORDER) {
    const entries = perSection[key];
    const main = MAIN_AUDIENCES.filter((audience) =>
      entries.some(
        (entry) => entry.audience === audience
      )
    );
    result[key] = buildSectionColumns(entries, main);
  }

  return result;
}

/* identity view of one product's sized variants, used by the
   size filter predicate (search-facets). */
export function productSizeTriples(
  product: SizeSectionInput
): SizeRow[] {
  return productSizeRows(product).map((row) => row.row);
}

export function buildSizeSectionValues(
  products: SizeSectionInput[]
): Record<SizeSectionKey, Set<string>> {
  const sections: Record<
    SizeSectionKey,
    Set<string>
  > = {
    clothing: new Set(),
    "shoes-us": new Set(),
    "shoes-eu": new Set(),
    accessories: new Set(),
    headwear: new Set(),
  };

  for (const product of products) {
    const kind = categorySizeGroupKind(
      product.category?.name ?? null
    );
    const seen = new Set<string>();
    for (const variant of product.variants) {
      const size = variant.size;
      if (!size || !size.value || seen.has(size.value)) {
        continue;
      }
      seen.add(size.value);
      sections[
        variantSizeSection(kind, size.system ?? null)
      ].add(size.value);
    }
  }

  return sections;
}