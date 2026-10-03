# Phase 09 — K: Future Size-Chart Source Contract

> STATUS: **CONTRACT ONLY.** Defines what a future *approved* chart source must provide so it
> can be ingested without changing the canonical domain. No provider is implemented, matched,
> cached, or persisted here (K7). The canonical pipeline already exists and is exercised by
> `scripts/size-domain-k-source-contract.test.mts` against a **TEST ONLY — NOT PRODUCTION DATA**
> fixture.

## K4 — Required source contract

A conformant source returns, per target, zero or more chart records. A record is valid only if
**all** required fields are present. Missing required fields fail closed (no chart), never a
guess.

### Required fields

| Group | Field | Meaning |
| --- | --- | --- |
| Identity | `sourceProductId` | The source's own stable product id. **Not** a name, slug, or title. |
| Identity | `sourceBrandId` | Source's stable brand id (for brand/category-scoped charts). May be absent for a product-only chart. |
| Identity | `sourceCategoryToken` | Source's category token, mapped by a verified table (not slugified name). |
| Identity | `sourceChartId` | Source's stable chart id (for provenance and caching). |
| Chart | `system` | Explicit size system (`EU`, `US`, `UK`, `INTERNATIONAL`, …). Never inferred from labels. |
| Chart | `columns[]` | `{ measurement, label, unit }`; `unit` explicit (`cm`, `in`, …). |
| Chart | `rows[]` | `{ sizeLabel, values[] }`, values aligned to columns. |
| Context | `audience` | `MEN` / `WOMEN` / `KIDS` / `UNISEX`. |
| Context | `productType` | `CLOTHING` / `FOOTWEAR` / `ACCESSORY` / `HEADWEAR`. |
| Context | `ageRange` | Required iff `audience = KIDS`. |
| Usage | `scope` | Which canonical target the chart attaches to: product, brand, or category. |
| Usage | `source` | Human-readable source name for provenance display. |
| Usage | `updatedAt` / `version` | Recency signals for deterministic resolution. |

### Forbidden by contract

- A measurements-only payload with no explicit `system` or `unit`.
- A chart for one target re-used for another target without a declared scope.
- Any conversion, interpolation, or "standard" fallback applied by the source.
- Any name-based or similarity-based attachment (K6).

## K5 — Canonical normalized contract (reuse, do not replace)

The source is adapted into the **existing** types; no second chart format is introduced.

```
SourceSizeChartInput
  -> normalizeSourceSizeChart()   -> NormalizedSizeChart   (chart-import.ts funnel)
  -> sizeChartFromNormalized()    -> SizeChart             (canonical domain type)
  -> resolveSizeChart()           -> ResolvedSizeChart     (priority + compatibility)
  -> buildSizeChartView()         -> SizeChartView         (display states)
```

Notes:

- `NormalizedSizeChart` / `SizeChart` remain the single canonical representations
  (`src/lib/size-domain/types.ts`). `SizeChartCellValue` is
  `number | { min; max } | string | null` — a range is preserved as `{min,max}` and formatted
  verbatim; a `null` measurement is preserved as empty, never filled.
- A chart with no rows/columns normalizes to `status: "missing"` and produces no chart.
- Units are stored as given and never converted (Stage I, I4).

## K6 — Identity-mapping requirements

Every attachment must resolve through a **verified mapping**. Names are never identifiers.

| Scope | Mapping required | Fail-closed condition |
| --- | --- | --- |
| Product | `sourceProductId` → `Product.id`, exact | No map, or map points elsewhere → NO_CHART; **no fallback** to brand/category from a mis-mapped product |
| Brand | `sourceBrandId` → `Brand.id`, exact | No verified brand map → brand scope unavailable |
| Category | `sourceCategoryToken` → canonical `SizeCategoryId`, verified | No verified category map → category scope unavailable |
| Chart → target | chart context must match target `audience`/`productType`/`ageRange`, and system when both declare one | Incompatible → `NO_COMPATIBLE_CHART` |

Rules:

- No fuzzy, prefix, normalized-case, or similarity matching — a near-miss id yields NO_CHART.
- Exactly one canonical target per source record; ambiguity fails closed.
- If ownership cannot be verified, the chart is not attached.

## K7 — Ingestion boundary

The single insertion point is **`SizeChartSource`** (`src/lib/size-domain/chart-source.ts`):

```ts
interface SizeChartSource {
  name: string;
  loadCharts(target: SizeChartTarget): Promise<SizeChart[]> | SizeChart[];
}
```

`resolveChartsFromSource(source, target)` loads then runs the canonical resolver. Today the
only registered source is `EMPTY_SIZE_CHART_SOURCE` (returns `[]`), so production shows no
charts. This boundary was already introduced in Stage I and is **not modified in Stage K**.

| Concern | Contract |
| --- | --- |
| **Input** | A `SizeChartTarget` (product/brand/category + `SizeContext` + declared `systems`). |
| **Output** | Zero or more canonical `SizeChart`s. The source never returns raw provider payloads to callers. |
| **Ownership** | The canonical domain owns normalization, resolution, and display. The source owns only transport + mapping to the contract. |
| **Caching** | Out of scope for the domain. A source MAY cache internally; any cache must key on the stable source id and must not invent missing fields. |
| **Errors** | A source MUST fail closed: throw or return `[]`; never return a partial chart with fabricated fields. The resolver itself never throws on bad charts — it records `INVALID`/`NO_CHART`. |
| **Provenance** | `source` + `sourceChartId` are carried through to `SizeChart.source` / `id` and rendered by `buildSizeChartView` / `<SizeGuide>`. |
| **Identity mapping** | The source (or its adapter, `scripts/fixtures/size-chart-source-fixture.ts` in the test) converts source ids to canonical ids using verified maps only (K6). |

Because Stage K implements no provider, `APPROVED SIZE CHART SOURCE: MISSING` still holds.
This contract is the acceptance criteria a future source must satisfy before it may be wired
to `SizeChartSource`.
