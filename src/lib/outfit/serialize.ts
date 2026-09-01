import type {
  ColorInfo,
  Outfit,
  OutfitProduct,
  SlotName,
} from "./types";

export function projectItem(item: {
  slot: SlotName;
  product: OutfitProduct;
  color: ColorInfo | null;
}) {
  const { slot, product, color } = item;
  return {
    slot,
    product: {
      id: product.id,
      name: product.name,
      price: product.price,
      currency: product.currency,
      imageUrl: product.imageUrl,
      productUrl: product.productUrl,
      brand: product.brand,
      category: product.category,
      gender: product.gender,
      attributes: product.attributes.map((a) => ({
        name: a.attribute.name,
        value: a.value,
      })),
    },
    color,
  };
}

export function serializeOutfit(o: Outfit) {
  return {
    id: o.id,
    complete: o.complete,
    score: o.score,
    totalPriceEur: o.totalPriceEur,
    missingSlots: o.missingSlots,
    items: o.items.map(projectItem),
    explanations: o.explanations,
  };
}

export function serializeAnchor(anchor: OutfitProduct) {
  return {
    id: anchor.id,
    name: anchor.name,
    price: anchor.price,
    currency: anchor.currency,
    imageUrl: anchor.imageUrl,
    productUrl: anchor.productUrl,
    brand: anchor.brand,
    category: anchor.category,
    gender: anchor.gender,
  };
}
