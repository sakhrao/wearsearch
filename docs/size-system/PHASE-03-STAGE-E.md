# Size System — Phase 3 / Stage E — Canonical Size Persistence & Safe Backfill

Stage E adds trustworthy canonical size persistence on top of the existing
Product / Variant / Offer model. It establishes **persistence**, not broader
coverage. The rule held throughout:

> Persist what we know. Preserve what the source said. Leave what we do not know
> unresolved.

`APPROVED_SIZE_SYSTEM_POLICIES` is still **empty**; the Livostyle candidate is
**not approved** and was not applied. No UI, search, questionnaire or Product
Detail code was touched.

## 1. Prisma schema audit

See `PHASE-03-STAGE-E-AUDIT.md`. Summary of the real ownership:

```
Product
 ├── ProductVariant       -> sizeId -> Size?          (legacy path)
 └── ProductOffer
      └── ProductOfferVariant -> sizeValue/sizeSystem/sizeProductType/sizeAudience
```

`Size.system` is the `SizeSystem` enum (`INTERNATIONAL, EU, US, UK, IT, FR,
UNKNOWN`) and **cannot** hold `DE, JP, CM, MONDO, WAIST_IN, WAIST_CM, BRA,
ONE_SIZE`. No hard-stop condition was found.

## 2. Chosen persisted fields

Four additive, nullable, no-default `TEXT` columns on **both** size-bearing
tables (`ProductVariant` and `ProductOfferVariant`):

```
canonicalSizeOptionId     String?
sizeResolutionStatus      String?   -- RESOLVED | UNRESOLVED
sizeResolutionProvenance  String?   -- EXPLICIT | INFERRED | UNRESOLVED
sizeResolutionSystem      String?   -- resolved system incl. non-persisted ids
```

Plus two additive indexes per table (`canonicalSizeOptionId`,
`sizeResolutionSystem`). No enum, no NOT NULL, no foreign key, no data rewrite.

There is **no** `canonicalSizeId`: `canonicalSizeOptionId` already is the Stage
A/B canonical identity and is byte-identical to the existing `sizeIdentity()`
wire format, so a second identity field would be pure duplication (Stage E §5).

## 3. Why each field exists

- **`canonicalSizeOptionId`** — the single canonical identity
  (`audience|discipline|system|value`). `null` when unresolved.
- **`sizeResolutionStatus`** — `RESOLVED` vs `UNRESOLVED`; `null` means "not yet
  backfilled" (a legacy row), which is deliberately distinct from unresolved.
- **`sizeResolutionProvenance`** — `EXPLICIT` / `INFERRED` / `UNRESOLVED`; keeps
  the three Stage D outcomes distinguishable in the database.
- **`sizeResolutionSystem`** — a stored *component*, not a second identity. It is
  needed because (a) the system can be known while the id is `null`, and (b)
  non-persisted systems cannot live in the `SizeSystem` enum and must never be
  coerced.

## 4. Legacy compatibility strategy

- Source data is untouched: `Size.value`, `ProductVariant.sizeId`,
  `ProductOfferVariant.sizeValue/sizeSystem/...` are never written.
- New columns are nullable, so every pre-existing row stays readable.
- `readCanonicalOrLegacySize()` (`src/lib/size-domain/persist.ts`) is the single
  domain-layer read branch: canonical present → canonical view; otherwise →
  legacy fallback. UI is not duplicated and is not changed.
- Availability remains independent (`availability` / `available` are never merged
  into resolution status).

## 5. Migration strategy

Migration `20261002140429_canonical_size_persistence`:

```sql
ALTER TABLE "ProductOfferVariant" ADD COLUMN "canonicalSizeOptionId" TEXT,
  ADD COLUMN "sizeResolutionProvenance" TEXT,
  ADD COLUMN "sizeResolutionStatus" TEXT,
  ADD COLUMN "sizeResolutionSystem" TEXT;
ALTER TABLE "ProductVariant" ADD COLUMN "canonicalSizeOptionId" TEXT,
  ADD COLUMN "sizeResolutionProvenance" TEXT,
  ADD COLUMN "sizeResolutionStatus" TEXT,
  ADD COLUMN "sizeResolutionSystem" TEXT;
CREATE INDEX "ProductOfferVariant_canonicalSizeOptionId_idx" ...;
CREATE INDEX "ProductOfferVariant_sizeResolutionSystem_idx" ...;
CREATE INDEX "ProductVariant_canonicalSizeOptionId_idx" ...;
CREATE INDEX "ProductVariant_sizeResolutionSystem_idx" ...;
```

