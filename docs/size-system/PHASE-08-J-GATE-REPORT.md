# Phase 08 — Stage J: Approved Size Chart Source Integration — GATE REPORT

> STATUS: **BLOCKED — REQUIRES APPROVED DATA SOURCE.**
> Stage J was restricted to discovering and, if possible, integrating an approved real
> size-chart source through the existing `SizeChartSource` boundary. The J1 audit found no
> legitimate, production-suitable source. Per J2/J15 the stage stops at the approval gate:
> **no fake data, no generic tables, no scraping, no persistence.** The Stage I Size Guide
> remains valid and continues to report `NO_CHART` honestly.
> No Stage K work begins.

## 1. Source

### Candidate sources audited

Full detail in `PHASE-08-J1-SOURCE-AUDIT.md`. Summary:

| Candidate | Contains real measurements? | Decision |
| --- | --- | --- |
| S1 first-party catalog DB | No (6 qualitative attributes only) | Rejected |
| S2 imported merchant feeds (DummyJSON / FakeStore / Livostyle) | No (tags only) | Rejected |
| S3 brand-provided charts | Do not exist | Rejected |
| S4 structured supplier feeds | Do not exist | Rejected |
| S5 approved static datasets / internal files | None exist | Rejected |
| S6 approved API responses | None return measurements | Rejected |
| S7 eBay `localizedAspects` (item specifics) | Possible but unpersisted, seller free text, no units/system, no stable mapping | Rejected |
| S8 eBay quarantined payloads | Empty (0 rows) | Rejected |
| S9 merchant / brand website scraping | No access method; licensing unestablished | Rejected |
| S10 generic "standard" size tables | — | Forbidden by guardrails |
| S11 measurement type registry | Vocabulary only, zero values | Not a data source |

### Approved source

**None.**

### Rejected sources and reasons

- **No first-party or imported dataset contains a single body/garment measurement.** The
  only six persisted attributes are `Sleeve, Collar, Fit, Style, Material, Pattern`; the F6
  writer hard-rejects any other attribute name
  (`src/lib/providers/attribute-enrichment.ts:3-10,192-196`).
- **eBay item specifics** are the only channel that *might* carry measurement text, but they
  are per-listing seller free text, unpersisted, lack units/system, and cannot be tied to a
  stable `Product.id` without fuzzy matching (forbidden by J6). Using them would require
  guessing units/systems, which the Stage J guardrails forbid.
- **No Prisma model or column** holds a chart or measurement
  (`prisma/schema.prisma`; probe confirmed columns matching `%chart%`/`%measure%` = none).
- **Licensing/usage status:** no measurement dataset with established usage rights exists.

### Live database evidence (development DB)

`Product=570`, `Brand=15`, `ProductVariant=4029`, `Attribute=6` (qualitative),
`ProductAttribute` values all garment tags, `ProductQuarantine=0`, and no chart/measurement
column. Sources present: `StyleHub Affiliate Feed`, `WearSearch Demo Store`,
`DummyJSON Free API`, `Fake Store API`, `Livostyle Open Catalog` — none a chart provider,
none `official`.

## 2. Integration

**Not performed — intentionally.** Because J2 failed, J3–J11 were not implemented:

- No source adapter (`ApprovedSourceChartProvider`) was created.
- No chart matching, caching, or persistence was added.
- `SizeChartSource` / `EMPTY_SIZE_CHART_SOURCE` is unchanged; the product page still uses the
  honest empty default.
- No domain, questionnaire, search, variant, or taxonomy code was modified.

The pipeline remains source-swappable and ready:

```
Approved Source → NormalizedSizeChart → chart-import.ts → SizeChart
  → resolveSizeChart() → buildSizeChartView() → <SizeGuide>
```

The single legal insertion point is `SizeChartSource` (`chart-source.ts:22-26`), consumed at
`product-detail.ts:374-377`. The bridge `sizeChartFromNormalized` (`chart-import.ts:86`)
already exists and is tested, so integrating a real source later requires no other code
change.

## 3. Data integrity

No values were created or altered:

