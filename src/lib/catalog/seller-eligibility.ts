/* Seller trust / eligibility engine (Phase 1 - eBay seller gating).

   DECISION RULE (the whole point of this module):
     - eBay Browse API does NOT return any field that proves a seller is
       an Official Brand Store or an Authorized/Verified retailer. The
       only seller signals it exposes are username, feedbackPercentage,
       feedbackScore (all present on EBAY_US), and sellerAccountType
       (BUSINESS|INDIVIDUAL) which is returned ONLY on EU marketplaces
       (EBAY_AT/BE/CH/DE/ES/FR/GB/IE/IT/PL) and even then only records
       business-vs-individual REGISTRATION - NOT brand-official status.
     - Therefore trust is decided EXCLUSIVELY by a curated registry
       (human-verified evidence). UNKNOWN (not in the registry) is NEVER
       accepted. High feedback, high score, PowerSeller-style volume, or
       a business account type are quality signals only - they can never
       upgrade a seller to OFFICIAL / AUTHORIZED_RETAIL / ELIGIBLE_RETAIL.

   Determinism: the classifier is a PURE function of the registry + the
   seller username. Feedback fields are accepted (for diagnostics) but
   never influence the trust verdict.

   Verdict set (`SellerTrust`):
     OFFICIAL            - known, verified official brand store (registry)
     AUTHORIZED_RETAIL   - known, verified authorized retailer (registry)
     ELIGIBLE_RETAIL     - known, verified established/eligible retail (registry)
     UNKNOWN             - seller missing or not in the verified registry
     INDEPENDENT         - explicitly classified independent/individual (registry)
   Only OFFICIAL / AUTHORIZED_RETAIL / ELIGIBLE_RETAIL are importable.
   UNKNOWN and INDEPENDENT must never create a Product or ProductOffer.

   The registry is intentionally an injected interface (not a hard-coded
   list): a future `EbaySellerRegistry` table can back it without changing
   this classifier. No seller is placed in a registry without documented
   verification - we never guess a seller is official because of a name.
*/

export const SELLER_TRUST_LEVELS = [
  "OFFICIAL",
  "AUTHORIZED_RETAIL",
  "ELIGIBLE_RETAIL",
  "UNKNOWN",
  "INDEPENDENT",
] as const;

export type SellerTrust = (typeof SELLER_TRUST_LEVELS)[number];

/* A verified seller entry in the trust registry. `sellerType` is the
   evidence-backed classification a human curator recorded after
   verifying the seller is actually the brand / an authorized partner.
   OFFICIAL and AUTHORIZED_RETAIL/ELIGIBLE_RETAIL must never be inferred
   from the API; they only exist here. */
export type SellerRegistryEntry = {
  sellerUsername: string;
  /* canonical brand this seller is verified against (for an official
     brand store, the brand whose store it is); optional scope */
  brand?: string | null;
  sellerType: "OFFICIAL" | "AUTHORIZED_RETAIL" | "ELIGIBLE_RETAIL" | "INDEPENDENT";
  verified: true;
};

/* Where a curator keeps verified sellers. Injected so tests and a
   future DB table can back it; never a hard-coded list inside the
   classifier. */
export type SellerTrustRegistry = {
  /* Normalized (case-folded) username -> verified entry, or null when
     there is no recorded/verified entry for that seller. */
  lookup: (username: string) => SellerRegistryEntry | null;
};

export type SellerEligibilityInput = {
  /* case is folded by the classifier; null/empty = no seller signal */
  sellerUsername: string | null;
  /* quality signals - ACCEPTED for diagnostics, NEVER a decision factor */
  feedbackScore?: number | null;
  feedbackPercentage?: string | null;
};

export type SellerEligibilityVerdict = {
  trust: SellerTrust;
  /* true only for OFFICIAL / AUTHORIZED_RETAIL / ELIGIBLE_RETAIL */
  eligible: boolean;
  /* a stable quarantine reason code when not eligible ("" when eligible) */
  reason: string;
  /* detail line (seller username / trust) for diagnostics, never a secret */
  detail: string;
};

export const SELLER_ELIGIBLE_TRUSTS: ReadonlySet<SellerTrust> =
  new Set<SellerTrust>(["OFFICIAL", "AUTHORIZED_RETAIL", "ELIGIBLE_RETAIL"]);

export function sellerTrustEligible(trust: SellerTrust): boolean {
  return SELLER_ELIGIBLE_TRUSTS.has(trust);
}

