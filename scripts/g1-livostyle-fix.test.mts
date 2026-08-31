import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  normalizeSize,
  livostyleProvider,
} from "../src/lib/providers/livostyle";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail: string) {
  if (cond) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name} :: ${detail}`);
  }
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
  }),
});

/* ---- AC-S1 / S2 / S4 / S5 : literal parsing, no conversion ---- */

check(
  "AC-S1 35(US4) -> EU 35 + US 4",
  JSON.stringify(normalizeSize("35(US4)", true)) ===
    JSON.stringify([
      { value: "35", system: "EU" },
      { value: "4", system: "US" },
    ]),
  JSON.stringify(normalizeSize("35(US4)", true))
);

check(
  "AC-S2 42(US10.5) -> EU 42 + US 10.5",
  JSON.stringify(normalizeSize("42(US10.5)", true)) ===
    JSON.stringify([
      { value: "42", system: "EU" },
      { value: "10.5", system: "US" },
    ]),
  JSON.stringify(normalizeSize("42(US10.5)", true))
);

check(
  "AC-S4 no conversion: 36(US5) kept literal (not 5/36 derived)",
  normalizeSize("36(US5)", true).every(
    (s) => (s.system === "EU" && s.value === "36") || (s.system === "US" && s.value === "5")
  ),
  JSON.stringify(normalizeSize("36(US5)", true))
);

check(
  "AC-S5 bare '6' is UNKNOWN (never inferred as US or EU)",
  JSON.stringify(normalizeSize("6", true)) ===
    JSON.stringify([{ value: "6", system: "UNKNOWN" }]),
  JSON.stringify(normalizeSize("6", true))
);

check(
  "AC-S5 bare '7.5' is UNKNOWN (never inferred as US or EU)",
  JSON.stringify(normalizeSize("7.5", true)) ===
    JSON.stringify([{ value: "7.5", system: "UNKNOWN" }]),
  JSON.stringify(normalizeSize("7.5", true))
);

check(
  "AC-S5 letters stay INTERNATIONAL and non-shoes unaffected",
  JSON.stringify(normalizeSize("M", true)) ===
    JSON.stringify([{ value: "M", system: "INTERNATIONAL" }]) &&
    JSON.stringify(normalizeSize("S", false)) ===
      JSON.stringify([{ value: "S", system: "INTERNATIONAL" }]),
  JSON.stringify([normalizeSize("M", true), normalizeSize("S", false)])
);

/* ---- AC-S3 : after fresh sync, the real Group-1 products keep both
   systems with no value loss, via the live provider output ---- */

const result = await livostyleProvider.fetchUnified();
const byHandle = new Map<string, typeof result.products[number]>();
for (const p of result.products) byHandle.set(p.externalId.replace(/^lv-/, ""), p);

/* full EU+US run for the widest Group-1 product from the audit */
const widest = byHandle.get("toe-loop-pu-leather-flats-sandals");
check(
  "AC-S3 widest Group-1 product present in provider output",
  !!widest,
  "missing toe-loop-pu-leather-flats-sandals"
);
if (widest) {
  const eu = [...new Set(
    widest.variants
      ?.filter((v) => v.sizeSystem === "EU")
      .map((v) => v.size as string) ?? []
  )];
  const us = [...new Set(
    widest.variants
      ?.filter((v) => v.sizeSystem === "US")
      .map((v) => v.size as string) ?? []
  )];
  check(
    "AC-S3 EU 35..45 all preserved with no loss",
    JSON.stringify(eu) === JSON.stringify(["35","36","37","38","39","40","41","42","43","44","45"]),
    `eu=${JSON.stringify(eu)}`
  );
  check(
    "AC-S3 US 4..12.5 all preserved with no loss",
    JSON.stringify(us) === JSON.stringify(["4","5","6","7","8","9","10","10.5","11","12","12.5"]),
    `us=${JSON.stringify(us)}`
  );
}

/* every Group-1 style must expose its EU and US sizes pairwise */
const GROUP1_EU_MISS = [];
const GROUP1_US_MISS = [];
for (const [handle, p] of byHandle) {
  if (!p.variants?.some((v) => v.sizeSystem === "EU")) continue;
  const hasEu = p.variants.some((v) => v.sizeSystem === "EU");
  const hasUs = p.variants.some((v) => v.sizeSystem === "US");
  if (!hasEu) GROUP1_EU_MISS.push(handle);
  if (!hasUs) GROUP1_US_MISS.push(handle);
}
check(
  "AC-S3 all explicit Group-1 products emit an EU variant",
  GROUP1_EU_MISS.length === 0,
  `missing EU: ${GROUP1_EU_MISS.join(",")}`
);
check(
  "AC-S3 all explicit Group-1 products emit a US variant",
  GROUP1_US_MISS.length === 0,
  `missing US: ${GROUP1_US_MISS.join(",")}`
);

/* the 22 BARE products must NOT get an inferred EU or US system */
const bareSystemInferred: Array<[string, string]> = [];
const bareProducts = [...byHandle.values()].filter((p) =>
  p.variants?.some((v) => v.sizeSystem !== "EU" && v.sizeSystem !== "US" && /^\d/.test(v.size ?? "") )
);
for (const p of bareProducts) {
  for (const v of p.variants ?? []) {
    if (/^\d+(\.\d+)?$/.test(v.size ?? "") && (v.sizeSystem === "EU" || v.sizeSystem === "US")) {
      bareSystemInferred.push([p.externalId, `${v.size}->${v.sizeSystem}`]);
    }
  }
}
check(
  "AC-S5/prior no bare Group-2 numeric is inferred as EU or US in provider output",
  bareSystemInferred.length === 0,
  JSON.stringify(bareSystemInferred.slice(0, 10))
);

/* ---- DB-state checks after a real sync (require sync to have run) ---- */

const src = await prisma.source.findUnique({ where: { name: "Livostyle Open Catalog" } });
if (src) {
  const euRows = await prisma.$queryRawUnsafe<Array<{ value: string; n: bigint }>>(
    `SELECT s.value, count(*)::bigint n FROM "Size" s
     JOIN "ProductVariant" v ON v."sizeId"=s.id JOIN "Product" p ON p.id=v."productId"
     JOIN "Source" src ON src.id=p."sourceId"
     WHERE src.name='Livostyle Open Catalog' AND s.system='EU'
     GROUP BY s.value ORDER BY s.value`
  );
  const euValues = euRows.map((r) => r.value);
  check(
    "DB: EU size rows exist with 35..45 normalized values",
    euValues.includes("35") && euValues.includes("42") && euValues.includes("45"),
    `eu=${JSON.stringify(euValues)}`
  );

  const us10half = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*)::bigint n FROM "Size" s
     JOIN "ProductVariant" v ON v."sizeId"=s.id JOIN "Product" p ON p.id=v."productId"
     JOIN "Source" src ON src.id=p."sourceId"
     WHERE src.name='Livostyle Open Catalog' AND s.system='US' AND s.value='10.5'`
  );
  check(
    "DB: US 10.5 size row exists (parenthetical preserved)",
    Number(us10half?.[0]?.n ?? 0) > 0,
    `us10.5 n=${Number(us10half?.[0]?.n ?? 0)}`
  );
}

console.log(`\nG1 livostyle-fix: passed=${passed} failed=${failed}`);
if (failed > 0) process.exit(1);
