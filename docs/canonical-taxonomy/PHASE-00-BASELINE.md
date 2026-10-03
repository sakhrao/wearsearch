# PHASE 0 — BASELINE

Snapshot taken before any canonical-taxonomy change. Gate 0 = baseline known.

## Taxonomy

| Metric | Value |
| --- | --- |
| Taxonomy version | `2.0.0` |
| Trees | 3 hand-authored (`MEN`, `WOMEN`, `KIDS`) |
| Nodes total | **475** (MEN 186, WOMEN 181, KIDS 108) |
| Leaves total | **362** (MEN 141, WOMEN 140, KIDS 81) |
| Roots | MEN 7, WOMEN 9, KIDS 8 |
| `migrationMap` slugs | 59 |
| Canonical nodes | **N/A** (not implemented yet) |

Node identity today: `id = <genderPrefix>_<ancestor slugs...>` (path-derived).
Style identity today: shared `styles.ts` registry via `styleId` (gender-free) — already correct.

## Commands

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | **PASS** (exit 0) |
| `npm run build` | **PASS** (compiled, 15/15 static pages) |
| `npm run test:taxonomy` | **83 passed / 4 failed** |
| `npm run test:questionnaire` | **32/32 passed** |
| `npm run test:edit-restore` | **36/36 passed** |
| `npm run test:search` | **111/115 passed** |

### Known-failing taxonomy tests (pre-existing, lock current shape)

```text
FAIL T1  the jeans children are fits :: expected fit,...,style
FAIL T2  women's jeans offers Wide-Leg and men's does not
FAIL T-kids  jeans offers its own fit level
FAIL B1  the released level re-exposes its options
```

### Known-failing search cases (pre-existing)

```text
[06] "slim fit black"   -> structured.attributes=[], expected [Fit:Slim]
[77] "blue pants"       -> similarCount=36, expected 35
[84] "skinny jeans"     -> structured.attributes=[], expected [Fit:Skinny]
[85] "straight jeans"   -> structured.attributes=[], expected [Fit:Straight]
```

## Behavior

| Property | Baseline |
| --- | --- |
| Questionnaire recursive | YES |
| Dynamic depth | YES |
| Size after leaf | YES (size only after selectable children exhausted) |
| Productless node handling | `branchHasStock` hides branches with no stocked category |
| Product matching contract | `node.mapTo` (legacy DB display names), matched in `search/route.ts` |
| `styleId` gender-free | YES (shared `styles.ts`) |

## Gate 0

**PASS** — baseline is known and recorded. Ready for Phase 1.
