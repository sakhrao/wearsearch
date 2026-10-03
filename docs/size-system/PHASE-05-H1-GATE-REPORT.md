# Phase 05 — H1: Canonical Search & Filtering — GATE REPORT

> STATUS: **IMPLEMENTED — AWAITING H1 APPROVAL.**
> H2 (`Questionnaire → Canonical Size Selection → Search`) does **not** start until this gate
> is explicitly accepted.

## 1. Scope delivered

Migrate the public search / filtering surface so the **canonical Stage F path is actually used
in production**, per the accepted audit (`PHASE-05-H1-SEARCH-MIGRATION.md`) and the two
confirmed architecture decisions:

- **Q1 — Server DB filter + facet refetch.** The active size facet is sent to `/api/search` and
  the canonical decision is made at the database boundary (Stage F), not in JS. A size toggle
  re-fetches. Search UI markup is unchanged.
- **Q2 — DB ID query + unfiltered size block.** The server runs the canonical predicate as an
  index-backed product-ID query and intersects the ranked set at serialization, while the size
  facet block is computed over the **full unfiltered ranked set** so multi-select never
  collapses.

## 2. Files changed (H1)

| File | Change |
| --- | --- |
| `src/app/api/search/route.ts` | `size`/`sizeSystem` params; Stage F DB filter; canonical serialization; unfiltered `sizeSections`; filtered intersection + recomputed counts/hasMore |
| `src/components/home-page.tsx` | sends active size facet on refetch/loadMore; `refineBySize`; server size block state; size excluded from client double-filter |
| `src/lib/search-facets.ts` | `getProductFacets` size entries + match from canonical identities |
| `src/lib/size-sections.ts` | `resolvedCanonicalSize()`; canonical `productSizeRows`; chip `displayValue`/`count`; canonical `buildSizeSectionValues` |
| `scripts/size-domain-h1-search.test.mts` | **new** — 25 real query-path cases |
| `scripts/facet-counts.test.mts`, `scripts/size-identity.test.mts`, `scripts/size-sections.test.mts` | fixtures migrated to canonical identities (contract change, not behavior regression) |
| `package.json` | `test:size-domain-h1` script |

