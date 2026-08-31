import "dotenv/config";
import * as C from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/* Stage-2 Backfill (audit-approved plan).
   - audience: ONLY from Product.gender (MEN/WOMEN/UNISEX/KIDS).
   - productType: ONLY from the product category map proven by the audit.
   - system/value/category/normalizedValue: copied literally from the
     original row. No reinterpretation of US 35-45, no deletion.
   - Per provable (audience, productType) a contextual Size clone is
     upserted (unique: audience+productType+system+value); every variant
     is re-pointed to the clone of its own product. Gender-null products
     stay on the untouched UNKNOWN original row.
   - numericValue: pure-numeric values only. ordinal: canonical for alpha
     values actually present in the catalog; ascending rank for numeric.
   - Idempotent: re-running converges (upserts + deterministic ordinals).
   Modes:  scripts/backfill-size-context.mts        (backfill + verify)
           scripts/backfill-size-context.mts verify (verify only)      */

const MODE = process.argv[2] ?? "backfill";

const { PrismaClient } = C;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const SHOE_CATS = new Set([
  "Sneakers", "Formal Shoes", "Boots", "Loafers", "Sandals", "Heels", "Running Trainers",
]);
const NUMERIC = /^\d+(?:\.\d+)?$/;
const ALPHA_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "4XL", "5XL"];
const ALPHA_INDEX = new Map(ALPHA_ORDER.map((v, i) => [v, i]));

type Audience = "MEN" | "WOMEN" | "KIDS" | "UNISEX";
type ProductType = "FOOTWEAR" | "CLOTHING";

/* The pre-context catalog held exactly 40 Size rows (see audit). The
   backfill only ever ADDS context clones; the originals are never
   deleted or converted, so this stays the absolute invariant. */
const ORIGINAL_SIZE_COUNT = 40;

function audienceFor(gender: string | null): Audience | null {
  if (gender === "MEN" || gender === "WOMEN" || gender === "KIDS" || gender === "UNISEX") return gender;
  return null;
}
function productTypeFor(catName: string): ProductType {
  return SHOE_CATS.has(catName) ? "FOOTWEAR" : "CLOTHING";
}
function pairKey(p: { aud: Audience; pt: ProductType }): string {
  return `${p.aud}|${p.pt}`;
}

type SizeRef = { id: string; category: string; system: C.$Enums.SizeSystem; value: string; normalizedValue: string };
type VariantRef = { id: string; sizeId: string | null; gender: string | null; catName: string };

async function loadSizes(): Promise<SizeRef[]> {
  return prisma.size.findMany({
    select: { id: true, category: true, system: true, value: true, normalizedValue: true },
  });
}

async function loadVariants(): Promise<VariantRef[]> {
  const vs = await prisma.productVariant.findMany({
    select: {
      id: true,
      sizeId: true,
      product: { select: { gender: true, category: { select: { name: true } } } },
    },
  });
  return vs.map((v) => ({
    id: v.id,
    sizeId: v.sizeId,
    gender: v.product?.gender ?? null,
    catName: v.product?.category?.name ?? "",
  }));
}

async function snapshot() {
  const [sizeCount, productCount, variantCount, withSize, genders] = await Promise.all([
    prisma.size.count(),
    prisma.product.count(),
    prisma.productVariant.count(),
    prisma.productVariant.count({ where: { sizeId: { not: null } } }),
    prisma.product.groupBy({ by: ["gender"], _count: true }),
  ]);
  return { sizeCount, productCount, variantCount, withSize, genders };
}

function assert(cond: boolean, msg: string, extra = "") {
  if (!cond) {
    console.error(`FAIL: ${msg}${extra ? ` (${extra})` : ""}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${msg}`);
  }
}

