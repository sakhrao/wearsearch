# Product Detail — Phase 1 Audit (read-only)

Scope: the repository AS IT IS, before any Product Detail code. No behavior was
modified. Every claim below is anchored to a file:line.

## 1. Current Product model (`prisma/schema.prisma:297-339`)

| field | type | notes |
|---|---|---|
| `id` | String `@default(cuid())` | canonical local identity |
| `sourceId` / `externalId` | String | provider identity; `@@unique([sourceId, externalId])` |
| `brandId` / `categoryId` | String | FK to `Brand` / `Category` |
| `name` | String | display name |
| `slug` | String | **exists but is NOT `@unique` at Product level** (only Category/Brand/Color have `@unique` slug); unused in any URL |
| `description` | String? | stored, currently not projected by `/api/search` |
| `price` | Decimal(10,2) | product-level mirror |
| `currency` | String default `EUR` | |
| `productUrl` | String (required) | external page; guard applies |
| `imageUrl` | String? | **single image only** |
| `gender` | `Gender?` | |
| `availability` | `Availability` default `AVAILABLE` | |
| `source` | `Source` relation | `type: DEMO` used to exclude fake stores |
| `offers` | `ProductOffer[]` | Phase-0 real sellable lines |
| `variants` | `ProductVariant[]` | legacy variant rows |
| `attributes` | `ProductAttribute[]` | |

There is **no** measurement table, size-chart table, gallery table, or
user-profile/body-measurement table on or beside Product.

## 2. Current ProductVariant model (`prisma/schema.prisma:341-359`)

`id`, `productId`, `sizeId?`, `colorId?`, `sku?`, `price`, `currency`,
`availability`, relations `color` (`Color`) and `size` (`Size`). Legacy rows.

`Size` (`:361-393`) carries `category`, `system` (`SizeSystem`), `value`,
`normalizedValue`, plus additive `audience` / `productType` / `numericValue` /
`ordinal` / `displayValue` / `subsystem`.

Phase-0 sellable lines live on `ProductOfferVariant` (`:118-211`):
`color` (raw string), `sizeValue` (raw string), `sizeSystem`, `availability`,
`originalPrice`, `originalCurrency`. There is **no FK** from offer variants to
the `Size` table; sizes are raw strings folded at read time.

## 3. Current Results Card (`src/components/home-page.tsx`)

- `ProductCard` → `home-page.tsx:2155-2379`.
- Renders: image (`ProductCardImage`, only `product.imageUrl`), out-of-stock
  badge, brand name, product name, category name, gender chip, color swatches
  (deduped from `variant.color`), `Sizes: …` string (deduped
  `variant.size.value`), first 4 attributes, price (`From …` when variants
  differ), and two actions.
- Actions: **"View product"** = external `<a target="_blank">` to
  `product.productUrl` gated by `hasRealProductPage()`; **"Style this item"** =
  internal `/outfit?anchor=${product.id}`.
- **No internal product-detail link exists.** The card is the only product
  surface in the app.

Client `Product` type (`home-page.tsx:88-132`) is BROADER than the API payload:
it declares `description`, `brand.slug`, `category.slug`, `variant.id`,
`variant.sku`, `size.id`, `size.normalizedValue` — none of which
`/api/search` actually returns (see §5). Do not build against those without
extending the projection.

## 4. Current routing (`src/app`)

App Router. Directories: `find`, `outfit`, `outfit/review`, `build`, `contact`,
`privacy`, `terms`, `api/{search,meta,outfit,outfits,ebay,build,dbg-pin,…}`.
**There is no `src/app/product/` route** (confirmed by grep for `/product/`,
`[productId]`).

## 5. Current product IDs as exposed to the client

- `/api/search` `projectProduct()` (`route.ts:208-269`, select at `:1438-1484`)
  returns only: `id`, `name`, `price`, `currency`, `productUrl`, `imageUrl`,
  `availability`, `gender`, `brand{id,name}`, `category{id,name}`,
  `variants{price,currency,availability,color{id,name,hex},size{value,system}}`,
  `attributes{value,attribute.name}`.
- It does **not** return `slug`, `description`, `source`, `sourceId`,
  `externalId`, `sku`, `size.id`, `size.normalizedValue`.
- The identifier already used in-app for a product is **`Product.id` (cuid)**,
  e.g. `home-page.tsx:2369` `/outfit?anchor=${product.id}`. `Product.slug` is
  never used in any route or link.

**Decision input: the canonical client product identifier to route on is
`Product.id`.**

## 6. Current external product URL field

- `Product.productUrl: string` (required in schema; nullable in the projection
  type).
