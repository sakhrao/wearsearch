# Phase 06 — H2: Questionnaire → Canonical Size Selection → Search — GATE REPORT

> STATUS: **IMPLEMENTED — AWAITING H2 APPROVAL.**
> H2 closes the last raw hand-off on the public search path: a size picked in the
> questionnaire now leaves the intent as a **canonical size identity** (or a legitimate
> `sizeSystem` pin), is carried through the URL, and is consumed by the H1 search channel.
> No Stage I / further work begins until this gate is accepted.

## 1. Scope delivered

Migrate the questionnaire size model from raw value strings to the canonical size identities
the H1 channel already accepts, per the accepted audit
(`PHASE-06-H2-QUESTIONNAIRE-AUDIT.md`) and the **unchanged H1 transition policy**:

```
Source size → canonical size → questionnaire selection → search filter → product result
```

No second size registry / normalization, no hardcoded identities, no cross-system conversion.
All existing questionnaire taxonomy / branching / back / reset / draft behavior is preserved.

## 2. Files changed (H2)

| File | Change |
| --- | --- |
| `src/lib/size-domain/questionnaire.ts` | **new** — `canonicalizeQuestionnaireSize()` (wraps the one normalizer) + `parseCanonicalSizeOptionId()` reverse parser; no `../sizes` import (cycle-safe) |
| `src/lib/catalog/size-vocabulary.ts` | `sizeCategoryIdForCategory(category)` — category → `SizeCategoryId` (bra/belt/socks/hat/one_size/footwear/clothing) |
| `src/lib/questionnaire.ts` | `SizeAnswer` gains `canonicalSizeOptionId: string \| null` + `resolutionStatus: "RESOLVED" \| "UNRESOLVED"` (additive) |
| `src/lib/search-url.ts` | `SearchIntentParams` / `SearchUrlDecoded` gain repeatable `size` / `sizeSystem`; `decodeSearchUrl` (`getAll`), `parseSearchUrl`, `encodeSearchUrl`, `buildSearchQueryString`, `searchIntentKey` carry them |
| `src/components/find-questionnaire.tsx` | per-option canonical derivation from audience + section + picked category; `pickSize` stores the identity; `buildIntent` emits `size` / `sizeSystem` and **no longer pushes the raw token into `q`** |
| `src/components/home-page.tsx` | forwards `size` / `sizeSystem` to `/api/search`; seeds the H1 size facet selection from them; size toggle + pagination carry the same filter |
| `src/lib/questionnaire-restore.ts` | `buildEditAnswers` 4th param (`CanonicalSizeFilterShape`); restores the answer from the canonical filter / `sizeSystem` pin, with legacy `structuredQuery.size` fallback |
| `scripts/size-domain-h2-questionnaire.test.mts` | **new** — 24 adapter / URL / restore / DB cases |
| `package.json` | `test:size-domain-h2` script |

