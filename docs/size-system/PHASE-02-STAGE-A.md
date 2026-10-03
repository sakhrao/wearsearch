# Size System — Phase 2 / Stage A — Canonical Size Domain (types only)

Decision (user): canonical size model lives **lib-level first** in
`src/lib/size-domain/`; Prisma entities come later. Stage A is **types +
structural registries, wired to nothing** — no behavior change, no fake size
values, no DB writes.

## What was added

| File | Contents |
| --- | --- |
| `src/lib/size-domain/types.ts` | `SizeSystemId`, `SizeAudienceId`, `SizeProductTypeId`, `SizeCategoryId`, `MeasurementTypeId`, `MeasurementUnit`, `SizeAgeRange`, `SizeContext`, `SizeOption`, `SizeChartColumn`, `SizeChartRow`, `SizeChartScope`, `SizeChartPriority`, `SizeChartStatus`, `SizeChart` |
| `src/lib/size-domain/registry.ts` | `SIZE_SYSTEMS`, `SIZE_CATEGORIES`, `MEASUREMENT_TYPES` + guards (`isSizeSystemId`, …), lookups (`sizeSystem`, `sizeCategory`, `measurementType`), `sizeSystemOrder`, and the compatibility bridges `sizeProductTypeToDiscipline` / `disciplineToSizeProductType` / `canonicalSizeOptionId` |
| `src/lib/size-domain/index.ts` | Public barrel |
| `scripts/size-domain.test.mts` | Invariant guard (22 checks) |

## Design rules enforced

- **Identity ≠ display.** `SizeOption` carries `value` (identity) and
  `displayValue` separately; `value` is never a display label.
- **Context on the size.** `SizeContext = { audience, productType, ageRange }`,
  so `MEN | FOOTWEAR | EU | 42` cannot collapse with `WOMEN | FOOTWEAR | EU | 42`.
- **Persistence truth is explicit.** `SizeSystemMeta.persisted` is `true` only
  for the exact Prisma `SizeSystem` enum set (`INTERNATIONAL, EU, US, UK, IT,
  FR, UNKNOWN`); every extended system (`DE, JP, CM, MONDO, WAIST_IN, WAIST_CM,
  BRA, ONE_SIZE`) is additive and flagged `persisted: false` pending migration.
- **No hardcoded size values.** The registries hold systems / categories /
  measurement *types* only; no `S/M/L`, no numeric ranges. Value sets remain
  data-driven (Stage B+).
- **Backward-compatible identity.** `canonicalSizeOptionId()` reproduces the
  existing `sizeIdentity()` wire format `audience|discipline|system|value`
  (`src/lib/size-sections.ts:131`), so the canonical domain speaks the same
  language the search facet already round-trips.
- **Measurements cover the spec's categories:** clothing/bra, footwear, belt,
  hat, glove, socks, bag (4 dimensions), plus `one_size`/`unknown` with none.

## Verification (Gate — Stage A)

- `npm run test:size-domain` → **22 passed, 0 failed**
- `npx tsc --noEmit` → **clean**
- No-regression reruns (nothing existing was modified):
  - `size-identity` **30/30**, `size-sections` **9/9**, `size-groups` **9/9**
    (the latter only via `tsx`; plain `node` cannot resolve its extensionless
    import — pre-existing, not wired to a script)
  - `test:taxonomy-ids` **15/15**
  - `test:taxonomy` **83/87** — exactly the 4 known pre-existing failures
    (T1 jeans-children, T2 wide-leg, T-kids, B1)
  - `test:questionnaire` **32/32**

## Not done (deliberately)

- No Prisma models, no migration, no adapter, no UI, no search changes.
- No wiring of the domain into `sizes.ts` / `size-sections.ts` / questionnaire.

## Next (awaiting go-ahead)

Stage B — **normalization**: one deterministic `normalizeSize(raw, context)` in
the domain that folds source strings (livostyle / offer-vocab / eBay) into
`SizeOption`s, reconciling the three `2XL/XXL` conventions, with a fixture test
driving the real adapters. Still no UI, no Prisma.
