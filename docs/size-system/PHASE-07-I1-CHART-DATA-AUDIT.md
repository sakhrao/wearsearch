# Phase 07 — I1: Size Chart Data Architecture Audit

> STATUS: **AUDIT.** Precedes Stage I implementation. Companion to
> `PHASE-04-G2-CHART-RESOLVER.md` and `PHASE-04-G2B-PRODUCT-DETAIL.md`.
> Scope: enumerate every existing source of size-chart / measurement information in
> the repository and database, and classify each. No data is to be invented here.

## 1. Method

Read-only inspection of:

- Chart domain + resolver: `src/lib/size-domain/{types,normalize,normalization-types,resolve-chart,index}.ts`
- Chart parser: `normalizeSourceSizeChart` (`normalize.ts:426`)
- Product detail / UI: `src/lib/product-detail.ts`, `src/app/product/[productId]/page.tsx`
- Catalog / options: `src/lib/catalog/size-vocabulary.ts`, `src/lib/sizes.ts`,
  `src/lib/size-sections.ts`, `src/app/api/meta/route.ts`
- Seed / static data: `prisma/seed.ts`, `prisma/catalog-data.ts`
- Prisma schema: `prisma/schema.prisma`, `prisma/migrations/*`
- Full-repo greps for `SizeChart`, `measurement`, `chest`, `waist`, `bust`, `hip`,
  `inseam`, `foot length`, `head circumference`, and chart-shaped literals
  (`scope.kind`, `priority: "product|brand|category"`, `status: "available|partial|missing"`).
- Live database probe (development DB): table/column inventory + row counts.

## 2. Database probe (real, development DB)

Tables present (public schema): `Attribute, Brand, BrandAlias, Category, CategoryMapping,
Color, Favorite, GtinRecord, MpnRecord, Product, ProductAttribute, ProductOffer,
ProductOfferVariant, ProductQuarantine, ProductVariant, Question, QuestionOption,
Questionnaire, SearchLog, Size, Source, SourceSyncRun, User, _prisma_migrations`.

Row counts: `Product=570, ProductVariant=4029, ProductOffer=0, ProductOfferVariant=0,
Size=107, Attribute=6, ProductAttribute=1657`.

Columns matching `%chart%` or `%measure%`: **none**.

`Attribute` names in use: `Style, Sleeve, Collar, Pattern, Fit, Material` — all
qualitative product tags, **no measurement attributes**.

**There is no chart table, no measurement table, and no persisted size-chart data.**

## 3. Discovered sources and classification

