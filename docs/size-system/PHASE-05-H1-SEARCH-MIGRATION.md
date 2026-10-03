# Phase 05 — H1: Canonical Search & Filtering — Migration Audit

> STATUS: **AUDIT ONLY.** No application code has been changed. This document is the
> prerequisite deliverable for H1. Migration begins only after this classification and
> transition policy are accepted.

## 1. Objective

Migrate the public **search / filtering** surface so that **canonical size filtering is
actually used in production**, reusing the Stage F primitives in `src/lib/size-domain/query.ts`.
No second size registry, no fuzzy matching, no string heuristics, no automatic system
conversion, no hidden inference, no hardcoded UI size lists. Search UI is **not** redesigned.

## 2. Guardrails (Stage H / H1)

- Correct + unresolved is preferable to incorrect + normalized.
- RESOLVED / UNRESOLVED / NOT_BACKFILLED must never collapse into each other.
- UNRESOLVED sizes are never assigned an invented identity.
- Availability is independent of canonical identity and is never merged into the size predicate.
- Size lives at variant / offer-variant grain — never `Product.canonicalSizeOptionId`.
- No `livostyle-womens-shoes-us` inference, no backfill policy change, no new charts.
- Do not hide products merely because their size data is unresolved / not backfilled.
- Reuse Stage F. Do not reproduce canonical logic.

## 3. Method

Inspected (read-only): `src/app/api/search/route.ts`, `src/lib/search-facets.ts`,
`src/lib/size-sections.ts`, `src/lib/sizes.ts`, `src/lib/facets.ts`,
`src/lib/search-parser.ts`, `src/lib/search-url.ts`, `src/app/api/meta/route.ts`,
`src/lib/catalog/size-vocabulary.ts`, `src/lib/outfit/*`, `src/lib/build/*`,
`src/components/home-page.tsx`, `src/app/outfit/outfit-client.tsx`,
`src/lib/size-domain/query.ts`, `src/lib/size-domain/persist.ts`, and the live dev DB
(read-only counts).

## 4. Live data state (read-only probe)

| Metric | Value |
| --- | --- |
| `ProductVariant` total | 4029 |
| `ProductVariant` with a `Size` row | 3977 |
| — RESOLVED | 3818 |
| — UNRESOLVED | 159 (all Livostyle footwear, `INSUFFICIENT_CONTEXT`) |
| — sized but canonical columns all NULL (NOT_BACKFILLED) | **0** |
| `ProductOfferVariant` total | 0 |
| Products with ≥1 canonical variant | 530 |

The Stage E backfill is complete for every sized variant in the current catalog. There are
**zero NOT_BACKFILLED sized rows today**; the policy below still defines their behavior for
newly-ingested rows prior to backfill.

## 5. Consumer inventory & classification

| # | Consumer | Location | Grain | Classification |
| --- | --- | --- | --- | --- |
| 1 | Server free-text size detection (`SIZE_ALIAS_WORDS`, `detectSizeSystem`) | `route.ts:471-481,509-580,1306-1357` | query | **INTENTIONALLY LEGACY / QUERY PARSING** (no product context → canonical identity impossible without guessing) |
| 2 | Server `sizeMatches` + `variantMatchesSizeSystem` + diagnostics presence probe | `route.ts:2169-2195,581-609,2881-2904` | variant | **MUST MIGRATE** (to canonical identity matching) |
| 3 | Server product query `where` (today availability-only, then full-catalog hydrate + JS rank) | `route.ts` (product load) | product | **MUST MIGRATE** (add DB-side canonical size predicate) |
| 4 | Server `productSizes` / `offerSizes` (raw `size.value` + offer chips) | `route.ts:1991-2037` | variant/offer | **MUST MIGRATE** (identity source) — display path stays |
| 5 | Client size facet option build (`getProductFacets`, `buildServerFacetBlock`) | `search-facets.ts:92-102,383-387` | product+variant | **MUST MIGRATE** |
| 6 | Client size facet match (`productMatchesSizeIdentity`, `productSizeTriples`) | `search-facets.ts:150-217`, `size-sections.ts:418-422` | product+variant | **MUST MIGRATE** |
| 7 | Size section chips (F19b) `buildSizeSectionColumns` / `productSizeRows` | `size-sections.ts:198-343` | product+variant | **MUST MIGRATE** (identity only; **display label preserved**) |
| 8 | `buildSizeSectionValues` | `size-sections.ts:424-455` | variant | **MUST MIGRATE** (identity source) |
| 9 | Questionnaire size catalog feed | `meta/route.ts:110-131` | variant | **INTENTIONALLY LEGACY / RAW feed → H2** |
| 10 | Questionnaire option builder (`buildSizeCatalog`, `sizeSectionsFor`, `STANDARD_*`) | `sizes.ts:224-469` | variant | **H2 (out of H1 scope)** |
| 11 | Build flow size vocabulary / input | `catalog/size-vocabulary.ts`, `lib/build/*` | — | **INTENTIONALLY LEGACY / RAW (Build)** |
| 12 | Outfit `?size=` free text + raw filter | `app/outfit/outfit-client.tsx` | — | **INTENTIONALLY LEGACY / RAW (Outfit)** |
| 13 | Offer chip expansion | `catalog/offer-vocab.ts` (`expandOfferSizeChips`) | offer | **INTENTIONALLY LEGACY / RAW** (offers empty; revisit on ingestion) |
| 14 | Diagnostics / coverage | `lib/size-diagnostics.ts`, diagnostics route | — | **INTENTIONALLY LEGACY / RAW (observability)** |
| 15 | `size.normalizedValue` lookup | `search-parser.ts:156-181` | — | **DEAD / UNUSED** (no caller; forbidden by the select-guard test) |
| 16 | Outfit catalog projection (already canonical) | `lib/outfit/catalog.ts:45-136` | variant/offer | **ALREADY MIGRATED (Stage G1)** |

