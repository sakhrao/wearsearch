# Phase 07 — Stage I: Size Chart Data Pipeline & Size Guide — GATE REPORT

> STATUS: **PASS WITH DOCUMENTED DATA LIMITATIONS.**
> Stage I completes the last consumer on the size pipeline: the product page now renders a
> resolver-driven, reusable Size Guide that handles every resolution state, preserves
> provenance / system / units / ranges / partial data, highlights canonical correspondence
> without claiming availability, and **never fabricates a measurement**.
> No Stage J (or further) work begins until this gate is accepted.

## 1. Scope delivered

```
raw source chart → NormalizedSizeChart → canonical SizeChart → resolver → view-model → Size Guide
```

Per the accepted audit (`PHASE-07-I1-CHART-DATA-AUDIT.md`) and the Stage I directives
(I1–I18). The one normalizer (`normalizeSourceSize` / `normalizeSourceSizeChart`) and the
one resolver (`resolveSizeChart`) remain the single authorities. No second chart system,
no invented measurements, no silent unit conversion, no UI-side priority logic.

## 2. Headline finding (from I1)

**There is no real production size-chart / measurement data in the repository or database.**
The audit found no chart table, no measurement table, no persisted chart JSON, and no
measurement attributes (`Attribute` names are `Style, Sleeve, Collar, Pattern, Fit,
Material`). What exists is real *architecture* (resolver + source parser) and real but
non-chart data (size labels, canonical identities, size-option surfaces). Stage I therefore
builds the full, correct pipeline and UI, and — honestly — renders `NO_CHART` for every
product until a real source is connected. **No data was fabricated to make the UI look
populated.**

## 3. Files added / changed (Stage I)

| File | Change |
| --- | --- |
| `src/lib/size-domain/types.ts` | `SizeChartRange {min,max}`, `SizeChartCellValue = number \| SizeChartRange \| string \| null`; `SizeChartRow.values: Record<string, SizeChartCellValue>` (additive, preserves ranges) |
| `src/lib/size-domain/chart-import.ts` | **new** — bridge `NormalizedSizeChart → SizeChart`: `sizeChartFromNormalized()`, `parseSizeChartRange()`, `SizeChartImportMeta`. Carries only resolved columns; null stays null; `available/partial/missing` preserved |
| `src/lib/size-domain/chart-source.ts` | **new** — `SizeChartSource`, `EMPTY_SIZE_CHART_SOURCE` (returns `[]`), `resolveChartsFromSource()` (the only chart-loading boundary) |
| `src/lib/size-domain/chart-view.ts` | **new** — pure view-model: `buildSizeChartView()`, `formatSizeChartCellValue()`, `SIZE_CHART_PROVENANCE_LABELS`, `SIZE_CHART_HIGHLIGHT_NOTE` |
| `src/lib/size-domain/index.ts` | exports the new bridge / source / view symbols + cell types |
| `src/components/size-guide.tsx` | **new** — reusable `<SizeGuide>` (server component); no hardcoded sizes or measurements |
| `src/lib/product-detail.ts` | `loadProductDetail(productId, options?: { chartSource? })`; calls `resolveChartsFromSource(options?.chartSource ?? EMPTY_SIZE_CHART_SOURCE, target)` |
| `src/app/product/[productId]/page.tsx` | imports `<SizeGuide>`; computes `carriedSizeOptionIds`; renders the guide (replaces the old inline block) |
| `scripts/size-domain-i-chart.test.mts` | **new** — 19 pure resolver/UI-contract cases |
| `scripts/size-domain-i-product.test.mts` | **new** — 8 DB product-integration cases |
| `package.json` | `test:size-domain-i-chart`, `test:size-domain-i-product` |

## 4. Architecture

- **Single resolver (I6).** `resolveSizeChart` still decides which chart applies
  (`PRODUCT > BRAND > CATEGORY`). The UI never selects a chart. `loadProductDetail` hands
  the resolver result straight to the view-model.
- **Source boundary (I14).** `SizeChartSource.loadCharts(target)` is the one place a future
  importer (product feed / brand table / category reference) plugs in. The default
  `EMPTY_SIZE_CHART_SOURCE` returns zero candidates → `NO_CHART`. This is deliberate and is
  the reason the gate is "with documented data limitations".
- **Import bridge (I2/I5 gap closed).** `sizeChartFromNormalized` maps the existing parser
  output into the resolver contract, so a future importer has a legal, tested path from a
  parsed source chart to the UI. It only carries resolved measurement columns; unresolved
  column labels are recorded by the parser but never displayed as measurements.
- **Cell fidelity (I3/I4/I13).** A cell is an exact number, a source range
  (`{min,max}`), the raw source string, or `null`. A `null` cell is never filled. Units are
  copied from the measurement registry and never converted. A source range is formatted
  (`100–104`), never converted or averaged.