- Guard: `hasRealProductPage()` in `src/lib/product-url.ts` is the single
  source of truth (rejects placeholder hosts, `/p/exp-`, `exp-` paths);
  `productStoreLabel()` derives the store hostname. Reused at
  `home-page.tsx:2160` and `api/search/route.ts:42-43`.
- When `hasRealProductPage` is false the UI shows "Product page unavailable";
  it must never fabricate a URL.

## 7. Current image fields

- Primary: `Product.imageUrl?` (single URL).
- Server-side fallback exists only in the outfit loader:
  `loadOutfitCatalog` uses `r.imageUrl ?? primaryOffer?.imageUrl`
  (`src/lib/outfit/catalog.ts:150`).
- `/api/search` returns only `product.imageUrl`; offer `imageUrl` is not
  projected.
- **No gallery / multiple images** anywhere. A product detail gallery would
  have to be built from `Product.imageUrl` + `ProductOffer.imageUrl` at most.

## 8. Current size fields

- Legacy: `ProductVariant.size` → `{value, system, normalizedValue,
  productType}` (select in `outfit/catalog.ts:42-49`), but `/api/search`
  projects only `{value, system}` (`route.ts:1477-1482`).
- Phase-0: `ProductOfferVariant` raw `sizeValue` / `sizeSystem`.
- Folding helpers: `expandOfferSizeChips()` and `canonicalColorFromOffer()`
  in `src/lib/catalog/offer-vocab.ts`.
- Size vocab/labels: `src/lib/sizes.ts`, `src/lib/size-sections.ts`,
  `src/lib/size-vocabulary.ts`. See the dedicated
  `docs/size-system/PHASE-01-AUDIT.md` for the full size picture.

## 9. Existing components/utilities to reuse

- `ProductCardImage` (`home-page.tsx:~2090-2153`): color-correct image with
  eBay `crossOrigin` + canvas probing.
- `ProductCard` layout primitives, badge/attribute-chip styling.
- `hasRealProductPage()` / `productStoreLabel()` (`src/lib/product-url.ts`).
- `loadOutfitCatalog()` (`src/lib/outfit/catalog.ts`) as the **loader pattern**
  for reading legacy variants + Phase-0 offers with a shared fold.
- `/api/meta` for taxonomy/color/size facets; `crossTagCategoryNames` from the
  taxonomy barrel.
- Offer fold helpers in `src/lib/catalog/offer-vocab.ts`.

## 10. Existing tests touching products/cards/search

No component/DOM test harness exists (no RTL/jsdom; single `*.test.ts` is
`src/lib/search/parser.test.ts`). Relevant Node/tsx script tests:
`f9-projection`, `f8-variant-availability`, `size-identity`, `size-sections`,
`size-groups`, `outfit-size`, `offer-vocab`, `search-regression` (`test:search`),
`spec-e2e`, `f4-edit-restore`, `url-state`. **No test asserts card markup or
links**, so a Product Detail route must add its own loader/route unit test plus
the e2e gate.

---

## Short implementation plan (incremental, preserves Results behavior)

1. **Read-only loader** `src/lib/product-detail.ts` — `getProductDetail(id)` via
   `prisma.product.findUnique({ where: { id } })`, selecting exactly the fields
   already known to exist (no invented fields): product + brand + category
   (+ parent for the taxonomy path) + legacy `variants` + AVAILABLE `offers`
   with `ProductOfferVariant`, reusing the `loadOutfitCatalog` fold for colors
   and `expandOfferSizeChips` for sizes. Reuse `hasRealProductPage`.
2. **Route** `src/app/product/[productId]/page.tsx` (server component) —
   `notFound()` when missing; render fields ONLY when present (no placeholders
   for absent source data). Gallery from `imageUrl` (+ offer image if any).
3. **Variant/size selection** is page state, derived entirely from the loaded
   variant/offer data (no hardcoded size lists). Size Guide is deferred to the
   canonical size model.
4. **Navigation**: add an internal link on the existing card to
   `/product/${product.id}` **without redesigning the card** (keep "View
   product" external action). Preserve all current Results behavior.
5. **Tests**: new `scripts/product-detail.test.mts` (loader shape + notFound
   path) and extend the e2e/search gates; run the full existing gate set.

### Open dependency
The Size Guide portion of this page depends on the canonical size domain
(Workstream B, staged A→H). Per the size-model answer, the data layer is proven
first; the Product Detail page must consume that model instead of re-implementing
size logic. Sequencing of "route shell now" vs "size domain first" is the one
open decision (see question in chat).
