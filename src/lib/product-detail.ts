/* Product Detail — server-only loader (Stage G / G2B).

   Given a `Product.id`, reads the honest catalog view the detail page
   renders: image/gallery, name, brand, price, source, availability,
   taxonomy path, attributes, real variant/offer sizes (through the
   canonical read path), the offers with their external source links, and
   the Size Chart Resolver result for this product.

   Rules honoured here:
     - Identity is the existing `Product.id` (cuid). No second product
       identity is invented.
     - Sizes come from real variants / offer variants and are classified
       RESOLVED | UNRESOLVED | NOT_BACKFILLED. An unresolved size is shown
       by its preserved raw label and is never reinterpreted.
     - Availability is per size line, independent of resolution.
     - External links preserve the real source URL; a product with no real
       page says so rather than fabricating one.
     - No chart source exists yet, so the resolver receives no candidates
       and returns NO_CHART. Nothing is fabricated or interpolated. */

import { prisma } from "@/lib/prisma";
import { hasRealProductPage } from "@/lib/product-url";
import {
  projectOfferVariantSize,
  projectVariantSize,
} from "@/lib/outfit/catalog";
import {
  EMPTY_SIZE_CHART_SOURCE,
  isSizeSystemId,
  resolveChartsFromSource,
  type ResolvedSizeChart,
  type SizeAudienceId,
  type SizeCategoryId,
  type SizeChartSource,
  type SizeChartTarget,
  type SizeProductTypeId,
  type SizeReadState,
  type SizeSystemId,
} from "@/lib/size-domain";
import { canonicalColorFromOffer, expandOfferSizeChips } from "@/lib/catalog/offer-vocab";
import { categorySizeGroupKind } from "@/lib/size-sections";

export type ProductDetailSize = {
  /* Preserved raw source label — never canonicalized away. */
  label: string;
  system: string | null;
  /* RESOLVED | UNRESOLVED | NOT_BACKFILLED — never collapsed. */
  state: SizeReadState;
  canonicalSizeOptionId: string | null;
  /* Availability is independent of resolution. */
  available: boolean;
  colors: string[];
};

export type ProductDetailOffer = {
  id: string;
  sourceLabel: string;
  externalListingId: string;
  price: string;
  currency: string;
  availability: string;
  externalUrl: string;
  hasRealPage: boolean;
  isPrimary: boolean;
};

export type ProductDetail = {
  id: string;
  name: string;
  description: string | null;
  brand: { id: string; name: string } | null;
  price: string;
  currency: string;
  availability: string;
  gender: string | null;
  imageUrl: string | null;
  gallery: string[];
  sourceLabel: string;
  productUrl: string;
  hasRealProductPage: boolean;
  categoryPath: { id: string; name: string; slug: string }[];
  attributes: { name: string; value: string }[];
  sizes: ProductDetailSize[];
  unresolvedCount: number;
  notBackfilledCount: number;
  resolvedCount: number;
  hasUnresolved: boolean;
  offers: ProductDetailOffer[];
  chart: ResolvedSizeChart;
};

type CategoryNode = {
  id: string;
  name: string;
  slug: string;
  parent?: CategoryNode | null;
};

function flattenCategoryPath(
  node: CategoryNode | null | undefined
): { id: string; name: string; slug: string }[] {
  const path: { id: string; name: string; slug: string }[] = [];
  let current: CategoryNode | null | undefined = node;
  while (current) {
    path.unshift({ id: current.id, name: current.name, slug: current.slug });
    current = current.parent;
  }
  return path;
}

function productTypeForCategory(categoryName: string | null): SizeProductTypeId {
  switch (categorySizeGroupKind(categoryName)) {
    case "shoes":
      return "FOOTWEAR";
    case "accessories":
      return "ACCESSORY";
    case "headwear":
      return "HEADWEAR";
    default:
      return "CLOTHING";
  }
}

