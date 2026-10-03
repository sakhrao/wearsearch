# Size System — Phase 2 / Stage B — Deterministic Normalization

Stage A (`src/lib/size-domain/types.ts` + `registry.ts`) is the baseline and was
not reopened. Stage B adds a **pure, deterministic, fixture-driven** normalization
layer that consumes the Stage A types/registries. Nothing is wired to Product,
Prisma, search, the questionnaire, Results Cards, or Product Detail.

## Files

| File | Role |
| --- | --- |
| `src/lib/size-domain/normalization-types.ts` | `SizeNormalizationContext`, `NormalizedSize`, `NormalizedSizeChart`, chart input/output types, `NormalizationStatus` / `NormalizationConfidence` / `NormalizationReason` |
| `src/lib/size-domain/aliases.ts` | The explicit, inspectable alias layer: `ALPHA_SIZE_ALIASES`, `ONE_SIZE_ALIASES`, `BRA_CUPS`, `SYSTEM_PREFIX_ALIASES`, `MEASUREMENT_LABEL_ALIASES`, `AMBIGUOUS_MEASUREMENT_LABELS`, `MEASUREMENT_UNIT_ALIASES` |
| `src/lib/size-domain/normalize.ts` | `normalizeSourceSize`, `normalizeSourceSizeChart`, `isPersistedSizeSystem` |
| `src/lib/size-domain/index.ts` | Barrel re-exports (modified) |
| `scripts/size-domain-normalize.test.mts` | Fixture guard (42 checks) |
| `package.json` | `test:size-domain-normalize`, `typecheck` scripts |

No second registry was created: the alpha vocabulary is the existing
`ORDERED_ALPHA` from `src/lib/sizes.ts`, and systems/categories/measurements come
from the Stage A registry. `aliases.ts` only adds explicit source-spelling → canonical
mappings on top.

## Normalization pipeline (`normalizeSourceSize`)

```
1. validate context (audience, productType, category, system, ageRange)
2. fold the raw label (trim, collapse whitespace, lowercase, strip "_")
3. preserve sourceLabel verbatim
4. extract an optional leading system token  ("EU 42", "JP 25", "US 8")
5. classify the remaining value: One Size | alpha | numeric | bra
6. resolve against the explicit registry for that shape
7. validate the system against the shape and the context
8. return a structured NormalizedSize (RESOLVED or UNRESOLVED)
```

`status: RESOLVED | UNRESOLVED` and `confidence: EXACT | NORMALIZED | UNKNOWN`
are independent:

- **EXACT** — the folded source already equals a canonical registered value
  (`"M"`, `" M "`, `"m"`, `"one size"`, `"36b"`).
- **NORMALIZED** — an explicit alias/equivalence was applied (`"Medium"`→`M`,
  `"2XL"`→`XXL`), or a numeric value was accepted under an explicit system.
- **UNKNOWN** — only on `UNRESOLVED`.

`identity ≠ display ≠ source` is preserved: the result carries `sourceLabel`
(verbatim), `canonicalValue`/`canonicalSizeOptionId` (identity), and
`displayLabel`.

## Supported mappings

- **Alpha** (`ALPHA_SIZE_ALIASES`): `xxs/xs/s/m/l/xl/xxl/xxxl/4xl/5xl` plus word
  aliases (`medium`, `med`, `extra small`, …). The known `2XL/XXL` and `3XL/XXXL`
  divergences are reconciled to the single canonical `XXL` / `XXXL` (the audit's
  three-convention defect).
- **One Size**: `one size`, `onesize`, `one-size`, `os`, `universal`, `uni` →
  canonical `One Size` (`ONE_SIZE` system).
- **Bra** (`BRA_CUPS`): `<2–3 digits><cup>` with an explicit cup list, only under
  `category = "bra"`.
- **Numeric**: accepted only when the system is explicit/persisted and the
  context is concrete; the source spelling is kept (`"8,5"` stays `"8,5"`).
