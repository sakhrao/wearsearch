# PHASE 3 — ID COMPATIBILITY LAYER

Added a pure resolver that lets legacy path-derived ids and new canonical
placement ids coexist. **No behavior changed** — nothing consumes it yet.

## Added

| File | Purpose |
| --- | --- |
| `src/lib/catalog/taxonomy/id-aliases.generated.ts` | generated table: `TAXONOMY_ID_ALIASES` (475) + `CANONICAL_PLACEMENT_IDS` (289) |
| `src/lib/catalog/taxonomy/ids.ts` | `resolveCanonicalId`, `isCanonicalId`, `normalizePath`, `CURRENT_TAXONOMY_VERSION`, `CANONICAL_TAXONOMY_VERSION` |
| `scripts/gen-taxonomy-aliases.mts` | regenerates the alias table from the current trees |
| `scripts/taxonomy-ids.test.mts` | Gate 3 tests (`npm run test:taxonomy-ids`) |

## API

```ts
resolveCanonicalId("mens_bottoms_jeans")        // -> "jeans"
resolveCanonicalId("mens_bottoms_jeans_skinny") // -> "jeans::skinny"
resolveCanonicalId("jeans")                      // -> "jeans" (idempotent)
normalizePath(["mens_bottoms_jeans", "..._skinny"]) // -> ["jeans", "jeans::skinny"]
```

`CURRENT_TAXONOMY_VERSION = "2.0.0"`, `CANONICAL_TAXONOMY_VERSION = "3.0.0"`.

## Gate 3 result

```
PASS old id -> canonical :: mens_bottoms_jeans -> jeans
PASS old id -> canonical :: mens_bottoms_jeans_skinny -> jeans::skinny
PASS canonical id -> itself (289 ids)
PASS every legacy alias points to a canonical id (475)
PASS old path -> canonical path
PASS new writes stay canonical (idempotent)
PASS unknown id is preserved
PASS legacy coverage (475 nodes aliased)

15 passed, 0 failed
```

`npx tsc --noEmit` → PASS.

## Gate 3

**PASS** — old→canonical, canonical→itself, old path→canonical path, and
idempotent canonical writes all verified. Questionnaire behavior untouched.

Next: **Phase 4 — introduce the unified taxonomy data** (concept + placement
model), consuming these exact canonical placement ids.