- **View-model (I7–I10).** `buildSizeChartView` produces the four distinct states with
  messages; `FOUND` carries dynamic columns/rows and a `highlighted` flag that means
  *correspondence only* (the row's canonical size option is listed by the product) — it
  never claims availability.

## 5. UI behavior (I7–I13)

- Reusable `<SizeGuide chart carriedSizeOptionIds?>`; the chart defines its own columns and
  rows — no hardcoded `XS/S/M/L/XL` or `Chest/Waist/Hip`.
- Four states rendered distinctly (I8):
  - `FOUND` — badges for provenance (`Product/Brand/Category size guide`), system, and
    source; dynamic sortable-by-order table.
  - `NO_CHART` — explicit "measurements are never estimated" message; nothing rendered.
  - `NO_COMPATIBLE_CHART` — explicit "no chart matches this product's sizing context".
  - `INVALID` — explicit "malformed" message; never rendered as data.
- Wide/long charts scroll horizontally (`overflow-x-auto`) with `whitespace-nowrap`; text
  is not truncated (I13). An absent cell renders as `—` (a "no data" marker), never a
  fabricated value.
- Highlight marker `Listed` plus a legend note clarifying it is a correspondence marker and
  that availability lives in the Sizes section (I10).
- The product page keeps images, name, brand, price, source, availability, taxonomy path,
  canonical sizes, unresolved indication, and external links unchanged (I12).

## 6. Data integrity guarantees

- No fabricated measurements: no typical-body values, no estimates, no interpolation, no
  synthetic rows, no filled cells (I3).
- Partial stays partial: an imported chart with unresolved columns/rows keeps status
  `partial` and shows only verified columns (I3, test I-14).
- Units preserved, no silent conversion (`US 8 ≠ EU 42`); Stage I performs no unit
  conversion (I4).
- Unresolved sizes stay raw with no fabricated canonical identity (I11, test I-26).
- Chart presence never changes size resolution or availability (I10, test I-24).
- **Persistence: no Prisma migration** (I5). Nothing real is persistable; the schema
  proposal below is documented, not applied.

### Schema proposal (documented only — NOT applied)

If/when a real chart source is approved, the smallest additive persistence would be a
`SizeChart` row + `SizeChartColumn` + `SizeChartRow` (or a single JSON column keyed by the
existing `SizeChart` contract), all nullable and back-compatible, with:
`id, scopeKind, productId?, brandId?, categoryId?, priority, version, audience, productType,
ageRange?, system?, status, source, updatedAt` and child rows carrying
`sizeOptionId?`, `sizeLabel`, serialized `values`. No existing field is renamed/removed and
no rows are pre-populated.

## 7. Verification results

| Suite | Result |
| --- | --- |
| `npm run typecheck` | PASS (0 errors) |
| `npm run build` (Next 16.3.2 Turbopack) | PASS |
| `npm run test:size-domain-i-chart` (new) | **19 passed, 0 failed** |
| `npm run test:size-domain-i-product` (new) | **8 passed, 0 failed** |
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

Dev-server-required suites (`search`, `diagnostics`, `facet-policy`, `gender-*`,
`similar-ratio`, `e2e`, `o4-facet-equivalence`) remain un-runnable locally
(`ECONNREFUSED 127.0.0.1:3000`), as in H1/H2; Stage I correctness is covered by the pure +
DB suites above. Taxonomy was not modified to pass; the expected 83/87 baseline holds.

## 8. Stage I test coverage

**Resolver / UI contract — `scripts/size-domain-i-chart.test.mts` (19):**
PRODUCT / BRAND / CATEGORY display (I-1…I-3); `NO_CHART` (I-4, I-16); `NO_COMPATIBLE_CHART`
(I-5); `INVALID` (I-6); provenance (I-7); system (I-8); units (I-9); dynamic columns
(no universal Chest/Waist, I-10); dynamic rows for a footwear chart (I-11); a source range
is formatted, not converted (I-12); a missing cell stays empty (I-13); an imported partial
chart stays partial and shows only verified columns (I-14); the bridge maps numbers +
canonical ids without guessing (I-15); the default boundary yields `NO_CHART` (I-16); an
injected source resolves through the single resolver (I-17); highlight is correspondence,
not availability (I-18/I-19).

**Product integration — `scripts/size-domain-i-product.test.mts` (8, DB-guarded):**
a real product with resolved variants exists (I-20); without a source the guide is
`NO_CHART` and the product is preserved (I-21); multiple canonical sizes are exposed
(I-22); an injected source yields `FOUND` + `PRODUCT` provenance (I-23); chart presence does
not change size resolution/availability (I-24); the external source link is preserved
(I-25); unresolved sizes stay raw with no fabricated identity (I-26); an unknown product
returns `null` → 404 (I-27). The injected chart is an in-memory test fixture and is never
persisted.

## 9. Open limitations / follow-ups

- **No real chart data (primary limitation).** Every product renders `NO_CHART` today. This
  is intentional: providing charts is a data-acquisition task, and I14 forbids fabricating
  one. The architecture is complete and tested; the moment a `SizeChartSource` is approved
  and wired into `loadProductDetail`, the Size Guide will render it with no further code
  change.
- **No production `chartSource` wired into the page yet.** `product/[productId]/page.tsx`
  uses the default empty source. This is the explicit "documented data limitation".
- **Import bridge is not yet used by a real importer.** `sizeChartFromNormalized` is tested
  but has no production caller (there is no parsed source chart to feed it).
- **Inherited H1 UNISEX-fold limitation** at the DB identity boundary (documented in the H2
  gate report) is unchanged by Stage I.
- **`scripts/questionnaire-context.test.mts` remains stale/unwired** (pre-existing, not
  touched by Stage I).

## 10. Gate decision requested

Accept Stage I as **PASS WITH DOCUMENTED DATA LIMITATIONS** (architecture + UI + tests
complete; no production chart source exists, so `NO_CHART` is the honest state), or return
with changes. No Stage J or other work begins until this gate is explicitly accepted.
