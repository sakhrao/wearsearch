/* Product-page URL guard.
   Playground/demo stores have no real product pages: the
   catalog must never present a fabricated or placeholder URL
   as a working "View product" link. This module is the single
   source of truth for what counts as a real, verifiable page. */

const PLACEHOLDER_HOSTS = new Set([
  "example.com",
  "www.example.com",
  "example.invalid",
]);

function isPlaceholderHost(hostname: string): boolean {
  if (PLACEHOLDER_HOSTS.has(hostname)) return true;
  if (hostname.endsWith(".example")) return true;
  return false;
}

export function hasRealProductPage(
  url: string | null | undefined
): boolean {
  if (!url) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (isPlaceholderHost(parsed.hostname.toLowerCase())) {
    return false;
  }

  const path = parsed.pathname.toLowerCase();
  if (/\/p\/exp-/.test(path)) {
    return false;
  }
  if (/\bexp-/.test(path)) {
    return false;
  }

  return true;
}

export function productStoreLabel(
  url: string | null | undefined
): string {
  if (!url || !hasRealProductPage(url)) {
    return "";
  }
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}