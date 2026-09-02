/* eBay real-data DRY RUN (Phase 1).
 *
 *      tsx scripts/ebay-dry-run.mts [--sample N] [--max N]
 *
 *  1. Uses the registered eBay adapter (OAuth production token, Browse
 *     search) to fetch a SMALL real sample from eBay.
 *  2. Normalizes each listing and runs the PURE validation gates.
 *  3. Reports accepted / quarantined / rejected counts, representative
 *     records, and the dedup identity layers each listing could match
 *     on - WITHOUT writing a single row.
 *
 *   This is the explicit "do not proceed to a large catalog import until
 *   the dry run is reviewed" step. Nothing here mutates the DB for the
 *   catalog: brand/category resolution is READ-ONLY (it just looks up
 *   existing Source/BrandAlias/CategoryMapping rows if the eBay source
 *   has already been mapped; it never creates them).
 *
 *   Config: see .env.example. For US listings you almost always need
 *   FX_RATE_USD_PER_EUR set (or the live FX layer) or USD rows will be
 *   flagged quarantinable - the correct, non-inventing behavior.
 */

import "dotenv/config";
import { createEbayAdapter, MissingEbayConfigError } from "../src/lib/catalog/adapters/ebay";
import type { IdentityBundle } from "../src/lib/catalog/types";
import { identityLayersOf, identityKey } from "../src/lib/catalog/dedupe";
import { validateListing } from "../src/lib/catalog/validation";
import { getSource, resolveBrand, resolveCategory } from "../src/lib/catalog/registry";
import { normalizePriceToEurValue, parseCurrency } from "../src/lib/catalog/normalize";
import type { NormalizedListing } from "../src/lib/catalog/types";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

