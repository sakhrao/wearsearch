import { isNumericSize } from "./facets";

export type SizeCandidate = {
  category: string;
  value: string;
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