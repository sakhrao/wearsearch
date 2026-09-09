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
  type SizeCandidate,
} from "../../../lib/sizes";
import {
  getFxRate,
  normalizePriceToEur,
  roundMoney,
} from "../../../lib/currency";
import {
  buildQuestionnaireCategories,
  genderCompatibilityFor,
  type CategoryGender,
} from "../../../lib/catalog/category-display";
import {
  canonicalColorFromOffer,
  expandOfferSizeChips,
} from "../../../lib/catalog/offer-vocab";
import { semanticSizeRowsFor } from "../../../lib/catalog/size-vocabulary";

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
      "meta-snapshot-v4",
      async () => {
        const [
          categories,
          colors,
          sizes,
          brands,
          productAttributes,
          sizeCatalogRows,
          offerColorRows,
          offerSizeRows,
          productGenderRows,
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

          /* Phase-0: a Phase-0 catalog (eBay etc.) has NO Color/Size/
             ProductVariant rows, but its ProductOfferVariant lines DO
             carry the real sellable colors/sizes. Those values are the
             questionnaire's source of truth for such catalogs, so the
             option surfaces merge them instead of going empty. The
             offer rows are never reinterpreted: colors collapse through
             the shared canonical fold and sizes through the shared
             size chip expander (same helpers /api/search uses). */
          prisma.productOfferVariant.findMany({
            where: {
              availability: "AVAILABLE",
              color: { not: null },
            },
            select: { color: true },
          }),

          prisma.productOfferVariant.findMany({
            where: {
              availability: "AVAILABLE",
              sizeValue: { not: null },
            },
            select: {
              sizeValue: true,
              sizeSystem: true,
              offer: {
                select: {
                  product: {
                    select: {
                      gender: true,
                      category: {
                        select: { slug: true, name: true },
                      },
                    },
                  },
                },
              },
            },
          }),

          /* Live Product.gender per category slug: the real stock
             signal that fills KIDS and verifies UNISEX for the
             gender-aware category filter. The same rows carry the
             product price so the budget step can size its sliders
             against the priciest stocked product per category. */
          prisma.product.findMany({
            select: {
              gender: true,
              price: true,
              currency: true,
              availability: true,
              category: {
                select: { slug: true, name: true },
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
        })) as SizeCandidate[];

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
          });

        /* category root -> size discipline (Shoes -> footwear, the rest
           -> clothing) comes from the SAME canonical display logic the
           questionnaire renders, so the offer size options are labelled
           by the taxonomy, never guessed. */
        const rootSlugBySlug = new Map<string, string>();
        for (const category of questionnaireCategories) {
          rootSlugBySlug.set(category.slug, category.rootSlug);
        }

        const normalizeAudience = (
          raw: string
        ): CategoryGender | null => {
          const value = raw.trim().toUpperCase();
          return (
            ["MEN", "WOMEN", "KIDS", "UNISEX"] as const
          ).includes(value as CategoryGender)
            ? (value as CategoryGender)
            : null;
        };

        /* Live Product.gender per category slug: the real stock signal
           that fills KIDS and verifies UNISEX for the gender filter. */
        const productGendersBySlug = new Map<
          string,
          Set<CategoryGender>
        >();
        for (const row of productGenderRows) {
          const slug = row.category?.slug;
          if (!slug) continue;
          const audience = normalizeAudience(
            String(row.gender ?? "")
          );
          if (!audience) continue;
          let set = productGendersBySlug.get(slug);
          if (!set) {
            set = new Set<CategoryGender>();
            productGendersBySlug.set(slug, set);
          }
          set.add(audience);
        }

        /* Merged gender compatibility per category: the declared
           canonical audience (inventory-independent) + data-driven
           KIDS; legacy rows stay inventory-first. Reused by the
           response and by the semantic size rows below. */
        const gendersBySlug = new Map<
          string,
          CategoryGender[]
        >();
        for (const category of questionnaireCategories) {
          gendersBySlug.set(
            category.slug,
            genderCompatibilityFor({
              slug: category.slug,
              source: category.source,
              productGenders:
                productGendersBySlug.get(category.slug) ??
                new Set<CategoryGender>(),
            })
          );
        }

        /* Phase-0 offer colors: real sellable colors from
           ProductOfferVariant collapse through the shared canonical
           fold (same chips /api/search detects and matches). */
        const offerColorCounts = new Map<string, number>();
        for (const row of offerColorRows) {
          const canonical = canonicalColorFromOffer(row.color);
          if (!canonical) continue;
          offerColorCounts.set(
            canonical,
            (offerColorCounts.get(canonical) ?? 0) + 1
          );
        }

        const mergedColors = [
          ...new Set([
            ...colors.map((color) => color.name),
            ...[...offerColorCounts.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([name]) => name),
          ]),
        ].sort((a, b) => a.localeCompare(b));

        /* Raw per-product price rows (kept currency-native). The route
           normalizes them to the EUR reference per request so the max
           always tracks the CURRENT fx rate, never a rate frozen in
           the memo. */
        const productPriceRows = productGenderRows.map((row) => ({
          name: row.category?.name ?? "",
          price: String(row.price),
          currency: row.currency,
          availability: row.availability,
        }));

        /* Phase-0 offer sizes: real sellable size chips, expanded to
           their canonical members (M/L from "S/M L/XL 2XL/3XL", 6..12
           from "6-12"), contextualised by the product's own gender and
           the canonical root discipline. */
        for (const row of offerSizeRows) {
          const categorySlug = row.offer.product.category?.slug;
          const categoryName =
            row.offer.product.category?.name;
          if (!categorySlug || !categoryName) continue;
          const rootSlug = rootSlugBySlug.get(categorySlug);
          if (!rootSlug) continue;
          const isFootwear = rootSlug === "shoes";
          const chips = expandOfferSizeChips(
            String(row.sizeValue ?? "")
          );
          if (chips.length === 0) continue;

          sizeCandidates.push(
            ...chips.map((value) => ({
              category: isFootwear ? "shoes" : "clothing",
              value,
              system: String(row.sizeSystem ?? "") || undefined,
            }))
          );

          const audience = normalizeAudience(
            String(row.offer.product.gender ?? "")
          );
          if (!audience) continue;
          for (const chip of chips) {
            contextualRows.push({
              audience,
              productType: isFootwear
                ? "FOOTWEAR"
                : "CLOTHING",
              category: categoryName,
              system: row.sizeSystem ?? null,
              value: chip,
              ordinal: null,
            });
          }
        }

        /* Semantic size vocabulary: the questionnaire size step covers
           EVERY category with its standard sizes, independent of live
           stock (Bras -> bra sizes, shoes -> EU/US/UK, accessories ->
           One Size, clothing -> letters). Rows come from the shared
           taxonomy shape + merged gender compatibility, never from
           inventory emptiness. Picking a size with no matching product
           is honest: the search matches real inventory and the results
           surface a zero-match state instead of inventing availability.
           KIDS rows are deliberately data-driven only (no invented
           kids scale), so kids contexts keep working off real stock. */
        for (const category of questionnaireCategories) {
          const genders = gendersBySlug.get(
            category.slug
          ) ?? [];
          if (genders.length === 0) continue;
          const viewableGenders = genders.filter(
            (gender) =>
              gender === "MEN" || gender === "WOMEN"
          );
          if (viewableGenders.length === 0) continue;
          contextualRows.push(
            ...semanticSizeRowsFor(
              {
                slug: category.slug,
                name: category.name,
                rootSlug: category.rootSlug,
                group: category.group,
              },
              viewableGenders
            )
          );
        }

        return {
          categories: questionnaireCategories.map(
            (category) => ({
              name: category.name,
              slug: category.slug,
              group: category.group,
              parent: category.subgroup,
              root: category.root,
              subgroup: category.subgroup,
              source: category.source,
              hasProducts: category.hasProducts,
              genders: gendersBySlug.get(category.slug) ?? [],
            })
          ),
          colors: mergedColors,
          sizes: [
            ...new Set([
              ...sizes.map((size) => size.value),
              ...sizeCandidates.map((size) => size.value),
            ]),
          ].sort((a, b) => {
            const na = parseFloat(a);
            const nb = parseFloat(b);
            if (Number.isFinite(na) && Number.isFinite(nb)) {
              return na - nb || a.localeCompare(b);
            }
            return a.localeCompare(b);
          }),
          sizeGroups: categorizeSizeList(
            sizeCandidates
          ),
          shoeSizeGroups: groupShoesBySystem(
            sizeCandidates
          ),
          sizeCatalog: buildSizeCatalog(contextualRows),
          brands: brands.map((brand) => brand.name),
          attributeGroups,
          productPriceRows,
        };
      }
    );

    /* Highest stocked price per category in the EUR reference
       (computed per request against the live fx rate; product rows
       themselves are memoized, the conversion is not). */
    const priceMaxEurByCategory: Record<string, number> = {};
    for (const row of snapshot.productPriceRows) {
      if (row.availability !== "AVAILABLE") {
        continue;
      }
      const normalized = normalizePriceToEur(
        Number(row.price),
        row.currency,
        fx.rate
      );
      if (
        !Number.isFinite(normalized) ||
        normalized <= 0
      ) {
        continue;
      }
      const previous =
        priceMaxEurByCategory[row.name] ?? -Infinity;
      if (normalized > previous) {
        priceMaxEurByCategory[row.name] = roundMoney(
          normalized
        );
      }
    }

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
        priceMaxEurByCategory,
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
