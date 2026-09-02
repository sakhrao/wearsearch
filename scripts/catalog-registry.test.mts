import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  ensureSource,
  getSource,
  resolveBrand,
  resolveCategory,
  ensureCanonicalBrand,
  ensureBrandAlias,
  ensureCategoryMapping,
} from "../src/lib/catalog/registry";

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

const TS = Date.now();
const SOURCE_NAME = `P0 Registry Source ${TS}`;
const BRAND_NAME = `P0RegistryBrand${TS}`;

/* ---- teardown: everything this test created, nothing else ---- */
async function teardown() {
  const source = await prisma.source.findUnique({ where: { name: SOURCE_NAME } });
  if (source) {
    await prisma.brandAlias.deleteMany({ where: { sourceId: source.id } });
    await prisma.categoryMapping.deleteMany({ where: { sourceId: source.id } });
    await prisma.source.delete({ where: { id: source.id } });
  }
  await prisma.brand.deleteMany({
    where: { name: { startsWith: `P0RegistryBrand${TS}` }, products: { none: {} } },
  });
}

let source: { id: string } | null = null;

try {
  /* ---- source registry with Phase-0 defaults ---- */
  const created = await ensureSource(prisma, {
    name: SOURCE_NAME,
    type: "AUTHORIZED_FEED",
    priority: 3,
    freshnessHours: 48,
    official: false,
  });
  source = created;
  check(
    "ensureSource registers priority/freshness/official",
    created.priority === 3 && created.freshnessHours === 48 && created.official === false,
    JSON.stringify({ priority: created.priority, freshnessHours: created.freshnessHours, official: created.official })
  );

  const reRead = await getSource(prisma, SOURCE_NAME);
  check(
    "getSource resolves by name",
    reRead?.id === created.id,
    JSON.stringify(reRead?.id)
  );

  /* default priority/freshness for an unset source */
  const defaulted = await ensureSource(prisma, {
    name: SOURCE_NAME,
    type: "MANUAL",
    priority: 5,
    freshnessHours: null,
  });
  check(
    "null freshnessHours defaults to 24 (user decision #3)",
    defaulted.freshnessHours === 24 && defaulted.priority === 5,
    JSON.stringify({ freshnessHours: defaulted.freshnessHours, priority: defaulted.priority })
  );
  /* reset to the 48h profile the test asserts below */
  await ensureSource(prisma, { name: SOURCE_NAME, type: "AUTHORIZED_FEED", priority: 3, freshnessHours: 48 });

  /* ---- canonical brand + alias (human-curated, exact) ---- */
  await ensureCanonicalBrand(prisma, BRAND_NAME);
  const brand = await prisma.brand.findUnique({ where: { name: BRAND_NAME } });
  await ensureBrandAlias(prisma, {
    brandName: BRAND_NAME,
    token: "brand alpha",
    sourceName: SOURCE_NAME,
    kind: "EXACT",
  });

  const resolved = await resolveBrand(prisma, source.id, "Brand Alpha");
  check(
    "resolveBrand maps raw token -> canonical brand id via EXACT alias",
    resolved === brand?.id,
    `resolved=${resolved} expected=${brand?.id}`
  );

  const unmapped = await resolveBrand(prisma, source.id, "Some Totally Unknown Label");
  check(
    "unmapped brand -> null (never guessed)",
    unmapped === null,
    `resolved=${JSON.stringify(unmapped)}`
  );

  /* ---- category mapping (per source, canonical only) ---- */
  const shoes = await prisma.category.findUnique({ where: { slug: "shoes" } });
  check(
    "precondition: canonical 'shoes' category exists",
    !!shoes,
    "shoes category not found in catalog"
  );
  if (shoes) {
    await ensureCategoryMapping(prisma, {
      sourceName: SOURCE_NAME,
      sourceToken: "running shoes",
      canonicalSlug: "shoes",
    });
    const mapped = await resolveCategory(prisma, source.id, "Running Shoes");
    check(
      "resolveCategory maps source token -> canonical category id",
      mapped === shoes.id,
      `mapped=${mapped} expected=${shoes.id}`
    );

    const unmappedCat = await resolveCategory(prisma, source.id, "Deep Sea Diving");
    check(
      "unmapped category -> null",
      unmappedCat === null,
      `mapped=${JSON.stringify(unmappedCat)}`
    );
  }
} finally {
  await teardown();
}

console.log(`\ncatalog-registry: passed=${passed} failed=${failed}`);
await prisma.$disconnect();
if (failed > 0) process.exit(1);