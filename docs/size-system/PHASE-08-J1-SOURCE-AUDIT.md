# Phase 08 — J1: Approved Size Chart Source Discovery Audit

> STATUS: **AUDIT — NO APPROVED SOURCE FOUND.**
> Companion to `PHASE-07-I1-CHART-DATA-AUDIT.md` and `PHASE-07-I-GATE-REPORT.md`.
> Scope: determine whether *any* legitimate, production-suitable source of size-chart /
> measurement data is available to this application. No source is integrated here, and no
> data is fabricated. The governing rule: **a missing real chart is better than an invented
> chart.**

## 1. Method

Read-only inspection of the application's real data channels:

- Catalog ingestion: `src/lib/catalog/**`, `scripts/import-catalog.mts`,
  `src/lib/catalog/adapters/ebay/**`.
- Legacy providers: `src/lib/providers/{livostyle,dummyjson,fakestore,sync,attribute-enrichment}.ts`.
- Prisma schema + generated client: `prisma/schema.prisma`, `src/generated/prisma/**`.
- Seed / static files: `prisma/seed.ts`, `prisma/catalog-data.ts`, repo-wide
  `.json`/`.csv`/`.tsv`/`.xml`.
- API routes and all outbound `fetch()` call sites.
- Environment configuration (variable *names* only; secret values never read or printed).
- Live development database probe: sources, brands, products, variants, attributes,
  attribute values, quarantine payloads.
- Prior audits: `PHASE-07-I1-CHART-DATA-AUDIT.md` (C1–C15 source classification).

## 2. Live database probe (development DB)

| Probe | Result |
| --- | --- |
| `Source` rows | 5 — `StyleHub Affiliate Feed` (AFFILIATE_FEED), `WearSearch Demo Store` (DEMO), `DummyJSON Free API` (OFFICIAL_API), `Fake Store API` (OFFICIAL_API), `Livostyle Open Catalog` (AUTHORIZED_FEED); none `official`, none a chart provider |
| `Product` / `Brand` / `ProductVariant` | 570 / 15 / 4029 |
| `Attribute` names | exactly 6 — `Sleeve, Collar, Fit, Style, Material, Pattern` (all qualitative) |
| `ProductAttribute` values | garment tags only (`Casual`, `Long Sleeve`, `Floral`, `Oversized`, `V-Neck`, …); **no measurements** |
| `ProductQuarantine` rows | 0 (no raw payloads retained; raw-aspect channel empty) |
| Prisma models / columns for charts or measurements | **none** (`PHASE-07-I1-CHART-DATA-AUDIT.md:34`) |

There is no chart table, no measurement table, no JSON measurement blob populated, and no
measurement attribute. This matches the Stage I audit.

## 3. Candidate sources (J1 required fields)

Legend for "Actual measurements": **No data** = source carries no measurements;
**Possible (unpersisted)** = could externally carry some, but not present/usable here;
**N/A** = source does not exist in this project.

### S1 — First-party catalog data (current DB)

| Field | Value |
| --- | --- |
| Source name | The application's own Postgres catalog |
| Ownership/origin | First-party (synthetic + public feeds) |
| Access method | Prisma / `src/lib/catalog/**` |
| Data format | Relational rows |
| Supported brands | 15 |
| Supported categories | full taxonomy |
| Supported audiences | MEN/WOMEN/KIDS/UNISEX on variants |
| Supported size systems | size *labels* + canonical identity (EU/US/UK/…) |
| Units | none (no measurements) |
| Actual measurements | **No data** |
| Licensing | first-party |
| Production-suitable | Not as a chart source — carries no measurements |
| Missing fields | every measurement column |
| Normalization needs | N/A |

### S2 — Imported merchant data (DummyJSON / FakeStore / Livostyle)

