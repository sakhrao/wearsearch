/* Brand name -> Simple Icons glyph slug, limited to slugs that were
   VERIFIED against the actual simple-icons `icons/` tree (jsdelivr
   @latest + unpkg 16.30.0). Several famous marks (Gucci, Rolex,
   Vans, Crocs, Champion, ...) were removed from Simple Icons, so
   they are intentionally absent here. Anything without a verified
   glyph is excluded from the marquee rather than rendered as text.
   Corrections that matter: "newbalance" (no hyphen),
   "underarmour" (no hyphen), "thenorthface" (one word). */

export const BRAND_LOGOS: Record<string, string> = {
  Nike: "nike",
  Adidas: "adidas",
  Puma: "puma",
  Reebok: "reebok",
  "New Balance": "newbalance",
  "The North Face": "thenorthface",
  "Under Armour": "underarmour",
  Zara: "zara",
  Dior: "dior",
  "Hermès": "hermes",
};

export function brandLogoSlug(brand: string): string | null {
  return BRAND_LOGOS[brand] ?? null;
}