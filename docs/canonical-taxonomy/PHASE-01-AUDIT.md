# PHASE 1 — TAXONOMY AUDIT (no code changes)

Compares the current 3 hand-authored trees against the Unified Canonical
Taxonomy spec. Outcome is a `Current → Target` mapping only. **No runtime
behavior is changed in this phase.**

## ID scheme (target)

Three-layer model (from the source-of-truth decision):

```text
Canonical Concept (conceptId, stable, path-independent)
        +
Taxonomy Placement (placementId, parentId, context, order, wrapper)
        +
Questionnaire View (options, labels, breadcrumbs)
```

- **Category conceptId** = canonical slug (`jeans`, `trousers`, `cargo`, `blazers`, `handbags`, ...).
- **Style/fit conceptId** = `styles.ts` registry id (`skinny`, `wide_leg`, `slim_fit`, ...).
- **Placement id** = conceptId scoped by its structural location (e.g. `kids-bottoms-cargo`).
- A concept may have **multiple placements** across contexts; identity is never derived from `label`.

## Legend

| Status | Meaning |
| --- | --- |
| `KEEP` | Exists, correct, product-bound or referenced → keep as-is |
| `ADD` | Exists in spec, absent today → create |
| `MERGE` | Several per-gender/duplicate nodes → one concept, multiple placements |
| `RENAME` | Same concept, label drifts across contexts → label harmonized, id preserved |
| `DEPRECATE` | Duplicate / dead → remove after alias |
| `MISSING` | Whole concept/domain absent |
| `DUPLICATE` | Same concept twice within a context |

---

## A. CLOTHING

### A1. Tops

| conceptId | Current placements | Status | Target |
| --- | --- | --- | --- |
| `shirts` | MEN `mens_tops_shirts` (Shirts); WOMEN `womens_tops_shirts_and_blouses` (Shirts\|Blouses); KIDS `kids_tops_shirts_and_blouses` | MERGE / RENAME | one concept; placements keep context structure |
| `dress-shirts` | MEN `..._shirts_dress_shirts` | KEEP | structural placement under `shirts` (MEN) |
| `casual-shirts` | MEN `..._shirts_casual_shirts` | KEEP | structural placement under `shirts` (MEN) |
| `button-down-shirts` | WOMEN `..._shirts_and_blouses_buttondown_shirts` | KEEP | placement under `shirts` (WOMEN) |
| `blouses` | WOMEN `..._blouses`; KIDS `kids_tops_shirts_and_blouses` (Blouses) | KEEP | concept; placements per context |
| `t-shirts` | MEN `..._basic_tshirts`; WOMEN `..._basic_tshirts`; KIDS `graphic_tees` | MERGE | one concept; KIDS placement differs |
| `polos` | MEN `..._polo_shirts`; KIDS `..._polo_shirts` | MERGE | one concept |
| `tank-tops` | MEN `..._tank_tops_and_sleeveless`; WOMEN `..._tank_tops_and_camisoles` | MERGE / RENAME | one concept; WOMEN sub-styles become placements |
| `camisoles` | WOMEN `..._camisoles` styles (bandeau, camisole, tube, longline) | RENAME | fold into `tank-tops` styles or promote `camisoles` concept |
| `sweaters` | MEN/WOMEN `..._pullovers`; KIDS `kids_tops_knitwear` (Sweaters) | MERGE / RENAME | concept `sweaters`; "Pullovers"/"Knitwear" are placements |
| `cardigans` | MEN/WOMEN `..._cardigans`; KIDS none | KEEP | concept; KIDS placement optional |
| `sweatshirts` | MEN `..._sweatshirts`; WOMEN/KIDS `..._sweatshirts_and_hoodies` | MERGE | one concept (currently fused with hoodies in 2 contexts) |
| `hoodies` | MEN `..._hoodies`; WOMEN/KIDS `..._sweatshirts_and_hoodies` | MERGE | one concept (currently fused) |
| `bodysuits` | MEN `mens_tops_bodysuits`; WOMEN `..._corsets_and_bodysuits`; KIDS `..._baby_bodysuits` | MERGE | one concept; KIDS placement is baby-scoped |
| `sports-tops` | MEN `..._performance_tops`; WOMEN `..._yoga_and_studio_tops`; KIDS `..._sports_tops` | MERGE / RENAME | concept `sports-tops` (Activewear domain) |
| `sports-bras` | WOMEN nested under `..._yoga_and_studio_tops` | RENAME | promote to Activewear concept; remove nesting under Tops |

