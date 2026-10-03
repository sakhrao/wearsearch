# Phase 06 — H2: Questionnaire → Canonical Size Selection → Search — Audit

> STATUS: **AUDIT.** Companion to `PHASE-05-H1-SEARCH-MIGRATION.md` and
> `PHASE-05-H1-GATE-REPORT.md` (H1 approved). H2 migrates the questionnaire size
> model from raw value strings to the canonical size identities the H1 search channel
> already accepts. Classification and plan below precede implementation.

## 1. Objective

Make the questionnaire emit **canonical size filter information** (not raw strings) and
have the H1 search channel consume it end to end:

```
Source size → canonical size → questionnaire selection → search filter → product result
```

No second size system, no hardcoded identities, no cross-system conversion. Reuse the
Stage A–F registry/normalization contracts and the H1 `size` / `sizeSystem` filter channel.

## 2. Guardrails

- Correct + unresolved is preferable to incorrect + normalized.
- RESOLVED / UNRESOLVED / NOT_BACKFILLED never collapse.
- UNRESOLVED sizes never receive an invented identity.
- Identity (`canonicalSizeOptionId`) is separate from the user-visible label (`Medium`
  stays `Medium`; its identity is `...|INTERNATIONAL|M`).
- US 8 ≠ EU 42; MEN M ≠ WOMEN M; clothing ≠ footwear.
- A bare numeric with no system (e.g. `32`) stays unresolved.
- Preserve all existing questionnaire taxonomy / branching / back / reset / draft behavior.
- Do not modify the H1 transition policy.

## 3. Method

Inspected (read-only): `src/lib/questionnaire.ts`, `src/lib/questionnaire-restore.ts`,
`src/lib/sizes.ts`, `src/lib/catalog/size-vocabulary.ts`, `src/app/api/meta/route.ts`,
`src/components/find-questionnaire.tsx`, `src/app/find/page.tsx`, `src/lib/search-url.ts`,
`src/components/home-page.tsx`, and the Stage A–F domain
(`src/lib/size-domain/{registry,normalize,types,index}.ts`, `query.ts`).

## 4. Current flow (as-is)

1. **`/api/meta`** builds `sizeCatalog` (`buildSizeCatalog`) from
   `Product → ProductVariant → Size` (purchasable) plus `semanticSizeRowsFor`
   (standard surfaces). Each row is raw: `audience`, `productType`, `category name`,
   `system` (raw label), `value` (raw label).
2. **`sizeSectionsFor`** merges all audiences per category and returns a flat
   `SizeSection { label, system, productType, values: string[] }`. Audience is dropped;
   clothing collapses to one null-system section, footwear to one section per system.
3. **`find-questionnaire`** renders `section.values` and stores a `SizeAnswer`
   `{ value, audience, productType, category, system }` on pick.
4. **`buildIntent`** pushes the size into the free-text `q` as `"<sys> <value>"` (known
   systems only) or bare `value`. The URL only carries `q/min/max/cur/soft`.
5. **`/api/search`** free-text parser (`SIZE_ALIAS_WORDS`, `detectSizeSystem`,
   `variantMatchesSizeSystem`, bare `sizeMatches`) applies the legacy raw-value path.
6. **Edit search** reconstructs the questionnaire answers from the server
   `structuredQuery` (including `structuredQuery.size` parsed from `q`).

## 5. Consumer classification (audit numbering)

| # | Consumer | Location | Classification |
| --- | --- | --- | --- |
| 9 | Questionnaire size catalog feed | `meta/route.ts:104-131,190-207,417-448` | **IN H2 SCOPE** (identity derivation context) |
| 10 | Questionnaire option build (`buildSizeCatalog`, `sizeSectionsFor`, `STANDARD_*`) | `sizes.ts:224-469` | **IN H2 SCOPE** (identity layer added; option surfaces preserved) |
| 10b | Questionnaire pick + submit (`SizeAnswer`, `buildIntent`) | `find-questionnaire.tsx:1134-1291` | **IN H2 SCOPE** |
| 10c | Edit/restore (`buildEditAnswers`) | `questionnaire-restore.ts:101-109` | **IN H2 SCOPE** |
| 11 | Build flow size vocabulary | `catalog/size-vocabulary.ts`, `lib/build/*` | INTENTIONALLY LEGACY / RAW (Build) |
| 12 | Outfit `?size=` free text | `app/outfit/outfit-client.tsx` | INTENTIONALLY LEGACY / RAW (Outfit) |
| 13 | Offer chip expansion | `catalog/offer-vocab.ts` | INTENTIONALLY LEGACY / RAW |
| 14 | Diagnostics / coverage | `lib/size-diagnostics.ts` | INTENTIONALLY LEGACY / RAW |
| 15 | `search-parser.ts` normalizedValue lookup | `search-parser.ts:156-181` | DEAD / UNUSED |
| — | Canonical normalizer | `size-domain/normalize.ts` | REUSE (single normalizer) |