No change to the H1 transition policy, the Stage A–F domain, the search route, or the
intentionally legacy consumers (#11–#15).

## 3. Consumer outcomes (audit numbering)

| # | Consumer | Outcome |
| --- | --- | --- |
| 9 | Questionnaire size catalog feed (`meta`) | UNCHANGED — options keep their source labels; identity is derived at pick time |
| 10 | Option build (`sizeSectionsFor`, `STANDARD_*`) | UNCHANGED surfaces; category classification helper added for identity context |
| 10b | Pick + submit (`SizeAnswer`, `buildIntent`) | **MIGRATED** — canonical identity derived, raw size token removed from `q` |
| 10c | Edit / restore (`buildEditAnswers`) | **MIGRATED** — reads the canonical filter, not `q` |
| 11–14 | Build / Outfit / offer chips / diagnostics | INTENTIONALLY LEGACY / RAW (untouched) |
| 15 | `search-parser.ts` normalizedValue | DEAD (untouched) |
| — | Canonical normalizer (`normalizeSourceSize`) | REUSED — single authority, called by the adapter |

## 4. Transition policy implemented (unchanged from H1)

| State | Questionnaire behavior | Filter emitted |
| --- | --- | --- |
| RESOLVED | identity derived; **display label untouched** (`Medium` stays `Medium`) | `size=<canonicalSizeOptionId>` |
| UNRESOLVED, persisted known system | no identity, system kept | `sizeSystem=<system>` |
| UNRESOLVED, no system (bare `32`) | no identity | none — never a fake identity |
| NOT_BACKFILLED | not reachable at questionnaire time (options come from the backfilled catalog) | — |

The route gives `size` precedence over `sizeSystem` (`src/app/api/search/route.ts:1056-1094`),
so a resolved identity is never loosened by a leftover system pin.

## 5. Canonical flow (end-to-end)

- Pick `Medium` while the section is tagged `EU`-less clothing for the **WOMEN** audience and
  the chosen category is not `bra` → adapter returns
  `canonicalSizeOptionId = WOMEN|clothing|INTERNATIONAL|M`, `sourceLabel = "Medium"`,
  `resolutionStatus = RESOLVED`.
- `buildIntent` emits `?q=…&size=WOMEN%7Cclothing%7CINTERNATIONAL%7CM`; the token is **not**
  added to `q`.
- `home-page` sends `size=…` to `/api/search` and seeds the H1 size facet from it; the same
  filter is re-sent on size toggle and pagination.
- On re-entry, `buildEditAnswers` re-derives the answer from the URL's canonical filter.

## 6. Verification results

| Suite | Result |
| --- | --- |
| `npm run typecheck` | PASS (0 errors) |
| `npm run build` (Next 16.3.2 Turbopack) | PASS |
| `npm run test:size-domain-h2` (new) | **24 passed, 0 failed** |
| `npm run test:size-domain-h1` | 25 / 25 |
| `npm run test:facet-counts` | 11 / 11 |
| `tsx scripts/size-identity.test.mts` | 31 / 31 |
| `tsx scripts/size-sections.test.mts` | 9 / 9 |
| `tsx scripts/f13-window-facets.test.mts` | 9 / 9 |
| `npm run test:url-state` | 29 / 29 |
| `npm run test:edit-restore` | 36 / 36 |
| `npm run test:questionnaire` | 32 / 32 |
| `npm run test:size-domain` | 22 / 22 |
| `npm run test:size-domain-normalize` | 42 / 42 |
| `npm run test:size-domain-product-integration` | 26 / 26 |
| `npm run test:size-domain-stage-d` | 24 / 24 |
| `npm run test:size-domain-stage-e` | 18 / 18 |
| `npm run test:size-domain-stage-f` | 25 / 25 |
| `npm run test:size-domain-g1-migration` | 12 / 12 |
| `npm run test:size-domain-chart` | 16 / 16 |
| `npm run test:taxonomy-ids` | 15 / 15 |
| `npm run test:taxonomy` | 83 / 87 (unchanged baseline) |

Environment-limited suites requiring a dev server at `localhost:3000` remain un-runnable
locally (`ECONNREFUSED`), as in H1; H2 correctness is covered by the pure + DB suites above.
The questionnaire URL/restore contract is covered by `url-state` and `edit-restore`.

## 7. H2 test coverage (`scripts/size-domain-h2-questionnaire.test.mts`)

**Adapter normalization:** `XS/M/XL` → own identities; `Medium`/`Med` → `M`; `2XL`/`3XL` →
`XXL`/`XXXL`; source label preserved (`Medium` stays `Medium`); `M`+MEN ≠ `M`+WOMEN.

**Systems / discipline:** `US 8` ≠ `EU 42`; bare `32` unresolved with no identity; footwear
numeric without a system unresolved; alpha in footwear unresolved (clothing ≠ footwear).

**Category context:** bra `36B` resolves only with `category = bra`; `One Size` resolves;
`sizeCategoryIdForCategory` maps shoes/bras/socks/belts/headwear/accessories/clothing.

**Identity + filter:** identity parses back to context; malformed identity rejected; a derived
identity matches a RESOLVED row carrying it and never an unresolved row; `filterByCanonicalSize`
receives the derived identity.

**URL:** `size` survives the build→parse round-trip; `sizeSystem` pin survives; a different
size changes the intent key.

**Restore:** canonical filter rebuilds the RESOLVED answer; a system pin rebuilds UNRESOLVED
with no identity; the legacy bare token still restores UNRESOLVED.

**DB (real boundary):** the adapter re-derives live stored identities verbatim across the
comparable stored population, and a re-derived identity returns products through
`findProductIdsBySizeFilter`.

## 8. Deviations from the audit (explicit)

1. **Restore signature.** The audit implied restore reads the canonical filter; implemented as
   a new optional 4th parameter on `buildEditAnswers` rather than changing the existing
   `structuredQuery` shape, so the legacy `structuredQuery.size` fallback still works for
   pre-H2 drafts.
2. **`sizeSystem` pin only when persisted.** An unresolved value that carries a *known*
   questionnaire system emits `sizeSystem`; an unresolved value with no system emits nothing.
   This matches the audit §7 table and avoids an over-broad pin.

## 9. Known limitations / follow-ups

- **UNISEX fold at the DB boundary (inherited H1 limitation).** The questionnaire derives the
  identity from the user's audience (`WOMEN|…`), while the H1 DB predicate is exact-equality
  (no UNISEX fold; the fold lives in the client facet matcher). A `UNISEX`-only product is
  therefore not returned by a `WOMEN|…` identity filter until the Stage I reconciliation.
  Not changed here — the H1 policy is frozen for H2.
- **`scripts/questionnaire-context.test.mts` is stale and unwired.** It is not referenced by
  any npm script and its fixture predates the Stage 3-A standard-surface behavior; it fails
  on `sizes.ts` (untouched by H2). Tracked as a pre-existing test-fixture drift, not an H2
  regression.
- Offer-variant grain still has no live data (carried from H1).

## 10. Gate decision requested

Approve H2, or return with changes. No Stage I (or other) work begins until this gate is
explicitly accepted.