async function backfill() {
  console.log("\n========== BACKFILL ==========");
  const sizes = await loadSizes();
  const variants = await loadVariants();
  const preSizeIds = new Set(sizes.map((s) => s.id));

  const byRow = new Map<string, Map<string, { aud: Audience; pt: ProductType; variantIds: string[] }>>();
  for (const v of variants) {
    if (!v.sizeId) continue;
    const aud = audienceFor(v.gender);
    if (!aud) continue;
    const pt = productTypeFor(v.catName);
    if (!byRow.has(v.sizeId)) byRow.set(v.sizeId, new Map());
    const m = byRow.get(v.sizeId)!;
    const key = pairKey({ aud, pt });
    const e = m.get(key) ?? { aud, pt, variantIds: [] as string[] };
    e.variantIds.push(v.id);
    m.set(key, e);
  }

  const targetByVariant = new Map<string, string>();
  let created = 0;

  for (const s of sizes) {
    const pairs = byRow.get(s.id);
    if (!pairs) continue;
    for (const { aud, pt, variantIds } of pairs.values()) {
      const where = {
        audience_productType_system_value: {
          audience: aud as C.$Enums.SizeAudience,
          productType: pt as C.$Enums.SizeProductType,
          system: s.system,
          value: s.value,
        },
      };
      const row = await prisma.size.upsert({
        where,
        update: { category: s.category, normalizedValue: s.normalizedValue },
        create: {
          category: s.category,
          system: s.system,
          value: s.value,
          normalizedValue: s.normalizedValue,
          audience: aud as C.$Enums.SizeAudience,
          productType: pt as C.$Enums.SizeProductType,
          numericValue: NUMERIC.test(s.value) ? parseFloat(s.value) : null,
        },
      });
      if (!preSizeIds.has(row.id)) created++;
      else if (row.numericValue !== (NUMERIC.test(s.value) ? parseFloat(s.value) : null)) {
        await prisma.size.update({ where: { id: row.id }, data: { numericValue: NUMERIC.test(s.value) ? parseFloat(s.value) : null } });
      }
      for (const vid of variantIds) targetByVariant.set(vid, row.id);
    }
  }

  const byTarget = new Map<string, string[]>();
  for (const [vid, tid] of targetByVariant) {
    byTarget.set(tid, [...(byTarget.get(tid) ?? []), vid]);
  }
  let repointed = 0;
  for (const [tid, vids] of byTarget) {
    const res = await prisma.productVariant.updateMany({ where: { id: { in: vids } }, data: { sizeId: tid } });
    repointed += res.count;
  }
  console.log(`context clones created=${created} | variants re-pointed=${repointed}`);

  /* numeric ordinals: ascending rank per (audience, productType, system) */
  const rows = await prisma.size.findMany({ select: { id: true, audience: true, productType: true, system: true, numericValue: true, value: true } });
  const numericGroups = new Map<string, { id: string; num: number; value: string }[]>();
  for (const r of rows) {
    if (r.audience === "UNKNOWN" || r.numericValue == null) continue;
    const k = `${r.audience}|${r.productType}|${r.system}`;
    numericGroups.set(k, [...(numericGroups.get(k) ?? []), { id: r.id, num: r.numericValue, value: r.value }]);
  }
  for (const list of numericGroups.values()) {
    list.sort((a, b) => a.num - b.num || a.value.localeCompare(b.value));
    for (let i = 0; i < list.length; i++) {
      await prisma.size.update({ where: { id: list[i].id }, data: { ordinal: i } });
    }
  }

  /* alpha canonical ordinals on context rows only (orphan/UNKNOWN untouched) */
  for (const r of rows) {
    if (r.audience === "UNKNOWN" || r.numericValue != null) continue;
    const idx = ALPHA_INDEX.get(r.value);
    if (idx == null) continue;
    await prisma.size.update({ where: { id: r.id }, data: { ordinal: idx } });
  }
}