## 6. Findings

- The questionnaire already carries the right **context** (`audience`, `productType`,
  `system`, `category`) on `SizeAnswer`, but never canonicalizes it. It ships the raw
  `value` as the matching key.
- `normalizeSourceSize(value, context)` already implements every required rule:
  `Medium`/`Med`→`M`, `2XL`→`XXL`, `3XL`→`XXXL`, alpha→`INTERNATIONAL`, numeric needs an
  explicit system, bra needs `category === "bra"`, footwear rejects alpha, MEN/WOMEN
  audiences produce distinct identities. H2 must call it — not recreate it.
- The questionnaire `system` for footwear is already a canonical id (`EU/US/UK/...`);
  for clothing it is `null`. The only extra context needed is the **SizeCategoryId**
  (e.g. `bra`, `belt`), derivable from the picked category.
- The current free-text handoff means the questionnaire's size never uses the canonical
  path. Keeping the raw token would let the legacy matcher conflict with the canonical
  filter, so the size token must leave `q`; the canonical filter replaces it.
- `buildEditAnswers` restores the size from `structuredQuery.size` (parsed from `q`);
  once the token leaves `q`, restore must read the canonical filter instead.

## 7. Transition policy (unchanged from H1)

| State | Questionnaire behavior | Search filter emitted |
| --- | --- | --- |
| RESOLVED | canonical identity derived, display label preserved | `size=<canonicalSizeOptionId>` |
| UNRESOLVED (known system) | no identity | `sizeSystem=<system>` (only legitimate pin) |
| UNRESOLVED (no system, e.g. bare `32`) | no identity | none (never a fake identity) |
| NOT_BACKFILLED | not applicable at questionnaire time (catalog options carry backfill) | — |

## 8. Migration plan

1. **Domain adapter** `src/lib/size-domain/questionnaire.ts`:
   `canonicalizeQuestionnaireSize(value, { audience, productType, system?, category? })`
   wrapping `normalizeSourceSize`; returns `{ displayLabel, canonicalSizeOptionId,
   resolutionStatus, system, canonicalValue }`. Display label = untouched source label.
2. **Category → SizeCategoryId** helper in `catalog/size-vocabulary.ts`
   (`sizeCategoryIdForCategory`), reusing the existing classification predicates.
3. **`SizeAnswer`** gains `canonicalSizeOptionId: string | null` and
   `resolutionStatus: "RESOLVED" | "UNRESOLVED"` (additive).
4. **`find-questionnaire`** derives per-option canonical identities from the current
   audience + section + picked category; `pickSize` stores them; `buildIntent` emits
   `size` / `sizeSystem` params instead of the free-text token.
5. **`search-url.ts`** carries repeatable `size` and `sizeSystem` through
   `SearchIntentParams` / encode / decode / parse / key.
6. **`home-page`** forwards `size` / `sizeSystem` to `/api/search` and seeds the H1
   size facet selection from them; pagination carries the same filter.
7. **`questionnaire-restore.ts`** restores the size answer from the canonical filter.

## 9. Test plan

- Normalization: `XS→XS`, `M→M`, `XL→XL`, `Medium→M`, `Med→M`, `2XL→XXL`, `3XL→XXXL`.
- Context: `M`+MEN → `MEN|clothing|INTERNATIONAL|M`; `M`+WOMEN → `WOMEN|clothing|INTERNATIONAL|M`.
- System: `US 8` ≠ `EU 42`; bare `32` unresolved (no identity); `US 8` with system resolves.
- Discipline: `WOMEN|shoes|...` ≠ `WOMEN|clothing|...`.
- Category: bra `36B` + `category=bra` resolves; without it stays unresolved.
- One Size resolves; display label preserved (`Medium` stays `Medium`).
- Unresolved never yields a canonical identity.
- No duplicate options; deterministic identity per (context, value).
- URL round-trip: build → parse preserves `size`/`sizeSystem`.
- Result filtering receives the canonical identity (`filterByCanonicalSize` accepts it;
  real DB `findProductIdsBySizeFilter` resolves a re-derived real catalog identity).

## 10. Out of scope

Build (#11), Outfit (#12), offer chips (#13), diagnostics (#14) stay raw. No Stage I.
