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
import {
  buildQuestionnaireCategories,
} from "../../../lib/catalog/category-display";

export const dynamic = "force-dynamic";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

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
      "meta-snapshot-v3",
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

        /* Questionnaire categories = CANONICAL taxonomy (import-plan,
           via category-display) merged with any legacy DB-only categories
           so that nothing currently offered disappears. Canonical wins on
           slug overlap (no duplicates); legacy rows are tagged source
           "legacy" with an additive root/subgroup so the client can render
           the hierarchy while still labelling size/detail by `group`. */
        /* Questionnaire categories = canonical taxonomy (import-plan, via
           category-display) merged with any legacy DB-only categories so
           nothing currently offered disappears. Canonical wins on slug
           overlap (no duplicates); legacy rows stay under a sensible root
           and are tagged source "legacy". */
        const dbRows = categories.map((category) => ({
          slug: category.slug,
          name: category.name,
          id: category.id,
          parentName: category.parent?.name ?? null,
        }));
        const questionnaireCategories =
          buildQuestionnaireCategories({
            dbRows,
            usedProductCategoryIds: usedIds,
          }).map((category) => ({
            name: category.name,
            slug: category.slug,
            group: category.group,
            parent: category.subgroup,
            root: category.root,
            subgroup: category.subgroup,
            source: category.source,
            hasProducts: category.hasProducts,
          }));

        return {
          categories: questionnaireCategories,
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

    return NextResponse.json(
      {
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
      },
      /* The questionnaire's categories/sizes depend on the canonical
         taxonomy and catalog dictionaries. Never let a browser
         heuristically cache an older /api/meta body (there is no
         Cache-Control by default, so a stale response could resurface
         long after a taxonomy/code change). no-store forces the exact
         request the clients make (fetch('/api/meta')) to always hit
         the server - the in-process memo already guarantees cheap,
         fresh recompute, so this is purely a correctness header. */
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Meta failed:", error);

    return NextResponse.json(
      { success: false, error: "Failed to load options" },
      { status: 500 }
    );
  }
}
