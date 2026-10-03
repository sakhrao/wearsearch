# Size System — Phase 3 / Stage F — Canonical Read Path & Size-System Filtering Audit

Read-only consumer audit completed **before** any Stage F code change.
Verdict: **no hard-stop condition found**. The canonical fields are fully
persisted (Stage E) but are read by **zero** application queries; Stage F
introduces the single canonical read path and the filtering primitive without
touching any existing public consumer.

## 1. Scope

Stage F has exactly two deliverables:

- **A. Canonical read path** — one function, `readCanonicalOrLegacySize()`, is
  the only boundary where a size row's canonical-vs-legacy state is decided.
- **B. Size-system filtering** — a variant/offer-variant-grain filter over
  `canonicalSizeOptionId` and `sizeResolutionSystem`, deterministic,
  composable, pagination-safe and index-backed.

Explicitly **out of scope** for Stage F (§16): public search integration,
`/product/[productId]`, Size Guide, Questionnaire, Results Cards, any UI, and
any Prisma schema/migration change.

## 2. Prior-stage contracts this audit relies on

| Contract | Location | Meaning |
| --- | --- | --- |
| `canonicalSizeOptionId` (wire identity) | `registry.ts:243`, `size-sections.ts:131` | `audience\|discipline\|system\|value`, byte-identical |
| `SizeCanonicalFields` (4 nullable columns) | `persist.ts:38` | persisted canonical state |
| `readCanonicalOrLegacySize()` | `persist.ts:247` | canonical/legacy boundary (exists, unused) |
| `isBackfilled()` | `persist.ts:98` | `sizeResolutionStatus != null` |
| `SIZE_RESOLUTION_STATUSES` | `persist.ts:25` | `RESOLVED`, `UNRESOLVED` |

## 3. Consumer inventory

Every reader found in `src/`. Classification: **(A)** canonical application read,
**(B)** raw source/provenance/debug read, **(C)** write/ingestion path,
**(D)** test only.

### (A) Application reads that currently use the legacy `Size` relation

| Consumer | Location | What it reads | Expected input today |
| --- | --- | --- | --- |
| Search engine — selection | `src/app/api/search/route.ts:1477-1482` | `variant.size` (`value`, `system`) | legacy relation |
| Search engine — offer selection | `src/app/api/search/route.ts:1495-1498` | offer `sizeValue`, `sizeSystem` | raw offer columns |
| Search engine — corpus | `src/app/api/search/route.ts:1810-1813` | `variant.size?.value` | legacy relation |
| Search engine — size match | `src/app/api/search/route.ts:576-609`, `2169-2195` | `size.value` + `size.system` | legacy relation |
| Search engine — dictionary | `src/app/api/search/route.ts:1089-1093`, `1112-1115` | `prisma.size.findMany()`, offer `sizeValue` | legacy rows |
| Meta route — dictionary | `src/app/api/meta/route.ts:84-92` | `prisma.size.findMany()` | legacy rows |
| Meta route — contextual catalog | `src/app/api/meta/route.ts:104-156` | `variant.size` + offer size fields | legacy relation |
| Facets — product facets | `src/lib/facets.ts:43-85` | `variant.size.value` | legacy relation |
| Size sections | `src/lib/size-sections.ts:198-247`, `304`, `327`, `418-421`, `444-451` | `variant.size.system/value` | legacy relation |
| Search facets (client) | `src/lib/search-facets.ts:93-102`, `168-190` | `variant.size.value`, `sizeIdentity` | legacy relation |
| Questionnaire size surface | `src/lib/sizes.ts:39-115`, `224-460` | `variant.size` + `size.system` | legacy relation |
| Outfit catalog loader | `src/lib/outfit/catalog.ts:42-48`, `62-63`, `88-93`, `114-120` | `variant.size` + offer fields | legacy relation |
| Outfit size matching | `src/lib/outfit/outfit-size.ts:49-115` | `v.size.value/normalizedValue/system` | legacy relation |
| Build route | `src/app/api/build/route.ts:421-434`, `487-514` | `v.size?.value` | legacy relation |
| Build serialize | `src/lib/build/serialize.ts:44-56` | `v.size?.value` | legacy relation |
| Home page cards/sections | `src/components/home-page.tsx:957-1038`, `2194-2208` | `variant.size.value` | legacy relation |
| Questionnaire restore | `src/lib/questionnaire-restore.ts:96-120` | `answers.size.value` (value only) | legacy wire |
| Search diagnostics | `src/lib/size-diagnostics.ts` (see report `/api/search` debug) | re-derived size evidence | legacy relation |
| Catalog fingerprint | `src/lib/catalog-memo.ts:135-175` | `client.size.count()` | invalidation only |

**None of these reads the Stage E columns.** They read legacy `Size` rows or raw
`ProductOfferVariant` strings. They are therefore *legacy-input consumers* and
remain correct until a later stage migrates them.

### (B) Raw source / provenance / audit reads (must stay raw)

| Consumer | Location | Why raw |
| --- | --- | --- |
| Backfill runner | `scripts/size-domain-backfill.mts:58-291` | reads both canonical + legacy to plan/verify |
| Coverage audit | `scripts/size-domain-catalog-coverage.mts:36-114` | read-only measurement |
| Stage D probe | `scripts/size-domain-stage-d-probe.mts:42-177` | provenance tracing |
| Legacy search parser | `src/lib/search-parser.ts:152-180` | `Size` row lookup (not wired into route) |
| Provider source shapes | `src/lib/providers/types.ts:7-32` | ingestion source truth |
| Pre-context oracle | `scripts/backfill-size-context.mts:37-245` | historical migration |

