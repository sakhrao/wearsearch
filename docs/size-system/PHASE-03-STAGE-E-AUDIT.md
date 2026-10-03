# Size System — Phase 3 / Stage E — Canonical Size Persistence Audit

Read-only schema audit completed **before** any Prisma or database change.
Verdict: **no hard-stop condition found**; the additive design below is safe.

## 1. Actual models inspected

| Concept | Actual model | File location |
| --- | --- | --- |
| Product | `Product` | `prisma/schema.prisma:297` |
| Product variant | `ProductVariant` | `prisma/schema.prisma:341` |
| Offer (listing) | `ProductOffer` | `prisma/schema.prisma:118` |
| Offer variant | `ProductOfferVariant` | `prisma/schema.prisma:171` |
| Shared size lookup | `Size` | `prisma/schema.prisma:361` |
| Source identity | `Source` | `prisma/schema.prisma:34` |

Ownership confirmed: a size hangs off `ProductVariant.sizeId -> Size?` and,
independently, off `ProductOfferVariant.sizeValue`/`sizeSystem`/`sizeProductType`/
`sizeAudience`. Size is **variant/offer-variant grain**, never `Product` grain.

`ProductVariant` is the legacy path; `ProductOfferVariant` is the Phase-0 path.
Both are active in the architecture.

## 2. Current size-bearing fields

### `ProductVariant` (`:341-359`)
```
id, productId, sizeId String?, colorId, sku, price, currency,
availability Availability, createdAt, updatedAt
relation: size -> Size?  (fields: [sizeId])
indexes: @@index([productId]) @@index([sizeId]) @@index([colorId])
```

### `ProductOfferVariant` (`:171-211`)
```
id, offerId, externalVariantId, variantKey, sku, gtin, gtinType,
color, sizeValue String?, sizeSystem String?, sizeProductType String?,
sizeAudience String?, availability String, prices..., timestamps
relation: offer -> ProductOffer (onDelete: Cascade)
indexes: @@index([offerId]) @@index([gtin]) @@index([availability])
unique:  @@unique([offerId, variantKey])
```

### `Size` (`:361-393`)
```
id, category, system SizeSystem, value, normalizedValue,
audience SizeAudience @default(UNKNOWN),
productType SizeProductType @default(UNKNOWN),
numericValue Float?, ordinal Int?, displayValue String?, subsystem String?
unique:  @@unique([audience, productType, system, value])
index:   @@index([normalizedValue])
```

`Size.system` is the `SizeSystem` enum (`INTERNATIONAL, EU, US, UK, IT, FR,
UNKNOWN`) — it **cannot** represent the non-persisted systems `DE, JP, CM, MONDO,
WAIST_IN, WAIST_CM, BRA, ONE_SIZE` that Stage A/B/D legally resolve. This is the
single most important constraint for the Stage E design.

### Availability
- `ProductVariant.availability` — `Availability` enum (AVAILABLE/OUT_OF_STOCK/UNKNOWN).
- `ProductOfferVariant.availability` — raw `String` (richer source state).

Availability is independent of size resolution and must not be merged with it.

## 3. Existing identity contract (Stage A/B)

```
canonicalSizeOptionId = [audience, discipline, system, value].join("|")
```
where `discipline = FOOTWEAR ? "shoes" : "clothing"` (`registry.ts:243-254`).
This is byte-identical to the established wire format
`sizeIdentity(audience, productType, system, value)` (`size-sections.ts:131-143`)
for every RESOLVED value; verified at `scripts/size-domain-normalize.test.mts:438`
(H1) and reused by Stage C/D.

## 4. Proposed additive fields (both size-bearing tables)

Chosen persisted fields:

```
canonicalSizeOptionId   String?   -- THE canonical identity (wire-compatible)
sizeResolutionStatus    String?   -- RESOLVED | UNRESOLVED
sizeResolutionProvenance String?  -- EXPLICIT | INFERRED | UNRESOLVED
sizeResolutionSystem    String?   -- resolved system incl. non-persisted ids
```

All nullable, no defaults, no NOT NULL, no enum. `NULL` on all four unambiguously
means **"not yet backfilled"** (a legacy row), which is distinct from
`sizeResolutionStatus = "UNRESOLVED"` (processed and genuinely unresolved).

