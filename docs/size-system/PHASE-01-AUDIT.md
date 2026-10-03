# FITWEAR — SIZE SYSTEM & SIZE CHARTS

## PHASE 1 — AUDIT + CURRENT DATA MODEL

No code changed. This is the audit result the spec asked for before any
restructuring.

Baseline at audit time: `tsc` PASS, `build` PASS, `test:taxonomy` 83/87,
`test:questionnaire` 32/32, `test:search` 111/115.

---

## 1. Current data model (Prisma)

Source of truth: `prisma/schema.prisma`.

### 1.1 `Size` — `schema.prisma:361-393`

```prisma
model Size {
  id              String   @id @default(cuid())
  category        String              // legacy: "clothing" / "shoes"
  system          SizeSystem
  value           String
  normalizedValue String
  audience        SizeAudience  @default(UNKNOWN)   // MEN|WOMEN|KIDS|UNISEX|UNKNOWN
  productType     SizeProductType @default(UNKNOWN) // CLOTHING|FOOTWEAR|ACCESSORY|HEADWEAR|UNKNOWN
  numericValue    Float?
  ordinal         Int?
  displayValue    String?
  subsystem       String?
  createdAt       DateTime @default(now())
  variants        ProductVariant[]
  @@unique([audience, productType, system, value])
  @@index([normalizedValue])
}
```

- Identity today = `audience | productType | system | value` (the new unique).
- The legacy `@@unique([category, system, value])` was **dropped**
  (`prisma/migrations/20260831120000_drop_legacy_size_unique`).
- `numericValue/ordinal/displayValue/subsystem` exist but are only written by
  an un-wired backfill script (§5.3).
- `SizeSystem` enum = `INTERNATIONAL, EU, US, UK, IT, FR, UNKNOWN`
  (`schema.prisma:514-522`).

### 1.2 `ProductVariant` — `schema.prisma:341-359`

```prisma
model ProductVariant {
  id           String   @id @default(cuid())
  productId    String
  sizeId       String?          // -> Size
  colorId      String?
  sku          String?
  price        Decimal
  currency     String   @default("EUR")
  availability Availability @default(AVAILABLE)
  size         Size?    @relation(fields: [sizeId], references: [id])
  color        Color?   @relation(fields: [colorId], references: [id])
  @@index([productId]) @@index([sizeId]) @@index([colorId])
}
```

- Availability **is per variant (per size)** → "available sizes" is already
  representable.
- **No unique constraint** on `(productId, colorId, sizeId)` — dedup is only
  the in-process `seen` Set in `sync.ts`.
- `sizeId` is nullable → sizeless products (dummyjson/fakestore) get one
  `sizeId: null` variant.

### 1.3 `Product` — `schema.prisma:297-339`

`Product` links to `Category`, `Brand`, `Source`; has `gender Gender?`
(`MEN|WOMEN|UNISEX|KIDS`) and `availability Availability`. **No size fields at
Product level** other than via variants.

### 1.4 Phase-0 offer model — `schema.prisma:118-211`

```prisma
ProductOfferVariant {
  offerId         String
  variantKey      String        // sku > gtin > vId > color+size fingerprint
  sku             String?
  gtin            String?
  color           String?
  sizeValue       String?       // raw source string, e.g. "EU 42", "S/M L/XL"
  sizeSystem      String?
  sizeProductType String?
  sizeAudience    String?
  availability    String        // richer than enum: PREORDER/BACKORDER/...
  originalPrice   Decimal
  ...                           // per-variant price + purchaseUrl
  @@unique([offerId, variantKey])
}
```

- Sizes here are **flat nullable strings, no `Size` FK, no normalization**.
- This is a **second, disjoint size pipeline** (§2).

### 1.5 Enums

| Enum | Values | Line |
| --- | --- | --- |
| `SizeSystem` | INTERNATIONAL, EU, US, UK, IT, FR, UNKNOWN | 514 |
| `SizeAudience` | MEN, WOMEN, KIDS, UNISEX, UNKNOWN | 526 |
| `SizeProductType` | CLOTHING, FOOTWEAR, ACCESSORY, HEADWEAR, UNKNOWN | 536 |
| `Availability` | AVAILABLE, OUT_OF_STOCK, UNKNOWN | 501 |
| offer availability (string) | AVAILABLE, OUT_OF_STOCK, PREORDER, BACKORDER, UNKNOWN | `catalog/types.ts:32-37` |

### 1.6 There is **no** SizeChart / Measurement / SizeGuide model

