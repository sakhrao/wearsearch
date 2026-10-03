# PHASE 2 — CANONICAL ID FREEZE

Inventory of the current 475 node ids and the rule for which ids may change.

Full per-node table: [`PHASE-02-ID-INVENTORY.tsv`](./PHASE-02-ID-INVENTORY.tsv)
(regenerate with `npx tsx scripts/gen-taxonomy-inventory.mts`).

## Inventory

| Metric | Value |
| --- | --- |
| Node rows | 475 |
| Product-bound (`mapTo` non-empty) | **159** |
| Structural / style (no `mapTo`) | **316** |
| Distinct canonical placement targets | **289** |
| Legacy → canonical aliases | **475** |

## Freeze rule

> Any id that is **used** is `KEEP` unless there is a documented reason
> (merge/deprecate) **and** an alias/migration entry.

"Used" today means any of:

| Consumer | How it uses an id |
| --- | --- |
| Products | via `node.mapTo` (legacy DB display names) → 159 nodes |
| Questionnaire | every node is reachable from a root |
| API | every node is serialized by `/api/meta` |
| Saved state | questionnaire path stored in sessionStorage uses node ids |
| Search | `node.mapTo` + `crossTags` + `tokens` |

Because every current id is **path-derived** (`<genderPrefix>_<ancestors>`),
canonicalization must be **lossless via aliases**. The alias table is the
freeze artifact: `src/lib/catalog/taxonomy/id-aliases.generated.ts`
(regenerate with `npx tsx scripts/gen-taxonomy-aliases.mts`).

## Statuses

| Status | Count | Notes |
| --- | --- | --- |
| `KEEP` | 474 | all mapped + reached + canonical-mapped |
| `DEPRECATE` | 1 | `mens_bottoms_cargo_pants` (duplicate of `cargo`) → alias `cargo` |

## Documented merges (id changes)

| Legacy id | Canonical placement | Reason |
| --- | --- | --- |
| `mens_bottoms_cargo_pants` | `cargo` | duplicate MEN node (D1) |
| `womens_lingerie_and_sleepwear` | `underwear_and_sleepwear` | same domain as MEN |
| all `*_jeans` | `jeans` | shared concept across contexts |
| all `<category>_<style>` | `<category>::<style>` | style scoped to its category |

## Gate 2

**PASS** — every id is inventoried, `KEEP` ids are frozen, and every id has a
canonical alias target. Structure untouched.