- **System prefixes** (`SYSTEM_PREFIX_ALIASES`): `EU/US/UK/IT/FR/DE/JP/CM/MONDO/
  WAIST IN/WAIST CM/BRA`, matched only when a value follows.

## Context resolution

`SizeNormalizationContext = { audience, productType, system?, category?, ageRange? }`.

- Alpha requires a concrete audience and product type (so `M` under MEN vs WOMEN
  is a different identity — never one universal id).
- Numeric requires an explicit system **and** a concrete product type/audience;
  `WAIST_*` on footwear is refused.
- A provided `ageRange` is KIDS-only and must be a valid min≤max range.
- A source prefix that conflicts with `context.system` is refused
  (`CONFLICTING_SYSTEM`).

## Unresolved behaviour (prefer correct+unresolved)

`UNRESOLVED` is returned — never a guess — for: empty/malformed input, unknown
labels (`Special Fit`, `Custom`, `XXX`), unregistered cup shapes (`42R`,
explicitly listed in the spec), multi-system values (`42 (US 9)`), ambiguous
numerics without a system/product type, cross-context values (alpha on footwear,
alpha under EU), and invalid systems.

## `persisted` compatibility (§13)

The normalized result exposes `systemPersisted` from the Stage A registry.
Non-persisted systems (`JP`, `BRA`, `WAIST_IN`, `ONE_SIZE`, …) **may be
represented** in the canonical identity (Stage A allows it) but are always
flagged `systemPersisted: false`; Stage B never silently promotes them into the
persisted enum set.

## `canonicalSizeOptionId` compatibility (§14)

`canonicalSizeOptionId` was not changed. Fixtures (`H1`/`H2`) prove a resolved
canonical size reproduces the existing `sizeIdentity` wire format
(`audience|discipline|system|value`, `size-sections.ts:131`).

## Size Chart normalization (`normalizeSourceSizeChart`)

Raw chart → validate columns → resolve source size labels → preserve source
labels → validate measurement types/units → canonical structure.

- **Columns stay dynamic**: resolved through `MEASUREMENT_LABEL_ALIASES` plus a
  context-dependent table (`AMBIGUOUS_MEASUREMENT_LABELS`) so `Width/Height/
  Depth/Length/Drop` map per category (`bag_width`, `foot_width`, …). Unknown
  columns are kept with `resolved: false`, never silently discarded.
- **Units are preserved, never converted** (`27 in` stays `27` with unit `in`).
  A declared-but-unrecognized unit marks the column unresolved.
- **Rows** carry `sourceSizeLabel`, `canonicalSizeOptionId`, and per-column
  `{ number, unit, raw }`. An unresolvable row stays `UNRESOLVED` with a null id
  — it is never attached to a nearby size. Missing measurements remain `null`.
- Chart `status` = `available` (all columns+rows resolved) / `partial` /
  `missing` (no columns or rows).

## What Stage B intentionally does NOT do

- No cross-system conversion (US↔EU↔JP …) — `normalization ≠ conversion`.
- No unit conversion.
- No fuzzy/nearest matching and no substring heuristics.
- No DB, network, Prisma, Product, availability, clock, or random ids.
- No writes to Product / ProductVariant and no schema change.

## Verification (Gate — Stage B)

- `npm run test:size-domain` → **22/22**
- `npm run test:size-domain-normalize` → **42/42**
- `npm run typecheck` (`tsc --noEmit`) → **clean**
- `npm run build` → **PASS**
- Regression: `size-identity` 30/30, `size-sections` 9/9, `size-groups` 9/9,
  `taxonomy-ids` 15/15, `questionnaire` 32/32, `taxonomy` 83/87 (the 4 known
  baseline failures unchanged).

Note: this repository defines **no** `test` aggregate script, so `npm test` is
not available; the focused suites above are the equivalent gate.

## Next (awaiting go-ahead)

**Stage C** — deterministic Product/Variant integration (additive): derive
`SizeOption`s from real variant/offer rows through `normalizeSourceSize`, prove
coverage and the unresolved rate against the live catalog, still without
changing search/questionnaire/UI.
