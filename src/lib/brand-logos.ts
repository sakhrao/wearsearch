/* Brand name -> Simple Icons CDN slug, curated for the catalog
   roster. Any slug that does not resolve (404) is swapped to a
   typographic wordmark by the marquee's onError fallback, so an
   unverified or missing icon is always safe to ship. */

export const BRAND_LOGO_SLUGS: Record<string, string> = {
  Nike: "nike",
  Adidas: "adidas",
  Puma: "puma",
  Reebok: "reebok",
  Converse: "converse",
  Vans: "vans",
  "New Balance": "new-balance",
  "Levi's": "levis",
  Wrangler: "wrangler",
  Diesel: "diesel",
  "Tommy Hilfiger": "tommy-hilfiger",
  "Calvin Klein": "calvin-klein",
  "Ralph Lauren": "ralph-lauren",
  Zara: "zara",
  "H&M": "hm",
  DKNY: "dkny",
  "The North Face": "thenorthface",
  Patagonia: "patagonia",
  Columbia: "columbia",
  Champion: "champion",
  Gildan: "gildan",
  "Fruit of the Loom": "fruit-of-the-loom",
  "Under Armour": "under-armour",
  Dockers: "dockers",
  Hanes: "hanes",
  Crocs: "crocs",
  Clarks: "clarks",
  Wolverine: "wolverine",
  Birkenstock: "birkenstock",
  Lululemon: "lululemon",
  Burberry: "burberry",
  Armani: "armani",
  "Hugo Boss": "hugo-boss",
  Casio: "casio",
  Seiko: "seiko",
  Rolex: "rolex",
  Omega: "omega",
  Cartier: "cartier",
  Gucci: "gucci",
  "Saint Laurent": "saint-laurent",
  Chanel: "chanel",
  Dior: "dior",
  "Hermès": "hermes",
  "Louis Vuitton": "louis-vuitton",
  Versace: "versace",
};

export function brandLogoSlug(brand: string): string | null {
  const exact = BRAND_LOGO_SLUGS[brand];
  if (exact) return exact;
  const folded = brand
    .toLowerCase()
    .replace(/['\u2019.\u0026]+/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return folded || null;
}