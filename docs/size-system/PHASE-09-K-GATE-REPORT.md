# Phase 09 — K Gate Report: Catalog Data Readiness & Size-Chart Source Contract

**Stage:** K (final phase of the Size System workstream for now)
**Status:** **PASS WITH DATA QUALITY LIMITATIONS**
**Date:** 2026-10-02

> Scope note: Stage K produced an audit, a source contract, and a test-only proof against the
> existing boundary. It deliberately implements **no provider**, **no matching**, **no
> caching**, **no persistence**, and **no Prisma migration** (K7, K8). Work stops at this gate;
> no Stage L is started.

---

## 1. Catalog

- Two ingestion paths exist: the **legacy provider sync** (`src/lib/providers/sync.ts`) that
  produced all current data, and the **eBay catalog architecture**
  (`src/lib/catalog/**`, `import.ts`, `sync-run.ts`, offers/variants) which is defined but has
  not populated the database (`ProductOffer=0`, `ProductOfferVariant=0`, no eBay `Source`).
- 570 products, all from `Livostyle Open Catalog`; 4029 variants; 0 offers; 15 brands;
  40 categories; 107 sizes; 6 qualitative attributes.
- Product identity is reliable: `Product.@@unique([sourceId, externalId])`, non-empty on
  570/570 products.
- **Identity gap:** brand external mappings `0/15`, category mappings `0/40`; the current
  catalog's variants have only a synthesized `sku` (no external variant id). The mapping
  tables exist but are unpopulated.

## 2. Size metadata

- Classified, not normalized (K3): Livostyle legacy = explicit or partially explicit
  (system defaults to `INTERNATIONAL` at ingestion); eBay = free text or missing.
- Backfilled state: 3977/4029 variants have a size row; 3818 resolved with a canonical
  identity; 159 unresolved (raw preserved); 52 not yet processed; 34 distinct source labels;
  33 canonical identities; systems present: `EU`, `INTERNATIONAL`, `US`.
- No data was modified to improve any figure (K9). No normalization/inference was performed
  by this audit.

## 3. Chart readiness

- **No approved production size-chart source exists.** eBay size aspects are seller free text,
  unpersisted, with no units/system and no stable product mapping; no chart/measurement table
  or column exists in the schema. All prior stages establish the same conclusion.
- The contract (`PHASE-09-K-CHART-SOURCE-CONTRACT.md`) now states the minimum required fields
  (identity, chart, context, usage) and the fail-closed rules a future source must meet.
- A **TEST ONLY — NOT PRODUCTION DATA** fixture (`scripts/fixtures/size-chart-source-fixture.ts`)
  proves the existing pipeline accepts a conformant hypothetical source and rejects
  non-conformant ones. It is not seeded and not wired to production.

## 4. Architecture

- Single insertion boundary unchanged: **`SizeChartSource`**
  (`src/lib/size-domain/chart-source.ts`) + `resolveChartsFromSource`; today only
  `EMPTY_SIZE_CHART_SOURCE` (returns `[]`) is registered, so production renders no charts.
- Canonical pipeline reused end-to-end:
  `NormalizedSizeChart → SizeChart → resolveSizeChart → buildSizeChartView`.
- No second chart format, no second resolver/registry, no schema change. Source, scope,
  provenance, units, and `{min,max}` ranges are preserved verbatim; `null` stays empty; ranges
  are never converted or interpolated.

## 5. Verification

- `npm run typecheck` — **PASS**
- `npm run build` — **PASS**
- New: `test:size-domain-k-source-contract` — **18/18**
- Regressions:
  - i-chart 19/19, i-product 8/8, h1 25/25, h2 24/24, chart 16/16, g1 12/12
  - size-domain 22/22, normalize 42/42, product-integration 26/26
  - stage-d 24/24, stage-e 18/18, stage-f 25/25
  - facet-counts 11/11, url-state 29/29, edit-restore 36/36, questionnaire 32/32
  - size-identity 31/31, size-sections 9/9, f13-window-facets 9/9, taxonomy-ids 15/15
  - **taxonomy 83/87** (baseline held; T1, T2, T-kids, B1)
- K12: no search / questionnaire / registry / normalization / persistence / product-detail /
  Size Guide / taxonomy / external-link behavior changed. No bugs found requiring a change.
- K8: no Prisma migration. K10: fixture is test-only; no DB rows written.

## 6. Blockers

- **`APPROVED SIZE CHART SOURCE: MISSING`** — preserved. No legitimate production
  chart/measurement dataset exists; none must ever be fabricated.
- **Catalog identity gap (scoped):**
  - Ready: **product-scoped** charts (reliable `Product.externalId`, 570/570).
  - Not ready: **brand-scoped** and **category-scoped** charts (0 populated mappings), and
    **variant-level** attachment for the current catalog (no external variant id).
  - The schema already supports the fixes (`CategoryMapping`, `BrandAlias`, `GtinRecord`,
    `MpnRecord`, `ProductOfferVariant.externalVariantId`); a future importer must populate
    them from an approved source.

## Gate decision

**PASS WITH DATA QUALITY LIMITATIONS.** The catalog readiness audit is complete, the future
source contract is defined and test-verified, product identity is reliable, and the canonical
architecture is unchanged. Integration with any real chart source remains blocked until
(i) an approved source exists, and (ii) brand/category/variant identity mappings are populated.
Stage K ends here; no Stage L.
