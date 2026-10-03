# Size System — Phase 3 / Stage F — Canonical Size Read Path & Size-System Filtering

Stage F establishes exactly two things and no more:

- **A.** the single canonical read path, so no caller branches on
  canonical-vs-legacy itself;
- **B.** a variant/offer-variant-grain size filter over the two Stage E columns.

It introduces no migration, no write, no inference, and no UI/search/product
integration. Public consumers keep reading the legacy `Size` relation unchanged
until a later, explicitly-approved stage migrates them.

## 1. Scope and non-goals

In scope (deliverables): `src/lib/size-domain/query.ts`,
`scripts/size-domain-stage-f.test.mts`,
`docs/size-system/PHASE-03-STAGE-F-AUDIT.md`, this document, one `package.json`
script.

Out of scope and untouched: public search (`src/app/api/search/route.ts`),
Questionnaire, `/product/[productId]`, Size Guide, Results Cards, any existing
size consumer, Prisma schema, migrations, and any data write.
`APPROVED_SIZE_SYSTEM_POLICIES` stays `[]`; the Livostyle candidate stays
unapproved.

## 2. Contract summary

```
readCanonicalSize()  — the ONE canonical read boundary
canonicalSizeOptionId filter  → matches ONLY resolved rows
sizeResolutionSystem filter   → matches resolved AND unresolved rows
predicates compose with AND; empty filter constrains nothing
availability is an explicit, independent, opt-in condition only
Product queries traverse variant/offer-variant grain via the relation
```

The four review requirements map to concrete code:

| Requirement | Where |
| --- | --- |
| Single canonical read path | `readCanonicalSize()` (`query.ts`) wrapping `readCanonicalOrLegacySize()` |
| Distinguish the three states | `SizeReadState = RESOLVED \| UNRESOLVED \| NOT_BACKFILLED` |
| System filter works when identity is null | `matchesSizeSystem()` ignores `sizeResolutionStatus` |
| No load-all-and-normalize | `productSizeFilterWhere()` → equality on indexed columns |

## 3. The canonical read path (§4 of the spec)

`readCanonicalSize(input)` returns `CanonicalSizeRead`:

| Field | Meaning |
| --- | --- |
| `state` | `RESOLVED`, `UNRESOLVED`, or `NOT_BACKFILLED` |
| `canonicalSizeOptionId` | set only when `state === "RESOLVED"`, else `null` |
| `system` | persisted system component; for a legacy row, the raw fallback system |
| `status` | `RESOLVED`/`UNRESOLVED`, or `null` when not backfilled |
| `provenance` | `EXPLICIT`/`INFERRED`/`UNRESOLVED`, or `null` when not backfilled |
| `sourceSizeLabel` | the untouched raw source label |
| `usedLegacyFallback` | true iff the legacy branch was taken |

`canonicalReadState(fields)` classifies a bare `SizeCanonicalFields`:
`not backfilled` (all null) is distinct from `UNRESOLVED` (processed, no
identity). `isResolvedSize` / `isUnresolvedSize` / `isNotBackfilledSize`
give callers named checks. `canonicalSizeIdentityOf()` and `sizeSystemOf()` are
thin accessors over the same boundary.

No existing legacy read was changed; the boundary is purely additive.

## 4. Filtering model (§5, §8, §13)

`CanonicalSizeFilter` holds two independent predicates:

- `canonicalSizeOptionId` — an exact wire identity. Only a row with
  `sizeResolutionStatus === "RESOLVED"` and an equal id can satisfy it. An
  `UNRESOLVED` or `NOT_BACKFILLED` row can never match because its id is null.
  This is a *canonical size filter*.
- `sizeSystem` — an equality on the stored `sizeResolutionSystem`. It matches
  whether or not the identity is resolved, because the system can be known
  while the id is null. This is a *system filter*.

Convenience constructors `filterByCanonicalSize()` and `filterBySizeSystem()`
build the single-predicate cases; `combineSizeFilters(...)` ANDs several
filters and throws on a contradictory value for the same predicate rather than
silently picking one. `matchesSizeFilter(fields, filter)` is the pure predicate
over fixture fields; `pickCanonicalFields(row)` projects the four columns out of
any wider row.

## 5. Composition, ordering and pagination (§15)

`productSizeFilterWhere(filter, options)` builds a `Product` where clause:

```
{ OR: [
    { variants: { some: <variant size where> } },
    { offers:   { some: { variants: { some: <offer-variant size where> } } } },
] }
```

`includeOffers: false` drops only the offer branch. The two DB helpers
`findProductIdsBySizeFilter()` / `queryProductsBySizeFilter()` order by `id`
ascending and accept `skip`/`take`, so pagination is deterministic and never
relies on a JS scan. `queryProductsBySizeFilter()` returns `{ ids, total }` from
one `$transaction` over the same where clause. Callers that need only a count
use `countProductsBySizeFilter()`.

## 6. Availability independence (§9)

Availability is **not** part of the size predicate. It is applied only when a
caller passes `availability` in `SizeFilterQueryOptions`, as an additional
equality on `ProductVariant.availability` / `ProductOfferVariant.availability`.
An out-of-stock resolved variant still satisfies the canonical size filter; the
two concepts never merge.

## 7. NOT_BACKFILLED vs UNRESOLVED vs RESOLVED, and the 159 rows

The three states are structural, not cosmetic:

- **NOT_BACKFILLED** — all four columns null (a legacy row). Readable through
  the legacy fallback; can never match a canonical-size filter.
- **UNRESOLVED** — processed; `sizeResolutionStatus = "UNRESOLVED"`, id null.
  May still expose a known `sizeResolutionSystem`.
