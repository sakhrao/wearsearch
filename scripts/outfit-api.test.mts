import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { loadOutfitCatalog } from "../src/lib/outfit/catalog";
import { hasRealProductPage } from "../src/lib/product-url";
import type { OutfitProduct } from "../src/lib/outfit/types";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const BASE = process.env.OUTFIT_API_BASE ?? "http://localhost:3000";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra?: string): void {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL ${name}${extra ? " :: " + extra : ""}`);
  }
}

async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

function womanAnchor(cat: string, color: string): OutfitProduct | null {
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

let catalog: OutfitProduct[] = [];

async function main() {
  catalog = await loadOutfitCatalog(prisma);

  // ---- happy path: white WOMEN sneaker anchor ----
  const sneaker = womanAnchor("sneakers", "white") ?? womanAnchor("sneakers", "black");
  check("has a white/black WOMEN sneaker anchor", sneaker != null);
  if (!sneaker) {
    console.error("SKIP resting assertions: no WOMEN sneaker anchor in catalog");
  } else {
    const r = await post("/api/outfits", { anchorProductId: sneaker.id, budget: 250 });
    check("POST /api/outfits returns 200", r.status === 200, `got ${r.status}`);
    const j = r.json ?? {};
    check("anchor echoed with id", j.anchor?.id === sneaker.id);
    check("catalogVersion present", typeof j.catalogVersion === "string");
    check("outfits is array of 1..3", Array.isArray(j.outfits) && j.outfits.length >= 1 && j.outfits.length <= 3, `n=${j.outfits?.length}`);
    check("request echo present", j.request && "budget" in j.request);
    for (const o of j.outfits ?? []) {
      check("outfit has id", typeof o.id === "string");
      check("outfit has score number", typeof o.score === "number");
      check("outfit has totalPriceEur number", typeof o.totalPriceEur === "number");
      check("outfit has complete boolean", typeof o.complete === "boolean");
      check("outfit has missingSlots array", Array.isArray(o.missingSlots));
      check("outfit has items array", Array.isArray(o.items) && o.items.length >= 1);
      const anchorPresent = (o.items ?? []).some(
        (it: any) => it.product?.id === sneaker.id
      );
      check("anchor present in every look", anchorPresent);
      for (const it of o.items ?? []) {
        check("item has slot", typeof it.slot === "string");
        check("item has product.id", typeof it.product?.id === "string");
        check("item has product.name", typeof it.product?.name === "string");
        check("item has product.price string-numeric", typeof it.product?.price === "string" && Number.isFinite(Number(it.product?.price)));
        check("item has color", it.color != null && typeof it.color.name === "string");
        check("item explanations present on outfit", Array.isArray(o.explanations?.[it.product.id]));
      }
      if (o.complete) check("complete look has no missingSlots", o.missingSlots.length === 0);
      else check("incomplete look has missingSlots", o.missingSlots.length > 0);
    }
  }

  // ---- incomplete / missingSlots path: try anchors that cannot complete ----
  const hardAnchors = [
    womanAnchor("heels", "black"),
    womanAnchor("loafers", "black"),
  ].filter(Boolean);
  let sawIncomplete = false;
  for (const a of hardAnchors) {
    if (!a) continue;
    const r = await post("/api/outfits", { anchorProductId: a.id });
    if (r.status !== 200 || !Array.isArray(r.json?.outfits)) continue;
    const first = r.json.outfits[0];
    if (first && first.complete === false) {
      sawIncomplete = true;
      check("incomplete response carries missingSlots", Array.isArray(first.missingSlots) && first.missingSlots.length > 0);
      check("items exclude missing slots", (first.items ?? []).every((it: any) => !first.missingSlots.includes(it.slot)));
      break;
    }
  }
  if (!sawIncomplete) {
    console.warn("NOTE: none of probed anchors were incomplete via API; complete:false is content-dependent and covered by unit test outfit-insufficient.");
  }

  // ---- replace: only target slot changes, others locked ----
  if (sneaker) {
    const r = await post("/api/outfits", { anchorProductId: sneaker.id });
    const look = r.json?.outfits?.[0];
    if (look && look.items.length >= 2) {
      const top = look.items.find((it: any) => it.slot === "top");
      const bottom = look.items.find((it: any) => it.slot === "bottom");
      const target = bottom ?? top;
      if (target) {
        const locked = look.items
          .filter((it: any) => it.slot !== target.slot)
          .map((it: any) => it.product.id);
        const rr = await post("/api/outfits/replace", {
          anchorProductId: sneaker.id,
          slot: target.slot,
          lockedProductIds: locked,
        });
        check("replace returns 200", rr.status === 200, `got ${rr.status}`);
        const reps = rr.json?.outfits ?? [];
        check("replace returns 1..3 looks", reps.length >= 1 && reps.length <= 3, `n=${reps.length}`);
        for (const o of reps) {
          const t2 = (o.items ?? []).find((it: any) => it.slot === target.slot);
          check("replaced slot changed", t2 && t2.product.id !== target.product.id);
          for (const it of o.items ?? []) {
            if (it.slot === target.slot) continue;
            const was = look.items.find((li: any) => li.slot === it.slot);
            check("non-target slot locked", was && was.product.id === it.product.id, `slot=${it.slot}`);
          }
          const anchorStill = (o.items ?? []).some((it: any) => it.product.id === sneaker.id);
          check("anchor still present after replace", anchorStill);
        }
      }
    }
  }

  // ---- error contracts ----
  const noId = await post("/api/outfits", {});
  check("missing anchorProductId -> 400", noId.status === 400, `got ${noId.status}`);
  const unknown = await post("/api/outfits", { anchorProductId: "does-not-exist-xyz" });
  check("unknown anchor -> 404", unknown.status === 404, `got ${unknown.status}`);
  const badReplaceSlot = await post("/api/outfits/replace", {
    anchorProductId: sneaker?.id ?? "x",
    slot: "not-a-slot",
  });
  check("invalid replace slot -> 400", badReplaceSlot.status === 400, `got ${badReplaceSlot.status}`);

  console.log(`\noutfit-api: ${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
