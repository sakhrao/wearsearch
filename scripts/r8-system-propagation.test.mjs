/* R8: Questionnaire size-system propagation (system identity + B0).

   The questionnaire lets the user pick a size from a system-labelled
   column (EU / US / ...), but previously buildIntent dropped the
   system and emitted only the bare numeric value, so the choice never
   reached the engine's strict matching. R8-C fixes the producer side
   (find/page.tsx buildIntent) to carry the chosen system as an
   adjacent token (e.g. "eu 42") so the existing parser
   (detectSizeSystem) + variantMatchesSizeSystem enforce it.

   This suite locks the R8 contract end-to-end at the live API, using
   the EXACT query strings the questionnaire now produces. In line
   with the R8-B decision it asserts system IDENTITY and SEPARATION,
   not hardcoded result counts (data volume may change over time).

   Assertions:
     - structuredQuery.sizeSystem carries the chosen system next to a
       matching size value.
     - strict separation: under an explicit system+value constraint,
       NO serialized variant of any exact result may carry the same
       value under a DIFFERENT system (EU 42 excludes a US 42, etc.).
     - B0 preserved: a bare size query keeps sizeSystem=null and is
       not re-interpreted / converted.
     - INTERNATIONAL + letter sizes parse and stay strict (no fallback
       to bare for an explicit system).
     - no EU<->US conversion anywhere in the chain.

   Usage: npx tsx scripts/r8-system-propagation.test.mjs
   Requires the dev server on BASE_URL.
*/

const BASE_URL =
  process.env.TEST_BASE_URL || "http://localhost:3000";

async function search(q) {
  const res = await fetch(
    `${BASE_URL}/api/search?q=${encodeURIComponent(q)}`,
    { signal: AbortSignal.timeout(15000) }
  );
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    failures.push({ name, detail });
    console.log(`FAIL ${name} :: ${detail}`);
  }
}

/* Strictness helper: every serialized exact-result variant must carry
   the requested value under exactly the requested system when an
   explicit system is present. Cross-system bleed = violation. */
async function assertStrictSeparation(name, q, expectedSystem, expectedSize) {
  let json;
  try {
    json = await search(q);
  } catch (e) {
    check(name, false, `request error: ${e.message}`);
    return;
  }
  const sq = json.structuredQuery || {};
  check(
    `${name}: sizeSystem identity`,
    sq.sizeSystem === expectedSystem && sq.size === expectedSize,
    `got sizeSystem=${sq.sizeSystem} size=${sq.size} for q="${q}"`
  );
  const products = json.exactProducts || [];
  let bleed = [];
  for (const p of products) {
    for (const v of p.variants || []) {
      const sz = v.size;
      if (
        sz &&
        String(sz.value) === String(expectedSize) &&
        (sz.system || "").toUpperCase() !== expectedSystem
      ) {
        bleed.push(
          `${p.name}#${sz.value}/${sz.system}`
        );
      }
    }
  }
  check(
    `${name}: strict separation (no cross-system bleed)`,
    bleed.length === 0,
    `cross-system variants: ${bleed.join("; ")}`
  );
}

async function main() {
  console.log(`R8 system-propagation suite`);
  console.log(`Target: ${BASE_URL}/api/search\n`);

  try {
    const ping = await fetch(
      `${BASE_URL}/api/search?q=ping`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!ping.ok) {
      throw new Error(`HTTP ${ping.status}`);
    }
  } catch (error) {
    console.error(
      `FAIL: dev server unreachable at ${BASE_URL}`
    );
    console.error(`Start it first: npm run dev`);
    process.exit(1);
  }

  /* AC-1 / AC-2: EU selection from questionnaire (numeric footwear). */
  await assertStrictSeparation(
    "[AC-1/2] EU 40 WOMEN Sneakers",
    "women eu 40 sneakers",
    "EU",
    "40"
  );

  /* AC-3: US selection from questionnaire. */
  await assertStrictSeparation(
    "[AC-3] US 8 WOMEN Heels",
    "women us 8 heels",
    "US",
    "8"
  );

  /* AC-5: EU + MEN + category. */
  await assertStrictSeparation(
    "[AC-5] EU 42 MEN Sneakers",
    "men eu 42 sneakers",
    "EU",
    "42"
  );

  /* US 42 (Livostyle US-tagged catalog). */
  await assertStrictSeparation(
    "[R4] US 42",
    "us 42",
    "US",
    "42"
  );

  /* AC-4 / B0: bare size keeps sizeSystem=null and no conversion. */
  {
    const json = await search("42");
    const sq = json.structuredQuery || {};
    check(
      "[AC-4/B0] bare '42' keeps sizeSystem=null",
      sq.sizeSystem === null && sq.size === "42",
      `got sizeSystem=${sq.sizeSystem} size=${sq.size}`
    );
    check(
      "[B0] bare '42' not converted (no sizeSystem injected)",
      sq.sizeSystem === null,
      "sizeSystem must stay null for a bare size"
    );
  }

  /* AC-6 / fallback: no system token -> bare identity, legacy. */
  {
    const json = await search("women 8 heels");
    const sq = json.structuredQuery || {};
    check(
      "[AC-6] gender+size bare keeps sizeSystem=null",
      sq.sizeSystem === null && sq.size === "8",
      `got sizeSystem=${sq.sizeSystem} size=${sq.size}`
    );
  }

  /* Condition 1: INTERNATIONAL + letter sizes parse and stay strict
     (parser conformance; the questionnaire never emits INTERNATIONAL
      for CLOTHING, but free search must keep working). */
  {
    const json = await search(
      "women international m t-shirt"
    );
    const sq = json.structuredQuery || {};
    check(
      "[C1] INTERNATIONAL M -> sizeSystem=INTERNATIONAL",
      sq.sizeSystem === "INTERNATIONAL" &&
        sq.size === "M",
      `got sizeSystem=${sq.sizeSystem} size=${sq.size}`
    );
  }

  /* Round-trip identity (refresh / deep-link): the same query string
     reproduces the same system identity - the prefix lives in q, so
     no state is needed to survive reload. */
  {
    const a = await search("women eu 40 sneakers");
    const b = await search("women eu 40 sneakers");
    check(
      "[AC-8] repeat/deep-link reproduces sizeSystem identity",
      (a.structuredQuery || {}).sizeSystem ===
        (b.structuredQuery || {}).sizeSystem,
      `first=${(a.structuredQuery || {}).sizeSystem} second=${(b.structuredQuery || {}).sizeSystem}`
    );
  }

  console.log(`\n================ RESULT ================`);
  console.log(`${passed}/${passed + failed} passed`);
  if (failed > 0) {
    console.log(`\nFailures:`);
    for (const f of failures) {
      console.log(`  - ${f.name}: ${f.detail}`);
    }
    process.exit(1);
  }
}

main();
