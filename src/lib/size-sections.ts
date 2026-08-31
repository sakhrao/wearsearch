import { SHOE_CATEGORY_NAMES } from "./facets";

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
  category: { name: string | null } | null;
  variants: {
    size: {
      value: string | null;
      system: string | null;
    } | null;
  }[];
};

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
        variantSizeSection(kind, size.system)
      ].add(size.value);
    }
  }

  return sections;
}