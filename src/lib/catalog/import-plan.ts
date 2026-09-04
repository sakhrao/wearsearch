/* Export-discovery plan (Phase 1 + Phase 3 taxonomy expansion).

   Goal: build a diverse eBay catalog of >=50 canonical products per
   category - NOT 50 random eBay listings. We start from named, high-
   quality brands and reject Unbranded/generic junk. No broad query like
   "clothing" is used; every query is a specific brand + type.

   This module is PURE data + helpers (no DB, no I/O). It drives:
     - the idempotent registry bootstrap (which BrandAlias/CategoryMapping
       rows to create),
     - diagnostics / diversity reporting,
     - staged imports (which query set belongs to which phase).

   TAXONOMY (Phase 3): the canonical category tree is now the full
   Clothing/Shoes taxonomy. Every leaf below maps to a real `Category`
   row (many already exist in prisma/seed.ts; the bootstrap upserts any
   that are missing). The taxonomy stays independent of eBay's own
   category names - eBay tokens are mapped per-canonical-category via
   `sourceCategoryTokens`, never assumed equal.

   PHASING: each plan carries a `phase`:
     - "importable" : sufficient existing brand/seller coverage -> included
                      in the FIRST live catalog import (target >=50 each).
     - "planned"    : taxonomy + plan exist for future waves, but the
                      category is SKIPPED by the first live import because
                      it lacks enough registered sellers/brands to reach a
                      diverse 50 without more research. Planner iterates
                      these only when explicitly requested (--include-planned).

   CONFLICT HANDLING (old vs new taxonomy): the original 10 leaf
   categories (sneakers, jeans, t-shirts, shirts, dresses, jackets,
   hoodies, trousers, shorts, leggings) are all KEPT with unchanged slugs
   and placed into the expanded hierarchy:
     - dresses  -> under "dresses & jumpsuits"
     - jackets  -> under "outerwear"
     - hoodies  -> under "tops" (kept; "sweatshirts" is a distinct sibling)
     - leggings -> under "bottoms" (kept)
   No category that carries data is deleted or renamed. */

export type CategoryPhase = "importable" | "planned";

export type CategoryPlan = {
  /* canonical Category slug (must exist in seed.ts or be created by the
     bootstrap - ensureCanonicalCategory upserts it) */
  slug: string;
  /* compact name for diagnostics labels */
  name: string;
  /* canonical parent category slug this leaf hangs under. For roots
     (clothing / shoes) this is absent. */
  parent?: string;
  /* eBay source category-path tokens that map to this canonical category */
  sourceCategoryTokens: string[];
  /* the named brands + queries used to source this category */
  queries: Array<{ brand: string; q: string }>;
  /* target count of canonical products once fully populated (>=50) */
  target: number;
  /* max share any single brand may occupy of this category before it is
     flagged as dominant (diversity control, 0-1) */
  maxBrandShare: number;
  /* expected data quality of this category's eBay supply */
  quality: "high" | "medium" | "low" | "unknown";
  /* phased import gate: "importable" is included in the first live import;
     "planned" is skipped by --all unless --include-planned is passed */
  phase: CategoryPhase;
  /* For IMPORTABLE leaves only: the EXISTING seller-registry usernames whose
     brand + scope justify importing this category. Enforces rule #6 - brand
     presence alone never makes a category importable; the seller must be
     genuinely appropriate for this product type. Every query brand in an
     IMPORTABLE plan must map to a seller in this set. Planned leaves leave
     this empty (no coverage to cite). */
  supportingSellers?: string[];
};

/* ------------------------------------------------------------------ */
/* CATEGORY PLANS                                                      */
/* ------------------------------------------------------------------ */