The canonical read path is **additive**: raw reads must remain available for
debugging/provenance, as required by §7.

### (C) Write / ingestion paths (untouched)

`src/lib/providers/sync.ts:68-94` (`sizeIdOf` / `prisma.size.upsert`),
`src/lib/catalog/offers.ts:329-332` (offer-variant size fields),
`src/lib/providers/livostyle.ts:127-189` and `:359`,
`src/lib/catalog/adapters/ebay/normalize.ts`. Stage F does not modify writes.

### (D) Tests

Size-domain suites (`scripts/size-domain*.test.mts`), identity/section suites,
facets, search, questionnaire, ingestion and outfit suites all listed in the
prior stages. Stage F adds one suite and does not change any existing one.

## 4. Where canonical and legacy reads diverge

1. **Existence of the canonical path.** `readCanonicalOrLegacySize()` is defined
   and exported (`index.ts:83`) but **no `src/` file calls it**. All application
   size reads are therefore legacy by default. This is the exact gap Stage F
   closes: create the boundary and a filtering primitive that uses it.
2. **Non-persisted systems.** Legacy `Size.system` is the `SizeSystem` enum
   (`INTERNATIONAL, EU, US, UK, IT, FR, UNKNOWN`); it cannot represent
   `DE, JP, CM, MONDO, WAIST_IN, WAIST_CM, BRA, ONE_SIZE`. The persisted
   `sizeResolutionSystem` is TEXT and can. Any future read that switches to the
   canonical path sees strictly more system information, never less.
3. **`UNRESOLVED` vs `NOT_BACKFILLED`.** The 159 Livostyle rows persist
   `sizeResolutionStatus = "UNRESOLVED"` with a null identity. A row with all
   four columns null is *not yet backfilled*. These are distinct and must never
   collapse into a single "no size" state.
4. **System known while identity null.** An unresolved row can still expose a
   real `sizeResolutionSystem` (e.g. explicit `US` with insufficient context).
   The legacy relation exposes no such component for offer variants.

## 5. Measured state (development DB)

From the Stage E backfill (`PHASE-03-STAGE-E.md`):

```
observations 3977 · resolved 3818 · inferred 0 · unresolved 159
withCanonicalIdentity 3818 · withoutCanonicalIdentity 159
bySystem { US: 371, EU: 355, NONE: 159, INTERNATIONAL: 3092 }
```

`ProductOffer` / `ProductOfferVariant` = 0 rows live, so the offer filter path is
implemented and fixture-tested (its columns/indexes exist).

## 6. Filtering grain and index availability

Size is **variant/offer-variant grain**, never `Product` grain
(`ProductVariant.sizeId`, `ProductOfferVariant.sizeValue`). Stage E added
indexes for exactly the two filter columns on both tables:

```
ProductVariant_canonicalSizeOptionId_idx
ProductVariant_sizeResolutionSystem_idx
ProductOfferVariant_canonicalSizeOptionId_idx
ProductOfferVariant_sizeResolutionSystem_idx
```

A `Product`-grain filter is expressed through the relation
(`variants.some` OR `offers.some.variants.some`), so the indexes are reached
without loading all rows and normalizing in JS (§15).

## 7. Compatibility risks of switching to the canonical read path

| Risk | Assessment |
| --- | --- |
| Existing consumers break | **None in Stage F.** No existing consumer is changed. |
| Legacy rows unreadable | **No.** `readCanonicalOrLegacySize()` falls back to legacy fields. |
| `UNRESOLVED` hidden | **No.** It is a distinct state; unresolved rows stay in the catalog. |
| 159 rows disappear from canonical filter | **By design.** They match no canonical-size filter and no system filter; they remain readable via fallback. |
| Non-persisted systems coerced | **No.** `sizeResolutionSystem` is TEXT. |
| Source labels lost | **No.** `sourceSizeLabel` is preserved in the view. |
| Duplicate identity invented | **No.** The persisted id is the established wire id. |
| Inference introduced | **No.** `APPROVED_SIZE_SYSTEM_POLICIES = []` stays empty. |
| Index plan regresses | Measured with `EXPLAIN` on the dev DB (see `PHASE-03-STAGE-F.md`). |

## 8. Hard-stop review

- A canonical read path already exists — **yes**, `readCanonicalOrLegacySize()`;
  it is unused, so Stage F wires a thin state-classifying wrapper around it and
  builds the filter, without a second identity.
- Legacy and canonical reads cannot be distinguished — **no**, `isBackfilled()`
  and `usedLegacyFallback` separate them; the wrapper additionally exposes
  `NOT_BACKFILLED` vs `UNRESOLVED` vs `RESOLVED`.
- System filtering needs the identity to be resolved — **no**, the system
  component is stored independently.
- Filtering would require a JS scan — **no**, both columns are indexed.
- Availability would be conflated with resolution — **no**, availability is an
  optional, explicit additional condition only.
- Removing NOT_BACKFILLED rows is required — **no**, they are excluded by
  predicate, not deleted.

No blocker. Proceeding is safe.

## 9. Development database

The configured `DATABASE_URL` (`postgres @ localhost:5432/mydb`) is the local
development database used by Stage E. Stage F only reads it (for a query-plan
check); it performs **no migration and no write**.
