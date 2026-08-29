import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  ATTRIBUTE_NAMES,
  LIVOSTYLE_TAG_MAP,
  attributesFromTags,
  writeProductAttributes,
} from "../src/lib/providers/attribute-enrichment";

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

/* ---- T2a: allow-list integrity ---- */

check(
  "T2a.1 every tag maps to an allowed attribute name",
  Object.entries(LIVOSTYLE_TAG_MAP).every(([tag, m]) => {
    const allowed = (ATTRIBUTE_NAMES as readonly string[]).includes(m.attribute);
    if (!allowed) console.log(`  bad attribute for '${tag}': ${m.attribute}`);
    return allowed;
  }),
  `total tags=${Object.keys(LIVOSTYLE_TAG_MAP).length}`
);

check(
  "T2a.2 every attribute has at least one tag",
  ATTRIBUTE_NAMES.every((a) =>
    Object.values(LIVOSTYLE_TAG_MAP).some((m) => m.attribute === a)
  ),
  ATTRIBUTE_NAMES.join(",")
);

/* ---- T2c: contradiction policy ---- */

const sleevePolicy = attributesFromTags(["long sleeve", "short sleeve", "bibi"]);
check(
  "T2c.1 contradictory sleeve lengths are all dropped",
  sleevePolicy.every((a) => a.name !== "Sleeve"),
  JSON.stringify(sleevePolicy)
);

const sleevePuff = attributesFromTags(["long sleeve", "puff sleeve"]);
check(
  "T2c.2 length + decorative sleeve coexist",
  sleevePuff.some((a) => a.name === "Sleeve" && a.value === "Long Sleeve") &&
    sleevePuff.some((a) => a.name === "Sleeve" && a.value === "Puff Sleeve"),
  JSON.stringify(sleevePuff)
);

const collarConflict = attributesFromTags(["v-neck", "round neck"]);
check(
  "T2c.3 two specific necklines are all dropped",
  collarConflict.every((a) => a.name !== "Collar"),
  JSON.stringify(collarConflict)
);

const collarAdditive = attributesFromTags(["v-neck", "collared"]);
check(
  "T2c.4 collared + one neckline coexists",
  collarAdditive.some((a) => a.name === "Collar" && a.value === "V-Neck") &&
    collarAdditive.some((a) => a.name === "Collar" && a.value === "Collared"),
  JSON.stringify(collarAdditive)
);

const patternSolidStriped = attributesFromTags(["solid color", "striped"]);
check(
  "T2c.5 specific pattern wins over Solid",
  patternSolidStriped.length === 1 &&
    patternSolidStriped[0].value === "Striped",
  JSON.stringify(patternSolidStriped)
);

const patternTwoSpecific = attributesFromTags(["floral print", "striped"]);
check(
  "T2c.6 two specific patterns are all dropped",
  patternTwoSpecific.every((a) => a.name !== "Pattern"),
  JSON.stringify(patternTwoSpecific)
);

const styleMulti = attributesFromTags(["casual", "athleisure", "boho"]);
check(
  "T2c.7 multiple style values coexist",
  styleMulti.filter((a) => a.name === "Style").length === 3,
  JSON.stringify(styleMulti)
);

const materialExact = attributesFromTags(["cotton", "faux leather"]);
check(
  "T2c.8 material exact values, no fabrication",
  materialExact.some((a) => a.name === "Material" && a.value === "Cotton") &&
    materialExact.some((a) => a.name === "Material" && a.value === "Leather"),
  JSON.stringify(materialExact)
);

/* ---- T2d: rejected tags contribute nothing ---- */

const rejected = [
  "ship from usa",
  "ship from overseas",
  "issues",
  "bibi",
  "zenana",
  "tops",
  "top",
  "dress",
  "shoes",
  "black",
  "pink",
  "white",
  "summer",
  "winter",
  "coachella",
  "festival",
  "polo",
  "timeless plaids",
  "velvet ocean",
  "knit",
  "ribbed",
  "sheer",
  "plus size",
  "high waist",
  "everyday",
  "daytime",
];
check(
  "T2d.1 rejected tags never produce attributes",
  attributesFromTags(rejected).length === 0,
  JSON.stringify(attributesFromTags(rejected))
);

