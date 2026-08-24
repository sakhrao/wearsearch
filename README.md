# WearSearch

A clothing search application: natural-language queries ("black tank top", "men shirt", "h&m jeans") are parsed into structured intents and matched against a product catalog with a strict two-tier result model (Exact / Similar), exposed through `/api/search` and a filterable React UI.

**Status: MVP freeze.** The ranking/parser engine is feature-frozen. Any future change is either a confirmed bug or an approved new feature — not an open-ended tuning effort.

## Quick Start

```bash
npm install
npm run dev          # http://localhost:3000
npx prisma db seed   # demo catalog (79 products, 15 stocked categories, 2 sources)
```

Environment: `DATABASE_URL` in `.env` (PostgreSQL via Prisma 7 + driver adapter).

## Tests

| Command | Scope |
|---|---|
| `npm run test:search` | 99-case golden regression over the live API (counts, structured interpretation, ordering pins, categoryStatus) |
| `npm run test:ranking` | 10 specification checks for scoring/ordering behavior |
| `npx tsc --noEmit` | type safety |

Both suites must pass against a running dev server (`localhost:3000`).

## What the search supports

### Parsing (`src/lib/search-parser.ts`)
- **Brand** detection from a brand vocabulary (masked spans; "h&m" never parses as size M).
- **Category** detection incl. synonyms (`tee`, `trainers`, `tank top`…), plural forms, and compact spellings (`tshirt`, `tanktop`).
- **Color** detection from catalog colors.
- **Size** detection incl. verbose aliases (`extra small`→XS … `double extra large`→XXL); possessive clitics stripped (`women's`→women).
- **Gender** detection (men/women/unisex) as a hard filter (MEN/WOMEN admit UNISEX).
- **Attributes** as explicit constraints (e.g. Style:Classic) with penalties for misses.
- **Unsupported categories** (jacket, hoodie, dress, pants…) suppress misleading Exact matches while still allowing suggestions.
- Free-text words act as relevance signals only; they can never satisfy Exact by themselves.

### Matching & ranking (`src/app/api/search/route.ts`)
- **Exact**: every detected structural intent must match literally (raw category match).
- **Similar**: scored candidates with brand/category/color/size/attribute credits, coherence halving off-subtree, admission gates (mismatch budget ≤2, positive score, meaningful relevance).
- **Category scope gate**: Similar never admits products from unrelated branches when an explicit non-empty category intent exists (color/brand alone cannot smuggle a cross-branch item in).
- **Empty-node sibling substitution**: if the requested category exists in the taxonomy but stocks zero products, sibling categories may stand in for Similar results only — all other explicit constraints must still hold; Exact remains impossible.
- **`categoryStatus` metadata** in the response (requested node, stocked subtree count, siblings) powers UI messaging.

### UI (`src/app/page.tsx`)
- Always-visible Exact and Similar sections, search-interpretation chip, three-way empty-state messaging driven by `categoryStatus`.
- Display-level facet filters (gender/category/color/size/brand) over the current response only — no re-querying, no engine involvement.
- Product cards: image (lazy), name, brand, derived store (from URL host), colors, sizes, attributes, price, availability badge, outbound purchase link.

## What it deliberately does NOT support

- Fuzzy/typo-tolerant matching beyond the fixed spelling vocabulary.
- Price intent ("under $50"), price sorting/filtering.
- Multi-intent ("mixed") queries such as "hoodie and tee".
- Query-time taxonomy browsing or autocomplete.
- Pagination (result sets are small by design).

## Deferred backlog (known, documented, intentionally open)

| Item | Class |
|---|---|
| G5 latent collision: attribute values that double as words (e.g. "Classic") can silently block sibling substitution under extra intents | watch on catalog expansion |
| Price intent (G7) | future feature |
| Mixed-intent policy ("hoodie tee" → suggest from the supported part) | future feature |
| Similar-quality tuning (e.g. which non-sibling tail is acceptable when no color intent exists) | future feature |
| Tailored message for "empty category AND zero substitutes" (currently generic empty state) | UX nicety |
| Catalog expansion → re-run both suites; latent issues surface at scale | ops |

## Roadmap after freeze

1. Catalog expansion (more products, real stores/sources; validate URLs, images, prices, sizes).
2. Production deployment (managed PostgreSQL, environment variables, hosted Next.js).
3. Bug-driven maintenance only for ranking/parser.