export const CATEGORY_PLANS: CategoryPlan[] = [
  /* ===== Roots / Shoes ===== */
  {
    slug: "sneakers",
    name: "Sneakers",
    parent: "shoes",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Shoes|Athletic Shoes",
      "Clothing, Shoes & Accessories|Women|Women's Shoes|Athletic Shoes",
      "Clothing, Shoes & Accessories|Men|Men's Shoes|Casual Shoes",
      "Clothing, Shoes & Accessories|Women|Women's Shoes|Casual Shoes",
      "Sporting Goods|Fitness, Running & Yoga|Shoes|Men's Shoes",
      "Sporting Goods|Fitness, Running & Yoga|Shoes|Women's Shoes",
    ],
    queries: [
      { brand: "Nike", q: "nike sneakers" },
      { brand: "Adidas", q: "adidas sneakers" },
      { brand: "New Balance", q: "new balance sneakers" },
      { brand: "Puma", q: "puma sneakers" },
      { brand: "Converse", q: "converse sneakers" },
      { brand: "Vans", q: "vans sneakers" },
      { brand: "Reebok", q: "reebok sneakers" },
      { brand: "Nike", q: "nike running shoes men" },
      { brand: "Adidas", q: "adidas running shoes women" },
    ],
    target: 500,
    maxBrandShare: 0.3,
    quality: "high",
    phase: "importable",
  },
  {
    slug: "boots",
    name: "Boots",
    parent: "shoes",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Shoes|Boots",
      "Clothing, Shoes & Accessories|Women|Women's Shoes|Boots",
    ],
    queries: [
      { brand: "The North Face", q: "the north face men's boots" },
      { brand: "Columbia", q: "columbia men's boots" },
      { brand: "Wolverine", q: "wolverine men's boots" },
      { brand: "Crocs", q: "crocs women's boots" },
      { brand: "The North Face", q: "the north face women's boots" },
    ],
    target: 50,
    maxBrandShare: 0.3,
    quality: "medium",
    phase: "importable",
  },
  {
    slug: "sandals",
    name: "Sandals",
    parent: "shoes",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Shoes|Sandals",
      "Clothing, Shoes & Accessories|Women|Women's Shoes|Sandals",
    ],
    queries: [
      { brand: "Crocs", q: "crocs sandals" },
      { brand: "Birkenstock", q: "birkenstock sandals" },
      { brand: "Clarks", q: "clarks sandals" },
      { brand: "Nike", q: "nike sandals" },
      { brand: "Adidas", q: "adidas sandals" },
    ],
    target: 50,
    maxBrandShare: 0.3,
    quality: "medium",
    phase: "importable",
  },
  {
    slug: "heels",
    name: "Heels",
    parent: "shoes",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Women|Women's Shoes|Heels",
    ],
    queries: [
      { brand: "Zara", q: "zara women's heels" },
      { brand: "H&M", q: "h&m women's heels" },
      { brand: "Calvin Klein", q: "calvin klein women's heels" },
      { brand: "DKNY", q: "dkny women's heels" },
      { brand: "Clarks", q: "clarks women's heels" },
    ],
    target: 50,
    maxBrandShare: 0.3,
    quality: "medium",
    phase: "importable",
  },
  {
    slug: "flats",
    name: "Flats",
    parent: "shoes",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Women|Women's Shoes|Ballet Flats & Loafers",
    ],
    queries: [
      { brand: "Clarks", q: "clarks women's flats" },
      { brand: "Zara", q: "zara women's flats" },
      { brand: "H&M", q: "h&m women's flats" },
      { brand: "DKNY", q: "dkny women's flats" },
    ],
    target: 50,
    maxBrandShare: 0.35,
    quality: "medium",
    phase: "importable",
  },
  {
    slug: "loafers",
    name: "Loafers",
    parent: "shoes",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Shoes|Loafers",
      "Clothing, Shoes & Accessories|Women|Women's Shoes|Ballet Flats & Loafers",
    ],
    queries: [
      { brand: "Clarks", q: "clarks men's loafers" },
      { brand: "Clarks", q: "clarks women's loafers" },
    ],
    target: 50,
    maxBrandShare: 0.5,
    quality: "low",
    phase: "planned",
  },
  {
    slug: "formal-shoes",
    name: "Formal Shoes",
    parent: "shoes",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Shoes|Dress Shoes",
    ],
    queries: [
      { brand: "Clarks", q: "clarks men's dress shoes" },
      { brand: "Calvin Klein", q: "calvin klein men's dress shoes" },
      { brand: "DKNY", q: "dkny men's dress shoes" },
    ],
    target: 50,
    maxBrandShare: 0.4,
    quality: "low",
    phase: "planned",
  },

  /* ===== Clothing / Tops ===== */
  {
    slug: "t-shirts",
    name: "T-Shirts",
    parent: "tops",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Clothing|Shirts|T-Shirts",
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Tops",
      "Clothing, Shoes & Accessories|Men|Men's Clothing|Activewear|Activewear Tops",
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Activewear|Activewear Tops",
    ],
    queries: [
      { brand: "Nike", q: "nike men's t-shirts" },
      { brand: "Adidas", q: "adidas men's t-shirts" },
      { brand: "Puma", q: "puma men's t-shirts" },
      { brand: "Levi's", q: "levi's men's t-shirts" },
      { brand: "Fruit of the Loom", q: "fruit of the loom men's t-shirts" },
      { brand: "Nike", q: "nike women's t-shirts" },
      { brand: "Adidas", q: "adidas women's t-shirts" },
    ],
    target: 500,
    maxBrandShare: 0.3,
    quality: "medium",
    phase: "importable",
  },
  {
    slug: "tank-tops",
    name: "Tank Tops",
    parent: "tops",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Clothing|Shirts|Tank Tops",
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Tops|Tank Tops",
    ],
    queries: [
      { brand: "Hanes", q: "hanes men's tank tops" },
      { brand: "Fruit of the Loom", q: "fruit of the loom men's tank tops" },
      { brand: "Nike", q: "nike women's tank tops" },
      { brand: "Champion", q: "champion tank tops" },
      { brand: "Adidas", q: "adidas women's tank tops" },
    ],
    target: 50,
    maxBrandShare: 0.3,
    quality: "medium",
    phase: "importable",
  },
  {
    slug: "polos",
    name: "Polo Shirts",
    parent: "tops",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Clothing|Shirts|Polo Shirts",
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Tops|Polos",
    ],
    queries: [
      { brand: "Ralph Lauren", q: "ralph lauren men's polo shirts" },
      { brand: "Tommy Hilfiger", q: "tommy hilfiger men's polo shirts" },
      { brand: "Calvin Klein", q: "calvin klein men's polo shirts" },
      { brand: "Nike", q: "nike men's polo shirts" },
      { brand: "Burberry", q: "burberry women's polo shirts" },
    ],
    target: 50,
    maxBrandShare: 0.3,
    quality: "medium",
    phase: "importable",
  },
  {
    slug: "shirts",
    name: "Shirts",
    parent: "tops",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Clothing|Shirts|Casual Button-Down Shirts",
      "Clothing, Shoes & Accessories|Men|Men's Clothing|Shirts|Dress Shirts",
    ],
    queries: [
      { brand: "Ralph Lauren", q: "ralph lauren men's shirts" },
      { brand: "Tommy Hilfiger", q: "tommy hilfiger men's shirts" },
      { brand: "Calvin Klein", q: "calvin klein men's shirts" },
      { brand: "Levi's", q: "levi's men's shirts" },
      { brand: "Wrangler", q: "wrangler men's shirts" },
    ],
    target: 300,
    maxBrandShare: 0.35,
    quality: "medium",
    phase: "importable",
  },
  {
    slug: "blouses",
    name: "Blouses",
    parent: "tops",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Tops|Blouses",
    ],
    queries: [
      { brand: "Tommy Hilfiger", q: "tommy hilfiger women's blouses" },
      { brand: "Calvin Klein", q: "calvin klein women's blouses" },
      { brand: "Zara", q: "zara women's blouses" },
      { brand: "H&M", q: "h&m women's blouses" },
      { brand: "DKNY", q: "dkny women's blouses" },
    ],
    target: 50,
    maxBrandShare: 0.3,
    quality: "medium",
    phase: "importable",
  },
  {
    slug: "sweaters",
    name: "Sweaters",
    parent: "tops",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Clothing|Sweaters",
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Sweaters",
    ],
    queries: [
      { brand: "Ralph Lauren", q: "ralph lauren men's sweaters" },
      { brand: "Tommy Hilfiger", q: "tommy hilfiger men's sweaters" },
      { brand: "Calvin Klein", q: "calvin klein women's sweaters" },
      { brand: "Zara", q: "zara women's sweaters" },
      { brand: "Armani", q: "armani men's sweaters" },
    ],
    target: 50,
    maxBrandShare: 0.3,
    quality: "medium",
    phase: "importable",
  },
  {
    slug: "cardigans",
    name: "Cardigans",
    parent: "tops",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Sweaters|Cardigans",
    ],
    queries: [
      { brand: "Ralph Lauren", q: "ralph lauren women's cardigans" },
      { brand: "Tommy Hilfiger", q: "tommy hilfiger women's cardigans" },
      { brand: "Zara", q: "zara women's cardigans" },
      { brand: "H&M", q: "h&m women's cardigans" },
    ],
    target: 50,
    maxBrandShare: 0.35,
    quality: "medium",
    phase: "importable",
  },
  {
    slug: "sweatshirts",
    name: "Sweatshirts",
    parent: "tops",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Clothing|Activewear|Sweatshirts & Hoodies",
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Activewear|Sweatshirts",
    ],
    queries: [
      { brand: "Champion", q: "champion sweatshirts" },
      { brand: "Gildan", q: "gildan sweatshirts" },
      { brand: "Hanes", q: "hanes sweatshirts" },
      { brand: "Nike", q: "nike men's sweatshirts" },
      { brand: "Adidas", q: "adidas women's sweatshirts" },
    ],
    target: 50,
    maxBrandShare: 0.3,
    quality: "medium",
    phase: "importable",
  },
  {
    slug: "hoodies",
    name: "Hoodies & Sweatshirts",
    parent: "tops",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Clothing|Activewear|Hoodies & Sweatshirts",
      "Clothing, Shoes & Accessories|Men|Men's Clothing|Activewear|Sweatshirts & Hoodies",
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Activewear|Hoodies & Sweatshirts",
    ],
    queries: [
      { brand: "Nike", q: "nike men's hoodies" },
      { brand: "Adidas", q: "adidas men's hoodies" },
      { brand: "Champion", q: "champion men's hoodies" },
      { brand: "Gildan", q: "gildan hoodies" },
      { brand: "Nike", q: "nike women's sweatshirts" },
    ],
    target: 300,
    maxBrandShare: 0.35,
    quality: "medium",
    phase: "importable",
  },
  {
    slug: "bodysuits",
    name: "Bodysuits",
    parent: "tops",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Tops|Bodysuits",
    ],
    queries: [
      { brand: "H&M", q: "h&m women's bodysuits" },
      { brand: "Zara", q: "zara women's bodysuits" },
      { brand: "Calvin Klein", q: "calvin klein women's bodysuits" },
    ],
    target: 50,
    maxBrandShare: 0.4,
    quality: "low",
    phase: "planned",
  },

  /* ===== Clothing / Bottoms ===== */
  {
    slug: "jeans",
    name: "Jeans",
    parent: "bottoms",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Clothing|Jeans",
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Jeans",
    ],
    queries: [
      { brand: "Levi's", q: "levi's men's jeans" },
      { brand: "Levi's", q: "levi's women's jeans" },
      { brand: "Wrangler", q: "wrangler men's jeans" },
      { brand: "Diesel", q: "diesel men's jeans" },
      { brand: "Tommy Hilfiger", q: "tommy hilfiger men's jeans" },
      { brand: "Calvin Klein", q: "calvin klein women's jeans" },
    ],
    target: 500,
    maxBrandShare: 0.3,
    quality: "medium",
    phase: "importable",
  },
  {
    slug: "trousers",
    name: "Trousers / Pants",
    parent: "bottoms",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Clothing|Pants",
    ],
    queries: [
      { brand: "Dockers", q: "dockers men's trousers" },
      { brand: "Wrangler", q: "wrangler men's pants" },
      { brand: "Dockers", q: "dockers men's chinos" },
      { brand: "Nike", q: "nike men's joggers" },
      { brand: "Adidas", q: "adidas men's pants" },
    ],
    target: 300,
    maxBrandShare: 0.35,
    quality: "low",
    phase: "importable",
  },
  {
    slug: "chinos",
    name: "Chinos",
    parent: "bottoms",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Clothing|Pants|Chinos",
    ],
    queries: [
      { brand: "Dockers", q: "dockers men's chinos" },
      { brand: "Wrangler", q: "wrangler men's chinos" },
      { brand: "Tommy Hilfiger", q: "tommy hilfiger men's chinos" },
      { brand: "Calvin Klein", q: "calvin klein men's chinos" },
      { brand: "Levi's", q: "levi's men's chinos" },
    ],
    target: 50,
    maxBrandShare: 0.3,
    quality: "medium",
    phase: "importable",
  },
  {
    slug: "cargo",
    name: "Cargo Pants",
    parent: "bottoms",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Clothing|Pants|Cargo Pants",
    ],
    queries: [
      { brand: "Wrangler", q: "wrangler men's cargo pants" },
      { brand: "Dockers", q: "dockers men's cargo pants" },
      { brand: "Columbia", q: "columbia men's cargo pants" },
      { brand: "Nike", q: "nike men's cargo pants" },
    ],
    target: 50,
    maxBrandShare: 0.35,
    quality: "low",
    phase: "importable",
  },
  {
    slug: "joggers",
    name: "Joggers",
    parent: "bottoms",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Clothing|Activewear|Track Pants & Joggers",
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Activewear|Track Pants & Joggers",
    ],
    queries: [
      { brand: "Nike", q: "nike men's joggers" },
      { brand: "Adidas", q: "adidas men's joggers" },
      { brand: "Puma", q: "puma women's joggers" },
      { brand: "Champion", q: "champion joggers" },
      { brand: "Lululemon", q: "lululemon women's joggers" },
    ],
    target: 50,
    maxBrandShare: 0.3,
    quality: "medium",
    phase: "importable",
  },
  {
    slug: "shorts",
    name: "Shorts",
    parent: "bottoms",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Clothing|Shorts",
      "Clothing, Shoes & Accessories|Men|Men's Clothing|Activewear|Activewear Shorts",
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Activewear|Activewear Shorts",
    ],
    queries: [
      { brand: "Nike", q: "nike men's shorts" },
      { brand: "Adidas", q: "adidas men's shorts" },
      { brand: "Levi's", q: "levi's men's shorts" },
      { brand: "Puma", q: "puma men's shorts" },
    ],
    target: 200,
    maxBrandShare: 0.4,
    quality: "low",
    phase: "importable",
  },
  {
    slug: "skirts",
    name: "Skirts",
    parent: "bottoms",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Skirts",
    ],
    queries: [
      { brand: "Zara", q: "zara women's skirts" },
      { brand: "H&M", q: "h&m women's skirts" },
      { brand: "Tommy Hilfiger", q: "tommy hilfiger women's skirts" },
      { brand: "Calvin Klein", q: "calvin klein women's skirts" },
      { brand: "DKNY", q: "dkny women's skirts" },
    ],
    target: 50,
    maxBrandShare: 0.35,
    quality: "medium",
    phase: "importable",
  },
  {
    slug: "leggings",
    name: "Leggings (Activewear)",
    parent: "bottoms",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Activewear|Leggings",
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Activewear|Tights & Leggings",
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Activewear|Activewear Pants",
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Leggings",
    ],
    queries: [
      { brand: "Nike", q: "nike women's leggings" },
      { brand: "Adidas", q: "adidas women's leggings" },
      { brand: "Under Armour", q: "under armour women's leggings" },
      { brand: "Puma", q: "puma women's leggings" },
    ],
    target: 300,
    maxBrandShare: 0.35,
    quality: "medium",
    phase: "importable",
  },

  /* ===== Clothing / Dresses & Jumpsuits ===== */
  {
    slug: "dresses",
    name: "Dresses",
    parent: "dresses-jumpsuits",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Dresses",
    ],
    queries: [
      { brand: "Zara", q: "zara women's dresses" },
      { brand: "H&M", q: "h&m women's dresses" },
      { brand: "DKNY", q: "dkny women's dresses" },
      { brand: "Calvin Klein", q: "calvin klein women's dresses" },
      { brand: "Tommy Hilfiger", q: "tommy hilfiger women's dresses" },
    ],
    target: 300,
    maxBrandShare: 0.35,
    quality: "medium",
    phase: "importable",
  },
  {
    slug: "jumpsuits",
    name: "Jumpsuits",
    parent: "dresses-jumpsuits",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Jumpsuits & Rompers",
    ],
    queries: [
      { brand: "H&M", q: "h&m women's jumpsuits" },
      { brand: "Zara", q: "zara women's jumpsuits" },
      { brand: "Tommy Hilfiger", q: "tommy hilfiger women's jumpsuits" },
    ],
    target: 50,
    maxBrandShare: 0.4,
    quality: "low",
    phase: "planned",
  },

  /* ===== Clothing / Outerwear ===== */
  {
    slug: "jackets",
    name: "Jackets",
    parent: "outerwear",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Clothing|Coats, Jackets & Vests",
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Coats, Jackets & Vests",
      "Clothing, Shoes & Accessories|Men|Men's Clothing|Activewear|Activewear Jackets",
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Activewear|Activewear Jackets",
    ],
    queries: [
      { brand: "The North Face", q: "the north face men's jackets" },
      { brand: "The North Face", q: "the north face women's jackets" },
      { brand: "Patagonia", q: "patagonia men's jackets" },
      { brand: "Nike", q: "nike men's jackets" },
      { brand: "Adidas", q: "adidas women's jackets" },
      { brand: "Columbia", q: "columbia men's jackets" },
    ],
    target: 300,
    maxBrandShare: 0.35,
    quality: "medium",
    phase: "importable",
  },
  {
    slug: "coats",
    name: "Coats",
    parent: "outerwear",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Clothing|Coats, Jackets & Vests|Coats",
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Coats, Jackets & Vests|Coats",
    ],
    queries: [
      { brand: "The North Face", q: "the north face men's coats" },
      { brand: "Columbia", q: "columbia women's coats" },
      { brand: "Patagonia", q: "patagonia women's coats" },
      { brand: "Armani", q: "armani men's coats" },
    ],
    target: 50,
    maxBrandShare: 0.35,
    quality: "medium",
    phase: "importable",
  },
  {
    slug: "blazers",
    name: "Blazers",
    parent: "outerwear",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Clothing|Suits & Blazers|Blazers",
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Blazers",
    ],
    queries: [
      { brand: "Tommy Hilfiger", q: "tommy hilfiger men's blazers" },
      { brand: "Calvin Klein", q: "calvin klein men's blazers" },
      { brand: "Ralph Lauren", q: "ralph lauren men's blazers" },
      { brand: "Zara", q: "zara women's blazers" },
      { brand: "Armani", q: "armani men's blazers" },
    ],
    target: 50,
    maxBrandShare: 0.35,
    quality: "medium",
    phase: "importable",
  },
  {
    slug: "parkas",
    name: "Parkas",
    parent: "outerwear",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Clothing|Coats, Jackets & Vests|Parkas",
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Coats, Jackets & Vests|Parkas",
    ],
    queries: [
      { brand: "The North Face", q: "the north face men's parkas" },
      { brand: "The North Face", q: "the north face women's parkas" },
      { brand: "Columbia", q: "columbia parkas" },
      { brand: "Patagonia", q: "patagonia men's parkas" },
    ],
    target: 50,
    maxBrandShare: 0.35,
    quality: "medium",
    phase: "importable",
  },
  {
    slug: "puffer-jackets",
    name: "Puffer Jackets",
    parent: "outerwear",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Clothing|Coats, Jackets & Vests|Puffer & Down Jackets",
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Coats, Jackets & Vests|Puffer & Down Jackets",
    ],
    queries: [
      { brand: "The North Face", q: "the north face puffer jacket men" },
      { brand: "The North Face", q: "the north face puffer jacket women" },
      { brand: "Columbia", q: "columbia puffer jacket" },
      { brand: "Patagonia", q: "patagonia down jacket" },
    ],
    target: 50,
    maxBrandShare: 0.35,
    quality: "medium",
    phase: "importable",
  },
  {
    slug: "vests",
    name: "Vests",
    parent: "outerwear",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Clothing|Coats, Jackets & Vests|Vests",
    ],
    queries: [
      { brand: "The North Face", q: "the north face men's vests" },
      { brand: "Columbia", q: "columbia men's vests" },
      { brand: "Patagonia", q: "patagonia men's vests" },
      { brand: "Nike", q: "nike men's vests" },
    ],
    target: 50,
    maxBrandShare: 0.35,
    quality: "medium",
    phase: "importable",
  },

  /* ===== Clothing / Sportswear ===== */
  {
    slug: "sports-tops",
    name: "Sports Tops",
    parent: "sportswear",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Clothing|Activewear|Activewear Tops",
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Activewear|Activewear Tops",
    ],
    queries: [
      { brand: "Nike", q: "nike men's sports tops" },
      { brand: "Adidas", q: "adidas women's sports tops" },
      { brand: "Under Armour", q: "under armour sports tops" },
      { brand: "Puma", q: "puma sports tops" },
      { brand: "Lululemon", q: "lululemon sports tops" },
    ],
    target: 50,
    maxBrandShare: 0.3,
    quality: "medium",
    phase: "importable",
  },
  {
    slug: "sports-bras",
    name: "Sports Bras",
    parent: "sportswear",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Activewear|Sports Bras",
    ],
    queries: [
      { brand: "Nike", q: "nike women's sports bras" },
      { brand: "Adidas", q: "adidas women's sports bras" },
      { brand: "Under Armour", q: "under armour women's sports bras" },
      { brand: "Lululemon", q: "lululemon women's sports bras" },
      { brand: "Champion", q: "champion women's sports bras" },
    ],
    target: 50,
    maxBrandShare: 0.3,
    quality: "medium",
    phase: "importable",
  },
  {
    slug: "track-pants",
    name: "Track Pants",
    parent: "sportswear",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Clothing|Activewear|Track Pants & Joggers",
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Activewear|Track Pants & Joggers",
    ],
    queries: [
      { brand: "Nike", q: "nike men's track pants" },
      { brand: "Adidas", q: "adidas men's track pants" },
      { brand: "Puma", q: "puma women's track pants" },
      { brand: "Under Armour", q: "under armour track pants" },
      { brand: "Lululemon", q: "lululemon women's track pants" },
    ],
    target: 50,
    maxBrandShare: 0.3,
    quality: "medium",
    phase: "importable",
  },
  {
    slug: "sports-shorts",
    name: "Sports Shorts",
    parent: "sportswear",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Clothing|Activewear|Activewear Shorts",
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Activewear|Activewear Shorts",
    ],
    queries: [
      { brand: "Nike", q: "nike men's sports shorts" },
      { brand: "Adidas", q: "adidas women's sports shorts" },
      { brand: "Under Armour", q: "under armour sports shorts" },
      { brand: "Puma", q: "puma sports shorts" },
    ],
    target: 50,
    maxBrandShare: 0.3,
    quality: "medium",
    phase: "importable",
  },

  /* ===== Clothing / Swimwear & Basics ===== */
  {
    slug: "swimwear",
    name: "Swimwear",
    parent: "swimwear-basics",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Clothing|Swimwear",
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Swimwear",
    ],
    queries: [
      { brand: "Nike", q: "nike men's swim trunks" },
      { brand: "Calvin Klein", q: "calvin klein women's swimwear" },
      { brand: "Tommy Hilfiger", q: "tommy hilfiger men's swimwear" },
      { brand: "Patagonia", q: "patagonia men's swim trunks" },
    ],
    target: 50,
    maxBrandShare: 0.35,
    quality: "low",
    phase: "planned",
  },
  {
    slug: "underwear",
    name: "Underwear",
    parent: "swimwear-basics",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Clothing|Underwear",
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Underwear",
    ],
    queries: [
      { brand: "Hanes", q: "hanes men's underwear" },
      { brand: "Fruit of the Loom", q: "fruit of the loom men's underwear" },
      { brand: "Calvin Klein", q: "calvin klein men's underwear" },
      { brand: "Champion", q: "champion men's underwear" },
    ],
    target: 50,
    maxBrandShare: 0.3,
    quality: "medium",
    phase: "importable",
  },
  {
    slug: "bras",
    name: "Bras",
    parent: "swimwear-basics",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Bras",
    ],
    queries: [
      { brand: "Hanes", q: "hanes women's bras" },
      { brand: "Calvin Klein", q: "calvin klein women's bras" },
      { brand: "Under Armour", q: "under armour women's bras" },
      { brand: "Lululemon", q: "lululemon women's bras" },
    ],
    target: 50,
    maxBrandShare: 0.3,
    quality: "medium",
    phase: "importable",
  },
  {
    slug: "socks",
    name: "Socks",
    parent: "swimwear-basics",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Clothing|Socks",
      "Clothing, Shoes & Accessories|Women|Women's Clothing|Socks",
    ],
    queries: [
      { brand: "Hanes", q: "hanes men's socks" },
      { brand: "Fruit of the Loom", q: "fruit of the loom socks" },
      { brand: "Nike", q: "nike men's athletic socks" },
      { brand: "Adidas", q: "adidas women's socks" },
      { brand: "Champion", q: "champion socks" },
    ],
    target: 50,
    maxBrandShare: 0.3,
    quality: "medium",
    phase: "importable",
  },
  /* ===== Accessories ===== */
  {
    slug: "watches",
    name: "Watches",
    parent: "accessories",
    sourceCategoryTokens: [
      "Jewelry & Watches|Watches|Wristwatches",
      "Clothing, Shoes & Accessories|Women|Women's Accessories|Watches",
    ],
    queries: [
      { brand: "Casio", q: "casio men's wristwatch" },
      { brand: "Seiko", q: "seiko men's wristwatch" },
      { brand: "Rolex", q: "rolex men's wristwatch" },
      { brand: "Omega", q: "omega men's wristwatch" },
      { brand: "Cartier", q: "cartier women's wristwatch" },
    ],
    target: 50,
    maxBrandShare: 0.3,
    quality: "high",
    phase: "importable",
    supportingSellers: [
      "watchgalactic",
      "watchshop",
      "luxury watches usa",
      "hist_92",
      "sflmaven",
    ],
  },
  {
    slug: "jewelry",
    name: "Jewelry",
    parent: "accessories",
    sourceCategoryTokens: [
      "Jewelry & Watches|Jewelry|Fine Jewelry",
      "Jewelry & Watches|Jewelry|Fashion Jewelry",
    ],
    queries: [
      { brand: "Cartier", q: "cartier jewelry necklace" },
      { brand: "Chanel", q: "chanel jewelry necklace" },
      { brand: "Dior", q: "dior jewelry bracelet" },
      { brand: "Hermès", q: "hermes ring jewelry" },
      { brand: "Gucci", q: "gucci jewelry earrings" },
      { brand: "Louis Vuitton", q: "louis vuitton jewelry necklace" },
    ],
    target: 50,
    maxBrandShare: 0.3,
    quality: "high",
    phase: "importable",
    supportingSellers: [
      "sflmaven",
      "chanel.i.love.chanel",
      "max pawn luxury",
      "maison de luxe store",
      "tailored-consignment",
      "reserved luxury",
    ],
  },
  {
    slug: "belts",
    name: "Belts",
    parent: "accessories",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Accessories|Belts",
      "Clothing, Shoes & Accessories|Women|Women's Accessories|Belts",
    ],
    queries: [
      { brand: "Gucci", q: "gucci men's leather belt" },
      { brand: "Saint Laurent", q: "saint laurent leather belt" },
      { brand: "Hermès", q: "hermes leather belt" },
      { brand: "Louis Vuitton", q: "louis vuitton belt" },
      { brand: "Burberry", q: "burberry belt men" },
      { brand: "Armani", q: "armani men's belt" },
      { brand: "Versace", q: "versace belt" },
    ],
    target: 50,
    maxBrandShare: 0.3,
    quality: "high",
    phase: "importable",
    supportingSellers: [
      "tailored-consignment",
      "reserved luxury",
      "maison de luxe store",
      "style haven official",
      "newbranditems",
      "dseef llc",
      "chanel.i.love.chanel",
      "max pawn luxury",
    ],
  },
  {
    slug: "ties-bow-ties",
    name: "Ties & Bow Ties",
    parent: "accessories",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Accessories|Ties",
      "Clothing, Shoes & Accessories|Men|Men's Accessories|Bow Ties",
    ],
    queries: [
      { brand: "Gucci", q: "gucci men's silk tie" },
      { brand: "Burberry", q: "burberry men's tie" },
      { brand: "Hermès", q: "hermes men's silk tie" },
      { brand: "Louis Vuitton", q: "louis vuitton tie" },
      { brand: "Hugo Boss", q: "hugo boss men's tie" },
      { brand: "Ralph Lauren", q: "ralph lauren men's tie" },
      { brand: "Tommy Hilfiger", q: "tommy hilfiger men's bow tie" },
    ],
    target: 50,
    maxBrandShare: 0.3,
    quality: "high",
    phase: "importable",
    supportingSellers: [
      "tailored-consignment",
      "style haven official",
      "maison de luxe store",
      "reserved luxury",
      "dseef llc",
      "bcarne1",
      "exclusiveforralphlauren",
      "reclothers2",
    ],
  },
  {
    slug: "handbags",
    name: "Handbags",
    parent: "bags",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Women|Women's Accessories|Handbags & Bags|Handbags",
      "Clothing, Shoes & Accessories|Women|Women's Bags & Handbags",
    ],
    queries: [
      { brand: "Gucci", q: "gucci women's handbag" },
      { brand: "Saint Laurent", q: "saint laurent handbag" },
      { brand: "Chanel", q: "chanel classic handbag" },
      { brand: "Dior", q: "dior lady handbag" },
      { brand: "Hermès", q: "hermes birkin handbag" },
      { brand: "Louis Vuitton", q: "louis vuitton handbag" },
    ],
    target: 50,
    maxBrandShare: 0.3,
    quality: "high",
    phase: "importable",
    supportingSellers: [
      "tailored-consignment",
      "reserved luxury",
      "chanel.i.love.chanel",
      "max pawn luxury",
      "maison de luxe store",
      "dseef llc",
      "style haven official",
    ],
  },
  /* ---- PLANNED Accessories leaves (no defensible existing seller coverage
     for these product types; deferred until reliable sources exist) ---- */
  {
    slug: "scarves-hijabs",
    name: "Scarves and Hijabs",
    parent: "accessories",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Women|Women's Accessories|Scarves",
      "Clothing, Shoes & Accessories|Women|Women's Accessories|Hijabs",
    ],
    queries: [
      { brand: "Burberry", q: "burberry scarf" },
      { brand: "Hermès", q: "hermes silk scarf" },
    ],
    target: 50,
    maxBrandShare: 0.3,
    quality: "unknown",
    phase: "planned",
  },
  {
    slug: "sunglasses",
    name: "Sunglasses",
    parent: "accessories",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Women|Women's Accessories|Sunglasses",
      "Health & Beauty|Health Care|Vision Care|Sunglasses",
    ],
    queries: [
      { brand: "Gucci", q: "gucci sunglasses" },
      { brand: "Dior", q: "dior sunglasses" },
    ],
    target: 50,
    maxBrandShare: 0.3,
    quality: "unknown",
    phase: "planned",
  },
  {
    slug: "wallets",
    name: "Wallets",
    parent: "bags",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Accessories|Wallets",
      "Clothing, Shoes & Accessories|Women|Women's Accessories|Wallets",
    ],
    queries: [
      { brand: "Gucci", q: "gucci wallet men's" },
      { brand: "Hermès", q: "hermes wallet women's" },
    ],
    target: 50,
    maxBrandShare: 0.3,
    quality: "unknown",
    phase: "planned",
  },
  {
    slug: "backpacks",
    name: "Backpacks",
    parent: "bags",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Bags|Backpacks",
      "Sporting Goods|Outdoor Sports|Backpacks",
    ],
    queries: [
      { brand: "The North Face", q: "the north face backpack" },
      { brand: "Patagonia", q: "patagonia backpack" },
    ],
    target: 50,
    maxBrandShare: 0.3,
    quality: "unknown",
    phase: "planned",
  },
  {
    slug: "shoulder-bags",
    name: "Shoulder Bags",
    parent: "bags",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Women|Women's Bags & Handbags|Shoulder Bags",
    ],
    queries: [
      { brand: "Gucci", q: "gucci shoulder bag" },
      { brand: "Chanel", q: "chanel shoulder bag" },
    ],
    target: 50,
    maxBrandShare: 0.3,
    quality: "unknown",
    phase: "planned",
  },
  {
    slug: "crossbody-bags",
    name: "Crossbody Bags",
    parent: "bags",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Women|Women's Bags & Handbags|Crossbody Bags",
    ],
    queries: [
      { brand: "Louis Vuitton", q: "louis vuitton crossbody bag" },
      { brand: "Gucci", q: "gucci crossbody bag" },
    ],
    target: 50,
    maxBrandShare: 0.3,
    quality: "unknown",
    phase: "planned",
  },
  {
    slug: "duffle-travel-bags",
    name: "Duffle & Travel Bags",
    parent: "bags",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Bags|Duffel Bags",
      "Luggage & Travel Accessories|Luggage|Duffel Bags",
    ],
    queries: [
      { brand: "The North Face", q: "the north face duffel bag" },
      { brand: "Adidas", q: "adidas duffel bag" },
    ],
    target: 50,
    maxBrandShare: 0.3,
    quality: "unknown",
    phase: "planned",
  },
  {
    slug: "bum-bags",
    name: "Bum Bags",
    parent: "bags",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Men|Men's Bags|Waist Packs",
      "Clothing, Shoes & Accessories|Women|Women's Bags & Handbags|Waist Packs",
    ],
    queries: [
      { brand: "Adidas", q: "adidas waist bag" },
      { brand: "Nike", q: "nike hip pack" },
    ],
    target: 50,
    maxBrandShare: 0.3,
    quality: "unknown",
    phase: "planned",
  },
  {
    slug: "tote-bags",
    name: "Tote Bags",
    parent: "bags",
    sourceCategoryTokens: [
      "Clothing, Shoes & Accessories|Women|Women's Bags & Handbags|Tote Bags",
    ],
    queries: [
      { brand: "Lululemon", q: "lululemon tote bag" },
      { brand: "Gucci", q: "gucci tote bag" },
    ],
    target: 50,
    maxBrandShare: 0.3,
    quality: "unknown",
    phase: "planned",
  },
];