### A2. Bottoms

| conceptId | Current placements | Status | Target |
| --- | --- | --- | --- |
| `jeans` | MEN/WOMEN `..._jeans`; KIDS `..._jeans_and_pants_jeans` | MERGE | one concept; KIDS placement under Kids |
| `trousers` | MEN `..._trousers_and_pants` + `..._dress_pants`; WOMEN `..._tailored_trousers`; KIDS `..._jeans_and_pants` | MERGE / RENAME | concept; "Dress Pants"/"Tailored Trousers" are placements |
| `chinos` | MEN/WOMEN `..._chinos`; KIDS `..._chinos_and_cargos` | MERGE | one concept |
| `cargo` | MEN **twice** (`..._trousers_and_pants_cargo_pants` + `mens_bottoms_cargo_pants`); KIDS `..._chinos_and_cargos` | MERGE + DEPRECATE | one concept; delete duplicate MEN node |
| `joggers` | MEN `..._joggers_and_sweatpants`; WOMEN `..._joggers_and_sweatpants`; KIDS `..._joggers_and_sweatpants` | MERGE / RENAME | one concept; style sets differ per context (labels diverge) |
| `shorts` | MEN/WOMEN/KIDS `..._shorts` | MERGE | one concept |
| `skirts` | WOMEN `..._skirts`; KIDS `..._skirts` | MERGE | one concept |
| `skort` | KIDS `..._skirts_skort` | KEEP | Kids structural placement |
| `leggings` | WOMEN `..._leggings_and_jeggings` **and** `..._yoga_and_studio_bottoms`; KIDS `..._leggings` | MERGE + DEPRECATE | one concept; collapse duplicate WOMEN placements |
| `swimwear` | MEN `..._swim_trunks`; WOMEN `womens_swimwear_swimwear`; KIDS `kids_swimwear_swimwear` | MERGE / RENAME | one concept under Swimwear domain |
| `performance-bottoms` | MEN `..._performance_bottoms`; WOMEN `..._yoga_and_studio_bottoms`; KIDS (none, in `tracksuits`) | MERGE / RENAME | concept `track-pants` / `activewear-bottoms` |

### A3. One-Pieces

| conceptId | Current placements | Status | Target |
| --- | --- | --- | --- |
| `dresses` | WOMEN `..._dresses`; KIDS `kids_onepieces_kids_dresses` | MERGE | one concept; KIDS placement |
| `jumpsuits` | MEN `..._jumpsuits_and_overalls`; WOMEN `..._jumpsuits_and_rompers`; KIDS `..._overalls_and_jumpsuits` | MERGE | one concept |
| `rompers` | WOMEN `..._rompers` | KEEP | concept |
| `overalls` | MEN `..._overalls_dungarees`; KIDS `..._dungarees` | MERGE | concept `overalls`/`dungarees` |
| `suits` | MEN `..._suits` | KEEP | concept (MEN placement); WOMEN suits MISSING |
| `tuxedos` | MEN `..._tuxedos` | KEEP | concept |
| `blazers` | MEN `..._blazers_and_sport_coats`; WOMEN under `womens_outerwear_jackets` (mapTo Blazers) | MERGE + structural divergence | concept `blazers`; **placement differs by context** (see registry) |
| `infants` | KIDS `kids_onepieces_infants` | RENAME | belongs to Baby domain |

### A4. Outerwear

| conceptId | Current placements | Status | Target |
| --- | --- | --- | --- |
| `jackets` | MEN/WOMEN `..._jackets`; KIDS `..._jackets_and_coats` | MERGE | one concept; KIDS fuses with coats |
| `coats` | MEN/WOMEN `..._coats`; KIDS `..._jackets_and_coats` | MERGE | one concept |
| `parkas` | MEN/WOMEN/KIDS inside `coats` | KEEP | concept placement under `coats` |
| `puffer-jackets` | MEN/WOMEN/KIDS inside `coats` | KEEP / RENAME | concept; label vs `puffer-coats` drift |
| `vests` | MEN/WOMEN/KIDS `..._vests` | MERGE | one concept |
| `tracksuits` | MEN/WOMEN/KIDS `..._tracksuits` | MERGE | Activewear concept |

### A5. Underwear & Sleepwear

