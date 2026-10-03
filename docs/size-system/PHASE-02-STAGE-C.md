# Size System — Phase 2 / Stage C — Product/Variant Size Integration & Coverage

Additive, read-only, deterministic, migration-free. This stage answers: *given the
size data actually in the catalog, what resolves under the Stage B pipeline, under
what context, and how much stays unresolved?* Nothing is persisted.

See `PHASE-02-STAGE-C-AUDIT.md` for the raw structure findings.

## A. What was integrated

Two live storage paths, both integrated per (variant / offer-variant) row:

- **Legacy:** `ProductVariant → Size` (`category`, `system`, `value`,
  `normalizedValue`, `audience`, `productType`). Written by `providers/sync.ts`
  with `audience = productType = UNKNOWN` in practice and a `Size.category` string.
- **Phase-0:** `ProductOffer → ProductOfferVariant` (`sizeValue`, `sizeSystem`,
  `sizeProductType`, `sizeAudience`, `availability`), written verbatim from the
  adapter `NormalizedSize` by `catalog/offers.ts`.

Size is variant/offer-level, never product-level. A product with S/M/L/XL yields
four independent observations; different sources keep their own labels. No Product
or schema change was made.

## B. Adapter design

`src/lib/size-domain/integrate-product.ts` — pure, no Prisma import:

```
Raw variant/offer row -> buildContext (real fields only) -> normalizeSourceSize -> observation
```

- `integrateProductSizes(input: ProductSizeInput): ProductSizeObservation[]`
  emits one observation per row with a non-empty size label (variants first in input
  order, then offer variants). Rows with no size value emit nothing.
- Each observation carries `sourceSizeLabel` **verbatim**, the raw `sourceSystem/
  sourceProductType/sourceAudience`, `availability` verbatim plus a conservative
  `available` narrowing (AVAILABLE→true, OUT_OF_STOCK→false, else null), the
  constructed `context`, the full Stage B `NormalizedSize`, and a derived
  `classification`.

`src/lib/size-domain/size-coverage.ts` — `buildSizeCoverage(observations)`:

- observation-level bucket (`total/resolved/unresolved/insufficientContext/ambiguous` + `resolutionPercentage`);
- unique-source-label coverage (with `mixed` for context-dependent labels);
- breakdowns by source, product type, audience, system, status, unresolved reason, canonical size;
- `unresolvedVocabulary` (occurrence count, classes, reasons, sources, product types, audiences, contexts), sorted count desc then label asc.
- No timestamps, no random ids, all record keys sorted → same observations give byte-identical reports.

The only new Stage B use is `normalizeSourceSize`. No aliases, registries, or
Product-specific heuristics were added; `ORDERED_ALPHA`, `SIZE_SYSTEMS`,
`categorySizeGroupKind` and the `sizeIdentity` wire format are reused.

## C. Context mapping (real fields only)

| Context | Source field | Rule |
| --- | --- | --- |
| `audience` | offer `sizeAudience`, else legacy `Size.audience`, else `Product.gender` | use the first registered value ≠ `UNKNOWN`; otherwise `UNKNOWN`. `Product.gender` is the same source `size-sections.ts` already documents for audience. |
| `productType` | offer `sizeProductType`, else `Size.productType`, else `Product.category.name` | registered value ≠ `UNKNOWN`, else category→product type via the existing `categorySizeGroupKind` (`shoes→FOOTWEAR`, `accessories→ACCESSORY`, `headwear→HEADWEAR`, else `CLOTHING`); no category → `UNKNOWN`. |
| `system` | `Size.system` / `sizeSystem` | registered `SizeSystemId` and ≠ `UNKNOWN`, else `null` (the adapter never coerces free-text). Stage B's prefix/absence rules then apply. |
| `category` | `Product.category.name` | only `bra`/`bras` maps to `bra`, plus `shoes→footwear`, `headwear→hat`; otherwise `clothing`. Kept conservative — Stage B only needs `bra` to matter. |
| `ageRange` | — | **not derivable** (no min/max age field anywhere) → always `null`. KIDS still normalize on stored audience/product type. |

Nothing is inferred from arbitrary size strings. A bare numeric with no stored
system, or alpha with no audience/product type, is passed through with the missing
context and left for Stage B to mark unresolved.

## D. Resolution behavior

`classification` is a documented view over the exact Stage B vocabulary (not a
replacement — `normalization.reason` is always preserved):

