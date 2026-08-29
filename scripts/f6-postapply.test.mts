import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hasRealProductPage } from "../src/lib/product-url";
import {
  ATTRIBUTE_NAMES,
  LIVOSTYLE_TAG_MAP,
  NECKLINE_VALUES,
  SLEEVE_LENGTH_VALUES,
  SPECIFIC_PATTERN_VALUES,
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

const SEARCH = "http://localhost:3000/api/search";

interface SearchAttributeRef {
  attribute: { name: string };
  value: string;
}
interface SearchProduct {
  id: string;
  productUrl: string;
  attributes: SearchAttributeRef[];
}
interface StructuredQuery {
  attributes?: { attributeName: string; value: string }[];
}
interface SearchResponse {
  exactCount?: number;
  similarCount?: number;
  exactProducts?: SearchProduct[];
  similarProducts?: SearchProduct[];
  structuredQuery?: StructuredQuery;
}

async function search(q: string): Promise<SearchResponse> {
  const res = await fetch(`${SEARCH}?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as SearchResponse;
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const livostyle = await prisma.source.findFirst({
  where: { name: "Livostyle Open Catalog" },
});
const demo = await prisma.source.findMany({
  where: { name: { in: ["WearSearch Demo Store", "StyleHub Affiliate Feed"] } },
});
const demoIds = demo.map((s) => s.id);

/* ---- T1: demo catalog untouched ---- */

const demoProducts = await prisma.product.count({
  where: { sourceId: { in: demoIds } },
});
const demoRows = await prisma.productAttribute.count({
  where: { product: { sourceId: { in: demoIds } } },
});
const perProduct = await prisma.productAttribute.groupBy({
  by: ["productId"],
  where: { product: { sourceId: { in: demoIds } } },
  _count: { _all: true },
});
check(
  "T1 demo intact: 79 products / 474 rows / 6 per product",
  demoProducts === 79 &&
    demoRows === 474 &&
    perProduct.length === 79 &&
    perProduct.every((r) => r._count._all === 6),
  `products=${demoProducts} rows=${demoRows} grouped=${perProduct.length}`
);

/* ---- load all livostyle attribute rows ---- */

const rows = await prisma.productAttribute.findMany({
  where: { product: { sourceId: livostyle!.id } },
  select: {
    value: true,
    productId: true,
    attribute: { select: { name: true } },
    product: { select: { externalId: true, name: true, category: { select: { slug: true } } } },
  },
});

const allowedValues = new Set(
  Object.values(LIVOSTYLE_TAG_MAP).map((m) => m.value)
);
const allowedNames = ATTRIBUTE_NAMES as readonly string[];

/* ---- T2: name/value strictness ---- */

const badName = rows.filter((r) => !allowedNames.includes(r.attribute.name));
const badValue = rows.filter((r) => !allowedValues.has(r.value));
check(
  "T2 no row has a name or value outside the F6 vocabulary",
  badName.length === 0 && badValue.length === 0,
  `badName=${badName
    .map((r) => r.attribute.name)
    .join(",")} badValue=${badValue.map((r) => r.value).join(",")}`
);

/* ---- T3: contradiction policy on DB state ---- */

const byProduct = new Map<string, Map<string, string[]>>();
for (const r of rows) {
  if (!byProduct.has(r.productId)) byProduct.set(r.productId, new Map());
  const m = byProduct.get(r.productId)!;
  const list = m.get(r.attribute.name) ?? [];
  list.push(r.value);
  m.set(r.attribute.name, list);
}

let sleeveContra = 0;
let collarContra = 0;
let patternContra = 0;
for (const [, attrs] of byProduct) {
  const sleeve = attrs.get("Sleeve") ?? [];
  if (sleeve.filter((v) => SLEEVE_LENGTH_VALUES.has(v)).length > 1) sleeveContra += 1;
  const collar = attrs.get("Collar") ?? [];
  if (collar.filter((v) => NECKLINE_VALUES.has(v)).length > 1) collarContra += 1;
  const pattern = attrs.get("Pattern") ?? [];
  const specifics = pattern.filter((v) => SPECIFIC_PATTERN_VALUES.has(v));
  if (specifics.length > 1) patternContra += 1;
  if (specifics.length === 1 && pattern.includes("Solid")) patternContra += 1;
}
check(
  "T3 no product violates the sleeve/neckline/pattern contradiction policy",
  sleeveContra === 0 && collarContra === 0 && patternContra === 0,
  `sleeve=${sleeveContra} collar=${collarContra} pattern=${patternContra}`
);

/* ---- dupes: no duplicate (product, attribute, value) triples ---- */

const triples = new Set(
  rows.map((r) => `${r.productId}|${r.attribute.name}|${r.value}`)
);
check("T3b no duplicate attribute triples in DB", triples.size === rows.length, `${triples.size} vs ${rows.length}`);

/* ---- T5: coverage == targets (distinct products) ---- */

const TARGETS: Record<string, number> = {
  Sleeve: 342,
  Collar: 240,
  Fit: 110,
  Style: 486,
  Pattern: 235,
  Material: 24,
};
for (const name of ATTRIBUTE_NAMES) {
  const covered = new Set(
    rows.filter((r) => r.attribute.name === name).map((r) => r.productId)
  ).size;
  check(
    `T5 ${name} coverage = ${TARGETS[name]}`,
    covered === TARGETS[name],
    `covered=${covered}`
  );
}

/* ---- shoe check: footwear products get no Sleeve/Collar ---- */

const shoeSlugs = new Set(["heels", "sneakers", "boots", "loafers", "sandals"]);
const shoeGarment = rows.filter(
  (r) =>
    shoeSlugs.has(r.product.category?.slug ?? "") &&
    (r.attribute.name === "Sleeve" || r.attribute.name === "Collar")
);
check(
  "shoe check: no footwear product has Sleeve/Collar",
  shoeGarment.length === 0,
  shoeGarment.map((r) => `${r.product.externalId}:${r.attribute.name}`).join(",")
);

/* ---- title<->attribute contradiction report (informational) ---- */

const sleeveTitleContra: string[] = [];
for (const [pid, attrs] of byProduct) {
  const row = rows.find((r) => r.productId === pid)!;
  const title = row.product.name.toLowerCase();
  const sleeve = attrs.get("Sleeve") ?? [];
  if (
    /\bsleeveless\b/.test(title) &&
    sleeve.length > 0 &&
    !sleeve.includes("Sleeveless")
  ) {
    sleeveTitleContra.push(`${row.product.externalId}`);
  }
}
check(
  "title sampler: no product titled 'sleeveless' carries a non-Sleeveless Sleeve value",
  sleeveTitleContra.length === 0,
  sleeveTitleContra.join(",")
);
console.log(
  `INFO title sampler: checked ${byProduct.size} attributed products for sleeve-title coherence`
);

/* ---- S1-S5 + negative controls (live search) ---- */

const cottonIds = new Set(
  rows.filter((r) => r.attribute.name === "Material" && r.value === "Cotton").map((r) => r.productId)
);

async function validateExact(query: string, attrName: string, attrValue: string): Promise<number> {
  const res = await search(query);
  const exact = res.exactProducts ?? [];
  const sq = res.structuredQuery ?? {};
  const detected = (sq.attributes ?? []).some(
    (a) => a.attributeName === attrName && a.value === attrValue
  );
  const allHold = exact.every(
    (p) =>
      hasRealProductPage(p.productUrl) &&
      p.attributes.some(
        (a) => a.attribute.name === attrName && a.value === attrValue
      )
  );
  check(
    `S ${query} => ${attrName}:${attrValue} (exact=${res.exactCount ?? 0})`,
    (res.exactCount ?? 0) >= 1 && detected && allHold,
    `exact=${res.exactCount} detected=${detected} allHold=${allHold}`
  );
  return res.exactCount ?? 0;
}

const c1 = await validateExact("cotton", "Material", "Cotton");
check("S1 cotton >= 2 exact real products", c1 >= 2, `cotton exact=${c1}`);

const c2 = await validateExact("long sleeve", "Sleeve", "Long Sleeve");
check("S2 long sleeve >= 150 exact", c2 >= 150, `long sleeve exact=${c2}`);

const c3a = await validateExact("v-neck", "Collar", "V-Neck");
const c3b = await validateExact("v neck", "Collar", "V-Neck");
check("S3 v-neck / v neck >= 95 exact", Math.min(c3a, c3b) >= 95, `v-neck=${c3a} v neck=${c3b}`);

const c4 = await validateExact("leather", "Material", "Leather");
const leatherRes = await search("leather");
const leatherIds = new Set(
  (leatherRes.exactProducts ?? []).map((p) => p.id)
);
const cottonLeak = [...cottonIds].filter((id) => leatherIds.has(id));
check(
  "S4 leather >= 7 exact, no Material:Cotton leak (F7-S2: 2 OOS faux-leather trousers excluded)",
  c4 >= 7 && cottonLeak.length === 0,
  `leather exact=${c4} leaked=${cottonLeak.length}`
);

const c5 = await validateExact("casual", "Style", "Casual");
check("S5 casual >= 457 exact, all real pages (F7-S2: 7 OOS Style:Casual excluded)", c5 >= 457, `casual exact=${c5}`);

/* ---- negative controls (live): F6 criterion = zero fabricated Material ---- */

const MATERIAL_WORDS = ["cashmere", "wool", "silk", "rayon", "polyester", "spandex"];
for (const q of MATERIAL_WORDS) {
  const res = await search(q);
  const attrs = res.structuredQuery?.attributes ?? [];
  const dbRows = await prisma.productAttribute.count({
    where: {
      value: { equals: q, mode: "insensitive" },
      attribute: { name: "Material" },
      product: { sourceId: livostyle!.id },
    },
  });
  check(
    `NEG ${q}: F6 fabricated no Material (dbRows=${dbRows}, attrs=${JSON.stringify(attrs.map((a) => `${a.attributeName}:${a.value}`))})`,
    dbRows === 0,
    `dbRows=${dbRows}`
  );
  console.log(
    `INFO ${q}: search exact=${res.exactCount ?? 0} ${
      (res.exactCount ?? 0) >= 500
        ? "-> full-catalog fallback for unrecognized free-text (PRE-EXISTING /api/search behavior)"
        : res.exactCount === 0
          ? "-> 0 results (pre-existing unsupported-intent / no-real-page attribute detection, or F7-S1 pure-free-text gate), not an F6 failure"
          : "-> see count"
    }`
  );
}

const checkedRes = await search("checked");
const checkedExact = checkedRes.exactProducts ?? [];
const checkedOk =
  (checkedRes.structuredQuery?.attributes ?? []).some(
    (a) => a.attributeName === "Pattern" && a.value === "Checked"
  ) &&
  checkedExact.every((p) =>
    p.attributes.some(
      (a) => a.attribute.name === "Pattern" && a.value === "Checked"
    )
  );
check(
  `NEG 'checked' yields exactly Pattern:Checked products (exact=${checkedRes.exactCount})`,
  (checkedRes.exactCount ?? 0) >= 4 && checkedOk,
  `exact=${checkedRes.exactCount} checkedOk=${checkedOk}`
);

console.log(`\n=== RESULT: ${passed}/${passed + failed} passed ===`);
process.exit(failed === 0 ? 0 : 1);