| conceptId | Current placements | Status | Target |
| --- | --- | --- | --- |
| `underwear` | MEN/WOMEN/KIDS `..._underwear` | MERGE | one concept |
| `sleepwear` | MEN/WOMEN/KIDS `..._sleepwear` | MERGE | one concept |
| `socks` | MEN/WOMEN/KIDS `..._socks` | MERGE | one concept |
| `bras` | WOMEN `..._bras` | KEEP | concept |
| `shapewear` | WOMEN `..._shapewear` | KEEP | concept |
| `loungewear` | — | MISSING | ADD |

### A6. Activewear / A7. Swimwear

| conceptId | Status | Notes |
| --- | --- | --- |
| Activewear domain | MISSING (first-class) | currently only `crossTags=["activewear"]` across Tops/Bottoms/Outerwear; spec wants a coherent domain |
| `swimwear` | partial | MEN `swim_trunks`, WOMEN `swimwear`, KIDS `swimwear`; `rash-guards` exists MEN only |

---

## B. FOOTWEAR

| conceptId | Current placements | Status | Target |
| --- | --- | --- | --- |
| `sneakers` | MEN `casual_and_sneakers`; WOMEN `flats_and_sneakers`; KIDS `everyday_shoes` | MERGE / RENAME | concept; split fused nodes |
| `running-trainers` | MEN `..._running_shoes`; KIDS `..._runners` | MERGE | distinct concept from `sneakers` |
| `boots` | MEN `..._boots` + `chelsea_boots` under Dress Shoes; WOMEN `..._boots` + `heeled_boots` under Heels; KIDS `..._boots_and_sandals` | MERGE + RENAME | concept `boots`; move mis-placed boots out |
| `sandals` | MEN `..._sandals_and_slides`; WOMEN `..._sandals_and_mules`; KIDS `..._boots_and_sandals` | MERGE / RENAME | concept; split `slides` / `mules` |
| `heels` | WOMEN `..._heels` | KEEP | concept |
| `flats` | WOMEN `..._ballerinas` | RENAME | concept `flats` |
| `loafers` | MEN under Dress Shoes; WOMEN `..._loafers` | MERGE | concept; move MEN loafer out of Dress Shoes |
| `formal-shoes` | MEN `dress_shoes`; KIDS `formal_shoes` | RENAME | concept `formal-shoes` (or keep `dress-shoes`) |

---

## C. BAGS & LEATHER GOODS

Only WOMEN has a Bags root today; MEN has none, KIDS only `backpacks`.

| conceptId | Current placement | Status | Target |
| --- | --- | --- | --- |
| `handbags` | WOMEN `womens_bags_handbags` | KEEP | concept, contexts [MEN?, WOMEN, UNISEX] per applicability |
| `backpacks` | WOMEN `womens_bags_backpacks`; KIDS `kids_accessories_backpacks` | MERGE | concept; add MEN |
| `shoulder-bags` | WOMEN `..._shoulder_and_crossbody_bags` (fused) | RENAME | split `shoulder-bags` |
| `crossbody-bags` | same fused node | RENAME | split `crossbody-bags` |
| `tote-bags` | WOMEN `..._tote_bags` | KEEP | concept |
| `wallets` | WOMEN `..._wallets` | KEEP | concept |
| `clutches` | — | MISSING | ADD |
| `slings` | — | MISSING | ADD |
| `cardholders` | — | MISSING | ADD |
| `duffels` | `duffle-travel-bags` (migrationMap empty) | MISSING | ADD |
| `travel-bags` | — | MISSING | ADD |
| `messenger-bags` | — | MISSING | ADD |
| `briefcases` | — | MISSING | ADD |
| `work-bags` | — | MISSING | ADD |
| `laptop-bags` | — | MISSING | ADD |
| `school-bags` | — | MISSING | ADD |
| `tech-pouches` | — | MISSING | ADD |
| `travel-organizers` | — | MISSING | ADD |
| `luggage` | — | MISSING | ADD |
| `bum-bags` | `bum-bags` (migrationMap empty) | MISSING | ADD |

---

## D. KIDS

Kids today uses a **separate simplified tree** (`KIDS_SPECS`) with wrappers
(`kids_bottoms_jeans_and_pants`, `kids_tops_knitwear`, ...) and fused nodes
(`chinos_and_cargos`, `jackets_and_coats`, `boots_and_sandals`, `sweatshirts_and_hoodies`).