### Why only one canonical identity (§5)
`canonicalSizeOptionId` **is** the existing Stage A/B canonical identity; adding a
second `canonicalSizeId` would duplicate the same identity. The normalized value
and audience/product-type components are derivable from the id via
`parseSizeIdentity()` (`size-sections.ts:145`), so they are not persisted again.

### Why `sizeResolutionSystem` exists as a component column
Documented architectural reason (not a second identity):
1. the system can be **known while the id is null** — an explicit system plus an
   insufficient context yields `UNRESOLVED` with a real `system`;
2. non-persisted systems (`JP/BRA/ONE_SIZE/...`) must be preserved without being
   coerced into the `SizeSystem` enum, which cannot hold them;
3. downstream size filtering will need a queryable system without parsing the id.

The system remains a component of the identity; it is not a competing identity.

## 5. Relations / constraints / indexes

- **No new relation.** The four columns are scalar on the two existing tables.
- **No existing constraint is touched**: `ProductVariant` FKs and indexes,
  `ProductOfferVariant` `@@unique([offerId, variantKey])`, and the `Size`
  `@@unique([audience, productType, system, value])` all stay exactly as they are.
- **New indexes (additive):** `@@index([canonicalSizeOptionId])` and
  `@@index([sizeResolutionSystem])` on each table, to support future size
  filtering. Indexing a mostly-null column is safe and cheap.

## 6. Backfill source (measured, before any change)

```sql
SELECT count(*) FROM "Product";
SELECT count(*) FROM "ProductVariant";
SELECT count(*) FROM "ProductVariant" WHERE "sizeId" IS NOT NULL;
SELECT count(*) FROM "ProductOffer";
SELECT count(*) FROM "ProductOfferVariant";
SELECT count(*) FROM "ProductOfferVariant" WHERE "sizeValue" IS NOT NULL;
SELECT count(*) FROM "Size";
```

```
BEFORE_COUNTS {
  products: 570,
  productVariant: 4029,
  productVariantWithSize: 3977,
  offers: 0,
  productOfferVariant: 0,
  productOfferVariantWithSize: 0,
  sizeRows: 107
}
```

`productVariantWithSize = 3977` matches the Stage C baseline observations count
exactly. The live catalog currently has **zero** `ProductOffer` /
`ProductOfferVariant` rows, so the live backfill exercises only the legacy path;
the offer path is still implemented and tested structurally with fixtures.

## 7. Migration risks and compatibility

| Concern | Assessment |
| --- | --- |
| Destructive change | None. Only `ADD COLUMN` (nullable) + `CREATE INDEX`. |
| Existing rows readable | Yes. New columns default to `NULL`; no read path requires them. |
| Source labels lost | No. `Size.value` / `ProductOfferVariant.sizeValue` are never written. |
| Existing `sizeIdentity` broken | No. The persisted id equals the existing wire format. |
| Non-persisted systems coerced | No. They live in the new TEXT column, not the enum. |
| Search / questionnaire / UI affected | No. Those paths do not read the new columns. |
| Reversibility | Trivial: `DROP COLUMN` / drop index in the down path; no enum to alter. |
| Idempotency | Guaranteed by the planner, not by SQL (see `PHASE-03-STAGE-E.md`). |

## 8. Hard-stop review (§23)

- Canonical identity cannot be represented safely — **no**, it is the existing id.
- Existing schema conflicts with the Stage A identity — **no**.
- Migration would be destructive — **no**.
- Legacy and canonical data cannot coexist — **no**, they are separate columns.
- Source labels would be lost — **no**.
- Unresolved values would require guessing — **no**, they persist as `UNRESOLVED`.
- ProductVariant / ProductOfferVariant ownership ambiguous — **no**, both supported.
- An additional canonical registry would be required — **no**, Stage A registry reused.

No blocker. Proceeding is safe.

## 9. Development database

`prisma migrate status` reports the configured `DATABASE_URL`
(`postgres @ localhost:5432/mydb`) is **up to date** with all 8 migrations. This is
a local development database, so the additive migration and the deterministic
backfill are validated there (never against a non-local database).
