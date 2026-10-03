# Size System — Phase 2 / Stage D — Missing `sizeSystem` Source Audit

Read-only trace of the 159 Stage C unresolved observations back to their source.
No code or schema change here.

## Where the 159 come from (measured)

```
total observations: 3977
unresolved:          159
by source:  [["Livostyle Open Catalog", 159]]
by origin:  [["variant", 159]]          # legacy ProductVariant -> Size
by reason:  [["INSUFFICIENT_CONTEXT", 159]]
raw labels: 7(21) 8(21) 9(21) 10(21) 6(18) 6.5(17) 7.5(17) 8.5(17) 11(4) 5.5(2)
categories: Heels, Sandals, Loafers, Boots, Sneakers (all footwear)
unresolved with a recoverable stored system: 0
```

## Full trace

```
raw data/products.json
  variant.options.Size = "7.5"        # bare numeric, no system anywhere
        │
        ▼
src/lib/providers/livostyle.ts  normalizeSize()   (:135-189)
  - Group 1 "36(US5)"  -> [{value:"36",system:"EU"},{value:"5",system:"US"}]  (explicit, resolves)
  - Group 2 bare "7.5" -> [{value:"7.5",system:"UNKNOWN"}]                    (deliberate, no guess)
        │
        ▼  buildVariants() (:238-279):  sizeSystem = sz.system = "UNKNOWN"
providers/sync.ts  sizeIdOf()  (:68-95)
  system = variant.sizeSystem ?? product.sizeSystem ?? "INTERNATIONAL"
  # variant.sizeSystem is the STRING "UNKNOWN", so ?? never falls through
  # to product.sizeSystem; Size.system is stored as UNKNOWN
        │
        ▼
Size.system = UNKNOWN, Size.productType = UNKNOWN, Size.audience = UNKNOWN
        │
        ▼
Stage C integrate-product.ts: stored "UNKNOWN" -> context.system = null
        │
        ▼
Stage B normalize.ts: numeric + system == null -> INSUFFICIENT_CONTEXT
```

## Answers to the audit questions

| Question | Answer |
| --- | --- |
| Does the original source contain size-system info? | **No.** `options.Size` is a bare string; there is no `size_system` field on the variant or product. |
| Does the source page/API provide it? | **No** for these rows. Shopify option values are just "6", "7.5". |
| Available in a parent product field? | **No real system.** `livostyle.ts:359` sets an adapter-level `sizeSystem: "US"` for shoes, but this is a hardcoded assumption, not source data. |
| Encoded in a label such as `US 8`? | Only Group 1 (`36(US5)`) carries systems explicitly; those already resolve. The 159 are Group 2 bare numerics. |
| Present in structured variant metadata? | **No.** |
| Present in source-specific attributes? | **No.** |
| Discarded by an existing adapter? | **No.** `normalizeSize` deliberately marks bare numerics `UNKNOWN` (comment `:179-181`) rather than guessing. |
| Genuinely absent from the source? | **Yes.** |

## The latent inconsistency (documented, not silently fixed)

`livostyle.ts:359` writes a product-level `sizeSystem: "US"` for all shoes, while
`livostyle.ts:129-133` says bare numerics "carry no label in source, so they never
become US or EU via inference or range heuristics". The `??` in `sync.ts:161-165`
means the variant-level `"UNKNOWN"` always wins, so the product-level `"US"` is
**dead for bare numerics**. Two contradictory intentions live in the repository.
Stage D does not pick a winner by fiat; it records both and leaves the decision to
an explicit policy approval.

## Source evidence for a policy candidate

The source README (`arturayupov/womens-fashion-catalog-open-data`) states:
- US DTC retailer, Arcada LLC, New Mexico; primary currency USD.
- "Size range: XS–XL (some XXL)" for apparel.

It **never states a shoe sizing system**. So the evidence is circumstantial
(US market + USD + the existing `sizeSystem: "US"` adapter line), not a documented
sizing declaration. This justifies a **source-specific policy candidate**, not a
silently applied rule.

## Candidate policy (NOT approved)

```
id:            livostyle-womens-shoes-us
source:        Livostyle Open Catalog
product type:  FOOTWEAR
audience:      WOMEN
system:        US
status:        CANDIDATE — left unapproved in
               SIZE_SYSTEM_POLICY_CANDIDATES
```

Classification of the 159:

- **Recoverable from existing source metadata: 0** (no stored system on any row).
- **Recoverable by the candidate policy: 159** (simulation only — see below).
- **Genuinely unresolved under the current approved registry (empty): 159.**

Simulated with the candidate policy applied (does **not** change production):

```
APPROVED registry (empty):  explicit 3818 | inferred 0   | unresolved 159
CANDIDATE simulation:       explicit 3818 | inferred 159 | unresolved 0
```

The 159 remain unresolved in production until a policy is explicitly approved.
