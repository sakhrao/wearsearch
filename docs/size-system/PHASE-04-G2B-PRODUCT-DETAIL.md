# Size System — Phase 4 / G2B — Product Detail Foundation

## 1. Audit of the existing routing / identity / links

| Area | Before |
| --- | --- |
| Product detail route | **None.** There was no `/product/*` route; `Product` pages were external-only. |
| Product identity | `Product.id` (cuid) is the single catalog identity. Search's `Product` type (`src/components/home-page.tsx:88`) and the outfit `ProductSummary` (`src/app/outfit/outfit-client.tsx:13`) both carry `id`. |
| External links | Card buttons pointed at `product.productUrl` and were gated by `hasRealProductPage()` (`src/lib/product-url.ts`), which rejects demo/placeholder hosts and `/p/exp-` listings. |
| Result cards | `ProductCard` (`src/components/home-page.tsx:2155`) showed "View product" (external) or "Product page unavailable"; the outfit look cards (`src/app/outfit/outfit-client.tsx:621`, `:714`) linked externally. |
| Taxonomy path | `Category` has a self-relation (`parent`/`children`); no path helper was exposed. |
| Size surface | Cards read `variant.size.value` only; no canonical state, no unresolved indication. |

## 2. What was built

### 2.1 Route — `src/app/product/[productId]/page.tsx`

- Dynamic App Router segment keyed by `Product.id` (cuid). `params` is a
  promise (`await params`) per Next 16; `export const dynamic = "force-dynamic"`
  so the page always reads the live catalog.
- A missing id calls `notFound()`.
- Renders: gallery (primary image + offer images), name, brand, price,
  availability, source label, `Product.gender`, taxonomy path breadcrumb,
  attributes, the size list, the Size Guide, and the "Where to buy" offers.

### 2.2 Loader — `src/lib/product-detail.ts`

`loadProductDetail(productId) -> ProductDetail | null`, read-only:

- selects the product, brand, source, category ancestor chain, attributes,
  legacy variants and offers/offer-variants; the variant/offer selects include
  the four Stage E canonical size columns;
- projects every size through the canonical read path
  (`projectVariantSize` / `projectOfferVariantSize`), keeping
  `state` (`RESOLVED` / `UNRESOLVED` / `NOT_BACKFILLED`) and the preserved raw
  label; availability is tracked per size line, independent of resolution;
- builds the taxonomy path by walking `Category.parent`;
- computes the Size Chart Resolver target (`productType` from
  `categorySizeGroupKind`, audience from `gender`, known systems from the read
  sizes) and calls `resolveSizeChart`. **No chart source exists yet, so the
  resolver receives zero candidates and returns `NO_CHART`** — nothing is
  fabricated or interpolated.

### 2.3 Card links

- `ProductCard` primary action is now `<Link href="/product/${product.id}">`
  (label "View product" preserved). The "Product page unavailable" state is
  gone because the internal page always exists.
- Outfit look cards ("View product" / "Open") now link to
  `/product/${item.product.id}`.
- The external source link is **moved to the detail page** and preserved
  verbatim (`Open at {source}`), with an explicit "No external product page
  available" state when the URL is not real.

## 3. G2B responsibilities mapping

| Responsibility | Where |
| --- | --- |
| Image / gallery | `ProductDetail.gallery` + page gallery block |
| Name, brand, price, source | page header + `sourceLabel` |
| Availability | product badge + per-size and per-offer availability |
| Taxonomy path | `categoryPath` breadcrumb |
| Canonical size options | `sizes[]` with `state` + `canonicalSizeOptionId` |
| Unresolved indication | chip styling + "not recognised" note + counts |
| Size Guide entry point | Size guide section driven by `chart.status` |
| External source link | product + per-offer links via `hasRealProductPage()` |

## 4. Honesty constraints honoured

- Identity is `Product.id`; no second product identity.
- An `UNRESOLVED` size is displayed by its preserved raw label and is never
  reinterpreted (no canonical id is attached).
- Availability is never merged with resolvability.
- The resolver is the only thing that may produce a chart; with no source it
  reports `NO_CHART` and the UI shows no measurements.
- No cart / checkout / payments / wishlist / reviews / recommendations /
  virtual try-on were added.

## 5. Scope notes

- `src/components/category-spotlight.tsx` and the outfit review confirmation
  list still link externally; they are discovery/confirmation surfaces, not
  result cards, and were intentionally left unchanged in this foundation stage.
- Size Guide is an entry point only; no chart data source, migration, or
  editing UI exists yet.

## 6. Verification

- `npm run typecheck` — clean.
- `npm run build` — `/product/[productId]` emitted as a dynamic route (ƒ).
- Live DB probe: resolved product (`Shoes > Heels`, 8 US sizes resolved,
  `NO_CHART`), unresolved product (`Level Up Rhinestone Strap Heels`, 8 sizes
  `UNRESOLVED`, `hasUnresolved: true`), unknown id returns `null`.
