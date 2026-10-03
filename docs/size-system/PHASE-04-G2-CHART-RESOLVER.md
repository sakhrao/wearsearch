# Size System — Phase 4 / G2 — Size Chart Resolver

A pure, UI-free, DB-free decision function that, given a product target and a
set of candidate charts, returns exactly one chart (or an explicit
no-chart/no-compatible/invalid outcome) with recorded provenance. It is a
domain contract only: it decides *which* chart applies, never *where* charts
come from and never what a chart contains.

## 1. Contract

`resolveSizeChart(target, charts) -> ResolvedSizeChart`

```
status:     FOUND | NO_CHART | NO_COMPATIBLE_CHART | INVALID
chart:      the winning SizeChart, untouched, or null
provenance: PRODUCT | BRAND | CATEGORY, or null
considered: every candidate with applies/usable/compatible/accepted + reason
```

`SizeChartTarget = { productId, brandId, category, context, systems? }` where
`context` is the product's `SizeContext` and `systems` are the size systems the
product actually carries (from canonical reads; empty = unknown).

Status semantics:

| status | meaning |
| --- | --- |
| `FOUND` | a usable, context/system-compatible chart was selected |
| `NO_CHART` | no candidate's scope names this product/brand/category |
| `NO_COMPATIBLE_CHART` | charts apply but none is compatible with the product |
| `INVALID` | the best applying chart is structurally unusable |

## 2. Priority

Fixed order: **PRODUCT > BRAND > CATEGORY** (`SIZE_CHART_PRIORITY_ORDER`). A
product's own chart always wins when it is usable and compatible. Brand scope
must also match the product's size category. Conversion tables are not product
charts and never apply.

## 3. Rejections are never silent

Every candidate lands in `considered` with a `reason` from
`SizeChartRejectionReason`:

`SCOPE_MISMATCH`, `CATEGORY_MISMATCH`, `PRODUCT_TYPE_MISMATCH`,
`AUDIENCE_MISMATCH`, `AGE_RANGE_MISMATCH`, `SYSTEM_MISMATCH`, `EMPTY`,
`INVALID`, `LOWER_PRIORITY`.

A higher-priority chart that is invalid or incompatible does not block a
lower-priority usable chart, but the rejection is always recorded (G2-5,
G2-14). A product chart is never silently replaced.

## 4. Compatibility (§19)

- `context.productType` must match exactly — a footwear product never receives
  a clothing chart and vice-versa.
- `context.audience` matches exactly, or through `UNKNOWN`/`UNISEX`.
- `context.ageRange` must overlap when both sides specify bounds.
- When `chart.system` is present and the product has known `systems`, the chart
  system must be among them — a US product never silently receives an EU chart
  (`SYSTEM_MISMATCH`).

## 5. No fabrication (§20)

`isUsableSizeChart()` only accepts or rejects:

- `status === "missing"`, zero columns or zero rows -> `EMPTY`;
- malformed columns/rows -> `INVALID`;
- `status === "partial"` is usable and is surfaced as-is.

The resolver returns the caller's chart object by reference. It never
interpolates, converts units, or fills a missing measurement — a `null` value
stays `null` (G2-9, G2-12).

## 6. Determinism

Candidate order never affects the result. Candidates are evaluated in `id`
order; the winner is chosen by priority, then `version` desc, then `updatedAt`
desc, then `id` asc (G2-11).

## 7. Tests

`scripts/size-domain-chart.test.mts` — **16/16** (`npm run test:size-domain-chart`):

- G2-1 product wins; G2-2 brand fallback; G2-3 category fallback; G2-4 no chart
- G2-5 incompatible chart recorded; G2-6 footwear; G2-7 clothing; G2-8 bag
- G2-9 dynamic columns untouched; G2-10 provenance
- G2-11 deterministic order/version/updatedAt/id; G2-12 no fabrication
- G2-13 size-system compatibility; G2-14 invalid product recorded + fallback
- G2-15 conversion tables excluded; G2-16 priority-order contract

## 8. Type change

`SizeChart` gains one **optional** field: `system?: SizeSystemId | null`. It is
additive; every existing chart without it is unaffected.

## 9. What this stage does not do

- It does not create, fetch, migrate, or persist charts (no Prisma chart model
  exists; see the audit).
- It does not convert systems, interpolate measurements, or render UI.
- It does not touch Search, the Questionnaire, or the database.
