# Phase 09 — K: Catalog Data Readiness & Size-Chart Source Contract — Readiness Audit

> STATUS: **AUDIT.** Covers K1 (ingestion capability), K2 (stable source identity),
> K3 (size metadata acquisition), K8 (schema), and K9 (data quality).
> The provider contract itself is in `PHASE-09-K-CHART-SOURCE-CONTRACT.md`.
> No code or data was changed to produce this audit.

## K1 — Catalog ingestion capability audit

### Two ingestion paths exist

**Path A — legacy provider sync (populates the current catalog).**
`src/lib/providers/sync.ts`, invoked by `npm run sync:providers`; providers are
`livostyle.ts`, `dummyjson.ts`, `fakestore.ts`. It writes directly with Prisma:

- `Source`: upsert by `name` (`sync.ts:216`).
- `Brand`: upsert by `name`, slug `slugify(name)` (`sync.ts:41-64`) — **no external brand id**.
- `Color`: upsert by `name` (`sync.ts:59-64`).
- `Category`: upsert by `slug`; the slug comes from the provider product, not a mapping
  table (`sync.ts:97-127,239-246`).
- `Size`: upsert on `(audience=UNKNOWN, productType=UNKNOWN, system, value)`
  (`sync.ts:68-95`); system = `variant.sizeSystem ?? product.sizeSystem ?? "INTERNATIONAL"`.
- `Product`: upsert on `(sourceId, externalId)` (`sync.ts:250-273`); `externalId` is the
  provider's stable product id.
- `ProductVariant`: delete-then-create per product (`sync.ts:133`); `sku` is **synthesized**
  as `${externalId}-v${index}` or `${externalId}-OS` (`sync.ts:176,204`) — **no external
  variant id**.
- `ProductAttribute`: via `writeProductAttributes`, restricted to 6 qualitative names
  (`attribute-enrichment.ts:3-10,192-196`).

**Path B — eBay catalog architecture (defined, not yet populating).**
`src/lib/catalog/adapters/ebay/**` + `src/lib/catalog/import.ts` + `sync-run.ts` +
`validation.ts` + `dedupe.ts` + `offers.ts`. This is the real-source architecture: it
extracts GTIN/MPN/brand/color/size/style aspects (`adapters/ebay/normalize.ts:49-118`),
validates, quarantines rejects, dedupes by GTIN→MPN→SKU→name+color→similarity
(`dedupe.ts`), and models one `Product` with many `ProductOffer`s and per-variation
`ProductOfferVariant`s (`schema.prisma:118-223`). **It has not yet produced rows**: the DB
has `ProductOffer=0`, `ProductOfferVariant=0`, no eBay `Source` row, and every one of the
570 products is from `Livostyle Open Catalog`.

### Field origins

| Field | Origin (current data) | Origin (eBay path, when used) |
| --- | --- | --- |
| Product | provider product object | eBay item summary |
| Brand | provider `brand` string → `Brand.name` upsert | `brand` aspect → `BrandAlias`/`Brand` |
| Category | provider `categorySlug` → `Category.slug` | source token → `CategoryMapping` |
| Product type | derived later from category/gender (`backfill-size-context`) | derived from category |
| Audience/gender | `Product.gender` (provider) + Stage backfill | `style`/`gender`/`department` aspect |
| Variant | provider `variants[]` or a single implicit variant | `ProductOfferVariant` lines |
| Variant size | `variant.size` label → `Size` row | `size` aspect → `sizeValue` |
| Size system | `variant.sizeSystem ?? product.sizeSystem ?? "INTERNATIONAL"` | not structured (free text) |
| Source/store | `Source` upsert on provider name | eBay `Source` |
| External product id | provider `externalId` → `Product.externalId` | eBay item id → `externalId` |
| External variant id | **none** (sku synthesized) | eBay variation id → `externalVariantId` |
| Source URL | provider `productUrl` | eBay item web URL |
| Availability | provider `inStock` → variant availability | eBay availability → offer/variant |

## K2 — Stable source identity audit

The rule: a chart may only attach to a canonical row through a **verified stable
identifier**, never through a name, and never through fuzzy similarity.