| Field | Value |
| --- | --- |
| Source name | `DummyJSON Free API`, `Fake Store API`, `Livostyle Open Catalog` |
| Ownership/origin | public demo APIs / `arturayupov` GitHub feed |
| Access method | HTTP `fetch()` in `src/lib/providers/*` |
| Data format | JSON (product / variant / tag) |
| Supported brands | Livostyle brand set only |
| Supported categories | clothing (mostly women's) |
| Supported audiences | WOMEN (Livostyle) |
| Supported size systems | alpha + some numeric labels |
| Units | none |
| Actual measurements | **No data** — Livostyle tags map only to `Fit/Style/Pattern/Material`; the F6 allow-list (`attribute-enrichment.ts:3-10`) structurally rejects measurement names |
| Licensing | public/unauthorized feeds; not an approved measurement license |
| Production-suitable | No — no measurements |
| Missing fields | all measurements |
| Normalization needs | N/A |

### S3 — Brand-provided charts

| Field | Value |
| --- | --- |
| Source name | — (none) |
| Ownership/origin | — |
| Access method | — |
| Actual measurements | **N/A** — no brand chart data exists; `Brand` model holds only name/logo/website |
| Production-suitable | No |

### S4 — Structured supplier feeds

| Field | Value |
| --- | --- |
| Source name | — |
| Actual measurements | **N/A** — no supplier feed integration or credential exists |
| Production-suitable | No |

### S5 — Approved static datasets / internal files

| Field | Value |
| --- | --- |
| Source name | — |
| Access method | — |
| Data format | Repo-wide scan found **no** `.csv/.tsv/.xml/.json` dataset with measurements; only `docs/canonical-taxonomy/PHASE-02-ID-INVENTORY.tsv` (taxonomy IDs) |
| Actual measurements | **N/A** |
| Production-suitable | No |

### S6 — Approved API responses

| Field | Value |
| --- | --- |
| Source name | — |
| Actual measurements | **No data** — no API the app calls returns measurements (see §4) |
| Production-suitable | No |

### S7 — eBay `localizedAspects` (item specifics)

| Field | Value |
| --- | --- |
| Source name | eBay Browse API (`GET /buy/browse/v1/item_summary/search`) |
| Ownership/origin | eBay marketplace; **seller-authored** free text |
| Access method | OAuth client-credentials; `EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET` present in `.env`; adapter at `src/lib/catalog/adapters/ebay/**` |
| Data format | JSON `localizedAspects: {name,value}[]`; extracted shape at `normalize.ts:74` |
| Supported brands | seller-listed |
| Supported categories | seller-listed |
| Supported audiences | derived from a `style`/`gender`/`department` aspect |
| Supported size systems | none guaranteed (free text) |
| Units | usually **absent** |
| Actual measurements | **Possible (unpersisted)** — e.g. "Chest Size", "Waist Size", "Inseam Length" *may* appear for apparel, but: (a) **not persisted** — no eBay `Source` row exists and `ProductAttribute` has no writer from `catalog/**`; (b) only a fixed aspect allow-list is extracted (`normalize.ts:49-59`); raw aspects are dropped; (c) `ProductQuarantine` is empty |
| Licensing/usage | eBay API License; using seller item specifics as a chart dataset would require legal review — **not established** |
| Production-suitable | **No** — seller free text per single listing is not a chart; no stable product identity mapping (J6 forbids fuzzy matching); units/systems often missing (forbidden to guess) |
| Missing fields | row-per-size structure, units, system, verified identity |
| Normalization needs | would require unit + system guessing (forbidden) |

### S8 — eBay rejected/quarantined payloads

| Field | Value |
| --- | --- |
| Source name | `ProductQuarantine.rawData` (JSONB) |
| Actual measurements | **No data** — 0 rows; only non-ACCEPT listings would be stored |
| Production-suitable | No |

### S9 — Merchant / brand websites (scraping)

| Field | Value |
| --- | --- |
| Source name | brand size-guide HTML pages |
| Access method | **none exists** — no crawler/scraper/HTTP client for merchant sites; `SourceType.CRAWLER` is an unused enum value; no `cheerio`/`puppeteer`/`playwright` dependency |
| Licensing/usage | copying brand charts requires an established right to use — **not present** |
| Production-suitable | No |

### S10 — Generic "standard" size tables (internet)

| Field | Value |
| --- | --- |
| Production-suitable | **Explicitly forbidden** by the Stage J guardrails; not a real source for this catalog |

### S11 — Measurement type registry (first-party vocabulary)

| Field | Value |
| --- | --- |
| Source name | `src/lib/size-domain/{types,registry,aliases}.ts` |
| What it is | 28 measurement *ids*, 7 unit ids, and label/unit alias tables — **vocabulary, zero values** |
| Actual measurements | **No data** |
| Production-suitable | It is the parser's vocabulary, not a data source |

## 4. External services actually called (no measurements)

| Service | Purpose | Returns measurements? |
| --- | --- | --- |
| eBay Browse API | marketplace listings | No (structured aspects limited; unpersisted) |
| eBay OAuth | token | No |
| eBay notifications webhook | inbound account events | No |
| Livostyle Open Catalog | women's product feed | No |
| dummyJSON | demo catalog | No |
| FakeStore | demo catalog | No |
| Frankfurter FX | currency rates | No |

No scraping infrastructure and no first-party chart dataset exists.

## 5. J2 approval decision

A source is acceptable only if its origin **and** usage are sufficiently established for this
project. Applying that test to every candidate:

| Candidate | Reject reason |
| --- | --- |
| S1 first-party DB | contains no measurements |
| S2 imported merchant feeds | contain no measurements; unlicensed for measurements |
| S3 brand charts | do not exist |
| S4 supplier feeds | do not exist |
| S5 static files | do not exist |
| S6 approved APIs | return no measurements |
| S7 eBay aspects | seller free text, unpersisted, no units/system, no stable product mapping, licensing unestablished |
| S8 quarantine payloads | empty |
| S9 website scraping | no access method; licensing unestablished |
| S10 generic tables | forbidden |
| S11 registry | vocabulary only |

**No approved production size-chart source exists.** Therefore, per Stage J J2/J15, the
stage stops at the approval gate. J3–J11 (adapter, matching, persistence, caching) are not
implemented, because there is nothing legitimate to adapt. The existing Size Guide remains
valid and continues to report `NO_CHART` honestly.

## 6. What would unblock Stage J

A source can be integrated without changing the domain if it supplies, for Product / Brand /
Category scope, a verified:

- stable identifier mapping to `Product.id` / `Brand.id` / category (no fuzzy matching);
- row-per-size chart with real measurement values or source ranges;
- explicit units (no guessing) and size system (no cross-system conversion);
- provenance and licensing clear for this project.

The single insertion point is `SizeChartSource` (`src/lib/size-domain/chart-source.ts:22-26`),
consumed at `src/lib/product-detail.ts:374-377`. The bridge
`sizeChartFromNormalized` (`src/lib/size-domain/chart-import.ts:86`) already converts a
parsed source chart into the resolver contract, so no other code change is required.

## 7. Expected Stage J status

`BLOCKED — REQUIRES APPROVED DATA SOURCE`.