| # | Source | Location | What it actually is | Classification |
| --- | --- | --- | --- | --- |
| C1 | `SizeChart` domain type + `resolveSizeChart` | `types.ts:131`, `resolve-chart.ts` | The canonical resolver contract (G2). Decides *which* chart applies; holds no data itself. | **REAL / USABLE** (architecture, not data) |
| C2 | `SourceSizeChartInput` + `normalizeSourceSizeChart` | `normalization-types.ts:50-67`, `normalize.ts:426` | A source-chart *parser*: validates measurement columns, units, and row values; preserves raw + partial. Requires a real input that does not exist. | **REAL / USABLE** (parser, no inputs) |
| C3 | `NormalizedSizeChart` | `normalization-types.ts:94` | Output of C2; the intermediate shape a future importer would consume. | **REAL / USABLE** (architecture, not data) |
| C4 | Candidate chart population (anything passed to the resolver) | — | `product-detail.ts:368` calls `resolveSizeChart(target, [])` with a hardcoded empty array; no other call site. | **NO DATA** |
| C5 | Prisma chart/measurement models | `schema.prisma` | None exist. No `SizeChart`, `Measurement`, `SizeChartRow`, or JSON measurement column. | **NO DATA** |
| C6 | Seed data | `prisma/seed.ts`, `prisma/catalog-data.ts` | Products, brands, categories, variants, colors, sizes, attributes only. No chart/measurement fixtures. | **NO DATA** (for charts) |
| C7 | `Size` table (107 rows) | `schema.prisma:388` | Size *labels* (`value`, `system`, `normalizedValue`, context). No measurements. | **REAL / USABLE** (labels, not charts) |
| C8 | `ProductVariant` / `ProductOfferVariant` canonical fields | `schema.prisma:376,210` | Canonical size *identity* + resolution status/system. No measurements. | **REAL / USABLE** (identity, not charts) |
| C9 | `ProductAttribute` (1657 rows) | `schema.prisma:439` | Style/Sleeve/Collar/Pattern/Fit/Material tags (e.g. "High-Waist", "Chest Pocket"). The words `chest`/`waist`/`hip` appear only as garment-detail tags, never as measurements. | **REAL BUT NOT CHART DATA** |
| C10 | Option surfaces `buildSizeCatalog` / `semanticSizeRowsFor` | `catalog/size-vocabulary.ts`, `size-sections.ts`, `sizes.ts` | Size-*option* surfaces for the questionnaire/facets (`EU`, `US`, `Waist (in)`, `Letters`). These are size **systems/labels**, not body measurements. | **REAL BUT NOT CHART DATA** |
| C11 | Inline Size Guide markup | `src/app/product/[productId]/page.tsx:212-247` | Existing UI that renders a `FOUND` chart's dynamic columns/rows, and a single generic message otherwise. No provenance, no `NO_COMPATIBLE_CHART`/`INVALID` distinction, not reusable. | **REAL / USABLE** (UI, incomplete) |
| C12 | `zoom-fitting.ts` "measurement" | `src/lib/zoom-fitting.ts` | Image-crop bounds math. Unrelated to sizing. | **LEGACY / UNUSED** (for charts) |
| C13 | JSON / CSV / SQL chart files | repo-wide | None found. | **NO DATA** |
| C14 | Scraped/imported chart data | repo-wide | None found. | **NO DATA** |
| C15 | `size-domain-chart.test.mts` fixtures | `scripts/size-domain-chart.test.mts` | In-memory synthetic `SizeChart` objects used only to test the resolver. Not production data. | **PLACEHOLDER / MOCK** (tests only) |

## 4. What counts as real production chart data

- **Real production chart data: NONE.**
- Real and reusable *architecture*: C1 (resolver), C2/C3 (source parser → normalized chart).
- Real but non-chart: C7 (size labels), C8 (canonical identity), C9 (product tags),
  C10 (size-option surfaces).
- Real but incomplete UI: C11.

## 5. Gaps that Stage I must close

1. **No bridge C3 → C1.** `normalizeSourceSizeChart` produces `NormalizedSizeChart`, but
   nothing maps it into the resolver's `SizeChart`. A future importer has no legal path
   from a parsed source chart to the resolver contract.
2. **No chart source boundary.** `product-detail.ts` hardcodes `[]`; there is no single
   provider where an importer/source could register Product / Brand / Category charts.
3. **`SizeChartRow.values` cannot hold ranges.** It is typed `Record<string, number | null>`
   (`types.ts:118`), but real charts frequently state ranges (I3 example `Chest 100–104 cm`).
   Storing a range today is impossible without dropping data.
4. **UI does not distinguish all four states** and does not show provenance/system, and is
   not reusable.

## 6. Stage I decisions recorded from this audit

- **No chart data exists; do not fabricate any.** Stage I will not seed, mock, or scaffold
  example measurements into production paths.
- **Persistence: no migration.** Nothing real is persistable today. A schema proposal is
  documented in the gate report, but no Prisma migration is added while there is no source
  data (I5: only migrate if genuinely required).
- **Resolver stays the single source of truth** (I6). UI receives `ResolvedSizeChart`.
- **Add the missing bridge** (C3 → C1) and a **chart source boundary** so a future
  importer can supply Product / Brand / Category charts through the existing contract (I14).
- **Extend the cell value type additively** to preserve source ranges (I3/I13).
- **Build a reusable Size Guide** implementing all four states, provenance, dynamic
  columns/rows, and canonical highlighting separated from availability (I7–I11).

## 7. Expected Stage I completion status

Given §2 and §4, real chart data is absent. The expected status is
**PASS WITH DOCUMENTED DATA LIMITATIONS**, provided the resolver, import bridge, and
Size Guide correctly handle `NO_CHART` and never fabricate measurements.