async function verify(originalSizeCount: number, originalVariantCount: number) {
  console.log("\n========== VERIFY ==========");
  const sizes = await loadSizes();
  const variants = await loadVariants();
  const rows = await prisma.size.findMany({
    select: {
      id: true, category: true, system: true, value: true, normalizedValue: true,
      audience: true, productType: true, numericValue: true, ordinal: true,
    },
  });

  const ctxRows = rows.filter((r) => r.audience !== "UNKNOWN");
  const originals = rows.filter((r) => r.audience === "UNKNOWN" && r.productType === "UNKNOWN");
  assert(originals.length === originalSizeCount, `original rows untouched as UNKNOWN (${originals.length} == before ${originalSizeCount})`);
  assert(rows.length === originals.length + ctxRows.length, `Size rows partition into originals + context clones (${rows.length})`);

  const ctxById = new Map(ctxRows.map((r) => [r.id, r]));
  const tupleToId = new Map<string, string>();
  for (const r of rows) {
    const t = `${r.audience}|${r.productType}|${r.system}|${r.value}`;
    if (!tupleToId.has(t)) tupleToId.set(t, r.id);
  }
  let dupTuples = 0;
  const tupleSeen = new Map<string, number>();
  for (const r of rows) {
    const t = `${r.audience}|${r.productType}|${r.system}|${r.value}`;
    tupleSeen.set(t, (tupleSeen.get(t) ?? 0) + 1);
  }
  for (const [t, n] of tupleSeen) if (n > 1) { dupTuples++; console.log(`  dup tuple: ${t} x${n}`); }
  assert(dupTuples === 0, `every (audience, productType, system, value) is unique (dup=${dupTuples})`);

  /* no lost size + correct contextual pointer (oracle) */
  const sizeById = new Map(sizes.map((s) => [s.id, s]));
  const noSizeNow = 0; let lostRef = 0, wrongContext = 0, unknownPinOk = 0;
  for (const v of variants) {
    if (!v.sizeId) continue; // never had a size
    const s = sizeById.get(v.sizeId);
    if (!s) { lostRef++; continue; }
    const aud = audienceFor(v.gender);
    const pt = productTypeFor(v.catName);
    if (!aud) {
      const row = rows.find((r) => r.id === v.sizeId);
      if (row && row.audience === "UNKNOWN" && row.system === s.system && row.value === s.value) unknownPinOk++;
      else wrongContext++;
      continue;
    }
    const expectedId = tupleToId.get(`${aud}|${pt}|${s.system}|${s.value}`);
    if (!expectedId) { lostRef++; continue; }
    const row = ctxById.get(v.sizeId);
    if (v.sizeId !== expectedId || !row) wrongContext++;
    else if (row.audience !== aud || row.productType !== pt) wrongContext++;
  }
  assert(noSizeNow === 0, "no variant lost its Size");
  assert(lostRef === 0, `every deducible variant resolves to a contextual clone (lost=${lostRef})`);
  assert(wrongContext === 0, `no variant points at the wrong audience/system/value (wrong=${wrongContext})`);

  /* counts preserved (no variant deleted; sizes only added) */
  assert(originalVariantCount === variants.length, `variant count unchanged (${originalVariantCount} -> ${variants.length})`);

  /* orphans still present as UNKNOWN */
  const orphanChecks: [string, string][] = [["EU", "45"], ["US", "S"], ["US", "M"], ["US", "L"], ["US", "XL"]];
  for (const [sys, val] of orphanChecks) {
    assert(originals.some((r) => r.system === sys && r.value === val), `orphan shoes|${sys}|${val} still exists as UNKNOWN`);
  }

  /* scope: no invented domains */
  assert(ctxRows.every((r) => r.audience !== "KIDS"), "no KIDS rows created (no catalog evidence)");
  assert(ctxRows.every((r) => r.productType === "FOOTWEAR" || r.productType === "CLOTHING"), "productType only FOOTWEAR/CLOTHING");
  const sysSeen = new Set(originals.map((r) => r.system));
  assert(ctxRows.every((r) => sysSeen.has(r.system)), "context clones reuse existing systems only (no US/UK/IT/FR/WAIST invention)");

  /* numericValue only on pure-numeric */
  assert(ctxRows.every((r) => (r.numericValue != null) === NUMERIC.test(r.value)), "numericValue present iff value is pure-numeric");

  /* numeric ordinals ascending per group */
  const groups = new Map<string, { id: string; num: number; value: string; ord: number | null }[]>();
  for (const r of ctxRows) {
    if (r.numericValue == null) continue;
    const k = `${r.audience}|${r.productType}|${r.system}`;
    groups.set(k, [...(groups.get(k) ?? []), { id: r.id, num: r.numericValue, value: r.value, ord: r.ordinal }]);
  }
  let ordinalBad = 0;
  for (const [k, list] of groups) {
    list.sort((a, b) => a.num - b.num || a.value.localeCompare(b.value));
    list.forEach((e, i) => { if (e.ord !== i) { ordinalBad++; console.log(`  bad ordinal ${e.value} in ${k} got ${e.ord} want ${i}`); } });
  }
  assert(ordinalBad === 0, `numeric ordinals ascending per (audience, productType, system) (bad=${ordinalBad})`);

  /* alpha canonical ordinals on context rows */
  let alphaBad = 0;
  for (const r of ctxRows) {
    if (r.numericValue != null) continue;
    const idx = ALPHA_INDEX.get(r.value);
    if (idx == null) continue;
    if (r.ordinal !== idx) { alphaBad++; console.log(`  bad alpha ordinal ${r.value} got ${r.ordinal} want ${idx}`); }
  }
  assert(alphaBad === 0, `alpha ordinals are canonical on context rows (bad=${alphaBad})`);

  /* final mapping table */
  console.log("\n----- final contextual mapping (audience | productType | system -> values) -----");
  const mapping = new Map<string, { values: Set<string>; ordinals: Map<string, number | null> }>();
  for (const r of ctxRows) {
    const k = `${r.audience} | ${r.productType} | ${r.system}`;
    const e = mapping.get(k) ?? { values: new Set<string>(), ordinals: new Map() };
    e.values.add(r.value);
    e.ordinals.set(r.value, r.ordinal);
    mapping.set(k, e);
  }
  for (const [k, e] of [...mapping.entries()].sort()) {
    const sorted = [...e.values].sort((a, b) => {
      if (NUMERIC.test(a) && NUMERIC.test(b)) return parseFloat(a) - parseFloat(b);
      return a.localeCompare(b);
    });
    console.log(`${k}  ->  ${sorted.join(", ")}`);
  }
  void noSizeNow; void unknownPinOk; void sizeById; void tupleToId;
}

async function main() {
  const before = await snapshot();
  console.log("BEFORE:", JSON.stringify(before));

  if (MODE !== "verify") {
    await backfill();
  }

  const after = await snapshot();
  console.log("AFTER :", JSON.stringify(after));

  await verify(ORIGINAL_SIZE_COUNT, before.variantCount);
}

main()
  .catch((e) => {
    console.error("BACKFILL FAILED:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());