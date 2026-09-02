/* eBay adapter configuration + credential validation (Phase 1).

   FRAGILE: the eBay Client Secret must NEVER appear in logs, API
   responses, tests, commits, or reports. This module only reads it
   from the environment and exposes a boolean "configured" + an opaque
   authRef (a pointer, never the secret itself). The base64 Authorization
   header is built and used only inside the auth module and is never
   logged or returned to callers.

   Required env vars (NAMES only; see .env.example):
     EBAY_CLIENT_ID        - eBay App ID (Production)
     EBAY_CLIENT_SECRET    - eBay Client Secret (CONFIDENTIAL)

   Optional:
     EBAY_ENV              - "production" (default) | "sandbox"
     EBAY_MARKETPLACE_ID   - default "EBAY_US"
     EBAY_KEYWORDS         - comma-separated discovery keywords
     EBAY_CATEGORY_IDS     - comma-separated eBay category ids
     EBAY_SAMPLE_SIZE      - default 10
     EBAY_MAX_LISTINGS     - default 200 (dry-run cap)
     FX_RATE_USD_PER_EUR   - deterministic EUR conversion for USD (see
                             the harness's resolveFx, which already honors this)
*/

export const EBAY_TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
export const EBAY_BROWSE_BASE = "https://api.ebay.com/buy/browse/v1";
export const EBAY_BROWSE_SCOPE = "https://api.ebay.com/oauth/api_scope/buy.browse";

export type EbayEnvConfig = {
  clientId: string;
  /* NEVER holds the plaintext client secret. Config objects may be
     serialized/logged; the secret stays out of them. A boolean tells
     callers whether a secret is configured so auth can be attempted. */
  clientSecretConfigured: boolean;
  environment: "production" | "sandbox";
  marketplaceId: string;
  keywords: string[];
  categoryIds: string[];
  sampleSize: number;
  maxListings: number;
  tokenUrl: string;
  browseBase: string;
  scope: string;
};

export type EbayConfigStatus =
  | { ok: true; config: EbayEnvConfig; authRef: string }
  | { ok: false; missing: string[] };

/* Parse + validate. Returns an ok:false report of which required vars
   are missing — it never echoes values, only NAMES. Accepts a partial
   env (tests/callers may not represent every process variable). */
export function loadEbayConfig(
  env: Partial<NodeJS.ProcessEnv> = process.env
): EbayConfigStatus {
  const clientId = env.EBAY_CLIENT_ID?.trim() || null;
  const clientSecret = env.EBAY_CLIENT_SECRET?.trim() || null;

  const missing: string[] = [];
  if (!clientId) missing.push("EBAY_CLIENT_ID");
  if (!clientSecret) missing.push("EBAY_CLIENT_SECRET");

  if (missing.length > 0) {
    return { ok: false, missing };
  }

  const environment =
    env.EBAY_ENV?.trim().toLowerCase() === "sandbox" ? "sandbox" : "production";

  const tokenUrl =
    environment === "sandbox"
      ? "https://api.sandbox.ebay.com/identity/v1/oauth2/token"
      : EBAY_TOKEN_URL;

  const browseBase =
    environment === "sandbox"
      ? "https://api.sandbox.ebay.com/buy/browse/v1"
      : EBAY_BROWSE_BASE;

  const num = (raw: string | undefined, fallback: number): number => {
    if (!raw) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  };

  return {
    ok: true,
    authRef: `ebay:${environment}`,
    config: {
      clientId: clientId!,
      clientSecretConfigured: Boolean(clientSecret),
      environment,
      marketplaceId: env.EBAY_MARKETPLACE_ID?.trim() || "EBAY_US",
      keywords: (env.EBAY_KEYWORDS ?? "")
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
      categoryIds: (env.EBAY_CATEGORY_IDS ?? "")
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
      sampleSize: num(env.EBAY_SAMPLE_SIZE, 10),
      maxListings: num(env.EBAY_MAX_LISTINGS, 200),
      tokenUrl,
      browseBase,
      scope: EBAY_BROWSE_SCOPE,
    },
  };
}

/* Read the client secret (CONFIDENTIAL) directly for the OAuth request.
   Intentionally NOT part of EbayEnvConfig: the secret is consumed only
   by the auth transport, never stored on or serialized with the config,
   so it cannot leak into logs, reports, or API responses. */
export function readEbayClientSecret(
  env: Partial<NodeJS.ProcessEnv> = process.env
): string | null {
  const secret = env.EBAY_CLIENT_SECRET?.trim();
  return secret && secret.length > 0 ? secret : null;
}