| Entity | Stable external identifier present? | Evidence | Verdict |
| --- | --- | --- | --- |
| **Product** | **Yes** | `Product.@@unique([sourceId, externalId])` (`schema.prisma:346`); every current product has a non-empty `externalId` (570/570) | Reliable |
| **Variant** | **Partial** | `ProductOfferVariant.externalVariantId` + stable `variantKey` exist (`:176,179`) but the table is empty; `ProductVariant` has only a synthesized `sku` and no external id (`:353-386`) | **Gap** for current catalog |
| **Brand** | **No** | `Brand` has no external id column (`:21-32`); `BrandAlias(token, sourceId)` maps a source token to a brand but the table is **empty** (0 of 15 brands) | **Gap** |
| **Category** | **No** | `CategoryMapping(sourceId, sourceToken) → categoryId` exists (`:97-108`) but is **empty** (0 of 40 categories); current categories are assigned by slug from the provider, not by a verified mapping | **Gap** |

Conclusion: only **Product** currently has a reliable external→canonical mapping. Variant,
Brand, and Category mappings exist as schema but are unpopulated. This is a data-quality gap,
not an architecture gap — the mapping tables are present and constrained (`@@unique`).

## K3 — Size metadata acquisition audit

Recorded exactly as received; nothing normalized or inferred for this audit.

| Path / source | Shape | Classification |
| --- | --- | --- |
| Livostyle/legacy provider, `variant.sizeSystem` present | `size` label + explicit `system` | **Explicit** |
| Livostyle/legacy provider, no system | `size` label, system defaults to `INTERNATIONAL` at write | **Partially explicit** (a default is applied at ingestion; see note) |
| eBay `localizedAspects` `Size` | free text (e.g. "US Women's 8", "M") | **Free text** |
| eBay with no size aspect | — | **Missing** |
| Product with no variants | no size row (`sizeId=null`) | **Missing** |

Current persisted outcome (Stage E backfill already applied):

| Metric | Count |
| --- | --- |
| Variants total | 4029 |
| Variants with a `Size` row | 3977 |
| Variants with an explicit canonical system | 3818 |
| Variants without a canonical system | 159 |
| Variants not yet processed (`sizeResolutionStatus = null`) | 52 |
| Canonicalized (`canonicalSizeOptionId` set) | 3818 |
| Resolved | 3818 |
| Unresolved (raw label kept) | 159 |
| Distinct source size labels (`Size.value`) | 34 |
| Distinct canonical identities | 33 |
| Distinct systems present | EU, INTERNATIONAL, US |

**Note (documented, not fixed here):** the legacy sync applies `"INTERNATIONAL"` as a default
system when the provider omits one. The Stage E resolver records the true state:
UNRESOLVED rows keep `sizeResolutionSystem` but gain no fabricated canonical identity, so the
default does not manufacture a canonical size. Stage K does not change this path.

## K8 — Schema decision

No Prisma migration is added in Stage K. The audit found no concrete limitation that requires
a schema change to receive a future approved chart source:

- The chart contract is in-memory (`SizeChart`), and the boundary (`SizeChartSource`) already
  exists — no chart table is needed to receive data.
- Persistence is only required if an approved source demands durable storage **and** cannot be
  loaded on demand. That decision belongs to the future integration, not to Stage K (J11/K8).
- The identity mapping tables already present (`CategoryMapping`, `BrandAlias`, `GtinRecord`,
  `MpnRecord`) cover mapping needs; they simply need populating by a future importer.

## K9 — Data quality report (development DB)

| Metric | Value |
| --- | --- |
| Products | 570 |
| Brands | 15 |
| Variants | 4029 |
| Offers | 0 |
| Offer variants | 0 |
| Size rows | 107 |
| Categories | 40 |
| Attributes | 6 (all qualitative) |
| ProductAttributes | 1657 |
| Variants with size | 3977 |
| Variants with explicit system | 3818 |
| Variants without system | 159 |
| Distinct source size labels | 34 |
| Canonicalized sizes | 3818 |
| Unresolved | 159 |
| Not yet processed | 52 |
| Products with reliable external IDs | 570 / 570 (100%) |
| Brands with reliable external IDs | 0 / 15 (0%) |
| Categories with reliable mappings | 0 / 40 (0%) |

Data sources present (all `Product` rows come from one): `StyleHub Affiliate Feed`
(AFFILIATE_FEED), `WearSearch Demo Store` (DEMO), `DummyJSON Free API` (OFFICIAL_API),
`Fake Store API` (OFFICIAL_API), `Livostyle Open Catalog` (AUTHORIZED_FEED). All 570 products
belong to `Livostyle Open Catalog`.

No data was modified to improve any figure above.