Purely additive and reversible (`DROP COLUMN`). Applied to the configured **local
development** database (`postgres @ localhost:5432/mydb`) with
`prisma migrate deploy`; client regenerated with `prisma generate`. No
non-local database was touched.

## 6. Backfill strategy

Pure planner + opt-in runner:

```
scripts/size-domain-backfill.mts
  read rows -> Stage C integrateProductSizes
            -> Stage D projectProductSizes (approved policies only)
            -> Stage E canonicalFieldsFromProjection
            -> planSizeBackfill (pure, deterministic, idempotent)
            -> report; write only with --apply
```

`planSizeBackfill()` (`src/lib/size-domain/persist.ts`) processes entries in input
order and returns `{ changes, report }`. Same data + same policy + same registry
always produces the same changes.

Commands:

```
npm run size-domain-backfill              # dry run, DATABASE_WRITES: 0
npm run size-domain-backfill -- --apply   # persist changes
npm run size-domain-backfill -- --verify  # read-only integrity assertions
```

## 7. Unresolved handling

An unresolved observation persists `canonicalSizeOptionId = null`,
`sizeResolutionStatus = "UNRESOLVED"`, `sizeResolutionProvenance = "UNRESOLVED"`.
No canonical id is ever invented. A known system is still recorded in
`sizeResolutionSystem` even when the id is null. Unresolved values are never
deleted or rewritten.

## 8. Provenance handling

`sizeResolutionProvenance` carries the Stage D value verbatim. Writes never
downgrade better provenance (`isDowngrade`): an `EXPLICIT` row is never lowered to
`INFERRED`/`UNRESOLVED`, and an unresolved row is only "resolved" when real
metadata (or an explicitly approved policy) produces a higher-provenance result.

## 9. Livostyle handling

The 159 legacy Livostyle bare-numeric footwear observations persist exactly as:

```
sourceSizeLabel      = original numeric value  (untouched in Size.value)
canonicalSizeOptionId = null
sizeResolutionStatus  = UNRESOLVED
sizeResolutionProvenance = UNRESOLVED
sizeResolutionSystem  = null
```

`livostyle-womens-shoes-us` remains a documented **candidate** in
`SIZE_SYSTEM_POLICY_CANDIDATES` and is **not** in
`APPROVED_SIZE_SYSTEM_POLICIES`. No inference was applied.

## 10. Idempotency guarantees

`planSizeBackfill` skips rows whose stored canonical fields already equal the
planned result, so a second run yields `changed: 0`. Measured on the live catalog
after the first apply:

```
run 1 (--apply): changed 3977, DATABASE_WRITES 3977
run 2 (--verify): changed 0,    unchanged 3977, DATABASE_WRITES 0
```

Same source data + same policy + same registry → same persisted result.

## 11. Verification results

Before (`prisma` counts) / after: legacy rows untouched.

```
products: 570
ProductVariant total 4029, with size 3977 (unchanged)
ProductOffer 0, ProductOfferVariant 0 (unchanged)
Size rows 107 (unchanged)
```

Backfill report (matches the Stage C baseline exactly):

```
observations 3977 | resolved 3818 | inferred 0 | unresolved 159
withCanonicalIdentity 3818 | withoutCanonicalIdentity 159
byProvenance {"EXPLICIT":3818,"UNRESOLVED":159}
bySystem {"US":371,"EU":355,"NONE":159,"INTERNATIONAL":3092}
baselineMatch true
```

Integrity assertions (`--verify`):

```
PASS V1 every RESOLVED row has a canonical identity :: resolvedWithoutId=0
PASS V2 no UNRESOLVED row has a fabricated canonical identity :: unresolvedWithId=0
PASS V3 production INFERRED count is 0 :: inferred=0
PASS V4 legacy size-bearing rows preserved :: variantWithSize=3977 ...
VERIFY: PASS
```

Tests: `scripts/size-domain-stage-e.test.mts` — **18/18** (E1–E16b, covering the
15 required cases plus offer-grain, downgrade prevention and an upgrade case).
Typecheck clean, build PASS (see the completion report).

## 12. Remaining limitations

- The offer path is implemented and unit-tested but has **zero** live rows, so its
  live backfill is not exercised by real data yet.
- Canonical fields are `TEXT` (closed vocabulary enforced at the domain layer),
  chosen for cheap reversibility; a future stage may promote them to enums.
- `sizeResolutionSystem` can hold non-persisted systems, but no downstream size
  filtering consumes it yet (later stage).
- A later sync that changes a legacy label without re-running the backfill leaves
  the canonical fields stale; the planner is safe to re-run and upgrades on real
  metadata.
- `ageRange` remains a data-acquisition problem and is not persisted here.
- `test:search` needs a live dev server and was not run.
