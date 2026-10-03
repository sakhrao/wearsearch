# Size System — Phase 4 / G1 — Public Consumer Migration to the Canonical Read Path

G1 makes the canonical size read (`readCanonicalSize()`) the preferred
application/domain representation while preserving legacy source data and
backward compatibility. Search and the Questionnaire are deliberately left
untouched.

## 1. Migration rule applied

For domain/application logic:

```
RESOLVED        -> use the canonical identity (and canonical system)
UNRESOLVED      -> preserve the unresolved state; use the source label as-is
NOT_BACKFILLED  -> legacy compatibility behavior (centralized fallback)
```

No local `if (!canonical) use legacy` branching was introduced. Every migrated
read funnels through `readCanonicalSize()`, whose fallback is the single
compatibility boundary.

## 2. Consumer inventory and classification

### A. Migrated now (domain)

| Consumer | Location | Before | After |
| --- | --- | --- | --- |
| Outfit catalog loader — legacy variant size | `src/lib/outfit/catalog.ts:projectVariantSize` | raw `v.size.{system,value,normalizedValue,productType}` | `readCanonicalSize()` + `pickCanonicalFields()`; exposes `state`, `canonicalSizeOptionId`, preserved `value`/`normalizedValue`/`system` |
| Outfit catalog loader — offer variant size | `src/lib/outfit/catalog.ts:projectOfferVariantSize` | synthesized chip only | chip preserved, state/identity via `readCanonicalSize()` |
| Outfit size matching | `src/lib/outfit/outfit-size.ts` | value/normalizedValue only | same matching + `sizeResolutionState()` / `hasUnresolvedSize()` |
| Build API size availability | `src/app/api/build/route.ts` + `src/lib/build/serialize.ts` | reads `v.size?.value` | reads the canonicalized loader view (no behavior change) |

The Prisma selects in `loadOutfitCatalog` now include the four Stage E columns
on both `ProductVariant` and `ProductOfferVariant`.

### B. Remain raw (provenance / audit / write / debug)

`scripts/size-domain-backfill.mts`, `scripts/size-domain-catalog-coverage.mts`,
`scripts/size-domain-stage-d-probe.mts`, `scripts/backfill-size-context.mts`,
`src/lib/search-parser.ts`, `src/lib/providers/types.ts`,
`src/lib/providers/sync.ts`, `src/lib/catalog/offers.ts`,
`src/lib/catalog/normalize.ts`, `src/lib/catalog-memo.ts`,
`src/lib/size-diagnostics.ts`.

These intentionally read `Size.value` / raw offer strings and must keep doing so
to preserve source truth, idempotent writes and provenance.

### C. Deferred (UI / search / questionnaire)

| Consumer | Location | Deferred to |
| --- | --- | --- |
| Public search engine (matching, corpus, facets) | `src/app/api/search/route.ts`, `src/lib/facets.ts`, `src/lib/search-facets.ts` | downstream search-migration stage |
| Questionnaire size surface | `src/lib/sizes.ts`, `src/lib/size-sections.ts`, `src/lib/catalog/size-vocabulary.ts`, `src/app/api/meta/route.ts`, `src/components/find-questionnaire.tsx`, `src/lib/questionnaire.ts`, `src/lib/questionnaire-restore.ts` | after product-side canonical path is stable |
| Result cards / product UI | `src/components/home-page.tsx`, `src/app/outfit/outfit-client.tsx` | Product Detail / UI stage |

## 3. Search and Questionnaire caution (§8, §9)

- **Search: UNCHANGED.** The search engine depends heavily on the legacy `Size`
  relation and the client/server facet identity contract. Migrating it wholesale
  would be a partial search rewrite, so it is documented as a downstream
  migration. The Stage F query primitive is ready but unused by search.
- **Questionnaire: UNCHANGED.** It has its own taxonomy/state architecture and
  consumes canonical sizes only after the product-side path is proven.

## 4. Preserved legacy source information (§4)

`projectVariantSize` keeps `value` (raw `Size.value`) and `normalizedValue`
(`Size.normalizedValue`) verbatim, and exposes `system` (canonical when known,
legacy fallback otherwise). `sourceSizeLabel` inside the canonical boundary is
the same raw value. The loader never writes to the source records.

## 5. Display semantics (§5)

No user-visible label was changed. A product displaying `Medium` still displays
`Medium`; the canonical identity `...|M` is available but is not substituted for
display. Exact-value matching still matches on the raw/normalized label, so
`evalSize` behavior is byte-for-byte identical for resolved, unresolved and
not-backfilled rows.

## 6. State distinction (§7)

`OutfitVariantSize.state` is `RESOLVED | UNRESOLVED | NOT_BACKFILLED`, carried
from `readCanonicalSize()`. `sizeResolutionState()` treats a missing state (a
test/legacy in-memory shape) as `NOT_BACKFILLED`, never as resolved.
`hasUnresolvedSize()` reports products with at least one safely-failed
normalization; `NOT_BACKFILLED` is excluded. This is the foundation Product
Detail uses in G2.

## 7. Tests

`scripts/size-domain-g1-migration.test.mts` — **12 passed, 0 failed**:

- G1-1 resolved → `RESOLVED` + identity; G1-2 unresolved → `UNRESOLVED` + null
  identity; G1-3 unresolved with known system; G1-4 not-backfilled → legacy
  system fallback; G1-5 source-label preservation; G1-6 identity equals the wire
  `sizeIdentity()`; G1-7 null size projects to null; G1-8 offer chip
  NOT_BACKFILLED; G1-9 backfilled offer resolved; G1-10 `sizeResolutionState`
  default; G1-11 `hasUnresolvedSize` distinguishes `UNRESOLVED` from
  `NOT_BACKFILLED`; G1-12 exact-match behavior unchanged.

Existing suites updated only where the application type gained fields:
`scripts/outfit-size.test.mts` and `scripts/build-flow.test.mts` fixtures now
carry an explicit `NOT_BACKFILLED` state.

## 8. G1 gate

| Check | Result |
| --- | --- |
| typecheck | PASS |
| build | PASS |
| `test:size-domain` | 22/22 |
| `test:size-domain-normalize` | 42/42 |
| `test:size-domain-product-integration` | 26/26 |
| `test:size-domain-stage-d` | 24/24 |
| `test:size-domain-stage-e` | 18/18 |
| `test:size-domain-stage-f` | 25/25 |
| `test:size-domain-g1-migration` | 12/12 |
| outfit suite (category/color/insufficient/integration/interactive/replace/save-share/scoring/size/slots/style) | all pass |
| `build-flow` | 63/63 |
| size-identity / size-sections / size-groups / taxonomy-ids | 30/30, 9/9, 9/9, 15/15 |
| `test:taxonomy` | 83/87 (pre-existing baseline) |
| server-dependent suites (`test:search`, `outfit-api`, `outfit-prefs`, `diagnostics`, `facet-policy`) | not run — require dev server on `localhost:3000` |

**G1: PASS.** Search UNCHANGED, Questionnaire UNCHANGED, Prisma UNCHANGED, no
database writes.
