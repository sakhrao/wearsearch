import { NextResponse } from "next/server";

import { PrismaClient } from "../../../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  computeCatalogFingerprint,
  getCatalogMemo,
} from "../../../lib/catalog-memo";
import {
  buildSizeCatalog,
  categorizeSizeList,
  groupShoesBySystem,
  type ContextualSizeRow,
} from "../../../lib/sizes";
import { getFxRate } from "../../../lib/currency";

export const dynamic = "force-dynamic";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

/* Root accessory/headwear categories are stored as flat roots;
   map them onto the groups the questionnaire presents. */
const SLUG_TO_GROUP: Record<string, string> = {
  beanies: "Headwear",
  caps: "Headwear",
  hats: "Headwear",
  belts: "Accessories",
  sunglasses: "Accessories",
  ties: "Accessories",
  watches: "Accessories",
};

export async function GET() {
  try {
    const fx = await getFxRate();

    /* O2: the questionnaire dictionaries (categories/colors/sizes/
       brands/attributes + which categories stock products) are
       memoized against the catalog fingerprint, so /api/meta stops
       re-fetching them on every load without ever serving stale
       options after a catalog/dictionary change. */
    const fingerprint =
      await computeCatalogFingerprint(prisma);

    const snapshot = await getCatalogMemo(
      prisma,
      fingerprint,
      "meta-snapshot-v2",
      async () => {
        const [
          categories,
          colors,
          sizes,
          brands,
          productAttributes,
          sizeCatalogRows,
        ] = await Promise.all([
          prisma.category.findMany({
            select: {
              id: true,
              name: true,
              slug: true,
              parent: { select: { name: true } },
            },
            orderBy: { name: "asc" },
          }),

          prisma.color.findMany({
            select: { name: true },
            orderBy: { name: "asc" },
          }),

          prisma.size.findMany({
            select: {
              category: true,
              value: true,
              system: true,
            },
          }),

          prisma.brand.findMany({
            select: { name: true },
            orderBy: { name: "asc" },
          }),

          prisma.productAttribute.findMany({
            select: {
              value: true,
              attribute: { select: { name: true } },
            },
          }),

          /* Stage 3-A: the contextual questionnaire size catalog comes
             strictly from Product -> ProductVariant -> Size restricted
             to purchasable variants, so an option exists only when a
             buyable variant actually carries it (F8-A single source of
             truth). audience/productType/ordinal are the Size columns
             written by the Stage-2 backfill. */
          prisma.productVariant.findMany({
            where: {
              availability: "AVAILABLE",
              size: { isNot: null },
            },
            select: {
              product: {
                select: {
                  category: { select: { name: true } },
                },
              },
              size: {
                select: {
                  audience: true,
                  productType: true,
                  system: true,
                  value: true,
                  ordinal: true,
                },
              },
            },
          }),
        ]);

        const contextualRows: ContextualSizeRow[] = [];
        for (const { product, size } of sizeCatalogRows) {
          if (
            size &&
            size.audience !== "UNKNOWN" &&
            (size.productType === "CLOTHING" ||
              size.productType === "FOOTWEAR")
          ) {
            contextualRows.push({
              audience: size.audience,
              productType: size.productType,
              category: product.category.name,
              system: size.system,
              value: size.value,
              ordinal: size.ordinal,
            });
          }
        }

        const usedIds = new Set(
          (
            await prisma.product.findMany({
              select: { categoryId: true },
            })
          ).map((product) => product.categoryId)
        );

        const attributeCounts = new Map<
          string,
          Map<string, number>
        >();

        for (const item of productAttributes) {
          const groupName = item.attribute.name;
          const value = item.value;

          if (!value || value === "n/a") {
            continue;
          }

          let values =
            attributeCounts.get(groupName);
          if (!values) {
            values = new Map<string, number>();
            attributeCounts.set(groupName, values);
          }
          values.set(value, (values.get(value) ?? 0) + 1);
        }

        const attributeGroups: Record<
          string,
          string[]
        > = {};

        for (const [
          groupName,
          values,
        ] of attributeCounts) {
          attributeGroups[groupName] = [
            ...values.entries(),
          ]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([value]) => value);
        }

        const sizeCandidates = sizes.map((size) => ({
          category: size.category,
          value: size.value,
          system: size.system,
        }));

        return {
          categories: categories.map((category) => ({
            name: category.name,
            slug: category.slug,
            group:
              category.parent?.name ??
              SLUG_TO_GROUP[category.slug] ??
              category.name,
            parent: category.parent?.name ?? null,
            hasProducts: usedIds.has(
              category.id
            ),
          })),
          colors: colors.map((color) => color.name),
          sizes: [
            ...new Set(sizes.map((size) => size.value)),
          ],
          sizeGroups: categorizeSizeList(
            sizeCandidates
          ),
          shoeSizeGroups: groupShoesBySystem(
            sizeCandidates
          ),
          sizeCatalog: buildSizeCatalog(contextualRows),
          brands: brands.map((brand) => brand.name),
          attributeGroups,
        };
      }
    );

    return NextResponse.json({
      success: true,
      categories: snapshot.categories,
      colors: snapshot.colors,
      sizes: snapshot.sizes,
      sizeGroups: snapshot.sizeGroups,
      shoeSizeGroups: snapshot.shoeSizeGroups,
      sizeCatalog: snapshot.sizeCatalog,
      brands: snapshot.brands,
      attributeGroups: snapshot.attributeGroups,
      fx: {
        rate: fx.rate,
        asOf: fx.asOf,
        source: fx.source,
        from: "EUR",
        to: "USD",
      },
    });
  } catch (error) {
    console.error("Meta failed:", error);

    return NextResponse.json(
      { success: false, error: "Failed to load options" },
      { status: 500 }
    );
  }
}