/* ---- T2e: writeProductAttributes semantics (fake db) ---- */

function fakeDb() {
  const calls: {
    deletes: number;
    creates: number;
    names: string[];
    values: string[];
  } = { deletes: 0, creates: 0, names: [], values: [] };
  const db = {
    attribute: {
      upsert: async (args: { where: { name: string }; create: { name: string } }) => {
        calls.names.push(args.create.name);
        return { id: `${args.create.name}-id` };
      },
    },
    productAttribute: {
      deleteMany: async () => {
        calls.deletes += 1;
        return { count: 0 };
      },
      createMany: async (args: { data: Array<{ value: string }> }) => {
        calls.creates += 1;
        calls.values.push(...args.data.map((d) => d.value));
        return { count: args.data.length };
      },
    },
  };
  return { db, calls };
}

const { db: dbOk, calls: callsOk } = fakeDb();
await writeProductAttributes(
  dbOk as never,
  "p1",
  [
    { name: "Style", value: "Casual" },
    { name: "Material", value: "Cotton" },
  ]
);
check(
  "T2e.1 valid attributes are written delete-then-insert",
  callsOk.deletes === 1 &&
    callsOk.creates === 1 &&
    callsOk.names.join(",") === "Style,Material" &&
    callsOk.values.join(",") === "Casual,Cotton",
  JSON.stringify(callsOk)
);

const { db: dbEmpty, calls: callsEmpty } = fakeDb();
await writeProductAttributes(dbEmpty as never, "p2", []);
check(
  "T2e.2 empty attrs still clears stale rows but writes nothing",
  callsEmpty.deletes === 1 && callsEmpty.creates === 0,
  JSON.stringify(callsEmpty)
);

const { db: dbBad } = fakeDb();
let threw = false;
try {
  await writeProductAttributes(dbBad as never, "p3", [
    { name: "MadeUp", value: "X" },
  ]);
} catch {
  threw = true;
}
check(
  "T2e.3 unknown attribute name is rejected",
  threw,
  "expected throw"
);

/* ---- T1 (read-only DB): demo rows untouched baseline ---- */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const demoSources = await prisma.source.findMany({
  where: { name: { in: ["WearSearch Demo Store", "StyleHub Affiliate Feed"] } },
});
const demoIds = demoSources.map((s) => s.id);
const demoProducts = await prisma.product.count({
  where: { sourceId: { in: demoIds } },
});
const demoRows = await prisma.productAttribute.count({
  where: { product: { sourceId: { in: demoIds } } },
});
const perProductRows = await prisma.productAttribute.groupBy({
  by: ["productId"],
  where: { product: { sourceId: { in: demoIds } } },
  _count: { _all: true },
});
check(
  "T1.1 demo catalog intact: 79 products / 474 attribute rows",
  demoProducts === 79 &&
    demoRows === 474 &&
    perProductRows.length === 79 &&
    perProductRows.every((r) => r._count._all === 6),
  `products=${demoProducts} rows=${demoRows} grouped=${perProductRows.length}`
);

const livostyle = await prisma.source.findFirst({
  where: { name: "Livostyle Open Catalog" },
});
const livostyleAttrRows = await prisma.productAttribute.count({
  where: { product: { sourceId: livostyle!.id } },
});
const otherReal = await prisma.source.findMany({
  where: { name: { in: ["DummyJSON Free API", "Fake Store API"] } },
});
const otherRealRows = await prisma.productAttribute.count({
  where: { product: { sourceId: { in: otherReal.map((s) => s.id) } } },
});
check(
  "T1.2 livostyle has 1624 rows after apply; other real sources still have none",
  livostyleAttrRows === 1624 && otherRealRows === 0,
  `livostyle=${livostyleAttrRows} otherReal=${otherRealRows}`
);

await prisma.$disconnect();

console.log(`\n=== RESULT: ${passed}/${passed + failed} passed ===`);
process.exit(failed === 0 ? 0 : 1);