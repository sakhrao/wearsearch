const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

/* =====================================================================
   Stage 3-C (Parser/Search) acceptance guard.

   The engine now understands an EXPLICIT size system (EU, US, UK, IT,
   FR, INTERNATIONAL) as part of the size identity, but ONLY when a
   size value is present in the query and the system token sits next
   to it. Everything else - bare-size queries ("42", "sneakers 42"),
   the "size 45 sneakers" contract (D3), gender rules - keeps its
   exact pre-3-C behavior.

   Unified gender rule (approved): KIDS never matches UNISEX in the
   Questionnaire, the Refine facets, or the search engine; MEN/WOMEN
   may match UNISEX. "EU 42" matches EU-stored 42 only; "US 42"
   matches US-stored 42 only; a queried system with no stored data is
   an honest empty + diagnostic.

   LIVE-DATA NOTE (2026-08-31): the real (F1-pruned) catalog carries
   US-tagged sizes only; every EU size lives on demo/placeholder
   products that F1 excludes from results. So explicit-EU queries on
   this catalog are honest empties, and the sharpest live proof of
   system strictness is the DIFFERENCE between a bare number and its
   EU form (e.g. "women shoes 40" = 21, "women shoes EU 40" = 0).

   No ranking weights, pagination, /api/meta, Schema, or DB changes.
   ===================================================================== */

let passed = 0;
let failed = 0;

function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name} :: ${detail}`);
  }
}

async function search(q) {
  const res = await fetch(
    `${BASE_URL}/api/search?q=${encodeURIComponent(q)}&debug=1`
  );
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for "${q}"`);
  }
  return res.json();
}