Only consumers #2–#8 are in H1 scope. #9–#14 remain raw by design and are deferred to H2 or
explicitly out of scope; #15 is removed/dead; #16 is already canonical.

## 6. Detailed findings

### 6.1 Server search (`src/app/api/search/route.ts`, 3015 lines)

- The route accepts only `q, debug, limit, offset, priceMin, priceMax, soft`. **There is no
  size filter parameter.**
- Size only enters through **free-text detection**: `findMatchSpan` over catalog size values
  + `SIZE_ALIAS_WORDS`, folded to an alpha code (`"medium" → "M"`, `"2xl"` handling is
  elsewhere), optionally pinned by an adjacent system token (`EU/US/UK/IT/FR/INTERNATIONAL`).
- The size predicate is applied **in JS after hydrating the whole purchasable catalog**
  (`sizeMatches`, `route.ts:2169-2195`). With an explicit system it calls
  `variantMatchesSizeSystem` against legacy `Size.value`/`Size.system`; bare values compare
  against `productSizes` (normalized raw `Size.value` + offer chips). **Canonical columns are
  never read.**
- The Prisma `where` used to load products constrains availability only. Filtering
  (category/gender/price/size) is post-load and in-memory. Pagination is
  `Array.slice(offset, offset + limit)` over the ranked array — safe for ranking but not a
  DB predicate.
- Diagnostics presence probe (`route.ts:2881-2904`) repeats the same legacy comparison.

### 6.2 Client size facet (`search-facets.ts`, `size-sections.ts`)

- Option values are built from legacy `variant.size.value`; matching is done through
  `productSizeTriples` (`size-sections.ts`) using `variant.size.value` + `variant.size.system`
  + category-derived `productType` + product gender. This is semantically close to the
  canonical identity but sourced from **raw legacy fields**, so `Medium`/`2XL` etc. never fold
  to their canonical form and unresolved rows are treated as if they carried an identity.
- The size filter is applied **client-side over the currently-loaded window**; toggling a
  facet does **not** re-fetch (the fetch is keyed by the query intent, not the filters).
- Display values and matching identity are the **same string** today (one chip value). Canonical
  migration must split them: **identity = canonical**, **display = source label** (guardrail:
  `Medium` stays `Medium`).

### 6.3 Dead code

- `search-parser.ts:156-181` reads `Size.normalizedValue`, a column no live path writes. No
  caller imports this lookup. Classified dead/legacy and left untouched in H1 (removal is a
  separate cleanup).

## 7. Transition policy

Applied by the canonical filter path and the migrated facet. The single decision point remains
Stage F `readCanonicalSize()` / `matchesSizeFilter()`.

| State | Definition | Canonical identity filter | `sizeSystem` filter | Discoverable without a size filter | Facet chip |
| --- | --- | --- | --- | --- | --- |
| **RESOLVED** | backfilled, `canonicalSizeOptionId` present | matches iff identity equal (audience fold applied at product context) | matches iff system equal | yes | emitted with canonical identity + source label |
| **UNRESOLVED** | backfilled, processed, identity NULL | **never matches** (no invented identity) | matches iff stored system equal | yes | **not emitted as a canonical chip**; product still listed |
| **NOT_BACKFILLED** | all four canonical columns NULL while a source size exists | **never matches** | never matches | yes | not emitted; converges to RESOLVED/UNRESOLVED on ingest backfill |

Rationale / explicit non-choices:

- **No legacy raw-value fallback.** Matching a canonical request against raw `Size.value`
  would reintroduce a second matching/normalization path (forbidden §3) and re-invent the
  very identity problem H1 removes. There are zero such rows today.