Status: **MERGE into canonical concepts** with `contexts:["KIDS"]` + `age` metadata.
Deliberate Kids wrappers are preserved as **structural placements** (see registry).

| Issue | Status |
| --- | --- |
| Kids reuses canonical concept ids (`jeans`, `chinos`, `cargo`, `sweatshirts`, ...) | MERGE |
| Kids-only wrappers (`kids-clothing`, `kids-bottoms-jeans-and-pants`) | KEEP as structural placements |
| Kids fused concepts (`chinos_and_cargos`, `jackets_and_coats`, `boots_and_sandals`, `sweatshirts_and_hoodies`) | SPLIT concept / keep placement |
| Kids Activewear (`sports-shorts`, `track-pants` separate) | MISSING |
| Kids Bags (beyond backpack) | MISSING |

---

## E. BABY & FAMILY UTILITY

Entirely absent.

| conceptId | Status |
| --- | --- |
| `diaper-bags` | MISSING |
| `changing-mat-bags` | MISSING |
| `stroller-organizers` | MISSING |
| `bottle-bags` | MISSING |
| `nursing-covers` | MISSING |
| `baby-carry-accessories` | MISSING |

Contexts: `["PARENT","BABY"]`.

---

## F. TRADITIONAL & CULTURAL

Entirely absent.

| conceptId | Status |
| --- | --- |
| `thobe` / `kandura` / `dishdasha` | MISSING |
| `bisht` / `abaya` | MISSING |
| `kaftan` / `caftan` | MISSING |
| `sari` / `kurta` / `shalwar-kameez` | MISSING |
| `kimono` / `hanbok` / `ao-dai` | MISSING |

---

## G. DUPLICATES (must resolve)

| # | Duplicate | Action |
| --- | --- | --- |
| D1 | MEN `mens_bottoms_trousers_and_pants_cargo_pants` vs `mens_bottoms_cargo_pants` (identical) | DEPRECATE one, alias to `cargo` |
| D2 | WOMEN `..._leggings_and_jeggings` vs `..._yoga_and_studio_bottoms` (both `Leggings`) | MERGE into `leggings` |
| D3 | WOMEN `Sports Bras` nested under Tops | MOVE to Activewear |
| D4 | `sweatshirts`+`hoodies` fused in WOMEN/KIDS | SPLIT concepts, keep placement |
| D5 | `flats`+`sneakers`+`loafers` fused in WOMEN `flats_and_sneakers` | SPLIT concepts |
| D6 | `boots`+`sandals` fused in KIDS `boots_and_sandals` | SPLIT concepts |
| D7 | `chinos`+`cargo` fused in KIDS `chinos_and_cargos` | SPLIT concepts |
| D8 | `trousers`+`chinos`+`cargo` fused in KIDS `jeans_and_pants` wrapper | KEEP wrapper, split leaves |
| D9 | `shoulder`+`crossbody` fused in WOMEN | SPLIT concepts |
| D10 | MEN `Parachute Pants` maps `Trousers` (overlap) | review placement |

## H. Structural Divergence Registry (explicit, must not be auto-normalized)

```ts
const STRUCTURAL_DIVERGENCES = [
  { id: "kids-clothing-wrapper",   context: "KIDS",  type: "wrapper" },
  { id: "kids-bottoms-wrapper",    context: "KIDS",  type: "wrapper" },
  { id: "blazer-placement",        contexts: ["MEN","WOMEN"], type: "contextual-placement" },
  { id: "kids-chinos-cargo",       context: "KIDS",  type: "contextual-placement" },
  { id: "women-sportsbras-under-tops", context: "WOMEN", type: "misplacement-to-fix" },
];
```

---

## I. Summary counts

| Status | Count (approx., concept-level) |
| --- | --- |
| KEEP | ~55 category concepts |
| MERGE | ~40 concepts across 3 contexts |
| RENAME | ~12 label drifts |
| DEPRECATE | 2 duplicate nodes (D1, D2) |
| SPLIT | 6 fused concepts (D4–D9) |
| MISSING domains | 3 (Baby & Family Utility, Traditional & Cultural, first-class Activewear) |
| MISSING concepts | ~25 (mostly Bags/Luggage + Traditional + Baby) |

## Gate 1

**PENDING REVIEW** — a clear `Current → Target` mapping exists. No code
changed. Proceeding to Phase 2 (ID freeze) does not alter behavior.
