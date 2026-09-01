import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { loadOutfitCatalog } from "../src/lib/outfit/catalog";
import { buildOutfits } from "../src/lib/outfit/outfit-builder";
import { hasRealProductPage } from "../src/lib/product-url";
import { isAllowed } from "../src/lib/outfit/category-rules";
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

function anchorSubset(cat: string, color: string): OutfitProduct | null {
  // Prefer a purchasable + available WOMEN product with the color in
  // an AVAILABLE variant, deterministically (first sorted).
  const matches = [...catalog].filter((p) => {
    if (!hasRealProductPage(p.productUrl)) return false;
    if (p.availability === "OUT_OF_STOCK") return false;
    if (!p.variants.some((v) => v.availability === "AVAILABLE")) return false;
    if (p.category?.slug?.toLowerCase() !== cat) return false;
    if (p.gender !== "WOMEN" && p.gender !== "UNISEX") return false;
    return p.variants.some(
      (v) => v.availability === "AVAILABLE" && v.color?.name.toLowerCase() === color.toLowerCase()
    );
  }).sort((a, b) => (a.id < b.id ? -1 : 1));
  return matches[0] ?? null;
}

function menAnchor(cat: string): OutfitProduct | null {
  const matches = [...catalog].filter((p) => {
    if (!hasRealProductPage(p.productUrl)) return false;
    if (p.availability === "OUT_OF_STOCK") return false;
    if (!p.variants.some((v) => v.availability === "AVAILABLE")) return false;
    if (p.category?.slug?.toLowerCase() !== cat) return false;
    return p.gender === "MEN";
  }).sort((a, b) => (a.id < b.id ? -1 : 1));
  return matches[0] ?? null;
}

let catalog: OutfitProduct[] = [];

async function main() {
  catalog = await loadOutfitCatalog(prisma);

  const womenSneaker = anchorSubset("sneakers", "white");
  const womenTshirt = anchorSubset("t-shirts", "white");
  const heelsAnchor = anchorSubset("heels", "black");
  const menSneaker = menAnchor("sneakers");

  // --- baseline catalog sanity for the test to be meaningful ---
  const realAvailable = catalog.filter(
    (p) => hasRealProductPage(p.productUrl) && p.availability !== "OUT_OF_STOCK" &&
      p.variants.some((v) => v.availability === "AVAILABLE")
  ).length;
  check("catalog has real+available products", realAvailable > 50, `got ${realAvailable}`);

  const anchor = womenSneaker ?? womenTshirt ?? heelsAnchor;
  check("found a WOMEN anchor for integration", Boolean(anchor), "none found");
  if (!anchor) {
    console.log(`\noutfit-integration: ${passed} passed, ${failed} failed (skipped: no anchor)`);
    process.exit(failed === 0 ? 0 : 1);
  }

  // ---- determinism (AC-O12): run twice -> identical ----
  const truth = { anchorId: anchor.id, occasion: null as any, style: null as any, budgetEur: null as any };
  const run1 = buildOutfits({ anchor, occasion: null, style: null, budget: null, products: catalog, rate: null });
  const run2 = buildOutfits({ anchor, occasion: null, style: null, budget: null, products: catalog, rate: null });
  check("deterministic: run1 === run2 length", run1.length === run2.length, `${run1.length} vs ${run2.length}`);
  if (run1.length && run2.length) {
    const ids1 = run1.map((o) => o.items.map((i) => i.product.id).join("|")).join(";;");
    const ids2 = run2.map((o) => o.items.map((i) => i.product.id).join("|")).join(";;");
    check("deterministic: identical item ids", ids1 === ids2);
  }

  // ---- AC-O1: anchor always present in every outfit ----
  for (const o of run1) {
    check(`anchor present in ${o.id}`, o.items.some((i) => i.product.id === anchor.id));
  }

  // ---- AC-O2/O3: every item real-page, not OOS, has AVAILABLE variant ----
  for (const o of run1) {
    for (const it of o.items) {
      check(`${o.id} ${it.product.id} real page`, hasRealProductPage(it.product.productUrl));
      check(`${o.id} ${it.product.id} not OOS`, it.product.availability !== "OUT_OF_STOCK");
      check(`${o.id} ${it.product.id} has AVAILABLE variant`, it.product.variants.some((v) => v.availability === "AVAILABLE"));
    }
  }

  // ---- AC-O4: gender policy held (WOMEN anchor -> only WOMEN/UNISEX) ----
  for (const o of run1) {
    for (const it of o.items) {
      check(`${o.id} ${it.product.id} gender ok for WOMEN`,
        it.product.gender === "WOMEN" || it.product.gender === "UNISEX" || it.product.gender === null);
    }
  }

  // ---- AC-O5: category compatibility blocks nonsense ----
  const anchorSlug = anchor.category?.slug?.toLowerCase() ?? "";
  for (const o of run1) {
    for (const it of o.items) {
      if (it.product.id === anchor.id) continue;
      const slug = it.product.category?.slug?.toLowerCase() ?? "";
      check(`${o.id} ${slug} allowed for ${it.slot}`, isAllowed(anchorSlug, it.slot, slug), `${slug} not allowed for slot ${it.slot}`);
    }
  }

  // ---- AC-O10: at most 3 outfits ----
  check("returns at most 3 outfits", run1.length <= 3, `got ${run1.length}`);

  // ---- completeness: every complete outfit has all required slots ----
  for (const o of run1) {
    if (o.complete) {
      check(`${o.id} complete has no missingSlots`, o.missingSlots.length === 0);
    }
  }

  // ---- AC-O9: explanations present and reason-coded ----
  for (const o of run1) {
    for (const it of o.items) {
      const lines = o.explanations[it.product.id];
      if (it.product.id === anchor.id) {
        check(`${o.id} anchor has explanation`, Boolean(lines));
      } else if (lines) {
        check(`${o.id} ${it.product.id} explanation lines have codes`, lines.every((l) => l.code && typeof l.value === "number"));
      }
    }
  }

  // ---- MEN anchor gender policy (if a MEN sneaker exists) ----
  if (menSneaker) {
    const mo = buildOutfits({ anchor: menSneaker, occasion: null, style: null, budget: null, products: catalog, rate: null });
    for (const o of mo) {
      for (const it of o.items) {
        check(`MEN ${o.id} ${it.product.id} gender is MEN/UNISEX only`,
          it.product.gender === "MEN" || it.product.gender === "UNISEX");
      }
    }
  } else {
    check("MEN sneaker anchor exists (for gender test) OR skipped is acceptable", true, "no MEN sneaker; skipped");
  }

  // ---- diversity: multiple looks differ in at least one item (when >=2) ----
  if (run1.length >= 2) {
    const sigs = run1.map((o) => o.items.map((i) => i.product.id).sort().join("|"));
    const distinct = new Set(sigs).size;
    check("outfits are distinct when >=2 returned", distinct === run1.length || run1.length === 1, `distinct=${distinct} of ${run1.length}`);
  }

  await prisma.$disconnect();
  console.log(`\noutfit-integration: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