- **UNRESOLVED stays discoverable** through every non-size query; it simply cannot satisfy a
  canonical size constraint. This is the intended trade-off (correct + unresolved).
- **`sizeSystem` is the only legitimate filter** that can reach UNRESOLVED rows, because the
  system is known even when the identity is not. This lets a future questionnaire pin a system
  without fabricating an identity.

## 8. Proposed migration (H1)

### 8.1 Server: DB-side canonical size filter (consumers #2, #3, #4)

- Add optional query params `size` (canonical wire identity `audience|discipline|system|value`)
  and `sizeSystem` to `/api/search`.
- Build the filter with `combineSizeFilters(filterByCanonicalSize(size), filterBySizeSystem(sizeSystem))`
  and, when non-empty, AND `productSizeFilterWhere(filter)` into the product `where` so the
  predicate reaches `ProductVariant_canonicalSizeOptionId_idx` /
  `..._sizeResolutionSystem_idx` at the DB boundary. Availability remains the existing,
  independent condition.
- Empty/absent params → **byte-identical current behavior** (no filter).
- Replace the legacy JS `sizeMatches` identity check with `matchesSizeFilter(pickCanonicalFields(…), filter)`
  **only** for the explicit filter channel. Free-text detection (#1) remains query parsing and
  is not turned into a canonical filter.

### 8.2 Serialize canonical fields (#4)

Add `canonicalSizeOptionId`, `sizeResolutionStatus`, `sizeResolutionSystem` to the search
variant/offer-variant projection and response so the client can build canonical identities.
Keep `size.value` / `size.system` for display and legacy compatibility.

### 8.3 Client facet (#5–#8)

- Build size **identities** from `readCanonicalSize` on the projected fields; emit canonical
  chips for RESOLVED only.
- Keep the **display** value as the source label (`sourceSizeLabel`), so `Medium` renders as
  `Medium` while its identity is `...|clothing|INTERNATIONAL|M`.
- `productMatchesSizeIdentity` compares canonical identities with the existing audience-fold
  rules (UNISEX → MEN/WOMEN only).
- `buildSizeSectionValues` / option sets derive from canonical identities.

### 8.4 Wire the active facet to the server

To make the canonical filter "actually used in production", the active size selection is sent
to `/api/search` as `size`/`sizeSystem` so the result window is filtered at the DB boundary
instead of in JS. **This is the one behavioral change** (a size-facet toggle re-fetches). The
UI markup is unchanged. See §12 for the alternative.

## 9. Test plan (≥15, real query paths)

1. RESOLVED identity exact match returns the product.
2. RESOLVED identity non-match excludes the product.
3. Same value, different audience (MEN `M` vs WOMEN `M`) does not match.
4. Same value, different system (EU `42` vs US `42`) does not match.
5. UNRESOLVED never matches a canonical identity filter.
6. UNRESOLVED is still returned when no size filter is active.
7. `sizeSystem` filter matches RESOLVED **and** UNRESOLVED rows of that system.
8. Synthetic NOT_BACKFILLED row never matches any canonical filter and is discoverable without one.
9. Empty filter constrains nothing.
10. Availability + size composition (unavailable matching variant does not surface).
11. Product/category + size composition (result set is the intersection).
12. Multiple simultaneous filters (size + gender + color + brand).
13. Pagination stable and duplicate-free across pages (deterministic `id` asc).
14. A product matching via both a variant and an offer appears once.
15. Client chip identity equals the canonical wire identity; display label unchanged (`Medium`).
16. No canonical filter → free-text/legacy behavior unchanged.
17. Unrecognized size string produces no canonical filter (no fabricated identity).

## 10. Performance evidence plan

- Capture `EXPLAIN (ANALYZE, BUFFERS)` for the search product query with a canonical size
  predicate; confirm index usage on the two Stage E indexes and absence of a full product scan.
- Record the plan in the H1 gate report alongside the existing Stage F evidence.

## 11. Out of scope (H2 / later)

Questionnaire option build (#9, #10), Build (#11), Outfit (#12), offer chips (#13) remain raw.
H2 covers `Questionnaire → Canonical Size Selection → Search Integration`.

## 12. Open decision before implementation

The only consequential fork is **§8.4**:

- **Option A (recommended):** send the active size facet to the server and filter at the DB
  boundary; a facet toggle re-fetches. Fully satisfies §9 ("do not load the catalog and filter
  size in JS") and makes canonical filtering genuinely production-used.
- **Option B (lower-risk):** keep the window-scoped client filter but rebuild it from canonical
  identities; expose the server `size`/`sizeSystem` channel for H2/questionnaire only. The
  server filter exists and is tested, but the public facet still filters client-side.

Awaiting confirmation of A vs B before writing code.