/* ------------------------------------------------------------------ */
/* HIERARCHY: parent categories (parents before children)              */
/* ------------------------------------------------------------------ */

/* The full canonical parent tree. Roots have no parentSlug; intermediate
   groups name their parent. These are ensured by the bootstrap in order
   so parentId always resolves. */
export const PLAN_PARENT_CATEGORIES: Array<{ name: string; slug: string; parentSlug?: string | null }> = [
  /* roots */
  { name: "Clothing", slug: "clothing" },
  { name: "Shoes", slug: "shoes" },
  { name: "Accessories", slug: "accessories" },
  /* clothing level 1 */
  { name: "Tops", slug: "tops", parentSlug: "clothing" },
  { name: "Bottoms", slug: "bottoms", parentSlug: "clothing" },
  { name: "Dresses & Jumpsuits", slug: "dresses-jumpsuits", parentSlug: "clothing" },
  { name: "Outerwear", slug: "outerwear", parentSlug: "clothing" },
  { name: "Sportswear", slug: "sportswear", parentSlug: "clothing" },
  { name: "Swimwear & Basics", slug: "swimwear-basics", parentSlug: "clothing" },
  /* accessories level 1 */
  { name: "Bags", slug: "bags", parentSlug: "accessories" },
];

/* ------------------------------------------------------------------ */
/* LEAVES                                                              */
/* ------------------------------------------------------------------ */