/* Conservative, name-based category id. Only used to select a chart's
   scope; it never invents a size. Unknown names map to "unknown". */
function sizeCategoryForName(categoryName: string | null): SizeCategoryId {
  const name = (categoryName ?? "").toLowerCase();
  if (/shoe|sneaker|boot|sandal|heel|loafer|trainer/.test(name)) return "footwear";
  if (/bag|backpack|tote|purse|handbag/.test(name)) return "bag";
  if (/belt/.test(name)) return "belt";
  if (/hat|cap|beanie/.test(name)) return "hat";
  if (/glove/.test(name)) return "glove";
  if (/sock/.test(name)) return "socks";
  if (/bra/.test(name)) return "bra";
  if (categorySizeGroupKind(categoryName) === "clothing") return "clothing";
  return "unknown";
}

export async function loadProductDetail(
  productId: string,
  options?: { chartSource?: SizeChartSource }
): Promise<ProductDetail | null> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      name: true,
      description: true,
      price: true,
      currency: true,
      availability: true,
      gender: true,
      imageUrl: true,
      productUrl: true,
      brand: { select: { id: true, name: true } },
      source: { select: { name: true } },
      category: {
        select: {
          id: true,
          name: true,
          slug: true,
          parent: {
            select: {
              id: true,
              name: true,
              slug: true,
              parent: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  parent: {
                    select: {
                      id: true,
                      name: true,
                      slug: true,
                      parent: {
                        select: {
                          id: true,
                          name: true,
                          slug: true,
                          parent: {
                            select: {
                              id: true,
                              name: true,
                              slug: true,
                              parent: {
                                select: { id: true, name: true, slug: true },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      attributes: {
        select: { value: true, attribute: { select: { name: true } } },
      },
      variants: {
        select: {
          price: true,
          currency: true,
          availability: true,
          color: { select: { name: true, hex: true } },
          canonicalSizeOptionId: true,
          sizeResolutionStatus: true,
          sizeResolutionProvenance: true,
          sizeResolutionSystem: true,
          size: {
            select: {
              system: true,
              value: true,
              normalizedValue: true,
              productType: true,
            },
          },
        },
      },
      offers: {
        orderBy: [{ isPrimary: "desc" }, { originalPrice: "asc" }],
        select: {
          id: true,
          externalListingId: true,
          sourceProductUrl: true,
          purchaseUrl: true,
          originalPrice: true,
          originalCurrency: true,
          availability: true,
          imageUrl: true,
          isPrimary: true,
          source: { select: { name: true } },
          variants: {
            orderBy: [{ sizeValue: "asc" }],
            select: {
              color: true,
              sizeValue: true,
              sizeSystem: true,
              availability: true,
              originalPrice: true,
              originalCurrency: true,
              canonicalSizeOptionId: true,
              sizeResolutionStatus: true,
              sizeResolutionProvenance: true,
              sizeResolutionSystem: true,
              purchaseUrl: true,
            },
          },
        },
      },
    },
  });

  if (!product) return null;

  const gallery: string[] = [];
  const pushGallery = (url: string | null | undefined) => {
    if (url && !gallery.includes(url)) gallery.push(url);
  };
  pushGallery(product.imageUrl);
  for (const offer of product.offers) pushGallery(offer.imageUrl);

  /* ==== Sizes (resolved / unresolved / not-backfilled, never collapsed) ==== */
  const sizeMap = new Map<string, ProductDetailSize>();
  const systemSet = new Set<SizeSystemId>();

  const recordSize = (
    label: string | null,
    system: string | null,
    state: SizeReadState,
    canonicalSizeOptionId: string | null,
    available: boolean,
    color: string | null
  ) => {
    if (!label) return;
    const key = [state, canonicalSizeOptionId ?? "", label, system ?? ""].join("|");
    const existing = sizeMap.get(key);
    if (existing) {
      existing.available = existing.available || available;
      if (color && !existing.colors.includes(color)) existing.colors.push(color);
    } else {
      sizeMap.set(key, {
        label,
        system,
        state,
        canonicalSizeOptionId,
        available,
        colors: color ? [color] : [],
      });
    }
    if (system && isSizeSystemId(system)) systemSet.add(system);
  };

  for (const variant of product.variants) {
    const size = projectVariantSize(variant);
    if (!size) continue;
    recordSize(
      size.value,
      size.system,
      size.state,
      size.canonicalSizeOptionId,
      variant.availability === "AVAILABLE",
      variant.color?.name ?? null
    );
  }

  for (const offer of product.offers) {
    for (const ov of offer.variants) {
      const chips = expandOfferSizeChips(ov.sizeValue);
      const chip = chips.length > 0 ? chips[0] : null;
      const size = projectOfferVariantSize(ov, chip, ov.sizeSystem ?? null);
      if (!size) continue;
      recordSize(
        size.value,
        size.system,
        size.state,
        size.canonicalSizeOptionId,
        ov.availability === "AVAILABLE",
        canonicalColorFromOffer(ov.color)
      );
    }
  }

  const sizes = [...sizeMap.values()];
  const resolvedCount = sizes.filter((s) => s.state === "RESOLVED").length;
  const unresolvedCount = sizes.filter((s) => s.state === "UNRESOLVED").length;
  const notBackfilledCount = sizes.filter(
    (s) => s.state === "NOT_BACKFILLED"
  ).length;

  /* ==== Offers / external source links ==== */
  const offers: ProductDetailOffer[] = product.offers.map((offer) => {
    const externalUrl =
      offer.sourceProductUrl || offer.purchaseUrl || product.productUrl;
    return {
      id: offer.id,
      sourceLabel: offer.source?.name ?? product.source?.name ?? "Source",
      externalListingId: offer.externalListingId,
      price: String(offer.originalPrice),
      currency: offer.originalCurrency,
      availability: offer.availability,
      externalUrl,
      hasRealPage: hasRealProductPage(externalUrl),
      isPrimary: offer.isPrimary,
    };
  });

  const productUrl = product.productUrl;
  const hasRealPage = hasRealProductPage(productUrl);

  /* ==== Size chart resolver (single source of truth) ==== */
  /* No real chart source exists yet, so the default source returns zero
     candidates and the resolver reports NO_CHART. A future importer
     plugs in through `options.chartSource`; nothing is fabricated. */
  const categoryPath = flattenCategoryPath(product.category);
  const leafCategoryName =
    product.category?.name ?? categoryPath[categoryPath.length - 1]?.name ?? null;
  const chartTarget: SizeChartTarget = {
    productId: product.id,
    brandId: product.brand?.id ?? null,
    category: sizeCategoryForName(leafCategoryName),
    context: {
      audience: (product.gender as SizeAudienceId | null) ?? "UNKNOWN",
      productType: productTypeForCategory(leafCategoryName),
      ageRange: null,
    },
    systems: [...systemSet],
  };
  const chart = await resolveChartsFromSource(
    options?.chartSource ?? EMPTY_SIZE_CHART_SOURCE,
    chartTarget
  );

  return {
    id: product.id,
    name: product.name,
    description: product.description,
    brand: product.brand,
    price: String(product.price),
    currency: product.currency,
    availability: product.availability,
    gender: product.gender,
    imageUrl: product.imageUrl ?? gallery[0] ?? null,
    gallery,
    sourceLabel: product.source?.name ?? "Source",
    productUrl,
    hasRealProductPage: hasRealPage,
    categoryPath,
    attributes: (product.attributes ?? []).map((a) => ({
      name: a.attribute.name,
      value: a.value,
    })),
    sizes,
    resolvedCount,
    unresolvedCount,
    notBackfilledCount,
    hasUnresolved: unresolvedCount > 0,
    offers,
    chart,
  };
}