/* Normalize a seller username for registry lookup (case-insensitive,
   trimmed, collapsed whitespace). eBay usernames are case-insensitive. */
export function normalizeSellerUsername(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/* The pure, deterministic classifier. `registry.lookup` resolves a
   normalized username; the result decides the verdict. Feedback fields
   are accepted but ignored for the trust decision on purpose. */
export function classifySeller(
  input: SellerEligibilityInput,
  registry: SellerTrustRegistry
): SellerEligibilityVerdict {
  const username = normalizeSellerUsername(input.sellerUsername);

  if (!username) {
    return {
      trust: "UNKNOWN",
      eligible: false,
      reason: "UNKNOWN_SELLER",
      detail: "missing seller info",
    };
  }

  const entry = registry.lookup(username);
  if (!entry) {
    return {
      trust: "UNKNOWN",
      eligible: false,
      reason: "SELLER_NOT_VERIFIED",
      detail: `'${username}' not in verified seller registry`,
    };
  }

  if (entry.sellerType === "INDEPENDENT") {
    return {
      trust: "INDEPENDENT",
      eligible: false,
      reason: "INDEPENDENT_SELLER",
      detail: `'${username}' classified as an independent/individual seller`,
    };
  }

  /* entry.sellerType is OFFICIAL | AUTHORIZED_RETAIL | ELIGIBLE_RETAIL */
  return {
    trust: entry.sellerType,
    eligible: true,
    reason: "",
    detail: `'${username}' verified as ${entry.sellerType}`,
  };
}

/* ---- Quality signals (DIAGNOSTICS ONLY - never a decision factor) ----
   The Browse API quality-ish signals we CAN read (feedback score /
   percentage) and an explicit note that none of these can upgrade a
   seller's trust. Kept separate so it is obvious they do not feed the
   classifier. */
export type SellerQualitySignals = {
  feedbackScore: number | null;
  feedbackPercentage: number | null;
  /* business-registration type from the API when available (EU markets
     only); NEVER returned on EBAY_US. Not a trust verdict by itself. */
  sellerAccountType: "BUSINESS" | "INDIVIDUAL" | null;
};

export const SELLER_QUALITY_NOTE =
  "feedback / score / business-account-type are quality signals only; " +
  "they can NEVER prove OFFICIAL / AUTHORIZED / VERIFIED retail status.";

/* Build an in-memory registry from a list of verified entries. Usernames
   are normalized (case-folded). The `verified` flag is forced true - these
   are entries a curator has ALREADY signed off on. No inference happens
   here; this just makes the injected-interface pattern usable offline. */
export function createMemorySellerRegistry(
  entries: ReadonlyArray<Omit<SellerRegistryEntry, "verified">>
): SellerTrustRegistry {
  const byUsername = new Map<string, SellerRegistryEntry>();
  for (const e of entries) {
    const key = normalizeSellerUsername(e.sellerUsername);
    byUsername.set(key, { ...e, sellerUsername: key, verified: true });
  }
  return {
    lookup: (username) => byUsername.get(normalizeSellerUsername(username)) ?? null,
  };
}

/* The honest default: NO seller is verified yet. Importing against this
   registry classifies every seller as UNKNOWN and accepts nothing - the
   correct behavior until sellers are documented and registered. */
export const EMPTY_SELLER_REGISTRY: SellerTrustRegistry = createMemorySellerRegistry([]);

/* =====================================================================
   FINALIZED Seller Decision Model (Phase 2)
   ---------------------------------------------------------------------
   Builds on (does NOT replace) the Phase 1 registry above. Adds:
     - a single, explicit decision set: VERIFIED / TRUSTED_HIGH /
       TRUSTED / LOW_TRUST / REJECTED / UNKNOWN
     - per-BRAND scope (a seller can be verified/trusted for one brand
       without being trusted for another)
     - a deterministic, explainable Trust Score for non-verified sellers
     - an explicit REJECTED state for clear counterfeit/fraud signals

   Priority resolution (highest wins):
     VERIFIED  -> honored as-is for its scoped brand
     REJECTED  -> rejected regardless of score
     TRUSTED   -> scored deterministically from curated registry inputs
     UNKNOWN   -> no registry profile (never importable)

   Verification NEVER comes from the API or from a store name/self-claim.
   It is curated here. Trust inputs are registry data (manually updatable),
   never pulled live during import; missing values are never invented.
   ===================================================================== */

export const SELLER_DECISIONS = [
  "VERIFIED",
  "CURATED_TRUSTED",
  "TRUSTED_HIGH",
  "TRUSTED",
  "LOW_TRUST",
  "REJECTED",
  "UNKNOWN",
] as const;
export type SellerDecision = (typeof SELLER_DECISIONS)[number];

/* Curated trust inputs for a NON-verified (scored) seller. All fields are
   registry data recorded by a curator - they are NOT fetched live during
   import. A null field simply contributes nothing to the score (we never
   invent a value). Kept separated so scoring is deterministic + testable. */
export type SellerTrustInputs = {
  /* positive feedback percentage (0-100); component weight 30 */
  feedbackPercentage?: number | null;
  /* number of feedback ratings; component weight 25 */
  feedbackCount?: number | null;
  /* number of sales / items sold; component weight 20 */
  salesCount?: number | null;
  /* account age in months; component weight 10 */
  accountAgeMonths?: number | null;
  /* activity volume within the TARGET brand (0-1); component weight 10 */
  brandActivity?: number | null;
  /* specialized/professional store for the brand; component weight 5 */
  specialized?: boolean | null;
};

/* A curated seller profile. `brand` is the SCOPE: the ONLY brand this
   profile's status/score applies to. null brand = applies to any brand
   (used only where a seller is genuinely universal). The same username
   may have multiple profiles (one per scoped brand). */
export type SellerProfile = {
  sellerUsername: string;
  /* scope brand; when set, this profile ONLY applies to that brand */
  brand?: string | null;
  /* OPTIONAL category scope: canonical category slugs (plan.slug values)
     this profile is PROVEN to cover for its scoped brand. Absent =
     legacy brand-scoped behavior (no category restriction). An empty
     array explicitly means "no category coverage". Only consulted when
     the requested category is inside ENFORCED_SELLER_CATEGORY_SCOPE -
     it is a NARROWING filter and can never widen a seller's eligibility,
     upgrade status, or change a trust score. */
  categories?: string[];
  status: "VERIFIED" | "CURATED_TRUSTED" | "REJECTED" | "TRUSTED";
  /* VERIFIED: no trust inputs required (official/authorized).
     CURATED_TRUSTED: explicit brand-scoped allowlist pick (best available
       non-Verified source); carries trustInputs + trustScore as a
       quantitative metric that ranks, but does NOT override, curation.
     TRUSTED: scored deterministically from trustInputs below.
     REJECTED: reasons must be recorded; score is ignored. */
  trustInputs?: SellerTrustInputs | null;
  /* deterministic trust score (0-100) attached for monitoring/ranking.
     For CURATED_TRUSTED this ranks the seller but does not gate import:
     a curated seller with a 67-79 score is STILL importable. */
  trustScore?: number | null;
  /* REJECTED reason (e.g. 'counterfeit/fraud signal'); echoed in detail */
  rejectReason?: string | null;
  /* documentation (evidence / rationale / source) - not used at runtime
     by the decision engine, kept for provenance/audit */
  evidence?: string | null;
  source?: string | null;
  confidence?: string | null;
};

/* The finalized, brand-aware registry. One username may map to several
   brand-scoped profiles. Passing `brand` context to the decision is what
   enforces scope (e.g. online_shoes -> Wolverine only). */
export type FinalSellerRegistry = {
  /* all profiles for a normalized username (may be several brands) */
  lookupProfiles: (username: string) => SellerProfile[];
};

export type SellerDecisionInput = {
  sellerUsername: string | null;
  /* canonical brand context (raw source brand is accepted lower-cased;
     the registry compares case-insensitively). Used ONLY to enforce
     per-brand scope - never to infer status. */
  brand?: string | null;
  /* canonical category slug context (plan.slug) for category-scope
     enforcement. Optional: when null/absent the verdict is exactly the
     legacy brand-scoped one. */
  category?: string | null;
};

export type SellerDecisionVerdict = {
  decision: SellerDecision;
  /* true only for importable decisions
     (VERIFIED / CURATED_TRUSTED / TRUSTED_HIGH / TRUSTED) */
  eligible: boolean;
  /* deterministic trust score (0-100) for scored sellers; null for
     VERIFIED / REJECTED / UNKNOWN */
  score: number | null;
  /* stable quarantine reason code when not eligible ("" when eligible) */
  reason: string;
  /* human detail for diagnostics; never a secret */
  detail: string;
};

/* Only these decisions are importable. CURATED_TRUSTED is importable even
   below the numeric trusted bar (explicit allowlist); LOW_TRUST is below
   the trusted bar for NON-curated sellers and is never imported; REJECTED
   and UNKNOWN are never imported. */
export const SELLER_ELIGIBLE_DECISIONS: ReadonlySet<SellerDecision> = new Set([
  "VERIFIED",
  "CURATED_TRUSTED",
  "TRUSTED_HIGH",
  "TRUSTED",
]);

export function sellerDecisionEligible(decision: SellerDecision): boolean {
  return SELLER_ELIGIBLE_DECISIONS.has(decision);
}

/* ---- Seller Category Scope (infrastructure) --------------------------
   Canonical category slugs (plan.slug values) that REQUIRE a seller
   profile to prove category scope before (seller, brand) alone can make
   its listings eligible.

   - Starts EMPTY: no category enforces scope yet, so every seller keeps
     today's exact brand-scoped behavior.
   - A profile proves scope via `categories` (canonical slugs).
   - Scope is a NARROWING filter only: it can never make an otherwise
     ineligible seller eligible, never upgrades status, never changes a
     trust score, and never crosses brand scope.
   - REJECTED remains the absolute veto regardless of categories.        */

const enforcedSellerCategoryScopes = new Set<string>();

/* Read-only view of the enforced category set (module state). */
export const ENFORCED_SELLER_CATEGORY_SCOPE: ReadonlySet<string> =
  enforcedSellerCategoryScopes;

/* Normalize a canonical category slug for scope matching. Slugs are the
   stable identity (plan.slug); this only folds case/whitespace. It never
   invents a slug from a display label ('Ties & Bow Ties' is NOT the slug
   'ties-bow-ties'). Returns null for empty input. */
export function normalizeCategorySlug(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = String(raw).replace(/\s+/g, " ").trim().toLowerCase();
  return key.length === 0 ? null : key;
}

/* True when the value is shaped like a canonical slug (lowercase words,
   hyphen-separated). Display labels/names are rejected so a scope key
   can never be spoofed with a human-readable label. */
const CANONICAL_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function isCanonicalCategorySlug(value: string | null | undefined): boolean {
  const key = normalizeCategorySlug(value);
  return key != null && CANONICAL_SLUG_PATTERN.test(key);
}

/* Register new category-scope enforcement (additive). Used by the future
   CATEGORY SCOPE EVIDENCE phase and by tests; ignored when a key does not
   normalize to a canonical slug. */
export function enforceSellerCategoryScopes(slugs: readonly string[]): void {
  for (const s of slugs) {
    const key = normalizeCategorySlug(s);
    if (key != null && isCanonicalCategorySlug(key)) enforcedSellerCategoryScopes.add(key);
  }
}

/* Clear enforcement (test/allocation helper only). */
export function clearEnforcedSellerCategoryScopes(): void {
  enforcedSellerCategoryScopes.clear();
}

/* ---- Deterministic Trust Score (max 100) ---------------------------
   Weights come from the approved policy. Each component reads a CURATED
   registry value; absent/null input contributes 0 (no invented values).
   A small account with perfect 100% feedback but little count/sales/age
   stays LOW, because it only earns the percentage component.          */

const SCORE_WEIGHTS = {
  feedbackPercentage: 30,
  feedbackCount: 25,
  salesCount: 20,
  accountAgeMonths: 10,
  brandActivity: 10,
  specialized: 5,
} as const;

export function componentScore(
  inputs: SellerTrustInputs
): Record<keyof typeof SCORE_WEIGHTS, number> {
  const parts = {
    feedbackPercentage: 0,
    feedbackCount: 0,
    salesCount: 0,
    accountAgeMonths: 0,
    brandActivity: 0,
    specialized: 0,
  };

  /* feedback % (30) */
  const pct = inputs.feedbackPercentage;
  if (pct != null) {
    parts.feedbackPercentage = pct >= 98 ? 30 : pct >= 95 ? 20 : pct >= 90 ? 10 : 0;
  }
  /* feedback count (25) */
  const cnt = inputs.feedbackCount;
  if (cnt != null) {
    parts.feedbackCount =
      cnt >= 5000 ? 25 : cnt >= 1000 ? 18 : cnt >= 200 ? 10 : cnt >= 50 ? 5 : 0;
  }
  /* sales / items sold (20) */
  const sales = inputs.salesCount;
  if (sales != null) {
    parts.salesCount =
      sales >= 5000 ? 20 : sales >= 1000 ? 14 : sales >= 200 ? 8 : sales >= 50 ? 4 : 0;
  }
  /* account age (10) */
  const age = inputs.accountAgeMonths;
  if (age != null) {
    parts.accountAgeMonths =
      age >= 120 ? 10 : age >= 60 ? 7 : age >= 24 ? 4 : age >= 6 ? 2 : 0;
  }
  /* brand activity volume (10) */
  const act = inputs.brandActivity;
  if (act != null) {
    parts.brandActivity = act >= 0.5 ? 10 : act >= 0.25 ? 6 : act >= 0.05 ? 3 : 0;
  }
  /* specialized store (5) */
  if (inputs.specialized === true) parts.specialized = 5;

  return parts;
}

export function scoreSeller(inputs: SellerTrustInputs): number {
  const parts = componentScore(inputs);
  return Object.values(parts).reduce((a, b) => a + b, 0);
}

export function sellerScoreComponents(
  inputs: SellerTrustInputs
): { label: string; weight: number; earned: number }[] {
  const parts = componentScore(inputs);
  return [
    { label: "feedbackPercentage", weight: SCORE_WEIGHTS.feedbackPercentage, earned: parts.feedbackPercentage },
    { label: "feedbackCount", weight: SCORE_WEIGHTS.feedbackCount, earned: parts.feedbackCount },
    { label: "salesCount", weight: SCORE_WEIGHTS.salesCount, earned: parts.salesCount },
    { label: "accountAgeMonths", weight: SCORE_WEIGHTS.accountAgeMonths, earned: parts.accountAgeMonths },
    { label: "brandActivity", weight: SCORE_WEIGHTS.brandActivity, earned: parts.brandActivity },
    { label: "specialized", weight: SCORE_WEIGHTS.specialized, earned: parts.specialized },
  ];
}

/* Map a 0-100 trust score to its decision level. */
export function sellerDecisionLevel(score: number): "TRUSTED_HIGH" | "TRUSTED" | "LOW_TRUST" {
  if (score >= 90) return "TRUSTED_HIGH";
  if (score >= 80) return "TRUSTED";
  return "LOW_TRUST";
}

/* ---- The finalized decision engine ---------------------------------
   Resolves a (sellerUsername, brand?) against a FinalSellerRegistry.

   Resolution order (highest priority wins) per the approved policy:
     1. REJECTED (any matching profile) -> REJECTED (veto; never eligible,
        overrides even VERIFIED / CURATED_TRUSTED / TRUSTED_HIGH)
     2. VERIFIED for the scoped brand  -> VERIFIED (eligible)
     3. CURATED_TRUSTED (target brand) -> CURATED_TRUSTED (eligible; the
        explicit brand-scoped allowlist pick. Its trustScore ranks the
        seller but does NOT gate import - curated sellers below 80 stay
        importable.)
     4. TRUSTED profile (target brand) -> score -> TRUSTED_HIGH/TRUSTED/LOW_TRUST
     5. nothing matches                -> UNKNOWN (never eligible)
   A VERIFIED/CURATED_TRUSTED/TRUSTED profile scoped to a DIFFERENT brand
   does not grant anything for the requested brand (seller-brand scope). */
export function decideSeller(
  input: SellerDecisionInput,
  registry: FinalSellerRegistry
): SellerDecisionVerdict {
  const username = normalizeSellerUsername(input.sellerUsername);
  if (!username) {
    return {
      decision: "UNKNOWN",
      eligible: false,
      score: null,
      reason: "UNKNOWN_SELLER",
      detail: "missing seller info",
    };
  }

  const requestedBrand = normalizeSellerUsername(input.brand ?? null);
  const profiles = registry.lookupProfiles(username);

  if (profiles.length === 0) {
    return {
      decision: "UNKNOWN",
      eligible: false,
      score: null,
      reason: "SELLER_NOT_REGISTERED",
      detail: `'${username}' has no curated seller profile`,
    };
  }

  /* Find profiles whose brand scope covers the requested brand. A profile
     with no brand scope applies universally. */
  const brandScoped = profiles.filter(
    (p) => !requestedBrand || !p.brand || normalizeSellerUsername(p.brand) === requestedBrand
  );

  /* REJECTED has absolute priority over everything (a counterfeit/fraud
     signal can never be overridden by a good score, by curation, OR by
     category scope). */
  const rejected = brandScoped.find((p) => p.status === "REJECTED");
  if (rejected) {
    return {
      decision: "REJECTED",
      eligible: false,
      score: null,
      reason: "REJECTED_SELLER",
      detail: `'${username}' rejected: ${rejected.rejectReason ?? "counterfeit/fraud signal"}`,
    };
  }

  /* Category-scope narrowing (infrastructure). Only enforced for
     canonical slugs inside ENFORCED_SELLER_CATEGORY_SCOPE; otherwise the
     decision uses the legacy brand-scoped rule exactly. When enforced, a
     profile must list the category in its `categories` (missing / empty /
     not-including => not proven). Scope is always a NARROWING filter: it
     can never grant eligibility, upgrade status, change a trust score, or
     cross brand scope. */
  const requestedCategory = input.category != null ? normalizeCategorySlug(input.category) : null;
  const enforceCategory =
    requestedCategory != null &&
    isCanonicalCategorySlug(requestedCategory) &&
    ENFORCED_SELLER_CATEGORY_SCOPE.has(requestedCategory);

  const scoped = enforceCategory
    ? brandScoped.filter(
        (p) =>
          requestedCategory != null &&
          Array.isArray(p.categories) &&
          p.categories.length > 0 &&
          p.categories.includes(requestedCategory)
      )
    : brandScoped;

  if (
    enforceCategory &&
    requestedCategory != null &&
    scoped.length === 0 &&
    brandScoped.length > 0
  ) {
    /* Profiles exist for the requested brand, but none proves this
       category's scope (categories missing / empty / excluding the slug). */
    return {
      decision: "UNKNOWN",
      eligible: false,
      score: null,
      reason: "SELLER_CATEGORY_NOT_PROVEN",
      detail: `'${username}' has no proven category scope for '${requestedCategory}'`,
    };
  }

  /* VERIFIED takes precedence over scoring and curation. */
  const verified = scoped.find((p) => p.status === "VERIFIED");
  if (verified) {
    return {
      decision: "VERIFIED",
      eligible: true,
      score: null,
      reason: "",
      detail: `'${username}' verified for ${verified.brand || "any brand"}`,
    };
  }

  /* CURATED_TRUSTED: explicit brand-scoped allowlist pick. Importable even
     if trustScore < 80 - the score is a ranking metric, not a gate. */
  const curated = scoped.find((p) => p.status === "CURATED_TRUSTED");
  if (curated) {
    const score = scoreSeller(curated.trustInputs ?? {});
    return {
      decision: "CURATED_TRUSTED",
      eligible: true,
      score,
      reason: "",
      detail: `'${username}' curated-trusted for ${requestedBrand || curated.brand || "any brand"} (trust score ${score}/100)`,
    };
  }

  /* TRUSTED: score deterministic registry inputs. */
  const trusted = scoped.find((p) => p.status === "TRUSTED");
  if (trusted) {
    const score = scoreSeller(trusted.trustInputs ?? {});
    const level = sellerDecisionLevel(score);
    return {
      decision: level,
      eligible: sellerDecisionEligible(level),
      score,
      reason: level === "LOW_TRUST" ? "LOW_TRUST" : "",
      detail: `'${username}' for ${requestedBrand || trusted.brand || "any brand"} scored ${score}/100 -> ${level}`,
    };
  }

  /* Profiles exist but none covers the requested brand (scope mismatch). */
  return {
    decision: "UNKNOWN",
    eligible: false,
    score: null,
    reason: "SELLER_SCOPE_MISMATCH",
    detail: `'${username}' is curated for another brand, not '${requestedBrand || "?"}'`,
  };
}

/* Build a FinalSellerRegistry from curated SellerProfiles. Usernames and
   brands are normalized (case-folded). Multiple brand-scoped profiles may
   coexist for the same username. */
export function createFinalMemorySellerRegistry(
  profiles: ReadonlyArray<SellerProfile>
): FinalSellerRegistry {
  const byUsername = new Map<string, SellerProfile[]>();
  for (const p of profiles) {
    const key = normalizeSellerUsername(p.sellerUsername);
    const list = byUsername.get(key) ?? [];
    list.push({
      ...p,
      sellerUsername: key,
      brand: p.brand ? normalizeSellerUsername(p.brand) : null,
      categories:
        p.categories === undefined
          ? undefined
          : Array.from(
              new Set(
                p.categories
                  .map((c) => normalizeCategorySlug(c) ?? "")
                  .filter((c) => c.length > 0)
              )
            ),
    });
    byUsername.set(key, list);
  }
  return {
    lookupProfiles: (username) => byUsername.get(normalizeSellerUsername(username)) ?? [],
  };
}

/* Honest default: no curated profiles -> every seller is UNKNOWN. */
export const EMPTY_FINAL_SELLER_REGISTRY: FinalSellerRegistry = createFinalMemorySellerRegistry([]);

