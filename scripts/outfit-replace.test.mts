import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { loadOutfitCatalog } from "../src/lib/outfit/catalog";
import { buildOutfits, replaceSlot } from "../src/lib/outfit/outfit-builder";
import { hasRealProductPage } from "../src/lib/product-url";
import type { OutfitProduct, SlotName } from "../src/lib/outfit/types";

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

function womenAnchor(cat: string, color?: string): OutfitProduct | null {
  const matches = [...catalog].filter((p) => {
    if (!hasRealProductPage(p.productUrl)) return false;
    if (p.availability === "OUT_OF_STOCK") return false;
    if (!p.variants.some((v) => v.availability === "AVAILABLE")) return false;
    if (p.category?.slug?.toLowerCase() !== cat) return false;
    if (p.gender !== "WOMEN" && p.gender !== "UNISEX") return false;
    if (color) {
      return p.variants.some(
        (v) => v.availability === "AVAILABLE" && v.color?.name.toLowerCase() === color.toLowerCase()
      );
    }
    return true;
  }).sort((a, b) => (a.id < b.id ? -1 : 1));
  return matches[0] ?? null;
}

let catalog: OutfitProduct[] = [];
const TARGET_SLOT: SlotName = "bottom";

async function main() {
  catalog = await loadOutfitCatalog(prisma);
  const anchor = womenAnchor("sneakers", "white") ?? womenAnchor("sneakers");
  check("found WOMEN anchor", Boolean(anchor));
  if (!anchor) {
    console.log(`\noutfit-replace: ${passed} passed, ${failed} failed (skip)`);
    process.exit(failed === 0 ? 0 : 1);
  }

  const outfits = buildOutfits({ anchor, occasion: null, style: null, budget: null, products: catalog, rate: null });
  const look = outfits[0];
  check("built at least one look", Boolean(look) && look.items.length > 0);

  // The look must contain a bottom slot to replace.
  const hasTarget = look.items.some((it) => it.slot === TARGET_SLOT);
  check(`look has a ${TARGET_SLOT} slot to replace`, hasTarget);

  if (hasTarget) {
    const originals = look.items.filter((it) => it.slot !== TARGET_SLOT && it.product.id !== anchor.id);
    const replacements = replaceSlot({
      anchor,
      slot: TARGET_SLOT,
      currentItems: look.items,
      products: catalog,
      occasion: null,
      style: null,
      budget: null,
      rate: null,
      max: 3,
    });

    check("replace returns >=1 variant", replacements.length >= 1);

    for (let i = 0; i < replacements.length; i++) {
      const r = replacements[i];
      // Anchor always present.
      check(`replace ${i}: anchor present`, r.items.some((it) => it.product.id === anchor.id));
      // Every non-target slot id equals the original (locked).
      const origNonTarget = new Map(originals.map((it) => [it.slot, it.product.id]));
      let allLocked = true;
      for (const it of r.items) {
        if (it.product.id === anchor.id) continue;
        if (it.slot === TARGET_SLOT) continue;
        if (origNonTarget.get(it.slot) !== it.product.id) allLocked = false;
      }
      check(`replace ${i}: all other slots locked unchanged`, allLocked);
    }

    // Determinism for replace.
    const r1 = replaceSlot({ anchor, slot: TARGET_SLOT, currentItems: look.items, products: catalog, occasion: null, style: null, budget: null, rate: null, max: 2 });
    const r2 = replaceSlot({ anchor, slot: TARGET_SLOT, currentItems: look.items, products: catalog, occasion: null, style: null, budget: null, rate: null, max: 2 });
    const sig = (arr: string[]) => arr.join("|");
    check("replace is deterministic", sig(r1.map((x) => x.items.map((i) => i.product.id).join(","))) === sig(r2.map((x) => x.items.map((i) => i.product.id).join(","))));

    // Replacements only contain eligible products (real, avail, gender ok).
    for (const r of replacements) {
      for (const it of r.items) {
        check(`replace ${r.id} ${it.product.id} real page`, hasRealProductPage(it.product.productUrl));
        check(`replace ${r.id} ${it.product.id} not OOS`, it.product.availability !== "OUT_OF_STOCK");
        check(`replace ${r.id} ${it.product.id} avail variant`, it.product.variants.some((v) => v.availability === "AVAILABLE"));
        check(`replace ${r.id} ${it.product.id} WOMEN/UNISEX`, it.product.gender === "WOMEN" || it.product.gender === "UNISEX");
      }
    }
  }

  await prisma.$disconnect();
  console.log(`\noutfit-replace: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