function norm(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/['’]s(?=\s|$)/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function productHasAvailableSize(product, value, system) {
  return product.variants.some(
    (variant) =>
      variant.availability === "AVAILABLE" &&
      variant.size &&
      norm(variant.size.value) === norm(value) &&
      (!system || norm(variant.size.system) === norm(system))
  );
}

function allProducts(d) {
  return [...d.exactProducts, ...d.similarProducts];
}

/* ------------------------------------------------------------------
   C1. "men shoes EU 42" -> explicit system consumed, audience derived.
   Live catalog has no real EU product, so this is an HONEST EMPTY -
   the US-42 twins must not leak in. 
------------------------------------------------------------------ */
{
  const d = await search("men shoes EU 42");
  check(
    "C1 'men shoes EU 42' keeps abstract size 42",
    d.structuredQuery.size === "42",
    `size=${d.structuredQuery.size}`
  );
  check(
    "C1 'men shoes EU 42' -> sizeSystem=EU, sizeAudience=MEN",
    d.structuredQuery.sizeSystem === "EU" &&
      d.structuredQuery.sizeAudience === "MEN",
    `sizeSystem=${d.structuredQuery.sizeSystem} sizeAudience=${d.structuredQuery.sizeAudience}`
  );
  check(
    "C1 honest empty: no real EU-42 product in this catalog",
    d.exactCount === 0 && d.similarCount === 0,
    `exact=${d.exactCount} similar=${d.similarCount}`
  );
}

/* ------------------------------------------------------------------
   C2. "men shoes 42" (bare) -> no system consumed, legacy path.
------------------------------------------------------------------ */
{
  const d = await search("men shoes 42");
  check(
    "C2 'men shoes 42' -> sizeSystem stays null",
    d.structuredQuery.sizeSystem === null,
    `sizeSystem=${d.structuredQuery.sizeSystem}`
  );
  check(
    "C2 'men shoes 42' -> sizeAudience stays null",
    d.structuredQuery.sizeAudience === null,
    `sizeAudience=${d.structuredQuery.sizeAudience}`
  );
  check(
    "C2 'men shoes 42' keeps abstract size 42",
    d.structuredQuery.size === "42",
    `size=${d.structuredQuery.size}`
  );
  check(
    "C2 bare path matches exactly the pre-3-C value-only result",
    d.exactCount === 0,
    `exact=${d.exactCount}`
  );
}

/* ------------------------------------------------------------------
   C3. "women shoes US 10" -> US column, WOMEN audience, live matches.
------------------------------------------------------------------ */
{
  const d = await search("women shoes US 10");
  const bare = await search("women shoes 10");
  check(
    "C3 'women shoes US 10' -> sizeSystem=US, sizeAudience=WOMEN",
    d.structuredQuery.sizeSystem === "US" &&
      d.structuredQuery.sizeAudience === "WOMEN",
    `sizeSystem=${d.structuredQuery.sizeSystem} sizeAudience=${d.structuredQuery.sizeAudience}`
  );
  check(
    "C3 'women shoes US 10' has results",
    d.exactCount > 0,
    `exact=${d.exactCount}`
  );
  check(
    "C3 every result carries an available US 10 variant",
    allProducts(d).every((p) =>
      productHasAvailableSize(p, "10", "US")
    ) && d.exactCount > 0,
    `n=${allProducts(d).length}`
  );
  check(
    "C3 explicit US 10 agrees with the bare 10 result (all real sizes are US)",
    d.exactCount === bare.exactCount,
    `us10=${d.exactCount} bare=${bare.exactCount}`
  );
}

/* ------------------------------------------------------------------
   C4. "women shoes EU 40" -> EU-only. Bare "women shoes 40" returns
   the US-40 products (21); the EU form must return none of them.
------------------------------------------------------------------ */
{
  const d = await search("women shoes EU 40");
  const bare = await search("women shoes 40");
  check(
    "C4 'women shoes EU 40' -> sizeSystem=EU, sizeAudience=WOMEN",
    d.structuredQuery.sizeSystem === "EU" &&
      d.structuredQuery.sizeAudience === "WOMEN",
    `sizeSystem=${d.structuredQuery.sizeSystem} sizeAudience=${d.structuredQuery.sizeAudience}`
  );
  check(
    "C4 EU-40 never folds to the US-40 products",
    d.exactCount === 0 && bare.exactCount > 0,
    `eu40=${d.exactCount} bare40=${bare.exactCount}`
  );
}

/* ------------------------------------------------------------------
   C5. "US 10" standalone -> system consumed, no gender/audience.
------------------------------------------------------------------ */
{
  const d = await search("US 10");
  check(
    "C5 'US 10' -> sizeSystem=US, sizeAudience=null",
    d.structuredQuery.sizeSystem === "US" &&
      d.structuredQuery.sizeAudience === null,
    `sizeSystem=${d.structuredQuery.sizeSystem} sizeAudience=${d.structuredQuery.sizeAudience}`
  );
  check(
    "C5 'US 10' has results",
    d.exactCount > 0,
    `exact=${d.exactCount}`
  );
  check(
    "C5 every result carries an available US 10 variant",
    allProducts(d).every((p) =>
      productHasAvailableSize(p, "10", "US")
    ) && d.exactCount > 0,
    `n=${allProducts(d).length}`
  );
}

/* ------------------------------------------------------------------
   C6. "EU 42" vs "US 42" -> column isolation on live data. The US-42
   result set (21 products) must NEVER satisfy the EU-42 query.
------------------------------------------------------------------ */
{
  const d = await search("EU 42");
  const us = await search("US 42");
  check(
    "C6 'EU 42' -> sizeSystem=EU, sizeAudience=null",
    d.structuredQuery.sizeSystem === "EU" &&
      d.structuredQuery.sizeAudience === null,
    `sizeSystem=${d.structuredQuery.sizeSystem} sizeAudience=${d.structuredQuery.sizeAudience}`
  );
  check(
    "C6 US 42 matches, EU 42 does not (system is part of the identity)",
    us.exactCount > 0 && d.exactCount === 0,
    `us42=${us.exactCount} eu42=${d.exactCount}`
  );
}

/* ------------------------------------------------------------------
   C7. "42" bare stays untyped (no EU/US inference).
------------------------------------------------------------------ */
{
  const d = await search("42");
  check(
    "C7 '42' -> size=42, no system, no audience",
    d.structuredQuery.size === "42" &&
      d.structuredQuery.sizeSystem === null &&
      d.structuredQuery.sizeAudience === null,
    `size=${d.structuredQuery.size} sizeSystem=${d.structuredQuery.sizeSystem} sizeAudience=${d.structuredQuery.sizeAudience}`
  );
}

/* ------------------------------------------------------------------
   C8. A queried system with no stored data is an honest empty:
   "size 40 uk sneakers" -> no UK column -> no invented match.
------------------------------------------------------------------ */
{
  const d = await search("size 40 uk sneakers");
  check(
    "C8 'size 40 uk sneakers' -> sizeSystem=UK",
    d.structuredQuery.sizeSystem === "UK",
    `sizeSystem=${d.structuredQuery.sizeSystem}`
  );
  check(
    "C8 UK column absent -> honest empty with size diagnostic",
    d.exactCount === 0 &&
      d.similarCount === 0 &&
      (d.diagnostics ?? []).some((m) =>
        String(m).includes("Size 40")
      ),
    `exact=${d.exactCount} similar=${d.similarCount} diag=[${(d.diagnostics ?? []).join(" | ")}]`
  );
}

/* ------------------------------------------------------------------
   C9. D3 contract preserved: "size 45 sneakers" is still a bare size
   query with the same diagnostic wording (no sizeSystem emitted).
------------------------------------------------------------------ */
{
  const d = await search("size 45 sneakers");
  check(
    "C9 'size 45 sneakers' -> size=45, sizeSystem=null (legacy path)",
    d.structuredQuery.size === "45" &&
      d.structuredQuery.sizeSystem === null,
    `size=${d.structuredQuery.size} sizeSystem=${d.structuredQuery.sizeSystem}`
  );
  check(
    "C9 diagnostic still explains the unavailable size",
    (d.diagnostics ?? []).some((m) =>
      String(m).includes("Size 45")
    ),
    `diag=[${(d.diagnostics ?? []).join(" | ")}]`
  );
}

/* ------------------------------------------------------------------
   C10. Unified KIDS rule: "kids sneakers" surfaces KIDS results only -
   UNISEX never folds into a KIDS search.
------------------------------------------------------------------ */
{
  const d = await search("kids sneakers");
  check(
    "C10 'kids sneakers' detected as KIDS",
    d.structuredQuery.gender === "KIDS",
    `gender=${d.structuredQuery.gender}`
  );
  const all = allProducts(d);
  check(
    "C10 no UNISEX/MEN/WOMEN leak into a KIDS result",
    all.every((p) => p.gender === "KIDS"),
    `genders=${[...new Set(all.map((p) => p.gender))].join(",")}`
  );
}

/* ------------------------------------------------------------------
   C11. "eu 41 sneakers" (regression case) -> the formerly inert "eu"
   is now a system constraint: EU-41 only, honest empty on live data,
   while bare "sneakers 41" keeps its 7 matches.
------------------------------------------------------------------ */
{
  const eu = await search("eu 41 sneakers");
  const bare = await search("sneakers 41");
  check(
    "C11 'eu 41 sneakers' -> sizeSystem=EU, size=41",
    eu.structuredQuery.sizeSystem === "EU" &&
      eu.structuredQuery.size === "41",
    `sizeSystem=${eu.structuredQuery.sizeSystem} size=${eu.structuredQuery.size}`
  );
  check(
    "C11 'eu 41 sneakers' honest empty while bare 'sneakers 41' still matches",
    eu.exactCount === 0 && bare.exactCount > 0,
    `eu41=${eu.exactCount} bare41=${bare.exactCount}`
  );
}

/* ------------------------------------------------------------------
   C12. blouse alias (lexicon only): "size medium blouse" resolves to
   the Blouses category exactly as a bare size query.
------------------------------------------------------------------ */
{
  const d = await search("size medium blouse");
  check(
    "C12 'size medium blouse' -> category=Blouses, size=M, no system",
    d.structuredQuery.category === "Blouses" &&
      d.structuredQuery.size === "M" &&
      d.structuredQuery.sizeSystem === null,
    `category=${d.structuredQuery.category} size=${d.structuredQuery.size} sizeSystem=${d.structuredQuery.sizeSystem}`
  );
  check(
    "C12 'size medium blouse' has results",
    d.exactCount > 0,
    `exact=${d.exactCount}`
  );
}

console.log(`\nsearch-parser-context: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;