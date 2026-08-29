import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  ATTRIBUTE_NAMES,
  LIVOSTYLE_TAG_MAP,
  attributesFromTags,
  writeProductAttributes,
} from "../src/lib/providers/attribute-enrichment";

const DATA_URL =
  "https://raw.githubusercontent.com/arturayupov/womens-fashion-catalog-open-data/master/data/products.json";

const TARGETS: Record<string, number> = {
  Sleeve: 342,
  Collar: 240,
  Fit: 110,
  Style: 486,
  Pattern: 235,
  Material: 24,
};

const applyMode = process.argv.includes("--apply");
if (applyMode) {
  console.log("⚡ APPLY MODE: attribute rows will be WRITTEN to the database");
} else {
  console.log("💤 DRY-RUN: no database writes will be performed");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const source = await prisma.source.findFirst({
  where: { name: "Livostyle Open Catalog" },
});
if (!source) throw new Error("Livostyle source not found");

const dbProducts = await prisma.product.findMany({
  where: { sourceId: source.id },
  select: { id: true, externalId: true },
});
const byHandle = new Map(
  dbProducts.map((p) => [p.externalId.replace(/^lv-/, ""), p])
);
console.log(`DB livostyle products = ${dbProducts.length}`);

const raw = (await (
  await fetch(DATA_URL)
).json()) as Array<{
  handle: string;
  title: string;
  tags?: string[];
}>;
const items = raw.filter((p) => byHandle.has(p.handle));
if (items.length !== dbProducts.length) {
  console.warn(`⚠ mismatch: raw=${items.length} db=${dbProducts.length}`);
}

const assigned = new Map<
  string,
  { title: string; tags: string[]; attributes: ReturnType<typeof attributesFromTags> }
>();
for (const item of items) {
  assigned.set(item.handle, {
    title: item.title,
    tags: (item.tags ?? []).map((t) => String(t).trim().toLowerCase()),
    attributes: attributesFromTags(item.tags ?? []),
  });
}

const allowedValues = new Set(
  Object.values(LIVOSTYLE_TAG_MAP).map((m) => m.value)
);

console.log("\n=== 1. COVERAGE vs TARGET (must be exact) ===");
let allPass = true;
for (const attr of ATTRIBUTE_NAMES) {
  const covered = [...assigned.values()].filter((a) =>
    a.attributes.some((x) => x.name === attr)
  ).length;
  const ok = covered === TARGETS[attr];
  if (!ok) allPass = false;
  console.log(
    `  ${ok ? "PASS" : "FAIL"} ${attr}: measured=${covered} target=${TARGETS[attr]}`
  );
}
const atLeastOne = [...assigned.values()].filter(
  (a) => a.attributes.length > 0
).length;
const atLeastTwo = [...assigned.values()].filter(
  (a) => a.attributes.length >= 2
).length;
console.log(
  `  products with >=1 attr: ${atLeastOne}  |  >=2 attrs: ${atLeastTwo}`
);
if (!allPass) console.log("  ❌ targets NOT met"); 

console.log("\n=== 2. VALUE DISTRIBUTION per attribute ===");
for (const attr of ATTRIBUTE_NAMES) {
  const dist: Record<string, number> = {};
  for (const a of assigned.values()) {
    for (const x of a.attributes) {
      if (x.name === attr) dist[x.value] = (dist[x.value] ?? 0) + 1;
    }
  }
  console.log(`  ${attr}: ${JSON.stringify(dist)}`);
}

console.log("\n=== 3. MANUAL REVIEW SAMPLE (2 products per attribute) ===");
for (const attr of ATTRIBUTE_NAMES) {
  let shown = 0;
  for (const a of assigned.values()) {
    const vals = a.attributes.filter((x) => x.name === attr).map((x) => x.value);
    if (vals.length === 0) continue;
    if (shown < 2) {
      console.log(
        `  [${attr}] ${a.title}\n      tags: ${a.tags.join(", ")}\n      assigned: ${vals.join(", ")}`
      );
    }
    shown += 1;
  }
}

console.log("\n=== 4. NEGATIVE CONTROLS ===");
const bannedMaterials =
  /^(cashmere|wool|silk|rayon|polyester|spandex|viscose|modal)$/i;
let bannedHits = 0;
for (const a of assigned.values()) {
  if (a.tags.some((t) => bannedMaterials.test(t))) bannedHits += 1;
}
console.log(
  `  products tagged with cashmere/wool/silk/rayon/polyester/spandex/viscose/modal: ${bannedHits} (must be 0)`
);
const offVocab = [...assigned.values()].filter((a) =>
  a.attributes.some((x) => !allowedValues.has(x.value))
);
console.log(
  `  assigned values outside the allow-list vocabulary: ${offVocab.length} (must be 0)`
);
const checked = [...assigned.values()].filter((a) =>
  a.attributes.some((x) => x.name === "Pattern" && x.value === "Checked")
).length;
console.log(
  `  Pattern=Checked coverage (query "checked" expected): ${checked} (target 4)`
);
const denotedMaterials = [...assigned.values()].filter((a) =>
  a.attributes.some((x) => x.name === "Material")
).length;
console.log(`  products with a Material value: ${denotedMaterials} (target 24)`);

if (applyMode) {
  console.log("\n=== 5. APPLYING ===");
  let writtenTotal = 0;
  for (const item of items) {
    const db = byHandle.get(item.handle)!;
    const attrs = attributesFromTags(item.tags ?? []);
    const { written } = await writeProductAttributes(prisma, db.id, attrs);
    writtenTotal += written;
  }
  console.log(`  attribute rows written: ${writtenTotal}`);

  const dbRows = await prisma.productAttribute.findMany({
    where: { product: { sourceId: source.id } },
    select: { productId: true, attribute: { select: { name: true } } },
  });
  const dbCoverage: Record<string, Set<string>> = {};
  for (const r of dbRows) {
    (dbCoverage[r.attribute.name] ??= new Set()).add(r.productId);
  }
  console.log("  DB distinct-product coverage after apply:");
  let verify = true;
  for (const attr of ATTRIBUTE_NAMES) {
    const n = dbCoverage[attr]?.size ?? 0;
    const ok = n === TARGETS[attr];
    if (!ok) verify = false;
    console.log(
      `    ${ok ? "PASS" : "FAIL"} ${attr}: products=${n} target=${TARGETS[attr]} (rows=${dbRows.filter((r) => r.attribute.name === attr).length})`
    );
  }
  if (!verify) process.exit(1);
} else {
  console.log("\n(apply skipped: run with --apply to write to the database)");
}

await prisma.$disconnect();
console.log("\n✅ backfill-f6 dry-run done");