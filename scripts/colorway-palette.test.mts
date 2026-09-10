/* Colourway palette-exactness integration test.

   Reproduction of the exact-match leak: an offer variant whose colour
   string is a colourway ("Black / White", "White / Black") must NEVER
   be treated as a pure-Black product. Such items are demoted to Similar
   for a plain "black" request (their palette is not a subset of the
   requested palette, spec §5) even though the display chip is "Black".

   Runs against the local dev server's /api/search. Seeds its own
   products, verifies membership, then removes them (cascade). The
   catalog only carries them during this script, so the pinned counts in
   the other suites are unaffected after cleanup. */

import { prisma } from "../src/lib/prisma";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name} :: ${detail}`);
  }
}

const SEARCH = "http://localhost:3000/api/search";

async function search(q: string) {
  const res = await fetch(`${SEARCH}?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

type Row = { id: string; name: string };



async function main() {
  const source = await prisma.source.findFirst();
  if (!source) {
    console.log("SKIP no Source row to attach the fixture under");
    process.exit(0);
  }

  let category = await prisma.category.findFirst({
    where: { name: "Sneakers" },
  });
  let createdCategory = false;
  if (!category) {
    category = await prisma.category.create({
      data: { name: "Sneakers", slug: "tmp-sneakers-fixture" },
    });
    createdCategory = true;
  }

  let brand = await prisma.brand.findFirst({
    where: { name: "Fixture Supply Co" },
  });
  let createdBrand = false;
  if (!brand) {
    brand = await prisma.brand.create({
      data: { name: "Fixture Supply Co", slug: "fixture-supply-co" },
    });
    createdBrand = true;
  }

  const productNames = [
    { id: "fixture-pure-black", name: "Fixture Pure Black Sneaker", offerColor: "Black" },
    { id: "fixture-black-white", name: "Fixture Black White Colorway Sneaker", offerColor: "Black / White" },
    { id: "fixture-white-black", name: "Fixture White Black Colorway Sneaker", offerColor: "White / Black" },
  ];

  const createdProductIds: string[] = [];
  for (const p of productNames) {
    const product = await prisma.product.create({
      data: {
        externalId: `${p.id}-ext`,
        name: p.name,
        slug: `${p.id}-slug`,
        description: null,
        price: 90.0,
        currency: "EUR",
        productUrl: `https://fixture-store.test-ok.com/itm/${p.id}`,
        imageUrl: null,
        gender: null,
        availability: "AVAILABLE",
        sourceId: source.id,
        brandId: brand.id,
        categoryId: category.id,
        offers: {
          create: [
            {
              sourceId: source.id,
              externalListingId: `${p.id}-listing`,
              externalTitle: p.name,
              sourceProductUrl: `https://fixture-store.test-ok.com/itm/${p.id}`,
              originalPrice: 90.0,
              originalCurrency: "EUR",
              normalizedEur: 90.0,
              availability: "AVAILABLE",
              variants: {
                create: [
                  {
                    variantKey: `fixture-key-${p.id}`,
                    color: p.offerColor,
                    sizeValue: "42",
                    sizeSystem: "EU",
                    availability: "AVAILABLE",
                    originalPrice: 90.0,
                    originalCurrency: "EUR",
                    normalizedEur: 90.0,
                  },
                ],
              },
            },
          ],
        },
      },
    });
    createdProductIds.push(product.id);
  }

  try {
    const r = await search("black sneaker");
    const exact = (r.exactProducts ?? []) as Row[];
    const similar = (r.similarProducts ?? []) as Row[];

    check(
      "fixture pure-Black sneaker is Exact",
      exact.some((p) => p.name.includes("Fixture Pure Black")),
      `exact=${exact.map((p) => p.name).join(" | ")}`
    );
    check(
      "Black / White colourway is absent from Exact",
      !exact.some((p) => p.name.includes("Black White Colorway")),
      `exact=${exact.map((p) => p.name).join(" | ")}`
    );
    check(
      "White / Black colourway is absent from Exact",
      !exact.some((p) => p.name.includes("White Black Colorway")),
      `exact=${exact.map((p) => p.name).join(" | ")}`
    );
    check(
      "Black / White colourway is demoted to Similar",
      similar.some((p) => p.name.includes("Black White Colorway")),
      `similar=${similar.map((p) => p.name).join(" | ")}`
    );
    check(
      "White / Black colourway is demoted to Similar",
      similar.some((p) => p.name.includes("White Black Colorway")),
      `similar=${similar.map((p) => p.name).join(" | ")}`
    );

    const debug = await search("black sneaker&debug=1");
    const dbgExact = (debug.exactProducts ?? []) as Row[];
    const dbgSimilar = (debug.similarProducts ?? []) as Row[];
    const projection = [
      (debug.structuredQuery ?? {}).category,
      (debug.structuredQuery ?? {}).color,
    ].join("|");
    check(
      "structured query still resolves category + colour",
      projection === "Sneakers|Black",
      `struct=${projection}`
    );
    check(
      "Exact membership identical with and without debug",
      dbgExact.some((p) => p.name.includes("Fixture Pure Black")) &&
        !dbgExact.some((p) => p.name.includes("Colorway")) &&
        dbgSimilar.some((p) => p.name.includes("Black White Colorway")) &&
        dbgSimilar.some((p) => p.name.includes("White Black Colorway")),
      `dbgExact=${dbgExact.map((p) => p.name).join(" | ")} dbgSim=${dbgSimilar.map((p) => p.name).join(" | ")}`
    );
  } finally {
    await prisma.product.deleteMany({
      where: { id: { in: createdProductIds } },
    });
    if (createdCategory) {
      await prisma.category.deleteMany({ where: { id: category.id } });
    }
    if (createdBrand) {
      await prisma.brand.deleteMany({ where: { id: brand.id } });
    }
    await prisma.$disconnect();
  }

  console.log(`\n=== RESULT: ${passed}/${passed + failed} passed ===`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});