No change to `SIZE_ALIAS_WORDS` / `detectSizeSystem` free-text parsing (#1, intentionally
legacy), Build (#11), Outfit (#12), offer chips (#13), diagnostics (#14), or the questionnaire
feed (#9/#10 → H2).

## 3. Consumers (audit numbering)

| # | Consumer | Outcome |
| --- | --- | --- |
| 1 | Free-text size detection | INTENTIONALLY LEGACY / QUERY PARSING (unchanged) |
| 2 | Server `sizeMatches` / `variantMatchesSizeSystem` | replaced for the explicit filter channel by Stage F `findProductIdsBySizeFilter`; free-text detection unchanged |
| 3 | Server product load `where` | **not** AND-ed (preserves ranking/envelope); canonical predicate runs as a separate index-backed ID query (see §5) |
| 4 | Server `productSizes` / projection | canonical fields serialized alongside legacy display fields |
| 5 | `getProductFacets` | MIGRATED to canonical identities |
| 6 | `productMatchesSizeIdentity` / `productSizeTriples` | MIGRATED (canonical triples) |
| 7 | `buildSizeSectionColumns` / `productSizeRows` | MIGRATED (identity canonical, display label preserved) |
| 8 | `buildSizeSectionValues` | MIGRATED (canonical) |
| 9–10 | Questionnaire feed / builder | H2 (untouched) |
| 11–14 | Build / Outfit / offer chips / diagnostics | INTENTIONALLY LEGACY / RAW (untouched) |
| 15 | `search-parser.ts` normalizedValue lookup | DEAD (untouched) |
| 16 | Outfit catalog projection | ALREADY MIGRATED (G1) |

## 4. Transition policy implemented

- **RESOLVED** — matches a canonical identity iff the wire identity is equal (audience fold:
  UNISEX ↔ MEN/WOMEN only); emits a chip carrying the canonical identity + the untouched source
  label in `value`.
- **UNRESOLVED** — never matched by a canonical identity; matched by `sizeSystem` when the
  stored system equals the request; still returned with no size filter; no canonical chip.
- **NOT_BACKFILLED** — never matched by either predicate; still returned with no size filter; no
  chip; no legacy raw-value fallback (forbidden by §3).

## 5. DB boundary & performance evidence

The canonical predicate is executed by `findProductIdsBySizeFilter(prisma, filter, { availability: "AVAILABLE" })`
(Stage F), once per selected identity (`size`) or once per system (`sizeSystem`), unioned; the
ranked exact/similar lists are intersected with the returned id set at serialization; counts
and `hasMore` are recomputed over the filtered set. `sizeSections` is computed over the
**unfiltered** exact+similar set.

`EXPLAIN (ANALYZE, BUFFERS)` for the canonical identity predicate (fresh run):

```
Bitmap Heap Scan on "ProductVariant"  (actual rows=727)
  Recheck Cond: ("canonicalSizeOptionId" = 'WOMEN|clothing|INTERNATIONAL|M'::text)
  ->  Bitmap Index Scan on "ProductVariant_canonicalSizeOptionId_idx"  (actual rows=727)
        Index Cond: ("canonicalSizeOptionId" = '...'::text)
Execution Time: 45.486 ms
```

Index-backed, no full table scan; consistent with the Stage F query-plan evidence
(`..._canonicalSizeOptionId_idx`, `..._sizeResolutionSystem_idx`).

## 6. Verification results

| Suite | Result |
| --- | --- |
| `npm run typecheck` | PASS (0 errors) |
| `npm run build` (Next 16.3.2 Turbopack) | PASS |
| `npm run test:size-domain-h1` (new) | **25 passed, 0 failed** |
| `npm run test:facet-counts` | 11 / 11 |
| `tsx scripts/size-identity.test.mts` | 31 / 31 |
| `tsx scripts/size-sections.test.mts` | 9 / 9 |
| `tsx scripts/f13-window-facets.test.mts` | 9 / 9 |
| `npm run test:size-domain` | 22 / 22 |
| `npm run test:size-domain-normalize` | 42 / 42 |
| `npm run test:size-domain-product-integration` | 26 / 26 |
| `npm run test:size-domain-stage-d` | 24 / 24 |
| `npm run test:size-domain-stage-e` | 18 / 18 |
| `npm run test:size-domain-stage-f` | 25 / 25 |
| `npm run test:size-domain-g1-migration` | 12 / 12 |
| `npm run test:size-domain-chart` | 16 / 16 |
| `npm run test:taxonomy` | 83 / 87 (unchanged baseline) |
| `npm run test:taxonomy-ids` | 15 / 15 |
| `npm run test:url-state` | 29 / 29 |
| `npm run test:edit-restore` | 36 / 36 |

B1. **Environment-limited suites (not regressions):** `o4-facet-equivalence` (14/19),
`f10-pagination`, `search-regression`, `outfit-api`, `outfit-prefs`, `diagnostics`,
`facet-policy` require a dev server at `localhost:3000` and fail with `ECONNREFUSED` /
`fetch failed` locally. H1 route wiring is covered by the DB + primitive tests above.

## 7. H1 test coverage (`scripts/size-domain-h1-search.test.mts`)

Pure: canonical chip identity + source label; UNRESOLVED/NOT_BACKFILLED never emit a chip; US≠EU
and MEN≠WOMEN identities never merge; `countProductsForFacetValue` counts only carrying
products and never UNRESOLVED; `getProductFacets` exposes canonical identity + source label;
canonical size predicate accepts the carrying product and rejects a different identity /
unresolved-only product.

DB (real, index-backed): a live resolved identity resolves to products; every matched product
carries an AVAILABLE resolved variant with that identity; `sizeSystem` matches only products
with an AVAILABLE variant in that system; unknown identity → ∅; unresolved rows carry no
canonical identity and stay discoverable without a filter; intersection preserves counts;
pagination slices the filtered set; the id filter is deterministic and id-ordered.

## 8. Deviations from the audit (explicit)

1. **§8.1 where-AND → ID-query + intersection.** The audit proposed AND-ing
   `productSizeFilterWhere` into the main product `where`. Implemented instead as the accepted
   Q2 design: an index-backed ID query (`findProductIdsBySizeFilter`) intersected at
   serialization. Rationale: the search engine already hydrates/ranks in full for
   exact/similar scoring and pagination; AND-ing the predicate into the load would alter the
   ranked envelope and facet truth. The canonical decision still happens at the DB boundary.
2. **Availability.** Passed explicitly as `{ availability: "AVAILABLE" }`, mirroring the
   existing purchasable-product gate; normalization never merges availability into identity.

## 9. Known limitations / follow-ups

- `ProductOfferVariant` is empty (0 rows); the offer-variant grain of Stage F is exercised by
  Stage F tests but has no live search data. Revisit on offer ingestion.
- No live NOT_BACKFILLED sized rows today; that branch is covered by synthetic tests only.
- The public facet refetch is the one behavioral change (a size toggle re-fetches). Non-size
  facets remain window-scoped client filters.
- Server-side size chip counts are computed against the unfiltered ranked set (by design, to
  keep multi-select usable); other active facets do not shrink them.

## 10. Gate decision requested

Approve H1 to proceed to **H2 — Questionnaire → Canonical Size Selection → Search**, or return
with changes. No H2 work will begin until approved.
