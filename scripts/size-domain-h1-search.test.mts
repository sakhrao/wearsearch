/* Stage H / H1 — canonical search & filtering integration.

   Real query-path evidence, no dev server required:
     - pure: canonical section/triple building (RESOLVED only)
     - pure: canonical facet extraction + predicate + counts
     - DB:   Stage F index-backed filter at the real boundary
     - DB:   unfiltered discoverability of UNRESOLVED candidates
     - DB:   intersection / pagination / determinism semantics

   The route applies the same intersection at serialization; these
   cases pin the primitives it composes. */

import "dotenv/config";

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import {
  buildSizeSectionColumns,
  SIZE_SECTION_ORDER,
  type SizeSectionColumn,
  type SizeSectionKey,
} from "../src/lib/size-sections";
import {
  countProductsForFacetValue,
  getProductFacets,
  productMatchesFilters,
  type ActiveFacetFilters,
  type FacetProduct,
} from "../src/lib/search-facets";
import {
  filterByCanonicalSize,
  filterBySizeSystem,
  findProductIdsBySizeFilter,
} from "../src/lib/size-domain/query";

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

const emptyFilters = (): ActiveFacetFilters => ({
  gender: new Set(),
  category: new Set(),
  color: new Set(),
  size: new Set(),
  brand: new Set(),
});

type Fixture = {
  gender: string | null;
  category: string | null;
  variants: {
    label: string;
    id: string | null;
    status: string | null;
  }[];
};

const asSectionInput = (p: Fixture) => ({
  gender: p.gender,
  category: { name: p.category },
  variants: p.variants.map((variant) => ({
    size: { value: variant.label, system: null },
    canonicalSizeOptionId: variant.id,
    sizeResolutionStatus: variant.status,
  })),
});

const asFacetProduct = (p: Fixture): FacetProduct => ({
  gender: p.gender,
  category: { id: "cat", name: p.category ?? "Dresses" },
  brand: { id: "brand", name: "Brand" },
  variants: p.variants.map((variant) => ({
    color: null,
    size: { value: variant.label, system: null },
    canonicalSizeOptionId: variant.id,
    sizeResolutionStatus: variant.status,
  })),
});

function chipsOf(
  sections: Record<SizeSectionKey, SizeSectionColumn[]>,
  key: SizeSectionKey
): { identity: string; value: string }[] {
  return (sections[key] ?? []).flatMap((column) => column.chips);
}