Exhaustive search: **zero** Prisma models, columns, or TS types for body
measurements, size charts, columns, or rows. `Size` has no measurement fields.
No EU↔US conversion table exists.

---

## 2. Two disjoint size pipelines

| | Legacy provider path | Phase-0 catalog path |
| --- | --- | --- |
| Contract | `UnifiedProduct/UnifiedVariant` (`providers/types.ts`) | `NormalizedListing/Variant` (`catalog/types.ts`) |
| Entry | `providers/sync.ts` | `catalog/import.ts` → `catalog/offers.ts` |
| DB target | **`Size` + `ProductVariant`** | **`ProductOffer` + `ProductOfferVariant`** (no `Size` FK) |
| Normalization | `normalizeSize` (livostyle) | `sizeFromSpec` (ebay) + read-time `expandOfferSizeChips` |

`catalog/offers.ts:18-20` explicitly states the legacy path is untouched.

---

## 3. Source adapters — raw size shapes

| Adapter | Size data produced |
| --- | --- |
| **livostyle** (`providers/livostyle.ts`) | Only real source. `sizes: []` **always empty** (`:351`); `variants: variants.slice(0,40)` (`:357`); fan-out one row per (color × normalized size) (`:263-275`); `sizeCategory` shoes/clothing (`:358`); `sizeSystem` `US`/`INTERNATIONAL` (`:359`) |
| **dummyjson** | **none** — `sizes: []` (`:174`), no variants |
| **fakestore** | **none** — `sizes: []` (`:92`) |
| **demo** | metadata only, no fetch |
| **eBay** (`catalog/adapters/ebay/normalize.ts`) | richest: `sizeFromSpec` (`:309-336`), per-variation sizes (`:238`); defaults missing availability to `AVAILABLE` (`:250`) |

`UnifiedProduct.sizes: string[]` (`types.ts:24`) is **dead** — populated by no
adapter, read by no code.

---

## 4. Normalization functions (and their disagreements)

| Function | File | Behavior |
| --- | --- | --- |
| `normalizeSize(raw, isShoes)` | `providers/livostyle.ts:135-189` | One Size/OS/uni; alpha ladder with `2XL→XXL` (`:151-162`); shoes: `"42 (US 9)"` → **two literals** (`:169-177`); bare numeric → `UNKNOWN` (refuses inference, `:182-185`); else **drops the variant** (`:188`) |
| `sizeFromSpec` | `catalog/adapters/ebay/normalize.ts:309-336` | prefix regex EU/US/UK/IT/FR/INT only |
| `parseSizeIdentity` | `catalog/normalize.ts:127-153` | spec string → `{system, value}` |
| `parseSizeIdentity` | `size-sections.ts:145-167` | 4-part `audience\|productType\|system\|value` key |
| `normalizeSizeToken`/`expandOfferSizeChips` | `catalog/offer-vocab.ts:155-230` | read-time expansion: ranges `XS-2XL`, numeric spans `6-12`, bra sizes, noise removal |

### Static "size catalogs" (4 of them, disagreeing)

1. `ORDERED_ALPHA` — `src/lib/sizes.ts:14-27` (`XXS…5XL`, includes both `2XL` and `XXL`).
2. `STANDARD_CLOTHING_SIZES` / `STANDARD_FOOTWEAR_SYSTEMS` — `sizes.ts:343-359`.
3. `buildSizeCatalog` — `sizes.ts:224-327` (runtime tree from real rows).
4. `size-vocabulary.ts` (387 lines) — **hand-authored semantic catalog**:
   `CLOTHING_LETTERS_MEN/WOMEN`, `BRA_SIZES`, `HEADWEAR`, `ACCESSORY_ONE_SIZE`,
   `SOCKS_*`, `BELT_*`, `SHOES_{EU,US,UK}_{MEN,WOMEN}`.

### Normalizer defects

- `2XL→XXL` (livostyle:158) vs `2xl→2XL` (offer-vocab:103) vs `ORDERED_ALPHA`
  listing both (sizes.ts:21-22) — **three conventions**.
- `backfill-size-context.mts:31` `ALPHA_ORDER` omits `"2XL"`.
- `size-vocabulary.ts` emits non-enum `system` values: `"Waist (in)"` (`:276`),
  `"EU range"` (`:261`), `"Letters"` — can never match stored `Size.system`.
- `vocabularyForCategory` shoes branch returns women's scales unconditionally
  (`:231-240`), overwritten for MEN by `schoolScaleFor` (`:341-347`).
- No EU↔US conversion anywhere; both literals preserved by design.

---

