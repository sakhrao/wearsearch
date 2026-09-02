import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { loadOutfitCatalog } from "../src/lib/outfit/catalog";
import { buildOutfits } from "../src/lib/outfit/outfit-builder";
import { evalSize, sizeMatchScore } from "../src/lib/outfit/outfit-size";
import { hasRealProductPage } from "../src/lib/product-url";
import type { OutfitProduct } from "../src/lib/outfit/types";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra?: string): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL ${name}${extra ? " :: " + extra : ""}`);
  }
}

/* Build a synthetic product snapshot so the matcher is tested against
   controlled variant size data (no dependency on live catalog). */
function fakeProduct(variants: OutfitProduct["variants"]): OutfitProduct {
  return {
    id: "p-" + Math.random().toString(36).slice(2, 8),
    sourceId: "s",
    externalId: "e",
    brandId: "b",
    categoryId: "c",
    name: "Fake",
    slug: "fake",
    price: "10",
    currency: "EUR",
    productUrl: "https://fake.test/p",
    imageUrl: null,
    gender: "UNISEX",
    variants,
    category: { slug: "tops", name: "Tops" },
    attributes: [],
  } as unknown as OutfitProduct;
}

function v(
  availability: string,
  sizeValue: string,
  system = "EU"
): OutfitProduct["variants"][number] {
  return {
    price: "10",
    currency: "EUR",
    availability,
    color: { name: "Black", hex: "#000000" },
    size: { system, value: sizeValue, normalizedValue: sizeValue, productType: "CLOTHING" },
  };
}

function main() {
  // 1. No preference -> neutral no-data (regardless of sizes present).
  const withSizes = fakeProduct([v("AVAILABLE", "M"), v("AVAILABLE", "L")]);
  check("no preference is neutral", evalSize(withSizes, null).match === "no-data");
  check("no-data score 0.5", sizeMatchScore("no-data") === 0.5);

  // 2. Exact available match ranks max.
  const exactAvail = evalSize(withSizes, { value: "M" });
  check("exact available match", exactAvail.match === "exact-available");
  check("exact-available score 1", exactAvail.score === 1);

  // 3. Exact size exists but none available -> exact-any (0.7).
  const onlyUnavailable = fakeProduct([v("OUT_OF_STOCK", "M"), v("AVAILABLE", "L")]);
  check(
    "unavailable exact size is not recommended over available one",
    evalSize(onlyUnavailable, { value: "M" }).match === "exact-any"
  );

  // 4. Numeric same-magnitude equivalence (different system not conflated).
  const numeric = fakeProduct([v("AVAILABLE", "42", "EU")]);
  const sameMagnitude = evalSize(numeric, { value: "42", productType: "FOOTWEAR" });
  check("numeric same-magnitude match", sameMagnitude.match === "exact-available" || sameMagnitude.match === "equivalent-available");
  check("numeric match scores > none", sameMagnitude.score > 0.2);

  // 5. No size data product -> graceful fallback, never hard-empties.
  const noData = fakeProduct([v("AVAILABLE", "M")]);
  const stripped: OutfitProduct = {
    ...noData,
    variants: [{ price: "10", currency: "EUR", availability: "AVAILABLE", color: null, size: null }],
  } as OutfitProduct;
  check("missing size data falls back gracefully", evalSize(stripped, { value: "M" }).match === "no-data");

  // 6. No match at all (product has sizes, none match) -> none (low score).
  const different = fakeProduct([v("AVAILABLE", "XL")]);
  check("no matching size scores low but present", evalSize(different, { value: "S" }).match === "none");
  check("none score 0.2", sizeMatchScore("none") === 0.2);

  console.log(`\noutfit-size: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
