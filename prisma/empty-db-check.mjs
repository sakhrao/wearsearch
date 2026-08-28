import "dotenv/config";
import pg from "pg";
import { execSync } from "node:child_process";

const {
  Client,
} = pg;

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL missing");

const parsed = new URL(url);
const dbName = parsed.pathname.replace(/^\//, "");
const tempName = `${dbName}_seedcheck`;
parsed.pathname = `/postgres`;

async function withClient(
  connString,
  fn
) {
  const client = new Client({
    connectionString: connString,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const adminUrl = parsed.toString();

/* create empty temp database */
await withClient(
  adminUrl,
  async (c) => {
    await c.query(
      `DROP DATABASE IF EXISTS "${tempName}"`
    );
    await c.query(
      `CREATE DATABASE "${tempName}"`
    );
  }
);

const tempUrl = url.replace(
  `/${dbName}`,
  `/${tempName}`
);

console.log(`created temp db: ${tempName}`);

/* apply migrations to temp db */
execSync("npx prisma migrate deploy", {
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: tempUrl,
  },
});

/* run seed against temp db as a child process
   (seed's internal main() promise is not
   awaitable from outside the module) */
execSync("npx tsx prisma/seed.ts", {
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: tempUrl,
  },
});

/* verify counts inside temp db */
const counts = await withClient(
  tempUrl,
  async (c) => {
    const r = await c.query(
      `SELECT
         (SELECT COUNT(*) FROM "Product") AS products,
         (SELECT COUNT(*) FROM "ProductVariant") AS variants,
         (SELECT COUNT(*) FROM "Source") AS sources,
         (SELECT COUNT(*) FROM "Category") AS categories`
    );
    return r.rows[0];
  }
);

console.log(
  `counts: products=${counts.products} variants=${counts.variants} sources=${counts.sources} categories=${counts.categories}`
);

if (Number(counts.products) !== 79) {
  throw new Error(
    `expected 79 products, got ${counts.products}`
  );
}

/* drop temp database (disconnect seed pool first) */
await withClient(adminUrl, async (c) => {
  await c.query(
    `DROP DATABASE IF EXISTS "${tempName}" WITH (FORCE)`
  );
});

console.log(
  "EMPTY-DB SEED CHECK: PASS (temp db dropped)"
);
