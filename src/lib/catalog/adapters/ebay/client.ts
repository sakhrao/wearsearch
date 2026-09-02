/* eBay Browse API search client (item_summary/search).

   GET https://api.ebay.com/buy/browse/v1/item_summary/search
     headers:
       Authorization: Bearer <access_token>
       X-EBAY-C-MARKETPLACE-ID: <marketplace>
     query: q, category_ids, gtin, limit, offset, sort, fieldgroups
   -> { itemSummaries[], total, limit, offset, next, prev }

   Pagination uses offset/limit (limit max 200 per request; the Browse
   API caps total results at 10,000). We pass fieldgroups=FULL to get
   localizedAspects (brand/colour/size/MPN/GTIN) for each summary.

   Security: never log the bearer token or any credential.
*/

import type { EbayFetch } from "./auth";
import type { EbayEnvConfig } from "./config";

export type EbayItemSummary = {
  itemId?: string;
  title?: string;
  leafItemIds?: string[];
  itemHref?: string;
  itemWebUrl?: string;
  itemAffiliateWebUrl?: string;
  shortDescription?: string;
  price?: { value?: string; currency?: string };
  marketingPrice?: { originalPrice?: { value?: string; currency?: string } };
  image?: { imageUrl?: string };
  additionalImages?: { imageUrl?: string }[];
  condition?: string;
  conditionId?: string;
  category?: string;
  categoryId?: string;
  categoryPath?: string;
  seller?: { username?: string; feedbackPercentage?: string; feedbackScore?: number };
  buyingOptions?: string[];
  itemGroupHref?: string;
  itemGroupType?: string;
  localizedAspects?: { name?: string; value?: string }[];
};

export type EbaySearchResult = {
  itemSummaries: EbayItemSummary[];
  total: number;
  limit: number;
  offset: number;
  next?: string;
  prev?: string;
  href?: string;
};

export class EbayApiError extends Error {
  readonly status: number;
  readonly detail: string;
  constructor(message: string, status: number, detail = "") {
    super(message);
    this.name = "EbayApiError";
    this.status = status;
    this.detail = detail;
  }
}

/* Build the search URL from config + page. Exposed separately so tests
   can assert deterministic query construction without a fetch. */
export function buildSearchUrl(
  cfg: Pick<EbayEnvConfig, "browseBase" | "marketplaceId" | "keywords" | "categoryIds">,
  page: { limit: number; offset: number },
): string {
  const params = new URLSearchParams();
  if (cfg.keywords.length > 0) {
    params.set("q", cfg.keywords.join(" "));
  }
  if (cfg.categoryIds.length > 0) {
    params.set("category_ids", cfg.categoryIds.join(","));
  }
  params.set("limit", String(page.limit));
  if (page.offset > 0) params.set("offset", String(page.offset));
  params.set("fieldgroups", "FULL");
  params.set("sort", "best_match");
  return `${cfg.browseBase}/item_summary/search?${params.toString()}`;
}

export type EbayBrowseClient = {
  searchPage: (page: { limit: number; offset: number }) => Promise<EbaySearchResult>;
};

export function createEbayBrowseClient(
  cfg: Pick<EbayEnvConfig, "browseBase" | "marketplaceId" | "keywords" | "categoryIds">,
  getToken: () => Promise<string>,
  fetchImpl: EbayFetch = fetch,
): EbayBrowseClient {
  const searchPage = async (page: { limit: number; offset: number }): Promise<EbaySearchResult> => {
    const url = buildSearchUrl(cfg, page);
    const token = await getToken();

    let resp: Response;
    try {
      resp = await fetchImpl(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "X-EBAY-C-MARKETPLACE-ID": cfg.marketplaceId,
          Accept: "application/json",
        },
      });
    } catch (err) {
      throw new EbayApiError(
        `eBay search request failed (network): ${(err as Error).message}`,
        0,
      );
    }

    if (!resp.ok) {
      let detail = "";
      try {
        const body = (await resp.json()) as { errors?: { message?: string; longMessage?: string }[] };
        detail = body.errors?.map((e) => e.longMessage ?? e.message ?? "").filter(Boolean).join("; ") ?? "";
      } catch {
        /* ignore non-JSON */
      }
      throw new EbayApiError(
        `eBay search request failed: HTTP ${resp.status}${detail ? ` (${detail})` : ""}`,
        resp.status,
        detail,
      );
    }

    return (await resp.json()) as EbaySearchResult;
  };

  return { searchPage };
}