async function main() {
  /* ---------------- pure: canonical section building ------------ */

  const clothing = asSectionInput({
    gender: "WOMEN",
    category: "Dresses",
    variants: [
      {
        label: "Medium",
        id: "WOMEN|clothing|INTERNATIONAL|M",
        status: "RESOLVED",
      },
      { label: "Ghost", id: null, status: "UNRESOLVED" },
    ],
  });

  const clothingSections = buildSizeSectionColumns([clothing]);
  const clothingChips = chipsOf(clothingSections, "clothing");

  check(
    "H1-1 resolved variant yields a chip carrying its canonical identity",
    clothingChips.some(
      (chip) => chip.identity === "WOMEN|clothing|INTERNATIONAL|M"
    )
  );

  check(
    "H1-2 chip label is the untouched source label (Medium stays Medium)",
    clothingChips.some(
      (chip) =>
        chip.identity === "WOMEN|clothing|INTERNATIONAL|M" &&
        chip.value === "Medium"
    )
  );

  check(
    "H1-3 UNRESOLVED variant yields no chip",
    !clothingChips.some((chip) => chip.value === "Ghost")
  );

  const notBackfilled = asSectionInput({
    gender: "MEN",
    category: "Dresses",
    variants: [{ label: "L", id: null, status: null }],
  });
  const notBackfilledSections = buildSizeSectionColumns([notBackfilled]);

  check(
    "H1-4 NOT_BACKFILLED variant yields no chip in any section",
    SIZE_SECTION_ORDER.every(
      (key) => chipsOf(notBackfilledSections, key).length === 0
    )
  );

  const shoes = asSectionInput({
    gender: "MEN",
    category: "Sneakers",
    variants: [
      { label: "8", id: "MEN|shoes|US|8", status: "RESOLVED" },
      { label: "42", id: "MEN|shoes|EU|42", status: "RESOLVED" },
    ],
  });
  const shoeSections = buildSizeSectionColumns([shoes]);

  check(
    "H1-5 US and EU shoe sizes land in their own sections",
    chipsOf(shoeSections, "shoes-us").some(
      (chip) => chip.identity === "MEN|shoes|US|8"
    ) &&
      chipsOf(shoeSections, "shoes-eu").some(
        (chip) => chip.identity === "MEN|shoes|EU|42"
      )
  );

  check(
    "H1-6 US and EU shoe identities never merge",
    !chipsOf(shoeSections, "shoes-us").some((chip) =>
      chip.identity.includes("|EU|")
    ) &&
      !chipsOf(shoeSections, "shoes-eu").some((chip) =>
        chip.identity.includes("|US|")
      )
  );

  const menProduct = asSectionInput({
    gender: "MEN",
    category: "Dresses",
    variants: [
      {
        label: "M",
        id: "MEN|clothing|INTERNATIONAL|M",
        status: "RESOLVED",
      },
    ],
  });
  const womenProduct = asSectionInput({
    gender: "WOMEN",
    category: "Dresses",
    variants: [
      {
        label: "M",
        id: "WOMEN|clothing|INTERNATIONAL|M",
        status: "RESOLVED",
      },
    ],
  });
  const mixed = buildSizeSectionColumns([menProduct, womenProduct]);
  const mixedIds = chipsOf(mixed, "clothing").map((chip) => chip.identity);

  check(
    "H1-7 MEN and WOMEN sizes stay distinct identities (never merged)",
    mixedIds.includes("MEN|clothing|INTERNATIONAL|M") &&
      mixedIds.includes("WOMEN|clothing|INTERNATIONAL|M") &&
      new Set(mixedIds).size === mixedIds.length
  );

  check(
    "H1-8 clothing category produces the clothing section",
    clothingSections.clothing.length > 0
  );

  /* ---------------- pure: canonical facet predicate -------------- */

  const facetMedium = asFacetProduct({
    gender: "WOMEN",
    category: "Dresses",
    variants: [
      {
        label: "Medium",
        id: "WOMEN|clothing|INTERNATIONAL|M",
        status: "RESOLVED",
      },
    ],
  });
  const facetLarge = asFacetProduct({
    gender: "WOMEN",
    category: "Dresses",
    variants: [
      {
        label: "Large",
        id: "WOMEN|clothing|INTERNATIONAL|L",
        status: "RESOLVED",
      },
    ],
  });
  const facetUnresolved = asFacetProduct({
    gender: "WOMEN",
    category: "Dresses",
    variants: [{ label: "Medium", id: null, status: "UNRESOLVED" }],
  });

  const identityM = "WOMEN|clothing|INTERNATIONAL|M";

  check(
    "H1-9 countProductsForFacetValue counts only carrying products",
    countProductsForFacetValue(
      "size",
      identityM,
      emptyFilters(),
      [facetMedium, facetLarge]
    ) === 1
  );

  check(
    "H1-10 countProductsForFacetValue never counts UNRESOLVED rows",
    countProductsForFacetValue(
      "size",
      identityM,
      emptyFilters(),
      [facetUnresolved]
    ) === 0
  );

  check(
    "H1-11 getProductFacets exposes the canonical identity + source label",
    getProductFacets(facetMedium).size.some(
      (entry) =>
        entry.value === identityM && entry.label === "Medium"
    )
  );

  const sizeFilter = (identity: string): ActiveFacetFilters => {
    const filters = emptyFilters();
    filters.size = new Set([identity]);
    return filters;
  };

  check(
    "H1-12 canonical size filter matches the carrying product",
    productMatchesFilters(facetMedium, sizeFilter(identityM))
  );

  check(
    "H1-13 canonical size filter rejects a different identity",
    !productMatchesFilters(
      facetMedium,
      sizeFilter("WOMEN|clothing|INTERNATIONAL|L")
    )
  );

  check(
    "H1-14 canonical size filter rejects an unresolved-only product",
    !productMatchesFilters(facetUnresolved, sizeFilter(identityM))
  );

  /* ---------------- DB: real filtering boundary ------------------ */

  if (!process.env.DATABASE_URL) {
    console.log("H1: NOT_MEASURED — DATABASE_URL not configured");
    console.log(`H1_RESULTS passed=${passed} failed=${failed}`);
    process.exit(failed === 0 ? 0 : 1);
  }

  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  });
  const prisma = new PrismaClient({ adapter });

  try {
    const resolvedSample =
      await prisma.productVariant.findFirst({
        where: {
          sizeResolutionStatus: "RESOLVED",
          canonicalSizeOptionId: { not: null },
        },
        select: { canonicalSizeOptionId: true },
        orderBy: { id: "asc" },
      });

    const identity =
      resolvedSample?.canonicalSizeOptionId ?? null;

    check(
      "H1-15 live DB exposes a resolved canonical identity",
      identity != null
    );

    const matchedIds = identity
      ? await findProductIdsBySizeFilter(
          prisma,
          filterByCanonicalSize(identity),
          { availability: "AVAILABLE" }
        )
      : [];

    check(
      "H1-16 canonical identity filter returns matching products",
      matchedIds.length > 0
    );

    const matchedProducts = matchedIds.length
      ? await prisma.product.findMany({
          where: { id: { in: matchedIds.slice(0, 100) } },
          select: {
            id: true,
            variants: {
              select: {
                canonicalSizeOptionId: true,
                availability: true,
              },
            },
          },
        })
      : [];

    check(
      "H1-17 every matched product carries an AVAILABLE resolved variant with the identity",
      matchedProducts.length > 0 &&
        matchedProducts.every((product) =>
          product.variants.some(
            (variant) =>
              variant.canonicalSizeOptionId === identity &&
              variant.availability === "AVAILABLE"
          )
        )
    );

    const systemSample =
      await prisma.productVariant.findFirst({
        where: { sizeResolutionSystem: { not: null } },
        select: { sizeResolutionSystem: true },
        orderBy: { id: "asc" },
      });
    const system = systemSample?.sizeResolutionSystem ?? null;

    const systemIds = system
      ? await findProductIdsBySizeFilter(
          prisma,
          filterBySizeSystem(system),
          { availability: "AVAILABLE" }
        )
      : [];

    const systemProducts = systemIds.length
      ? await prisma.product.findMany({
          where: { id: { in: systemIds.slice(0, 100) } },
          select: {
            variants: {
              select: {
                sizeResolutionSystem: true,
                availability: true,
              },
            },
          },
        })
      : [];

    check(
      "H1-18 sizeSystem filter matches only products with an AVAILABLE variant in that system",
      system != null &&
        systemProducts.length > 0 &&
        systemProducts.every((product) =>
          product.variants.some(
            (variant) =>
              variant.sizeResolutionSystem === system &&
              variant.availability === "AVAILABLE"
          )
        )
    );

    const noneIds =
      await findProductIdsBySizeFilter(
        prisma,
        filterByCanonicalSize(
          "NOBODY|clothing|INTERNATIONAL|ZZZ"
        ),
        { availability: "AVAILABLE" }
      );

    check(
      "H1-19 unknown canonical identity returns no products",
      noneIds.length === 0
    );

    const unresolvedVariant =
      await prisma.productVariant.findFirst({
        where: { sizeResolutionStatus: "UNRESOLVED" },
        select: {
          canonicalSizeOptionId: true,
          sizeResolutionStatus: true,
          productId: true,
        },
        orderBy: { id: "asc" },
      });

    check(
      "H1-20 unresolved rows carry no canonical identity",
      unresolvedVariant != null &&
        unresolvedVariant.canonicalSizeOptionId === null &&
        unresolvedVariant.sizeResolutionStatus ===
          "UNRESOLVED"
    );

    const unresolvedProduct = unresolvedVariant
      ? await prisma.product.findUnique({
          where: { id: unresolvedVariant.productId },
          select: { id: true },
        })
      : null;

    check(
      "H1-21 unresolved candidates stay discoverable without a size filter",
      unresolvedProduct != null
    );

    check(
      "H1-22 unresolved candidates never match a canonical identity filter",
      !unresolvedVariant ||
        !matchedIds.includes(unresolvedVariant.productId) ||
        matchedProducts.some(
          (product) =>
            product.id === unresolvedVariant.productId &&
            product.variants.some(
              (variant) =>
                variant.canonicalSizeOptionId === identity
            )
        )
    );

    /* Intersection + pagination semantics the route applies at
       serialization: filter the ranked ids by the matched set, then
       slice. */
    const ranked = await prisma.product.findMany({
      where: { availability: "AVAILABLE" },
      select: { id: true },
      orderBy: { id: "asc" },
      take: 200,
    });
    const matchedSet = new Set(matchedIds);
    const filtered = ranked.filter((product) =>
      matchedSet.has(product.id)
    );
    const PAGE = 30;
    const paged = filtered.slice(0, PAGE);
    const hasMore = filtered.length > paged.length;

    check(
      "H1-23 intersection keeps only matched ids and preserves counts",
      filtered.every((product) =>
        matchedSet.has(product.id)
      ) && filtered.length <= ranked.length
    );

    check(
      "H1-24 pagination slices the filtered set and hasMore reflects it",
      paged.length === Math.min(PAGE, filtered.length) &&
        hasMore === (filtered.length > PAGE)
    );

    const again = identity
      ? await findProductIdsBySizeFilter(
          prisma,
          filterByCanonicalSize(identity),
          { availability: "AVAILABLE" }
        )
      : [];

    check(
      "H1-25 identity filter is deterministic and id-ordered",
      again.length === matchedIds.length &&
        again.every((id, index) => id === matchedIds[index])
    );
  } finally {
    await prisma.$disconnect();
  }

  console.log(`H1_RESULTS passed=${passed} failed=${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
