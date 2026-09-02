/* Import CLI for the controlled harness.

     tsx scripts/import-catalog.mts --adapter <id> [--dry-run] [--sample 10] [--max 200]

   Phase 0: runs against the harness with whatever adapters are registered
   (none yet - eBay arrives in Phase 1). Flat exits with a clear message
   instead of pretending a source exists.

   Run FORMAT NOTES: --dry-run never writes; sample/max bound the batch.
   Every run records a SourceSyncRun and includes the invariant verify in
   the report. */

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { findAdapter } from "../src/lib/catalog/adapters";
import { runImport, inspectSample } from "../src/lib/catalog/import";

const ADAPTER = "--adapter";
const DRY_RUN = "--dry-run";
const SAMPLE = "--sample";
const MAX = "--max";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === DRY_RUN) {
      out[DRY_RUN] = "1";
    } else if (
      (arg === ADAPTER || arg === SAMPLE || arg === MAX) &&
      i + 1 < argv.length
    ) {
      out[arg] = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const adapterId = args[ADAPTER];
  if (!adapterId) {
    console.error(
      "usage: tsx scripts/import-catalog.mts --adapter <id> [--dry-run] [--sample N] [--max N]"
    );
    process.exit(1);
  }

  const adapter = findAdapter(adapterId);
  if (!adapter) {
    console.error(
      `no adapter registered for '${adapterId}' - Phase 1 adds the first real source`
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const sampleSize = args[SAMPLE] ? Number(args[SAMPLE]) : 10;
  const maxListings = args[MAX] ? Number(args[MAX]) : 200;
  const dryRun = Boolean(args[DRY_RUN]);

  try {
    console.log(`\nInspecting sample (${sampleSize}) for ${adapter.sourceName}...`);
    const inspection = await inspectSample(prisma, adapter, { sampleSize });
    console.log(
      `  sample rows=${inspection.total} wellFormed=${inspection.wellFormed} accepted=${inspection.accepted.length} quarantined=${inspection.quarantined.length} invalid=${inspection.invalid.length}`
    );

    console.log(`\nRunning import (${dryRun ? "DRY" : "LIVE"})...`);
    const result = await runImport(prisma, adapter, {
      sampleSize,
      maxListings,
      dryRun,
    });

    console.log("\n📦 Import result:");
    console.log(`   syncRunId       ${result.syncRunId ?? "(dry-run)"}`);
    console.log(`   listingsFetched ${result.listingsFetched}`);
    console.log(`   created         ${result.created}`);
    console.log(`   updated/merged  ${result.updated}  (merged=existing:${result.mergedExisting})`);
    console.log(`   quarantined     ${result.quarantined}`);
    console.log(`   dropped         ${result.dropped}`);
    console.log(`   products        ${result.productCountBefore} -> ${result.productCountAfter}`);
    if (result.errors.length > 0) {
      console.error("\n⚠️  Errors:");
      for (const error of result.errors) console.error(`   - ${error}`);
      process.exit(1);
    }
    console.log("\n✅ Import complete (all invariants verified)");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("❌ Import failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});