/* Every canonical leaf the plan targets, with its parent slug. This is
   the authoritative list the bootstrap uses to create category rows. */
export const PLAN_LEAF_CATEGORIES: Array<{ name: string; slug: string; parentSlug: string }> = [
  /* shoes */
  { name: "Sneakers", slug: "sneakers", parentSlug: "shoes" },
  { name: "Boots", slug: "boots", parentSlug: "shoes" },
  { name: "Sandals", slug: "sandals", parentSlug: "shoes" },
  { name: "Heels", slug: "heels", parentSlug: "shoes" },
  { name: "Flats", slug: "flats", parentSlug: "shoes" },
  { name: "Loafers", slug: "loafers", parentSlug: "shoes" },
  { name: "Formal Shoes", slug: "formal-shoes", parentSlug: "shoes" },
  /* tops */
  { name: "T-Shirts", slug: "t-shirts", parentSlug: "tops" },
  { name: "Tank Tops", slug: "tank-tops", parentSlug: "tops" },
  { name: "Polo Shirts", slug: "polos", parentSlug: "tops" },
  { name: "Shirts", slug: "shirts", parentSlug: "tops" },
  { name: "Blouses", slug: "blouses", parentSlug: "tops" },
  { name: "Sweaters", slug: "sweaters", parentSlug: "tops" },
  { name: "Cardigans", slug: "cardigans", parentSlug: "tops" },
  { name: "Sweatshirts", slug: "sweatshirts", parentSlug: "tops" },
  { name: "Bodysuits", slug: "bodysuits", parentSlug: "tops" },
  { name: "Hoodies", slug: "hoodies", parentSlug: "tops" },
  /* bottoms */
  { name: "Jeans", slug: "jeans", parentSlug: "bottoms" },
  { name: "Trousers", slug: "trousers", parentSlug: "bottoms" },
  { name: "Chinos", slug: "chinos", parentSlug: "bottoms" },
  { name: "Cargo Pants", slug: "cargo", parentSlug: "bottoms" },
  { name: "Joggers", slug: "joggers", parentSlug: "bottoms" },
  { name: "Shorts", slug: "shorts", parentSlug: "bottoms" },
  { name: "Skirts", slug: "skirts", parentSlug: "bottoms" },
  { name: "Leggings", slug: "leggings", parentSlug: "bottoms" },
  /* dresses & jumpsuits */
  { name: "Dresses", slug: "dresses", parentSlug: "dresses-jumpsuits" },
  { name: "Jumpsuits", slug: "jumpsuits", parentSlug: "dresses-jumpsuits" },
  /* outerwear */
  { name: "Jackets", slug: "jackets", parentSlug: "outerwear" },
  { name: "Coats", slug: "coats", parentSlug: "outerwear" },
  { name: "Blazers", slug: "blazers", parentSlug: "outerwear" },
  { name: "Parkas", slug: "parkas", parentSlug: "outerwear" },
  { name: "Puffer Jackets", slug: "puffer-jackets", parentSlug: "outerwear" },
  { name: "Vests", slug: "vests", parentSlug: "outerwear" },
  /* sportswear */
  { name: "Sports Tops", slug: "sports-tops", parentSlug: "sportswear" },
  { name: "Sports Bras", slug: "sports-bras", parentSlug: "sportswear" },
  { name: "Track Pants", slug: "track-pants", parentSlug: "sportswear" },
  { name: "Sports Shorts", slug: "sports-shorts", parentSlug: "sportswear" },
  /* swimwear & basics */
  { name: "Swimwear", slug: "swimwear", parentSlug: "swimwear-basics" },
  { name: "Underwear", slug: "underwear", parentSlug: "swimwear-basics" },
  { name: "Bras", slug: "bras", parentSlug: "swimwear-basics" },
  { name: "Socks", slug: "socks", parentSlug: "swimwear-basics" },
  /* accessories - direct leaves under Accessories */
  { name: "Belts", slug: "belts", parentSlug: "accessories" },
  { name: "Scarves and Hijabs", slug: "scarves-hijabs", parentSlug: "accessories" },
  { name: "Ties & Bow Ties", slug: "ties-bow-ties", parentSlug: "accessories" },
  { name: "Sunglasses", slug: "sunglasses", parentSlug: "accessories" },
  { name: "Watches", slug: "watches", parentSlug: "accessories" },
  { name: "Jewelry", slug: "jewelry", parentSlug: "accessories" },
  /* accessories - leaves under the Bags parent (Bags itself is parent-only) */
  { name: "Handbags", slug: "handbags", parentSlug: "bags" },
  { name: "Backpacks", slug: "backpacks", parentSlug: "bags" },
  { name: "Shoulder Bags", slug: "shoulder-bags", parentSlug: "bags" },
  { name: "Crossbody Bags", slug: "crossbody-bags", parentSlug: "bags" },
  { name: "Duffle & Travel Bags", slug: "duffle-travel-bags", parentSlug: "bags" },
  { name: "Bum Bags", slug: "bum-bags", parentSlug: "bags" },
  { name: "Tote Bags", slug: "tote-bags", parentSlug: "bags" },
  { name: "Wallets", slug: "wallets", parentSlug: "bags" },
];