- **RESOLVED** — id present and equal to the Stage A/B wire identity.

The 159 Livostyle rows are `UNRESOLVED`. They stay in the catalog, remain
readable through `readCanonicalSize()`'s fallback, do **not** match any
canonical-size filter, and are not hidden. They only match a system filter if a
stored system exists; under the empty approved-policy registry they carry none.

## 8. Database and index evidence (§15)

The filter columns are the Stage E ones, indexed on both tables. A read-only
`EXPLAIN (ANALYZE, BUFFERS)` against the local development database confirms
index use:

- canonical identity → `Bitmap Index Scan on
  "ProductVariant_canonicalSizeOptionId_idx"` (47 rows, `Index Cond:
  canonicalSizeOptionId = 'WOMEN|shoes|US|8'`), execution ≈ 26 ms total for the
  product traversal;
- system → `Bitmap Index Scan on
  "ProductVariant_sizeResolutionSystem_idx"` (`Index Cond:
  sizeResolutionSystem = 'US'`, 371 rows), execution ≈ 1.2 ms.

The offer branch falls back to a sequential scan only because
`ProductOffer` / `ProductOfferVariant` are empty in the live catalog (0 rows);
the equivalent indexes exist on `ProductOfferVariant` and are used once offers
are present. No full-catalog JS normalization occurs. No migration or write was
performed for this measurement.

## 9. Files and API reference

New module `src/lib/size-domain/query.ts`:

```
canonicalReadState(fields)                       SizeReadState
readCanonicalSize(input)                         CanonicalSizeRead
isResolvedSize/isUnresolvedSize/isNotBackfilledSize(read)
canonicalSizeIdentityOf(input) / sizeSystemOf(input)
filterByCanonicalSize(id) / filterBySizeSystem(system)
combineSizeFilters(...)                          CanonicalSizeFilter
hasCanonicalSizePredicate / hasSizeSystemPredicate / isEmptySizeFilter
matchesCanonicalSize(fields, id)
matchesSizeSystem(fields, system)
matchesSizeFilter(fields, filter)
pickCanonicalFields(row)                         SizeCanonicalFields
sizeFilterToVariantWhere(filter, options)        Prisma.ProductVariantWhereInput
sizeFilterToOfferVariantWhere(filter, options)   Prisma.ProductOfferVariantWhereInput
productSizeFilterWhere(filter, options)          Prisma.ProductWhereInput
findProductIdsBySizeFilter(db, filter, options)  Promise<string[]>
countProductsBySizeFilter(db, filter, options)   Promise<number>
queryProductsBySizeFilter(db, filter, options)   Promise<{ ids, total }>
```

All value exports are re-exported from `src/lib/size-domain/index.ts`; the two
Prisma types are imported type-only, so importing the barrel never loads Prisma
at runtime.

## 10. Tests (25 cases)

`scripts/size-domain-stage-f.test.mts` — **25 passed, 0 failed**:

- **F1–F5** read states: resolved / unresolved (system kept) / not-backfilled
  fallback / legacy system fallback / source-label preservation.
- **F6–F11** canonical predicate: exact match, no unresolved match, no
  not-backfilled match, empty id matches nothing, AND composition, conflict
  rejection + empty filter matches all.
- **F12–F16** grain: Product where traverses variants and offers, `includeOffers`
  toggle, availability opt-in, index-friendly equality shapes.
- **F17–F20** system filtering independent of resolution; null system never
  matches; accessors; partial-row classification.
- **F21–F22** availability independence.
- **F23–F25** safety: bare `8` is not inferred, empty approved registry,
  determinism across runs, wire compatibility with `sizeIdentity()`.

## 11. Verification gate

| Check | Result |
| --- | --- |
| `test:size-domain` | 22/22 |
| `test:size-domain-normalize` | 42/42 |
| `test:size-domain-product-integration` | 26/26 |
| `test:size-domain-stage-d` | 24/24 |
| `test:size-domain-stage-e` | 18/18 |
| `test:size-domain-stage-f` | **25/25** |
| `size-identity` | 30/30 |
| `size-sections` | 9/9 |
| `size-groups` | 9/9 |
| `taxonomy-ids` | 15/15 |
| `test:questionnaire` | 32/32 |
| `test:edit-restore` | 36/36 |
| `typecheck` (`tsc --noEmit`) | clean |
| `next build` | pass (Next.js 16.3.2) |
| `test:taxonomy` | 83/87 — pre-existing baseline (B1 released-level, T1/T2/T-kids) |
| `test:search` | not run — requires a dev server on `localhost:3000` (unavailable) |
| `EXPLAIN` index plan | read-only, index scans confirmed |

No regression was introduced: every changed/produced file is new, and the
taxonomy/`test:search` baselines are unchanged from before Stage F.

## 12. Compatibility, non-changes and follow-ups

- **No existing consumer changed.** All application size reads still go through
  the legacy `Size` relation and raw offer columns; the canonical columns remain
  written-only plus the new read primitive.
- **No data mutated.** Stage F performs no write, no migration, no backfill.
- **No inference added.** `APPROVED_SIZE_SYSTEM_POLICIES` is still empty.
- **Wire identity unchanged** — the persisted id equals `sizeIdentity()`.

Deferred (not started, require separate approval):

1. migrate public search/facets/questionnaire/meta to `readCanonicalSize()`;
2. chart resolver;
3. `/product/[productId]` + loader and card link;
4. Size Guide UI;
5. any decision to approve a size-system policy (the Livostyle candidate stays
   unapproved).