## 5. Availability: three distinct states already exist

1. **Currently available** (buyable) — `meta/route.ts:104-131` restricts to
   `availability: "AVAILABLE"` + `size isNot null`; search uses
   `availVariants(product)` and skips non-`AVAILABLE` (`search/route.ts:1970-1996`).
2. **Supported / all possible** (stock-independent) — `sizes.ts:336-343`
   documented: questionnaire always offers the full standard surface unioned
   with real catalog rows.
3. **Exists but out-of-stock** — only modeled in `outfit/outfit-size.ts:23-28`:
   `exact-available | exact-any | equivalent-available | no-data | none`.
   `hasExactSize` (`:50-72`) returns `{available, exists}`.

> ⚠️ The spec's rule "Product supports S/M/L/XL but only S/M/XL available" is
> **partially supported**: per-variant availability is real, but there is no
> explicit Product-level "supported sizes" list distinct from variants
> (only the static standard surface).

`src/lib/search-diagnostics.ts` (`:10-15, 200-217, 264-280`) also keeps the
trichotomy and refuses to claim a size is absent when products carry no size
data.

---

## 6. Search parsing + filtering

- `search/route.ts:471-481` alias words (`medium→M`), `:490-500` system words.
- `detectedSize` from real rows + alias words (`:1192-1196, 1306-1333`).
- `detectSizeSystem` (`:509-574`) requires the system word adjacent to the size
  (distance ≤ 2 tokens; IT/FR direct neighbours only).
- Emits `size`, `sizeSystem`, `sizeAudience` (`:1631-1641`).
- Predicate (`:2169-2195`): with explicit system → `variantMatchesSizeSystem`
  (strict value+system) OR offer-size equality; without system → bare value
  match on `productSizes`.
- **No category/context binding**: `Size 32` is matched as a bare value, so it
  is not yet scoped as "jeans 32" vs "shoe 32" by construction — the taxonomy
  chain is not part of the size predicate today.

---

## 7. Questionnaire size step

- Step order `questionnaire.ts:6-21`: `gender, category, size, colors, budget,
  details` (size after category).
- Options `find-questionnaire.tsx:731-740`: `sizeSectionsFor({audience,
  categoryName, catalog})`.
- Options = **standard vocabulary ∪ catalog data** (`sizes.ts:336-403`), so EU/
  US/UK columns appear even with no rows; semantic per-category lists from
  `size-vocabulary.ts`.
- Pick state stores `{value, audience, productType, category, system}`
  (`:1175-1184`).
- Emission is a **free-text token** `"EU 42"` / `"42"` into the query string
  (`:1265-1291, 1370`) — not a structured URL param.
- `AUDIENCES = ["MEN","WOMEN"]` — **KIDS is never generated** semantically.

---

## 8. Product page + size UI

- **There is no product detail route.** `src/app` pages: `page`, `build`,
  `find`, `outfit`, `outfit/review`, `contact`, `privacy`, `terms`, `terms`.
  No `product/[slug]`.
- The only product surface is the card in `components/home-page.tsx`:
  sizes rendered as plain text `Sizes: M, L` (`:2297-2303`); no system labels,
  no chart; link is external `View product` (`:2352-2360`).
- **No `SizeSelector`, `SizeFilter`, size-chart, size-guide, or measurement
  component exists.** All size UI is inline in `home-page.tsx` /
  `find-questionnaire.tsx` / `build/page.tsx` / `outfit`.

---

## 9. Existing tests touching size (all currently green)

`size-identity.test.mts`, `size-sections.test.mts`, `size-groups.test.mjs`,
`outfit-size.test.mts`, `offer-vocab.test.mts`, `r8-system-propagation.test.mjs`,
`search-parser-context.test.mjs`, `questionnaire-context.test.mts`,
`fitwear-semantics.test.mts`, `facet-policy.test.mjs`, `taxonomy.test.mts`,
`diagnostics.test.mts`, `spec-e2e.test.mjs`, `f4-edit-restore.test.mjs`,
`build-flow.test.mts`, `catalog-variants.test.mts`, `g1-livostyle-fix.test.mts`,
`facet-counts.test.mts`, `f8-variant-availability.test.mts`,
`o3-select-guard.test.mjs`, plus live browser `f19`/`f20`.

Gap: no test drives the questionnaire→`/api/search` size path end-to-end.

---

## 10. Spec requirement → current state

