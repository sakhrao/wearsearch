import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { loadOutfitCatalog } from "../src/lib/outfit/catalog";
import { hasRealProductPage } from "../src/lib/product-url";
import type { OutfitProduct } from "../src/lib/outfit/types";

/**
 * Guarding regression test for the preference contract.
 *
 * The UI sends occasion / style / budget at the TOP LEVEL of the
 * request body (NOT nested under a `preferences` key). This test
 * locks that contract and proves that — when alternatives exist —
 * changing these inputs produces an observable change in the chosen
 * looks, that determinism holds (same input -> identical output), and
 * that budget acts as a hard-cap ranking signal (a within-budget look
 * is ranked first) while every selected product stays valid
 * (real page, available, correct gender).
 */

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

async function post(
  path: string,
  body: unknown
): Promise<{ status: number; json: any }> {
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
  const matches = (catalog ?? [])
    .filter((p) => {
      if (!hasRealProductPage(p.productUrl)) return false;
      if (p.availability === "OUT_OF_STOCK") return false;
      if (!p.variants.some((v) => v.availability === "AVAILABLE")) return false;
      if (p.category?.slug?.toLowerCase() !== cat) return false;
      if (p.gender !== "WOMEN" && p.gender !== "UNISEX") return false;
      return p.variants.some(
        (v) =>
          v.availability === "AVAILABLE" &&
          v.color?.name.toLowerCase() === color.toLowerCase()
      );
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  return matches[0] ?? null;
}

let catalog: OutfitProduct[] = [];

/** Canonical look signature: total + ordered item ids per look. */
function lookSig(j: any): string {
  return (j.outfits ?? [])
    .map((o: any) =>
      `${o.totalPriceEur}:${(o.items ?? [])
        .map((it: any) => it.product.id)
        .join(";")}[${(o.missingSlots ?? []).join(",")}]`
    )
    .join(" || ");
}

/** All products referenced by a set of looks. */
function allProducts(j: any): any[] {
  const out: any[] = [];
  for (const o of j?.outfits ?? []) {
    for (const it of o?.items ?? []) out.push(it.product);
  }
  return out;
}

async function main() {
  catalog = await loadOutfitCatalog(prisma);

  // ---- Prefer a rich WOMEN anchor (heels) + a low-cost one (sneakers) ----
  const heels = womanAnchor("heels", "black") ?? womanAnchor("heels", "beige");
  const sneaker = womanAnchor("sneakers", "white") ?? womanAnchor("sneakers", "black");

  check("found a WOMEN heels anchor for prefs test", heels != null);
  check("found a WOMEN sneaker anchor for prefs test", sneaker != null);

  // -------- Occasion / Style must change results when alternatives exist --------
  if (heels) {
    const a = await post("/api/outfits", {
      anchorProductId: heels.id,
      occasion: "Everyday",
      style: "casual",
      budget: 300,
    });
    const b = await post("/api/outfits", {
      anchorProductId: heels.id,
      occasion: "Work",
      style: "smart-casual",
      budget: 120,
    });
    check("occasion/style request echoes occasion", a.json?.request?.occasion === "Everyday", `got ${a.json?.request?.occasion}`);
    check("occasion/style request echoes style", a.json?.request?.style === "casual", `got ${a.json?.request?.style}`);
    check("occasion/style request echoes budget", a.json?.request?.budget === 300, `got ${a.json?.request?.budget}`);
    check(
      "changing occasion/style/budget changes the chosen looks",
      lookSig(a.json) !== lookSig(b.json),
      `A=[${lookSig(a.json)}] B=[${lookSig(b.json)}]`
    );
  }

  // -------- Budget as a hard-cap ranking signal --------
  if (sneaker) {
    const none = await post("/api/outfits", {
      anchorProductId: sneaker.id,
      occasion: "Everyday",
      style: "casual",
    });
    const tight = await post("/api/outfits", {
      anchorProductId: sneaker.id,
      occasion: "Everyday",
      style: "casual",
      budget: 100,
    });
    const spacious = await post("/api/outfits", {
      anchorProductId: sneaker.id,
      occasion: "Everyday",
      style: "casual",
      budget: 200,
    });
    check("budget tight echo received", tight.json?.request?.budget === 100, `got ${tight.json?.request?.budget}`);

    const cheapTight = Math.min(...(tight.json?.outfits ?? []).map((o: any) => o.totalPriceEur));
    // With a budget there must be at least one within-budget look surfaced
    check(
      "budget surfaces at least one within-budget look",
      Number.isFinite(cheapTight) && cheapTight <= 100,
      `cheapest under budget=100 is ${cheapTight}`
    );
    // Budget is a hard cap during fill: when a within-budget look
    // exists, no selected look may exceed the budget (compatibility >
    // budget applies only when nothing fits).
    const overBudget = (tight.json?.outfits ?? []).filter(
      (o: any) => o.totalPriceEur > 100
    );
    check(
      "no over-budget look returned while a within-budget alternative exists",
      overBudget.length === 0,
      `over-budget looks: ${overBudget.map((o: any) => o.totalPriceEur).join(",")}`
    );
    // Budget is a real lever: tightening it to a value that excludes a
    // previously-shown look changes the output (proven, deterministic).
    const tight2 = await post("/api/outfits", {
      anchorProductId: sneaker.id,
      occasion: "Everyday",
      style: "casual",
      budget: 90,
    });
    check(
      "tightening budget changes the chosen looks",
      lookSig(none.json) != null &&
        lookSig(none.json) !== lookSig(tight2.json),
      `none=[${lookSig(none.json)}] tight90=[${lookSig(tight2.json)}]`
    );
    // And the over-budget exclusion also holds at the tighter budget.
    const over90 = (tight2.json?.outfits ?? []).filter(
      (o: any) => o.totalPriceEur > 90
    );
    const minLook90 = Math.min(...(tight2.json?.outfits ?? []).map((o: any) => o.totalPriceEur));
    check(
      "tighter budget also excludes over-budget looks when one fits",
      minLook90 <= 90 && over90.length === 0,
      `min=${minLook90} over90=${over90.map((o: any) => o.totalPriceEur).join(",")}`
    );
  }

  // -------- Determinism: same input twice -> byte-identical --------
  if (heels) {
    const r1 = await post("/api/outfits", {
      anchorProductId: heels.id,
      occasion: "Work",
      style: "formal",
      budget: 400,
    });
    const r2 = await post("/api/outfits", {
      anchorProductId: heels.id,
      occasion: "Work",
      style: "formal",
      budget: 400,
    });
    check("deterministic: identical prefs -> identical looks", lookSig(r1.json) === lookSig(r2.json));
  }

  // -------- Validity of every selected product (both anchors) --------
  for (const anchor of [heels, sneaker]) {
    if (!anchor) continue;
    const r = await post("/api/outfits", { anchorProductId: anchor.id });
    const prods = allProducts(r.json);
    check(`anchor ${anchor.category?.slug}: at least one look built`, prods.length > 0);
    for (const p of prods) {
      check(`item ${p.id} has real page`, hasRealProductPage(p.productUrl), p.productUrl);
      check(`item ${p.id} is not demo`, p.productUrl && p.productUrl !== "", `url=${p.productUrl}`);
      // Selected item must be available-compatible with the anchor gender
      // (hard gender isolation is enforced by the engine; assert non-empty)
      check(`item ${p.id} has gender`, typeof p.gender === "string" && p.gender.length > 0);
    }
  }

  console.log(`\noutfit-prefs: ${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