async function loadFxRateEnv(): Promise<number | null> {
  const raw = process.env.FX_RATE_USD_PER_EUR;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function main() {
  const argv = process.argv.slice(2);
  const sampleArg = argv[argv.indexOf("--sample") + 1];
  const sample = sampleArg ? Math.max(1, Number(sampleArg)) : 10;

  console.log("\n===== eBay DRY RUN =====");
  console.log(`sample=${sample}`);

  /* ---- fetch live via the real adapter ---- */
  const adapter = createEbayAdapter();
  if (!adapter.configStatus.ok) {
    console.error("\n❌ eBay is not configured. Missing env vars:");
    for (const name of adapter.configStatus.missing) console.error(`   - ${name}`);
    console.error("\n   See .env.example. NONE of the values are logged here.");
    process.exit(1);
  }
  console.log(`source            ${adapter.sourceName} (official=${adapter.official})`);
  console.log(`marketplace       ${adapter.configStatus.config.marketplaceId}`);
  console.log(`keywords          ${adapter.configStatus.config.keywords.join(", ") || "(none)"}`);
  console.log(`categories        ${adapter.configStatus.config.categoryIds.join(", ") || "(none)"}`);
  const fxRate = await loadFxRateEnv();
  console.log(fxRate ? `fxRate USD/EUR    ${fxRate} (env)` : "fxRate            none (USD rows will quarantine - expected)");

  let batch;
  try {
    batch = await adapter.fetch({ page: 1, limit: sample });
  } catch (err) {
    if (err instanceof MissingEbayConfigError) {
      console.error(`\n❌ ${err.message}`);
      process.exit(1);
    }
    console.error(`\n❌ Failed to fetch sample from eBay: ${(err as Error).message}`);
    process.exit(1);
  }

  /* ---- read-only registry resolution (if the source exists) ---- */
  let sourceId: string | null = null;
  let db: PrismaClient | null = null;
  let pool: Pool | null = null;
  if (process.env.DATABASE_URL) {
    try {
      pool = new Pool({ connectionString: process.env.DATABASE_URL });
      db = new PrismaClient({ adapter: new PrismaPg(pool) });
      const src = await getSource(db, adapter.sourceName);
      sourceId = src?.id ?? null;
    } catch {
      db = null;
    }
  }

  console.log(
    sourceId
      ? `brand/category map ${sourceId ? "resolved (read-only)" : "not yet mapped"}`
      : "registry           offline (no DATABASE_URL) - brand/category unresolved"
  );

  const resolveExternal = async (listing: NormalizedListing) => {
    if (!db || !sourceId) return { brandResolved: null, categoryResolved: null, fxRate };
    const [brandResolved, categoryResolved] = await Promise.all([
      resolveBrand(db, sourceId, listing.brand ?? ""),
      resolveCategory(db, sourceId, listing.category ?? ""),
    ]);
    return { brandResolved, categoryResolved, fxRate };
  };

  /* ---- normalize + validate ---- */
  const accepted: NormalizedListing[] = [];
  const quarantined: Array<{ listing: NormalizedListing; reasons: string[] }> = [];
  const rejected: Array<{ listing: NormalizedListing; reasons: string[] }> = [];
  const dropped: Array<{ listing: NormalizedListing; reason: string }> = [];

  for (const raw of batch.listings) {
    const listing = adapter.toNormalizedListing(raw);
    if (!listing) {
      dropped.push({ listing: { externalListingId: "(unknown)", name: "(unparseable)", originalPrice: 0, originalCurrency: "", availability: "UNKNOWN", sourceProductUrl: "", gtins: [], mpn: null, sku: null, brand: null, category: null, colors: [], sizes: [], description: null, imageUrl: null, gender: null, salePrice: null, normalizedEur: null, attributes: [] }, reason: "adapter could not normalize (no id)" });
      continue;
    }
    const external = await resolveExternal(listing);
    const verdict = validateListing(listing, { external });
    if (verdict.status === "ACCEPT") accepted.push(listing);
    else if (verdict.status === "QUARANTINE") quarantined.push({ listing, reasons: verdict.reasons });
    else rejected.push({ listing, reasons: verdict.reasons });
  }

  /* ---- dedup decision forecast (pure) ---- */
  const dedupRows = accepted.map((l) => {
    const bundle: IdentityBundle = {
      gtins: l.gtins,
      brand: l.brand,
      mpn: l.mpn,
      sku: l.sku,
      name: l.name,
      color: l.colors[0] ?? null,
    };
    const layers = identityLayersOf(bundle).filter((la) => identityKey(la, bundle) !== "");
    return { id: l.externalListingId, layers };
  });

  /* ---- report ---- */
  console.log(`\nFetched           ${batch.listings.length} listings (hasMore=${batch.hasMore})`);
  console.log(`ACCEPT           ${accepted.length}`);
  console.log(`QUARANTINE       ${quarantined.length}`);
  console.log(`REJECT           ${rejected.length}`);
  console.log(`DROPPED(unparsed)${dropped.length}`);

  console.log("\n----- dedup identity forecast (accepted) -----");
  const LAYER_NAME: Record<number, string> = {
    1: "GTIN",
    2: "BRAND+MPN",
    3: "BRAND+SKU",
    4: "BRAND+NAME+COLOR",
    5: "SIMILARITY(fuzzy)",
  };
  for (const row of dedupRows.slice(0, 20)) {
    console.log(`   ${row.id} -> ${row.layers.map((l) => LAYER_NAME[l]).join(", ") || "(none)"}`);
  }
  if (accepted.length === 0) console.log("   (none accepted)");

  console.log("\n----- representative ACCEPT records -----");
  for (const l of accepted.slice(0, 5)) {
    const eur = normalizePriceToEurValue(l.originalPrice, parseCurrency(l.originalCurrency)!, fxRate);
    console.log(`   [${l.externalListingId}] ${l.name}`);
    console.log(`       brand=${l.brand} category=${l.category} color=${l.colors.join(",") || "-"} size=${l.sizes.map((s) => s.value).join(",") || "-"}`);
    console.log(`       price=${l.originalPrice} ${l.originalCurrency} (EUR≈${eur}) availability=${l.availability}`);
    console.log(`       purchaseUrl=${l.purchaseUrl ?? l.sourceProductUrl}`);
  }

  console.log("\n----- representative QUARANTINE records -----");
  for (const q of quarantined.slice(0, 8)) {
    console.log(`   [${q.listing.externalListingId}] ${q.listing.name || "(no name)"}`);
    for (const reason of q.reasons) console.log(`       - ${reason}`);
  }

  console.log("\n----- REJECTED records -----");
  for (const r of rejected.slice(0, 8)) {
    console.log(`   [${r.listing.externalListingId}] ${r.listing.name || "(no name)"}`);
    for (const reason of r.reasons) console.log(`       - ${reason}`);
  }

  if (pool) await pool.end();
  console.log("\n✅ DRY RUN COMPLETE - nothing written to the catalog DB.");
  console.log("Review the counts above before running a real import.");
}

main().catch((err) => {
  console.error("\n❌ Dry run failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