/* ------------------------------------------------------------------ */
/* BRANDS                                                              */
/* ------------------------------------------------------------------ */

/* The named brands the plan sources from. This is the union of every
   brand referenced by a plan query, plus the VERIFIED/canonical brands
   used for bootstrapping. Each must have a brand alias. */
export const PLAN_BRANDS: string[] = [
  /* retained original set */
  "Nike",
  "Adidas",
  "New Balance",
  "Puma",
  "Converse",
  "Vans",
  "Reebok",
  "Levi's",
  "Wrangler",
  "Diesel",
  "Tommy Hilfiger",
  "Calvin Klein",
  "Ralph Lauren",
  "Zara",
  "H&M",
  "DKNY",
  "The North Face",
  "Patagonia",
  "Columbia",
  "Champion",
  "Gildan",
  "Fruit of the Loom",
  "Under Armour",
  "Dockers",
  /* added for the expanded taxonomy (all carry existing seller-registry
     entries from Steps 10/11 - no new seller research) */
  "Hanes",
  "Crocs",
  "Clarks",
  "Wolverine",
  "Birkenstock",
  "Lululemon",
  "Burberry",
  "Armani",
  "Hugo Boss",
  /* accessory brands - each maps to an EXISTING seller-registry entry
     (watch stores and luxury/designer houses curated in Steps 10/11; no
     new seller research) */
  "Casio",
  "Seiko",
  "Rolex",
  "Omega",
  "Cartier",
  "Gucci",
  "Saint Laurent",
  "Chanel",
  "Dior",
  "Hermès",
  "Louis Vuitton",
  "Versace",
];

