/* eBay OAuth 2.0 Application Access Token (client-credentials) + cache.

   Flow (Production):
     POST https://api.ebay.com/identity/v1/oauth2/token
       Authorization: Basic base64(clientId:clientSecret)
       Content-Type:  application/x-www-form-urlencoded
       body:          grant_type=client_credentials&scope=<scope>
     -> { access_token, expires_in (7200s), token_type }

   Security: the Client Secret is only combined into the Basic header
   inside acquireToken; no part of the credentials is ever logged or
   returned. The token is cached in-memory and reused until just before
   expiry (~120s buffer) to avoid needless round-trips.
*/

export type TokenResponse = {
  access_token: string;
  expires_in: number;
  token_type?: string;
};

export type EbayFetch = (url: string, init?: RequestInit) => Promise<Response>;

type CachedToken = { token: string; expiresAtMs: number };

const TOKEN_EXPIRY_BUFFER_MS = 120_000;

export class EbayTokenError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "EbayTokenError";
    this.status = status;
    this.code = code;
  }
}

export function makeBasicAuthHeader(clientId: string, clientSecret: string): string {
  const raw = `${clientId}:${clientSecret}`;
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

export function buildTokenBody(scope: string): string {
  return new URLSearchParams({ grant_type: "client_credentials", scope }).toString();
}

/* A token store with an expiry buffer. Exposed separately so tests can
   inject their own clock/start state and assert cache re-use. */
export function createTokenCache(now: () => number = () => Date.now()) {
  let cached: CachedToken | null = null;
  const CACHE_MISS = Symbol("token-cache-miss");

  return {
    CACHE_MISS,
    getValid(requiredLifetimeMs: number): string | typeof CACHE_MISS {
      if (!cached) return CACHE_MISS;
      if (cached.expiresAtMs - now() <= requiredLifetimeMs) return CACHE_MISS;
      return cached.token;
    },
    store(tokenResponse: TokenResponse): string {
      const expiresAtMs =
        now() + (Number.isFinite(tokenResponse.expires_in) ? tokenResponse.expires_in : 7200) * 1000;
      cached = { token: tokenResponse.access_token, expiresAtMs };
      return cached.token;
    },
    peekExpiresAtMs(): number | null {
      return cached ? cached.expiresAtMs : null;
    },
  };
}

export type EbayAuthClient = {
  /* Returns a valid access token, reusing cache when fresh. Throws
     EbayTokenError on credential/config problems, EbayFetchError on
     transport problems. */
  getToken: () => Promise<string>;
};

export type EbayAuthConfig = {
  clientId: string;
  /* CONFIDENTIAL - only consumed here to build the Basic header, never
     stored on or serialized with any config object. */
  clientSecret: string;
  tokenUrl: string;
  scope: string;
};

export function createEbayAuthClient(
  cfg: EbayAuthConfig,
  fetchImpl: EbayFetch = fetch,
  cache = createTokenCache(),
): EbayAuthClient {
  const { clientId, clientSecret, tokenUrl, scope } = cfg;

  const requestNewToken = async (): Promise<string> => {
    const cached = cache.getValid(TOKEN_EXPIRY_BUFFER_MS);
    if (cached !== cache.CACHE_MISS) {
      return cached as string;
    }

    let resp: Response;
    try {
      resp = await fetchImpl(tokenUrl, {
        method: "POST",
        headers: {
          Authorization: makeBasicAuthHeader(clientId, clientSecret),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: buildTokenBody(scope),
      });
    } catch (err) {
      throw new EbayTokenError(
        `eBay token request failed (network): ${(err as Error).message}`,
        0,
        null,
      );
    }

    if (!resp.ok) {
      let code: string | null = null;
      let detail = "";
      try {
        const body = (await resp.json()) as { error?: string; error_description?: string };
        code = body.error ?? null;
        detail = body.error_description ?? "";
      } catch {
        /* non-JSON error body; fall through with status only */
      }
      throw new EbayTokenError(
        `eBay token request failed: HTTP ${resp.status}${detail ? ` (${detail})` : ""}`,
        resp.status,
        code,
      );
    }

    let body: TokenResponse;
    try {
      body = (await resp.json()) as TokenResponse;
    } catch {
      throw new EbayTokenError("eBay token response was not valid JSON", resp.status, null);
    }

    if (!body.access_token || typeof body.access_token !== "string") {
      throw new EbayTokenError("eBay token response missing access_token", resp.status, null);
    }

    return cache.store(body);
  };

  const getToken = async (): Promise<string> => {
    const cached = cache.getValid(TOKEN_EXPIRY_BUFFER_MS);
    if (cached !== cache.CACHE_MISS) {
      return cached as string;
    }
    return requestNewToken();
  };

  return { getToken };
}