| Class | Condition |
| --- | --- |
| `RESOLVED` | Stage B status `RESOLVED` |
| `INSUFFICIENT_CONTEXT` | reason `INSUFFICIENT_CONTEXT` |
| `AMBIGUOUS` | reason `CONTEXT_MISMATCH` or `CONFLICTING_SYSTEM` |
| `UNRESOLVED` | any other `UNRESOLVED` reason (`UNKNOWN_VALUE`, `EMPTY_INPUT`, `MALFORMED_INPUT`, `UNSUPPORTED_SYSTEM`, `NON_PERSISTED_SYSTEM`) |

Unresolved values are never deleted, never marked unavailable, and never given a
fabricated canonical id or system. Availability is never read as a proxy for
resolvability.

## E. Coverage

`LIVE_CATALOG_COVERAGE: MEASURED` — via the read-only `npm run size-domain-coverage`
against the configured database (nothing written). This is a **snapshot**; the
deterministic guarantee is "same catalog snapshot + same registry ⇒ same report".

```
products:                          570
observations:                    3977
resolved:                        3818   (96.0%)
unresolved:                       159   (4.0%)
insufficient context:             159
ambiguous:                          0

unique source labels:              34
  resolved:                        33   (97.06%)
  fully unresolved:                 1
  context-mixed:                    9

by product type:  CLOTHING 3092/3092 resolved · FOOTWEAR 726/885 resolved
by audience:      WOMEN 3977/3977 observations (catalog is women-only today)
by system:        INTERNATIONAL 3092 (all resolved) · US 371 · EU 355 · NONE 159 (0 resolved)
unresolved reason: INSUFFICIENT_CONTEXT 159
```

`byCanonicalSize` holds 33 distinct canonical ids; the largest are
`WOMEN|clothing|INTERNATIONAL|L/M/S/XL` and `WOMEN|shoes|US|5..8`,
`WOMEN|shoes|EU|36/37`.

## F. Unresolved vocabulary

All 159 unresolved observations are numeric footwear sizes `5.5, 6, 6.5, 7, 7.5, 8,
8.5, 9, 10, 11` on offer variants whose `sizeSystem` is **null** (context
`WOMEN|FOOTWEAR|NONE|footwear`, reason `INSUFFICIENT_CONTEXT`). These are real,
recognizable sizes — but with no stored system there is no honest basis to choose
US vs EU vs UK, so they are correctly left unresolved rather than guessed.

The same numeric values **do** resolve wherever a stored system exists (US 5–8 and
EU sizes resolve at 100%). So the gap is missing `sizeSystem` metadata on some
offer rows, not an unknown size vocabulary. `5.5` is the single label that never
resolves in any context (2/2).

## G. Persistence decision (input to Stage D — no decision made here)

No Prisma change, no new columns, no backfill, no writes. Stage C only suggests what
Stage D would need to evaluate:

1. The dominant resolver gap is **missing `sizeSystem`** on numeric footwear offer
   variants; a real fix is source-side metadata (or an explicit, reviewable
   system-inference policy), not a guess.
2. A canonical-size projection on variant/offer rows would need `audience`,
   `productType`, `system`, and the canonical id — but only after Stage D confirms
   the identity contract and migration path.
3. `ageRange` has no source field at all, so any kids-range persistence is a new
   data-acquisition problem, not just a schema change.
4. Offer `sizeSystem` free-text may hold non-persisted systems (`JP`, `BRA`,
   `ONE_SIZE`); persistence must not silently coerce them into the enum.

## Hard-stop review

None of the hard-stop conditions were hit: Stage A contracts unchanged, Stage B
normalization semantics unchanged, no Prisma/schema/persistence change, no context
guessing, no invented mappings, canonical IDs unchanged, `sizeIdentity` wire format
unchanged.

## Verification

- `npm run test:size-domain` → 22/22
- `npm run test:size-domain-normalize` → 42/42
- `npm run test:size-domain-product-integration` → 26/26
- `npm run typecheck` → clean
- `npm run build` → PASS
- Regressions: size-identity 30/30, size-sections 9/9, size-groups 9/9,
  taxonomy-ids 15/15, questionnaire 32/32, taxonomy 83/87 (4 known baseline
  failures unchanged).

Note: this repository still defines no aggregate `test` script, so `npm test` is
not available; the focused suites above are the equivalent gate.
