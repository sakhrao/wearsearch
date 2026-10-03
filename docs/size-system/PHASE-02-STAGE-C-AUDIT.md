# Size System — Phase 2 / Stage C — Real Product/Variant Size Audit

Read-only inspection of how size data is actually stored today, before writing
any integration code. No schema or product model is redesigned here.

## Entities that carry a source size label

There are **two independent storage paths**, and both are live:

### 1. Legacy provider path — `Size` + `ProductVariant`

- `Size` (`prisma/schema.prisma:361-393`): `category String`, `system SizeSystem`,
  `value String`, `normalizedValue String`, `audience SizeAudience @default(UNKNOWN)`,
  `productType SizeProductType @default(UNKNOWN)`, plus optional
  `numericValue/ordinal/displayValue/subsystem`.
- `ProductVariant` (`:341-359`): `sizeId String?` → `Size`, `colorId`, `sku`,
  `price`, `currency`, `availability Availability @default(AVAILABLE)`.
- Written by `src/lib/providers/sync.ts` (`sizeIdOf`, `:68-95`): the unique key is
  **always** `(audience=UNKNOWN, productType=UNKNOWN, system, value)` and
  `normalizedValue = value.toLowerCase()`. The free-text `product.sizeCategory ?? "clothing"`
  lands in `Size.category`. So legacy `Size.audience`/`productType` are **UNKNOWN in
  practice**; `system` falls back to `INTERNATIONAL` (`variant.sizeSystem ?? product.sizeSystem ?? "INTERNATIONAL"`).
- Only legacy variants are `ProductVariant` rows; each row is one size.

### 2. Phase-0 offer path — `ProductOfferVariant`

- `ProductOfferVariant` (`:171-211`): `sizeValue String?`, `sizeSystem String?`,
  `sizeProductType String?`, `sizeAudience String?`, `availability String @default("UNKNOWN")`,
  plus price/currency/sku/gtin/color/purchaseUrl and `variantKey`.
- Written by `src/lib/catalog/offers.ts` (`upsertOfferVariant`, `:308-353`) directly
  from the adapter `NormalizedSize` (`src/lib/catalog/types.ts:79-87`): `value/system/
  productType/audience` are stored **verbatim** as free-text strings. `sizeSystem` here
  may hold systems outside the persisted Prisma enum (e.g. `JP`, `BRA`, `ONE_SIZE`).
- `ProductOffer` (`:118-161`) is one sellable listing per source; a product can have
  **many offers**, each with its own variant rows.

### Which path is populated

`src/lib/outfit/catalog.ts` (`:82-128`) documents the reality: Phase-0 catalogs keep
sellable data in `ProductOffer → ProductOfferVariant` with **no legacy `ProductVariant`
rows**; the loader synthesizes variant-like entries from the available offer lines.
Both paths must be integrated.

## Answers to the audit questions

| Question | Finding |
| --- | --- |
| Where do source labels live? | `Size.value` (legacy), `ProductOfferVariant.sizeValue` (offer) |
| Size on Product / Variant / Offer? | Never on `Product`. On `ProductVariant` (via `Size`) and `ProductOfferVariant` |
| Availability represented? | Yes — `ProductVariant.availability` (`Availability` enum) and `ProductOfferVariant.availability` (raw rich string) |
| Source/brand context available? | `Product.sourceId/source`, `Product.brand`; offers carry `sourceId` |
| Audience/gender represented? | `Product.gender` (`Gender?`: MEN/WOMEN/UNISEX/KIDS); `ProductOfferVariant.sizeAudience`; legacy `Size.audience` (UNKNOWN in practice) |
| Product type/category represented? | `Product.category.name`; `Size.productType` (UNKNOWN in practice); `ProductOfferVariant.sizeProductType` (free-text) |
| Age range represented? | **No** — only `gender = KIDS`; no min/max age anywhere |
| Size system already stored? | `Size.system` (persisted enum) and `ProductOfferVariant.sizeSystem` (free-text, may be non-persisted) |
| `sizeIdentity` / related fields used? | Identity is derived at query time in `src/lib/size-sections.ts:131` (`audience\|productType\|system\|value`); not stored |
| Multiple size labels per product? | Yes — many `ProductVariant` rows and/or many offer-variant rows |
| Multiple variants/offers from different sources? | Yes — many `ProductOffer` (one per source) each with own variants |
| Source labels preserved exactly? | Yes — `Size.value` and `sizeValue` are verbatim; `Size.normalizedValue` is a lowercased **derived** field, not a replacement |

## Consequences for integration (what must stay honest)

- **Age range is not derivable** → always `null`; KIDS alpha/numeric still normalize on
  stored audience/productType, never on an invented range.
- **Legacy audience/productType are UNKNOWN in practice** → the adapter must fall back to
  `Product.gender` for audience (the same rule `size-sections.ts` already documents) and
  to the existing category→discipline mapping for product type. Numeric alpha under
  missing context stays `INSUFFICIENT_CONTEXT` — correct, not guessed.
- **`Size.system` may be the literal `UNKNOWN`** → treat as "no stored system" (pass null)
  so Stage B's prefix parsing/absence rules apply unchanged.
- **Offer `sizeSystem` is free-text** → only accept it when it is a registered
  `SizeSystemId`; otherwise pass null. Never coerce unknown strings.
- **Availability must be preserved verbatim**, not collapsed: legacy enum (`AVAILABLE/
  OUT_OF_STOCK/UNKNOWN`) and offer strings (`AVAILABLE/OUT_OF_STOCK/PREORDER/BACKORDER/UNKNOWN`).

## Existing mapping helpers reused (not duplicated)

- `categoryDiscipline` / `SHOE_CATEGORY_NAMES` (`src/lib/facets.ts`) and
  `categorySizeGroupKind` (`src/lib/size-sections.ts:69-83`) for category→product type.
- `normalizeAudience` (`size-sections.ts:125`) semantics for gender→audience.
- `sizeIdentity` (`size-sections.ts:131`) as the compatibility wire format that
  `canonicalSizeOptionId` already reproduces.
