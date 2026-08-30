/* F12 (N-FX0): a search without a budget must not trigger the
   optional Frankfurter getFxRate() lookup; a budget search must
   still fetch and use it. Runs in-process against the real DB
   (like catalog-integrity), intercepting globalThis.fetch for the
   frankfurter domain so the assertions are network-safe and fully
   deterministic. Fails pre-fix (non-budget hits == 1), passes
   post-fix (non-budget hits == 0).

   Usage: npx tsx scripts/f12-fx-lazy.test.mts */
import "dotenv/config";
import assert from "node:assert";
import { NextRequest } from "next/server";
import { GET } from "../src/app/api/search/route";
import { resetFxCacheForTests } from "../src/lib/currency";

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  PASS ${name}`);
};

const frankfurterHits = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith("https://api.frankfurter.app/")) {
    frankfurterHits.push(url);
    return new Response(
      JSON.stringify({ date: "2026-01-01", rates: { USD: 1.1 } }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
  return realFetch(input, init);
};

/* ---- 1) non-budget search must NOT call getFxRate() ---- */
resetFxCacheForTests();
frankfurterHits.length = 0;

const nbRes = await GET(
  new NextRequest("http://localhost:3000/api/search?q=clothing&debug=1")
);
const nb = await nbRes.json();

check("non-budget returns success", () => assert.equal(nbRes.status, 200));
check("non-budget success flag", () => assert.equal(nb.success, true));
check("non-budget exactCount intact", () => assert.equal(nb.exactCount, 517));
check("non-budget budget null", () => assert.equal(nb.structuredQuery?.budget, null));
check("non-budget facets present", () => assert.ok(Array.isArray(nb.facets?.size)));
check("non-budget: zero fx lookups", () => assert.equal(frankfurterHits.length, 0));

/* ---- 2) budget search must still call and use getFxRate() ---- */
resetFxCacheForTests();
frankfurterHits.length = 0;

const bRes = await GET(
  new NextRequest(
    "http://localhost:3000/api/search?q=clothing&priceMin=30&priceMax=150&debug=1"
  )
);
const b = await bRes.json();

check("budget returns success", () => assert.equal(bRes.status, 200));
check("budget parsed as {min,max}", () =>
  assert.deepEqual(b.structuredQuery?.budget, { min: 30, max: 150 }));
check("budget: exactly one fx lookup", () =>
  assert.equal(frankfurterHits.length, 1));
check("budget count under fake rate unchanged", () =>
  assert.equal(b.exactCount, 357));

/* ---- 3) corpus parity anchors ---- */
resetFxCacheForTests();
frankfurterHits.length = 0;

const topsRes = await GET(
  new NextRequest("http://localhost:3000/api/search?q=tops&debug=1")
);
const tops = await topsRes.json();

check("corpus non-budget (tops) zero fx", () =>
  assert.equal(frankfurterHits.length, 0));
check("corpus non-budget (tops) count intact", () =>
  assert.equal(tops.exactCount, 411));

console.log(`F12 fx-lazy: ${passed} passed, 0 failed`);
process.exit(0);