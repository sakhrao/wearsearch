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

let catalog: OutfitProduct[] = [];

function pickAnchor(cat: string, color?: string): OutfitProduct | null {
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

async function main() {
  catalog = await loadOutfitCatalog(prisma);
  const anchor = pickAnchor("sneakers", "white") ?? pickAnchor("sneakers");
  check("found WOMEN sneakers anchor", Boolean(anchor));
  if (!anchor) {
    console.log(`\noutfit-interactive: ${passed} passed, ${failed} failed (skip)`);
    process.exit(failed === 0 ? 0 : 1);
  }

  // ---- Not-my-style: exclude a product id from a replace ----
  const outfits = buildOutfits({ anchor, occasion: null, style: null, budget: null, products: catalog, rate: null });
  const look = outfits[0];
  check("built at least one look", Boolean(look) && look.items.length > 0);

  const replaceTarget: SlotName = (["bottom", "top", "layer", "footwear", "accessory"] as SlotName[]).find(
    (s) => look.items.some((it) => it.slot === s) && itSlots(look)[s] !== undefined
  ) as SlotName;

  if (replaceTarget) {
    // Baseline replace result id set.
    const baseRepl = replaceSlot({
      anchor, slot: replaceTarget, currentItems: look.items, products: catalog,
      occasion: null, style: null, budget: null, rate: null, max: 3,
    });
    const seenReplaced = new Set<string>();
    for (const r of baseRepl) {
      const picked = r.items.find((it) => it.slot === replaceTarget);
      if (picked) seenReplaced.add(picked.product.id);
    }
    check("baseline replace has >=1 variant", baseRepl.length >= 1);

    // Excluding one of the seen ids must remove it from the pool.
    const someSeen = [...seenReplaced][0];
    if (someSeen) {
      const excludedRepl = replaceSlot({
        anchor, slot: replaceTarget, currentItems: look.items, products: catalog,
        occasion: null, style: null, budget: null, rate: null, max: 3,
        excludeProductIds: [someSeen],
      });
      const stillThere = excludedRepl.some((r) =>
        r.items.some((it) => it.slot === replaceTarget && it.product.id === someSeen)
      );
      check("excluded (Not my style) id never re-picked", !stillThere);
    }
  }

  // ---- Add/Remove: locked products reconstruction in buildOutfits ----
  // Take one complete look, then rebuild with those items locked except
  // one slot; the removed slot must be re-filled by the builder.
  const full = outfits[0];
  const extras = full.items.filter((it) => it.product.id !== anchor.id);
  if (extras.length >= 1) {
    const locked = extras.slice(1).map((it) => it.product);
    const keptSlots = new Set(locked.map((lp) => slot(lp)));
    // The first extra becomes the "removed" slot.
    const removedSlot = extras[0].slot;
    if (!keptSlots.has(removedSlot) && locked.length > 0) {
      const rebuilt = buildOutfits({
        anchor, occasion: null, style: null, budget: null, products: catalog, rate: null,
        lockProducts: locked,
      });
      const rebuilt0 = rebuilt[0];
      check("locked rebuild returned a look", Boolean(rebuilt0));
      if (rebuilt0) {
        const removedRefilled = rebuilt0.items.some((it) => it.product.id !== anchor.id && it.slot === removedSlot);
        check("removed slot refilled around locked items", removedRefilled);
        // All locked items preserved verbatim.
        const lockedOk = locked.every((lp) => rebuilt0.items.some((it) => it.product.id === lp.id));
        check("all locked products preserved", lockedOk);
      }
    }
  }

  // ---- Budget remaining/over helpers ----
  const budget = 100;
  const budgeted = buildOutfits({ anchor, occasion: null, style: null, budget, products: catalog, rate: null });
  let anyWithin = false;
  for (const o of budgeted) {
    if (o.complete && o.totalPriceEur <= budget) anyWithin = true;
  }
  check("budgeted outfits respect hard cap", anyWithin || budgeted.length === 0);

  console.log(`\noutfit-interactive: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

function itSlots(look: { items: { slot: SlotName; product: { id: string } }[] }) {
  const m: Record<string, string> = {};
  for (const it of look.items) m[it.slot] = it.product.id;
  return m;
}
function slot(p: OutfitProduct): SlotName {
  const slug = p.category?.slug?.toLowerCase() ?? "";
  if (slug.includes("bottom") || slug.includes("pant") || slug.includes("trouser") || slug.includes("jean")) return "bottom";
  if (slug.includes("shoe") || slug.includes("sneaker") || slug.includes("boot")) return "footwear";
  if (slug.includes("layer") || slug.includes("jacket") || slug.includes("coat") || slug.includes("cardigan") || slug.includes("sweater")) return "layer";
  if (slug.includes("accessory") || slug.includes("bag") || slug.includes("scarf") || slug.includes("hat")) return "accessory";
  return "top";
}

main();