| Spec | Status today |
| --- | --- |
| 1 Size identity ≠ display | PARTIAL — `Size.value` + `normalizedValue` (lowercase only); no display/system split |
| 2 Size systems registry | PARTIAL — `SizeSystem` enum has 7 of ~20; normalizers only know 4 |
| 3 Size categories | PARTIAL — legacy `Size.category` (clothing/shoes) + `SizeProductType` (5) |
| 4 Variant-level availability | **YES** (`ProductVariant.availability`) |
| 5 Canonical + source size | PARTIAL — `Size` FK is canonical-ish; raw source string only on `ProductOfferVariant.sizeValue` |
| 6 SizeChart entity | **MISSING** |
| 7 Chart columns | **MISSING** |
| 8 Chart rows/measurements | **MISSING** |
| 9 Product > Brand > Category chart priority | **MISSING** |
| 10 Context-scoped brand charts | **MISSING** |
| 11 genderContext + ageRange | PARTIAL — `SizeAudience` no `BABY`; kids ages are taxonomy-only |
| 12 Shoes independent system | PARTIAL — tags exist; no conversion, no dedicated category enum on chart |
| 13 One Size | PARTIAL — literal `"One Size"` values; no dimensions |
| 14 Bags dimensions | PARTIAL — no `BAG` category; bags use `ACCESSORY`/one-size |
| 15 Belt/Hat/Glove | PARTIAL — `size-vocabulary.ts` lists them; glove absent; no measurement ranges |
| 16 Keep raw source data | PARTIAL — offer path keeps raw string; legacy path discards after normalize |
| 17 Deterministic normalizeSize | PARTIAL — several disagreeing normalizers |
| 18 conversionConfidence | **MISSING** |
| 19 UserMeasurements | **MISSING** (deferred by spec) |
| 20 Questionnaire dynamic sizes | PARTIAL — stock-independent standard surface; not product-availability driven |
| 21 Size Chart UI | **MISSING** |
| 22 sizeChartStatus | **MISSING** |
| 23 Product/variant/ProductSizeInfo model | PARTIAL — variants exist; `ProductSizeInfo` and `canonicalCategoryId` absent |
| 24 Chart versioning | **MISSING** |
| 25 Adapter normalization responsibility | PARTIAL — two pipelines |
| 26 Search uses canonical+context+availability | PARTIAL — value+system+availability, **no category/context binding** |
| 27 Taxonomy vs Size separation | YES by design (taxonomy has no sizes) |

---

## 11. Key defects (no fixes yet)

1. `sync.ts:76-91` — `Size.category` not in upsert `where`; process cache key includes it → stale category.
2. `sync.ts:79-80` — `audience`/`productType` always `UNKNOWN`; `Product.gender` never propagates; `/api/meta:194` then discards those rows.
3. `sync.ts:133-135` — delete-then-recreate variants invalidates backfill pointers each sync.
4. `sync.ts:168-170` — `${colorId}|${sizeId}` dedup drops distinct source SKUs/prices.
5. Three disagreeing `2XL/XXL` conventions (§4).
6. `size-vocabulary.ts` emits non-`SizeSystem` system strings.
7. No `@@unique` on `ProductVariant` (color,size).
8. `types.ts:24` `sizes: string[]` dead field.
9. **Zero** size-chart/measurement data anywhere.

---

## 12. Proposed implementation order (as per spec §29, unchanged)

Phase 2 Canonical Size Model → Phase 3 Size Chart Model → Phase 4 Product
Integration (additive) → Phase 5 Source Normalization → Phase 6 Availability →
Phase 7 Search → Phase 8 Product Page (needs a product route decision) →
Phase 9 Questionnaire → Phase 10 Tests.

Two decisions needed before Phase 2/4:

- **D1:** Add a real **product detail route** or implement Size Guide on the
  existing card?
- **D2:** Canonical size model as **Prisma entities** or a **lib-level model**
  first, persisted later?

## Decisions (resolved)

- **D1 — RESOLVED:** build a real **`/product/[productId]`** route keyed by
  `Product.id`; do not redesign Results Cards (audit:
  `docs/product-detail/PHASE-01-AUDIT.md`). Size Guide UI lands on that page
  and is deferred until the canonical size domain exists.
- **D2 — RESOLVED:** **lib-level first** in `src/lib/size-domain/`, persisted to
  Prisma in a later stage after tests pass. Execution order: canonical size
  domain → normalization → Product/Variant integration → chart resolver →
  search/filtering → Product Detail → Size Guide UI.

## Gate 1

**PASS (audit only).** Current data model documented, gaps mapped, no code
changed. Phase 2 Stage A completed separately
(`docs/size-system/PHASE-02-STAGE-A.md`).
