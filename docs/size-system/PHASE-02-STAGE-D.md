# Size System — Phase 2 / Stage D — System-Resolution Policy & Canonical Projection

Additive, read-only, migration-free. Stage D does **not** persist canonical sizes.
It adds a provenance-aware system-resolution policy and a pure canonical projection
on top of Stage B/C.

Core principle preserved: **explicit source info, deterministic normalization,
approved inference, and genuine unknown are four distinct states** and are never
collapsed into one apparently clean canonical value.

See `PHASE-02-STAGE-D-AUDIT.md` for the source trace.

## 1. Source metadata audit

The 159 Stage C unresolved observations are all legacy `ProductVariant → Size` rows
from **`Livostyle Open Catalog`**, footwear categories, bare numeric sizes
(`5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 10, 11`). The source `options.Size` is a bare
string with no system; `livostyle.normalizeSize` deliberately marks it `UNKNOWN`
(no guessing). `sync.ts` stores `Size.system = UNKNOWN` because the variant-level
`"UNKNOWN"` string short-circuits its `??` fallback.

## 2. Exact location where `sizeSystem` is lost/absent

- **Source:** `data/products.json` `variant.options.Size` — no system field.
- **Adapter:** `providers/livostyle.ts:135-189` — Group 2 bare numerics return
  `system: "UNKNOWN"` on purpose; `providers/types.ts:8-12` documents the same.
- **Store:** `providers/sync.ts:161-165` — `variant.sizeSystem ?? product.sizeSystem`
  never falls through because `variant.sizeSystem === "UNKNOWN"`.
- Not a discarded field and not a throwaway; genuinely absent from the source.

## 3. Recoverable metadata

Measured on the live catalog:

```
unresolved with a recoverable stored system: 0
```

So **0 of 159** can be recovered from existing source metadata. The only route is a
source-specific inference policy (below), which the adapter intentionally avoided.

## 4. EXPLICIT vs INFERRED vs UNRESOLVED

`src/lib/size-domain/system-resolution.ts` defines
`SystemResolutionProvenance = "EXPLICIT" | "INFERRED" | "UNRESOLVED"` and attaches
it to every `CanonicalSizeProjection`:

- **EXPLICIT** — the system came from stored metadata **or** was named in the source
  label (`"US 8"`), which Stage B resolves. Stage D never parses labels itself.
- **INFERRED** — an approved, source-specific policy supplied the system. Always
  carries the `policyId`; never indistinguishable from EXPLICIT.
- **UNRESOLVED** — no trustworthy system; the Stage B result is left unchanged.

## 5. Inference policy

- `APPROVED_SIZE_SYSTEM_POLICIES = []` — **empty by default; no inference happens.**
- `SIZE_SYSTEM_POLICY_CANDIDATES` holds exactly one **unapproved** candidate,
  `livostyle-womens-shoes-us` (FOOTWEAR, WOMEN → US), justified only by
  circumstantial evidence (US retailer, USD, the dead `sizeSystem:"US"` adapter line).
- A policy is valid only when it names a source (id or name) **and** a product type;
  audience is optional. Inference never triggers on a numeric range.
- Policies are deterministic, reviewable, and reversible: approving means adding to
  the approved list; reverting means removing it.

## 6. Canonical projection design

`projectProductSizes(observations, policies?) → CanonicalSizeProjection[]`.
Authority order: (1) Stage B already resolved → EXPLICIT; (2) unresolved for a
missing system + a matching approved policy → re-normalize with the inferred system
→ INFERRED; (3) otherwise → UNRESOLVED.

The projection carries: verbatim `sourceSizeLabel`; `canonicalSizeOptionId` (the
existing Stage A/B wire identity — **no second `canonicalSizeId` is introduced**);
`canonicalValue`, `displayLabel`, `category`, `audience`, `productType`, `system`,
`systemPersisted`, `status`, `reason`, `systemResolution`, `policyId`, and verbatim
`availability`/`available`. `summarizeSizeProjections` counts
`explicit / inferred / unresolved / inferredResolved`.

## 7. Unsupported / non-persisted systems

`JP`, `BRA`, `ONE_SIZE` resolve to their own systems and are flagged
`systemPersisted: false`. Nothing coerces `JP→US`, `BRA→EU`, or `ONE_SIZE→M`
(Stage D tests assert this). Free-text systems that are not registered remain
`UNRESOLVED`; a policy may only name a registered `SizeSystemId`.

## 8. `ageRange` limitation

There is no real age field in the repository. Stage D does **not** invent one from
category/product names, marketing text, gender, or taxonomy placement. The
projection has no `ageRange` field, and age-like labels (e.g. `24M`) are not turned
into fabricated ranges. If canonical sizing ever needs age range, it is a
**data-acquisition problem**: the value must come from a source that actually
publishes it (or an explicit, reviewed derivation over a real attribute), not from
normalization.

## 9. Analysis of the 159 unresolved observations

```
159 unresolved before Stage D

source metadata recoverable:            0   (no stored system on any row)
source-specific inference candidates:  159  (Livostyle WOMEN FOOTWEAR -> US)
genuinely unresolved:                  159  (approved registry is empty)

APPROVED registry (empty):  explicit 3818 | inferred 0   | unresolved 159
CANDIDATE simulation:       explicit 3818 | inferred 159 | unresolved 0
```

The candidate simulation is illustrative only; production keeps all 159 unresolved
until the policy is explicitly approved. A higher percentage is not a success
criterion on its own.

## 10. Test results

`scripts/size-domain-stage-d.test.mts` — **24/24**, covering: explicit US/EU/JP/alpha;
label-encoded `US 8` (EXPLICIT, not INFERRED); the bare `5.5..11` set staying
unresolved under the empty registry; source-specific inference matching / wrong
source / wrong product type / missing context / determinism; registry safety (empty
approved set, unapproved candidate, invalid policy); non-persisted systems
(JP/BRA/ONE_SIZE); no fabricated age range; and `EXPLICIT ≠ INFERRED ≠ UNRESOLVED`.

## 11. Recommended persistence requirements for the next stage

Do not persist yet. Before Stage E can store a canonical size it needs:

1. **An explicit decision** on the `livostyle-womens-shoes-us` candidate (approve or
   reject), so inferred values carry a definitive provenance.
2. A canonical-size projection target that stores `audience`, `productType`,
   `system`, `canonicalSizeOptionId`, and the provenance (`EXPLICIT`/`INFERRED` +
   `policyId`) — never a bare canonical value.
3. A migration path that keeps **non-persisted systems** representable (JP/BRA/
   ONE_SIZE) rather than coercing them into the persisted enum.
4. Source-side capture of `sizeSystem` at the adapter boundary as the preferred
   long-term fix, so inference stays a fallback.
5. A separate, unrelated data-acquisition plan for `ageRange` if needed.

## Verification

- `npm run test:size-domain` → 22/22
- `npm run test:size-domain-normalize` → 42/42
- `npm run test:size-domain-product-integration` → 26/26
- `npm run test:size-domain-stage-d` → 24/24
- `npm run typecheck` → clean
- `npm run build` → PASS
- Regressions: size-identity 30/30, size-sections 9/9, size-groups 9/9,
  taxonomy-ids 15/15, questionnaire 32/32, taxonomy 83/87 (4 known baseline
  failures unchanged).
- `test:search` requires a live dev server (`localhost:3000`) and is unavailable in
  this environment; reported as-is, not faked.

No aggregate `test` script exists in this repository.
