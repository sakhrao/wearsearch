import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

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
  availability?: string;
  attributes: SearchAttributeRef[];
}
interface CategoryStatus {
  requested?: string;
  productCount?: number;
  siblings?: string[];
}
interface SearchResponse {
  success?: boolean;
  query?: string;
  exactCount?: number;
  similarCount?: number;
  exactProducts?: SearchProduct[];
  similarProducts?: SearchProduct[];
  diagnostics?: string[];
  categoryStatus?: CategoryStatus | null;
}

async function search(q: string): Promise<SearchResponse> {
  const res = await fetch(`${SEARCH}?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for "${q}"`);
  return res.json() as SearchResponse;
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

/* ------------------------------------------------------------------
   DB truth: which AVAILABLE products with a real product page carry
   the queried token in their engine searchable text (name, description,
   brand, category, gender, variant colors/sizes, attribute names/values)?
   Replicates the engine's tokenization so the F7 contract is checked
   against the same facts the engine sees.
------------------------------------------------------------------ */

const dbCatalog = await prisma.product.findMany({
  where: { availability: { not: "OUT_OF_STOCK" } },
  select: {
    productUrl: true,
    name: true,
    description: true,
    gender: true,
    category: { select: { name: true } },
    brand: { select: { name: true } },
    variants: { select: { color: { select: { name: true } }, size: { select: { value: true } } } },
    attributes: { select: { value: true, attribute: { select: { name: true } } } },
  },
});

const normalizeText = (text: string | null | undefined): string =>
  (text ?? "")
    .replace(/['’]s(?=\s|$)/gi, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const getWords = (text: string): string[] =>
  normalizeText(text)
    .split(/[\s-]+/)
    .filter((word) => word.length > 1);

const searchableTokens = (p: (typeof dbCatalog)[number]): Set<string> => {
  const joined = [
    p.name,
    p.description,
    p.brand?.name,
    p.category?.name,
    String(p.gender ?? ""),
    ...(p.variants ?? []).map((v) => v.color?.name ?? ""),
    ...(p.variants ?? []).map((v) => v.size?.value ?? ""),
    ...(p.attributes ?? []).map((a) => a.value),
    ...(p.attributes ?? []).map((a) => a.attribute.name),
  ].join(" ");
  return new Set(getWords(joined));
};

const realCatalog = dbCatalog.filter((p) => /^https?:\/\//.test(p.productUrl ?? ""));
const demoishCount = dbCatalog.length - realCatalog.length;

const dbTokenCount = (word: string): number =>
  realCatalog.filter((p) => searchableTokens(p).has(word)).length;

const dbWordSet = (word: string): Set<string> =>
  new Set(
    realCatalog
      .filter((p) => searchableTokens(p).has(word))
      .map((p) => p.productUrl)
  );

/* ------------------------------------------------------------------
   S1 controls
------------------------------------------------------------------ */

const silkDb = dbTokenCount("silk");
const rayonDb = dbTokenCount("rayon");
const spandexDb = dbTokenCount("spandex");
console.log(`INFO dbTruth AVAILABLE+realPage text tokens: silk=${silkDb} rayon=${rayonDb} spandex=${spandexDb} (noPageDemoish=${demoishCount})`);

const silkRes = await search("silk");
const rayonRes = await search("rayon");
const spandexRes = await search("spandex");
const xyzzyRes = await search("xyzzy");
const polyesterRes = await search("polyester");
const cashmereRes = await search("cashmere");
const woolRes = await search("wool");

check("S1 rayon exact = DB truth (10)", rayonRes.exactCount === 10 && rayonDb === 10, `rayon exact=${rayonRes.exactCount} db=${rayonDb}`);
check("S1 spandex exact = DB truth (5)", spandexRes.exactCount === 5 && spandexDb === 5, `spandex exact=${spandexRes.exactCount} db=${spandexDb}`);
check("S1 silk exact = 0 (its only text token sits on a no-page product)", silkRes.exactCount === 0 && silkDb === 0, `silk exact=${silkRes.exactCount} db=${silkDb}`);

check("S1 silk never returns the catalog (exact < 500)", (silkRes.exactCount ?? 0) < 500, `silk exact=${silkRes.exactCount}`);
check("S1 rayon never returns the catalog (exact < 500)", (rayonRes.exactCount ?? 0) < 500, `rayon exact=${rayonRes.exactCount}`);
check("S1 spandex never returns the catalog (exact < 500)", (spandexRes.exactCount ?? 0) < 500, `spandex exact=${spandexRes.exactCount}`);

const rayonIds = new Set((rayonRes.exactProducts ?? []).map((p) => p.id));
const spandexIds = new Set((spandexRes.exactProducts ?? []).map((p) => p.id));

check(
  "S1 every rayon result actually carries the word in its text",
  (rayonRes.exactProducts ?? []).length === rayonIds.size &&
    rayonRes.exactProducts!.every((p) => dbWordSet("rayon").has(p.productUrl)),
  `rayon results=${rayonRes.exactProducts?.length}`
);
check(
  "S1 every spandex result actually carries the word in its text",
  (spandexRes.exactProducts ?? []).length === spandexIds.size &&
    spandexRes.exactProducts!.every((p) => dbWordSet("spandex").has(p.productUrl)),
  `spandex results=${spandexRes.exactProducts?.length}`
);

/* Unification: silk (corpus-known free text with no real-page hit) is
   now indistinguishable from pure gibberish - both yield the same
   empty shape and the same generic diagnostics. */
check(
  "S1 silk is unified with 'xyzzy' (0 exact / 0 similar / identical diagnostics)",
  silkRes.exactCount === 0 &&
    xyzzyRes.exactCount === 0 &&
    silkRes.similarCount === 0 &&
    xyzzyRes.similarCount === 0 &&
    JSON.stringify(silkRes.diagnostics ?? []) === JSON.stringify(xyzzyRes.diagnostics ?? []) &&
    (silkRes.diagnostics ?? []).length >= 1,
  `silk diag=[${(silkRes.diagnostics ?? []).join(" | ")}] xyzzy diag=[${(xyzzyRes.diagnostics ?? []).join(" | ")}]`
);

check("S1 polyester stays 0 (unknown corpus word -> noise guard)", polyesterRes.exactCount === 0, `polyester exact=${polyesterRes.exactCount}`);
check("S1 cashmere stays 0 (unknown corpus word -> noise guard)", cashmereRes.exactCount === 0, `cashmere exact=${cashmereRes.exactCount}`);
check("S1 wool stays 0 (Material:Wool only on no-page StyleHub products)", woolRes.exactCount === 0, `wool exact=${woolRes.exactCount}`);

/* Mixed-matrix frozen: structured intent still dominates noise /
   free text; the flood is dead only where free text was the sole signal. */
const blueRes = await search("blue");
const blueXyzzyRes = await search("blue xyzzy");
const silkXyzzyRes = await search("silk xyzzy");
const cottonRes = await search("cotton");

check("T blue xyzzy == blue exact (noise tolerated under structured intent) = 83 (F7-S2: 2 OOS blue products excluded from the pre-F7 85)", blueXyzzyRes.exactCount === blueRes.exactCount && blueXyzzyRes.exactCount === 83, `blue=${blueRes.exactCount} blue xyzzy=${blueXyzzyRes.exactCount}`);
check("T silk xyzzy == silk exact (0, unified)", silkXyzzyRes.exactCount === (silkRes.exactCount ?? 0), `silk xyzzy=${silkXyzzyRes.exactCount}`);
check("T cotton exact unchanged (= 2, attribute-structured)", cottonRes.exactCount === 2, `cotton exact=${cottonRes.exactCount}`);

/* Cross-false-positives: a free-text hit for one word must never admit
   candidates that belong to a different intent. */
const cottonIds = new Set((cottonRes.exactProducts ?? []).map((p) => p.id));
const leatherIds = new Set((await search("leather")).exactProducts!.map((p) => p.id));
const checkedIds = new Set((await search("checked")).exactProducts!.map((p) => p.id));
const longSleeveIds = new Set((await search("long sleeve")).exactProducts!.map((p) => p.id));

const rayonVsCotton = [...rayonIds].filter((id) => cottonIds.has(id)).length;
const rayonVsLeather = [...rayonIds].filter((id) => leatherIds.has(id)).length;
const spandexVsChecked = [...spandexIds].filter((id) => checkedIds.has(id)).length;
const spandexVsLongSleeve = [...spandexIds].filter((id) => longSleeveIds.has(id)).length;

check("XFP rayon exact never contains Material:Cotton products", rayonVsCotton === 0, `rayon.intersect.cotton=${rayonVsCotton}`);
check("XFP rayon exact never contains Material:Leather products", rayonVsLeather === 0, `rayon.intersect.leather=${rayonVsLeather}`);
check("XFP spandex exact never contains Pattern:Checked products", spandexVsChecked === 0, `spandex.intersect.checked=${spandexVsChecked}`);
check("XFP spandex exact never contains Sleeve:Long Sleeve products", spandexVsLongSleeve === 0, `spandex.intersect.longSleeve=${spandexVsLongSleeve}`);

/* rayon <-> spandex overlap is LEGITIMATE only via text blends: any
   shared product must contain both words. */
const rayonDbSet = dbWordSet("rayon");
const spandexDbSet = dbWordSet("spandex");
const sharedBlends = [...rayonIds].filter((id) => spandexIds.has(id));
check(
  "XFP rayon/spandex overlapping products contain both words",
  sharedBlends.every((id) => {
    const hit = rayonRes.exactProducts!.find((x) => x.id === id);
    return !!hit && rayonDbSet.has(hit.productUrl) && spandexDbSet.has(hit.productUrl);
  }),
  `rayon.intersect.spandex=${sharedBlends.length}`
);

/* ------------------------------------------------------------------
   S2 controls: OUT_OF_STOCK must not leak anywhere.
------------------------------------------------------------------ */

const oosRows = await prisma.product.findMany({
  where: { availability: "OUT_OF_STOCK" },
  select: { id: true, productUrl: true },
});
const oosIds = new Set(oosRows.map((p) => p.id));
const oosUrls = new Set(oosRows.map((p) => p.productUrl));
check("S2 catalog has exactly 9 OUT_OF_STOCK products", oosRows.length === 9, `oos=${oosRows.length}`);

const SWEEP_QUERIES = [
  "tops", "clothing", "bottoms", "shoes", "hoodie", "sweatshirt", "sweatpants",
  "t-shirt", "tee", "tank top", "sneaker", "blouse", "trousers", "joggers",
  "jeans", "boots", "sandals", "leggings", "cardigan", "polo", "chinos", "formal shoes",
  "silk", "rayon", "spandex", "xyzzy", "polyester", "cashmere", "wool", "denim",
  "cotton", "leather", "long sleeve", "v-neck", "round neck", "sleeveless top",
  "sport top", "casual", "checked", "floral", "skinny jeans", "straight jeans",
  "black pants", "black tank top", "blue sneakers", "white sneaker 41",
  "size medium black tank top", "women tank top", "men jeans", "kids jeans",
  "nike", "adidas", "zara", "new balance sneaker",
  "tops under 20", "jeans under 30", "sneakers under 50", "sandals under 50 in EUR",
];

let leakCount = 0;
let notAvailableCount = 0;
let badShapeCount = 0;
let seenProducts = 0;

for (const q of SWEEP_QUERIES) {
  const res = await search(q);
  const all = [...(res.exactProducts ?? []), ...(res.similarProducts ?? [])];
  seenProducts += all.length;

  if (res.exactCount !== res.exactProducts?.length) badShapeCount += 1;
  if (res.similarCount !== res.similarProducts?.length) badShapeCount += 1;

  for (const p of all) {
    if (oosIds.has(p.id) || oosUrls.has(p.productUrl)) leakCount += 1;
    if (p.availability !== "AVAILABLE") notAvailableCount += 1;
    if (!/^https?:\/\//.test(p.productUrl ?? "")) badShapeCount += 1;
  }
}

check(`S2 no OUT_OF_STOCK product appears in any response (${SWEEP_QUERIES.length} queries, ${seenProducts} products seen)`, leakCount === 0, `leaks=${leakCount}`);
check(`S2 every returned product is availability=AVAILABLE (${seenProducts} seen)`, notAvailableCount === 0, `nonAvailable=${notAvailableCount}`);
check("S2 exactCount === exactProducts.length and real pages everywhere", badShapeCount === 0, `shapes=${badShapeCount}`);

const tankStatus = await search("tank top");
check("S2 categoryStatus.productCount excludes OOS (tank top == 50)", tankStatus.categoryStatus?.productCount === 50, `productCount=${tankStatus.categoryStatus?.productCount}`);

/* ------------------------------------------------------------------
   Payload: the old silk response shipped ~1.77 MB of full catalog.
------------------------------------------------------------------ */

const silkBytes = Buffer.byteLength(JSON.stringify(silkRes), "utf8");
const rayonBytes = Buffer.byteLength(JSON.stringify(rayonRes), "utf8");
check("P silk payload < 100 KB (was ~1.77 MB)", silkBytes < 100 * 1024, `silk bytes=${silkBytes}`);
check("P rayon payload < 100 KB (was ~1.77 MB)", rayonBytes < 100 * 1024, `rayon bytes=${rayonBytes}`);

console.log(`\n=== RESULT: ${passed}/${passed + failed} passed ===`);
process.exit(failed === 0 ? 0 : 1);