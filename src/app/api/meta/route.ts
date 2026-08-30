import { NextResponse } from "next/server";

import { PrismaClient } from "../../../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  computeCatalogFingerprint,
  getCatalogMemo,
} from "../../../lib/catalog-memo";
import { categorizeSizeList } from "../../../lib/sizes";
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
      "meta-snapshot",
      async () => {
        const [
          categories,
          colors,
          sizes,
          brands,
          productAttributes,
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
            select: { category: true, value: true },
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
        ]);

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
            sizes.map((size) => ({
              category: size.category,
              value: size.value,
            }))
          ),
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
