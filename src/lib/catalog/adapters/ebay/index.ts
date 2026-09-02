/* eBay commerce source adapter (Phase 1).

   Implements CommerceSourceAdapter against the eBay Browse API using an
   OAuth 2.0 application (client-credentials) access token.

   Identity & classification (no hard-coding):
     - eBay is AFFILIATE_FEED / official:false / default priority. Its
       listings are marketplace resale and MUST never masquerade as an
       official brand store just because the title mentions a brand.
     - Auth is an opaque application-token pointer (authRef), never the
       secret itself.

   Secrets: EBAY_CLIENT_SECRET is read from the environment inside
   config.ts and combined into a Basic header inside auth.ts. It is
   never logged, never returned, never committed. buildSearchUrl /
   EbayItemSummary shapes contain no credentials.

   All of this is unit-testable by injecting a fetch implementation;
   see scripts/ebay-adapter.test.mts.
*/

import type {
  CommerceSourceAdapter,
  NormalizedListing,
  RawListingBatch,
} from "../../types";
import { loadEbayConfig, readEbayClientSecret } from "./config";
import { createEbayAuthClient, createTokenCache, type EbayAuthConfig } from "./auth";
import { createEbayBrowseClient, type EbayBrowseClient } from "./client";
import { ebayItemToNormalizedListing } from "./normalize";

export type EbayAdapterDeps = {
  /* Injectable transport + clock for deterministic tests. */
  fetchImpl?: typeof fetch;
  now?: () => number;
};

const PAGE_SIZE = 50;

export function createEbayAdapter(deps: EbayAdapterDeps = {}): CommerceSourceAdapter & {
  configStatus: ReturnType<typeof loadEbayConfig>;
  /* expose the live search client for diagnostics / dry-run */
  browse: EbayBrowseClient | null;
} {
  const status = loadEbayConfig();
  const missing = status.ok ? [] : status.missing;
  /* The client secret is read privately here and passed ONLY into the
     auth transport; it never lands on the returned configStatus. */
  const authCfg: EbayAuthConfig | null = status.ok
    ? {
        clientId: status.config.clientId,
        clientSecret: readEbayClientSecret() ?? "",
        tokenUrl: status.config.tokenUrl,
        scope: status.config.scope,
      }
    : null;
  const browse: EbayBrowseClient | null = status.ok && authCfg
    ? createEbayBrowseClient(
        status.config,
        createEbayAuthClient(authCfg, deps.fetchImpl, createTokenCache(deps.now)).getToken,
        deps.fetchImpl,
      )
    : null;

  const sourceName = status.ok
    ? `eBay (${status.config.environment})`
    : "eBay (not configured)";

  const adapter: CommerceSourceAdapter & {
    configStatus: ReturnType<typeof loadEbayConfig>;
    browse: EbayBrowseClient | null;
  } = {
    id: "ebay",
    sourceName,
    sourceType: "AFFILIATE_FEED",
    priority: 5,
    freshnessHours: 24,
    official: false,
    ...(status.ok ? { authRef: status.authRef } : {}),
    configStatus: status,
    browse,

    async sample(limit: number): Promise<RawListingBatch> {
      if (!browse) {
        throw new MissingEbayConfigError(missing);
      }
      return fetchPage(browse, Math.max(1, Math.min(limit, PAGE_SIZE)), 0);
    },

    async fetch(options?: { page?: number; limit?: number }): Promise<RawListingBatch> {
      if (!browse) {
        throw new MissingEbayConfigError(missing);
      }
      const page = options?.page ?? 1;
      const limit = Math.max(1, Math.min(options?.limit ?? PAGE_SIZE, PAGE_SIZE));
      const offset = (page - 1) * limit;
      return fetchPage(browse, limit, offset);
    },

    toNormalizedListing(raw: unknown): NormalizedListing | null {
      return ebayItemToNormalizedListing(raw);
    },
  };

  return adapter;
}

export class MissingEbayConfigError extends Error {
  readonly missing: string[];
  constructor(missing: string[]) {
    super(`eBay not configured: missing ${missing.join(", ")} (set env; see .env.example)`);
    this.name = "MissingEbayConfigError";
    this.missing = missing;
  }
}

async function fetchPage(
  client: EbayBrowseClient,
  limit: number,
  offset: number
): Promise<RawListingBatch> {
  const result = await client.searchPage({ limit, offset });
  const total = result.total ?? result.itemSummaries.length;
  const nextOffset = offset + result.itemSummaries.length;
  return {
    listings: result.itemSummaries,
    hasMore: result.itemSummaries.length > 0 && nextOffset < total,
    page: Math.floor(offset / limit) + 1,
  };
}