- **Real source values:** none integrated (correct — none approved).
- **Units / ranges / missing values:** the existing pipeline preserves all of these
  (carried from Stage I; re-verified below).
- **Provenance / system:** the resolver remains authoritative
  (`PRODUCT > BRAND > CATEGORY`); no adapter-side matching was added.
- No migration; no persistence; no fabricated chart rows.

## 4. Product verification

- Real product probes (Stage I `test:size-domain-i-product`, re-run): a real product with
  resolved variants exists; without a source the guide is `NO_CHART` and the product is
  preserved; multiple canonical sizes are exposed; an injected *test-only* source yields
  `FOUND` + `PRODUCT` provenance; chart presence never changes size resolution/availability;
  the external link is preserved; unresolved sizes stay raw; unknown product → `null`.
- `NO_CHART` is the correct live state for **every** product (no approved source).
- `NO_COMPATIBLE_CHART` / `INVALID` remain reachable from the tested resolver prior to data
  integration (Stage I tests I-5/I-6).

## 5. Verification

| Suite | Result |
| --- | --- |
| `npm run typecheck` | PASS (0 errors) |
| `npm run build` (Next 16.3.2 Turbopack) | PASS |
| `npm run test:size-domain-i-chart` | 19 / 19 |
| `npm run test:size-domain-i-product` | 8 / 8 |
| `npm run test:size-domain-h1` | 25 / 25 |
| `npm run test:size-domain-h2` | 24 / 24 |
| `npm run test:size-domain-chart` | 16 / 16 |
| `npm run test:size-domain-g1-migration` | 12 / 12 |
| `npm run test:size-domain` | 22 / 22 |
| `npm run test:size-domain-normalize` | 42 / 42 |
| `npm run test:size-domain-product-integration` | 26 / 26 |
| `npm run test:size-domain-stage-d` | 24 / 24 |
| `npm run test:size-domain-stage-e` | 18 / 18 |
| `npm run test:size-domain-stage-f` | 25 / 25 |
| `tsx scripts/size-identity.test.mts` | 31 / 31 |
| `tsx scripts/size-sections.test.mts` | 9 / 9 |
| `tsx scripts/f13-window-facets.test.mts` | 9 / 9 |
| `npm run test:facet-counts` | 11 / 11 |
| `npm run test:url-state` | 29 / 29 |
| `npm run test:edit-restore` | 36 / 36 |
| `npm run test:questionnaire` | 32 / 32 |
| `npm run test:taxonomy-ids` | 15 / 15 |
| `npm run test:taxonomy` | 83 / 87 (unchanged baseline: T1, T2, T-kids, B1) |

J12 ("tests covering the actual source adapter") is **N/A**: no source adapter exists to
test, and fabricating a source purely to satisfy J12 is exactly what Stage J forbids. All
existing Stage I chart tests are retained and pass.

## 6. Limitations

Remaining missing chart coverage is **total**: every product, brand, and category currently
lacks a chart, because no approved measurement dataset exists. Specifically:

- No product-scope charts, no brand-scope charts, no category-scope charts.
- No units, ranges, or measurements to display; `<SizeGuide>` correctly renders `NO_CHART`.
- The import bridge has no production caller (no parsed source chart to feed it).
- eBay item specifics remain captured in memory but unpersisted; persisting them would not by
  itself create an approved chart and is out of scope.

## 7. What unblocks Stage J

An approved source supplying, for Product / Brand / Category scope: a verified stable
identifier mapping (no fuzzy matching), a row-per-size chart with real values or ranges,
explicit units and size system (no guessing, no cross-system conversion), and clear licensing
for this project. Integration then = implement a `SizeChartSource` adapter that emits the
`NormalizedSizeChart` contract and wire it into `loadProductDetail`; nothing else changes.

## 8. Gate decision requested

Accept Stage J as **BLOCKED — REQUIRES APPROVED DATA SOURCE** (the honest outcome; the
existing Size Guide remains valid, `NO_CHART` is correct, and no fake data was introduced),
or provide an approved source to proceed. No Stage K work begins regardless.