/* Brand alias rows: canonical brand name -> one or more source tokens
   (folded to lowercase at insert; a single token covers case variants).
   These are the ONLY brand aliases we create - never Unbranded / No Brand
   / generic product brands. */
export const PLAN_BRAND_ALIASES: Array<{ brand: string; tokens: string[] }> = [
  { brand: "Nike", tokens: ["nike", "jordan"] },
  { brand: "Adidas", tokens: ["adidas"] },
  { brand: "New Balance", tokens: ["new balance"] },
  { brand: "Puma", tokens: ["puma"] },
  { brand: "Converse", tokens: ["converse"] },
  { brand: "Vans", tokens: ["vans"] },
  { brand: "Reebok", tokens: ["reebok", "reebook"] },
  { brand: "Levi's", tokens: ["levi's", "levis"] },
  { brand: "Wrangler", tokens: ["wrangler"] },
  { brand: "Diesel", tokens: ["diesel"] },
  { brand: "Tommy Hilfiger", tokens: ["tommy hilfiger"] },
  { brand: "Calvin Klein", tokens: ["calvin klein"] },
  { brand: "Ralph Lauren", tokens: ["ralph lauren"] },
  { brand: "Zara", tokens: ["zara"] },
  { brand: "H&M", tokens: ["h&m", "hm"] },
  { brand: "DKNY", tokens: ["dkny"] },
  { brand: "The North Face", tokens: ["the north face", "north face"] },
  { brand: "Patagonia", tokens: ["patagonia"] },
  { brand: "Columbia", tokens: ["columbia"] },
  { brand: "Champion", tokens: ["champion"] },
  { brand: "Gildan", tokens: ["gildan"] },
  { brand: "Fruit of the Loom", tokens: ["fruit of the loom"] },
  { brand: "Under Armour", tokens: ["under armour", "underarmour"] },
  { brand: "Dockers", tokens: ["dockers"] },
  { brand: "Hanes", tokens: ["hanes"] },
  { brand: "Crocs", tokens: ["crocs"] },
  { brand: "Clarks", tokens: ["clarks"] },
  { brand: "Wolverine", tokens: ["wolverine"] },
  { brand: "Birkenstock", tokens: ["birkenstock", "birk"] },
  { brand: "Lululemon", tokens: ["lululemon", "lulu"] },
  { brand: "Burberry", tokens: ["burberry"] },
  { brand: "Armani", tokens: ["armani", "giorgio armani"] },
  { brand: "Hugo Boss", tokens: ["hugo boss", "boss"] },
  { brand: "Casio", tokens: ["casio"] },
  { brand: "Seiko", tokens: ["seiko"] },
  { brand: "Rolex", tokens: ["rolex"] },
  { brand: "Omega", tokens: ["omega"] },
  { brand: "Cartier", tokens: ["cartier"] },
  { brand: "Gucci", tokens: ["gucci"] },
  { brand: "Saint Laurent", tokens: ["saint laurent", "ysl"] },
  { brand: "Chanel", tokens: ["chanel"] },
  { brand: "Dior", tokens: ["dior", "christian dior"] },
  { brand: "Hermès", tokens: ["hermes", "hermès"] },
  { brand: "Louis Vuitton", tokens: ["louis vuitton", "lv"] },
  { brand: "Versace", tokens: ["versace"] },
];

