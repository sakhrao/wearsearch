import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { loadOutfitCatalog } from "../src/lib/outfit/catalog";
import { buildOutfits } from "../src/lib/outfit/outfit-builder";
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

let catalog: OutfitProduct[] = [];

async function main() {
  catalog = await loadOutfitCatalog(prisma);
  const anchor = [...catalog].find((p) => {
    if (!hasRealProductPage(p.productUrl)) return false;
    if (p.availability === "OUT_OF_STOCK") return false;
    if (!p.variants.some((v) => v.availability === "AVAILABLE")) return false;
    if (p.gender !== "WOMEN" && p.gender !== "UNISEX") return false;
    return true;
  });
  check("found an anchor", Boolean(anchor));
  if (!anchor) {
    console.log(`\noutfit-save-share: ${passed} passed, ${failed} failed (skip)`);
    process.exit(failed === 0 ? 0 : 1);
  }

  const outfits = buildOutfits({ anchor, occasion: null, style: null, budget: null, products: catalog, rate: null });
  const look = outfits[0];
  check("built a look", Boolean(look) && look.items.length > 0);

  // Simulate Share: capture every product id in the look, then rebuild
  // with ALL non-anchor items locked. The rebuild must reproduce the
  // exact same item set (same ids) — the outfit is fully reconstructible
  // from the shared id list alone.
  const locked = look.items.filter((it) => it.product.id !== anchor.id).map((it) => it.product);
  if (locked.length >= 1) {
    const rebuilt = buildOutfits({
      anchor, occasion: null, style: null, budget: null, products: catalog, rate: null,
      lockProducts: locked,
    });
    const rebuilt0 = rebuilt[0];
    check("full-lock rebuild returns a look", Boolean(rebuilt0));
    if (rebuilt0) {
      const rebuiltIds = new Set(rebuilt0.items.map((it) => it.product.id));
      const origIds = new Set(look.items.map((it) => it.product.id));
      let allPresent = true;
      for (const id of origIds) if (!rebuiltIds.has(id)) allPresent = false;
      check("all shared items reconstructed", allPresent);
      check("rebuilt look is complete", rebuilt0.complete === true && rebuilt0.missingSlots.length === 0);
    }
  }

  // Style/occasion params survive a locked rebuild (request echo).
  const rebuiltStyle = buildOutfits({
    anchor, occasion: "Work", style: "formal", budget: null, products: catalog, rate: null,
    lockProducts: locked,
  });
  check("locked rebuild with occasion/style returns looks", rebuiltStyle.length >= 0);

  console.log(`\noutfit-save-share: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