/* ------------------------------------------------------------------ */
/* HELPERS                                                             */
/* ------------------------------------------------------------------ */

/* The importable (first-wave) plans - the set the live importer runs by
   default. PLANNED categories (loafers, formal-shoes, bodysuits,
   jumpsuits, swimwear) are excluded until they gain seller/brand
   coverage or --include-planned is passed. */
export function importablePlans(): CategoryPlan[] {
  return CATEGORY_PLANS.filter((p) => p.phase === "importable");
}

/* The plans intentionally deferred to a future phase. */
export function plannedPlans(): CategoryPlan[] {
  return CATEGORY_PLANS.filter((p) => p.phase === "planned");
}

/* The full unique list of discovery query strings across the given plans
   (feeds the adapter's multi-query mode and diagnostics). */
export function allPlanQueries(plans: CategoryPlan[] = CATEGORY_PLANS): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const plan of plans) {
    for (const { q } of plan.queries) {
      if (seen.has(q)) continue;
      seen.add(q);
      out.push(q);
    }
  }
  return out;
}

/* Every plan slug - a helper to assert no duplicate category identities. */
export function planSlugs(): string[] {
  return CATEGORY_PLANS.map((p) => p.slug);
}

/* ---- diversity helper ---- */

/* Given per-brand product counts within a category, report whether any
   single brand exceeds the category's maxBrandShare ceiling. Used by the
   diagnostics to flag dominance BEFORE expanding a category. */
export function brandDominanceFlags(
  categorySlug: string,
  counts: Array<{ brand: string; count: number }>
): Array<{ brand: string; count: number; share: number; maxShare: number }> {
  const plan = CATEGORY_PLANS.find((p) => p.slug === categorySlug);
  if (!plan) return [];
  const total = counts.reduce((s, c) => s + c.count, 0);
  if (total === 0) return [];
  const reportAbove = 0.05;
  const flags: Array<{ brand: string; count: number; share: number; maxShare: number }> = [];
  for (const c of counts) {
    const share = c.count / total;
    if (share >= reportAbove && share > plan.maxBrandShare) {
      flags.push({ brand: c.brand, count: c.count, share, maxShare: plan.maxBrandShare });
    }
  }
  return flags;
}
