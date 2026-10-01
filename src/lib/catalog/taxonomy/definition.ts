/**
 * Central application-layer taxonomy definition.
 *
 * The tree is DATA-DRIVEN and variable-depth: every node declares
 * `children`, and the questionnaire flow is derived purely from that
 * shape (see ./flow.ts). Nothing in the UI branches on a specific
 * category name.
 *
 * - Stable IDs are machine keys, decoupled from display labels.
 * - `mapTo` = legacy DB category display names, so the existing
 *   product filtering / search / recommendation logic is untouched.
 * - `tokens` = free-text query tokens contributed by the node.
 * - `crossTags` = cross-cutting labels (e.g. "activewear"). A
 *   cross-tag is NEVER a questionnaire step - it only widens search.
 * - `type` describes the node's role; the questionnaire cares about
 *   `children`, not about `type`.
 * - No DB renames: existing category slugs/names stay as they are.
 */

/** The role of a node inside the hierarchy. */
export type TaxonomyNodeType =
  | "category"
  | "subcategory"
  | "style"
  | "fit"
  | "variant"
  | "attribute";

export type TaxonomyGender = "MEN" | "WOMEN" | "KIDS";

/** Kids age brackets, the filterable kids attribute. */
export type KidsAge =
  | "all"
  | "0-3"
  | "4-14";

export interface TaxonomyNode {
  /** Stable ID, always <gender>_<ancestor slugs...>. */
  id: string;
  label: string;
  type: TaxonomyNodeType;
  gender: TaxonomyGender;
  /** Selectable child node IDs. Empty = leaf. */
  children: string[];
  /** Parent node id (null for a root). */
  parentId: string | null;
  /** True when this node is a real catalog category (vs. a style). */
  categoryLike: boolean;
  /** Legacy DB category display names this node maps to. */
  mapTo: string[];
  /** Query tokens contributed when this node is on the selected path. */
  tokens: string[];
  /** Cross-cutting labels (search-time only, never a step). */
  crossTags: string[];
  /** Kids age brackets this node covers. */
  age: KidsAge[];
  /**
   * Whether reaching this node requires the Size step. Accessories
   * without a conventional size set this false so the flow continues
   * to the next applicable attribute instead of forcing a size.
   */
  requiresSize: boolean;
}

export interface TaxonomyGenderTree {
  gender: TaxonomyGender;
  /** Root-level selectable nodes (the first questionnaire level). */
  roots: string[];
  nodes: Record<string, TaxonomyNode>;
}

export interface AppTaxonomy {
  version: string;
  trees: Record<TaxonomyGender, TaxonomyGenderTree>;
  /** Old DB slug -> new taxonomy IDs (reference only; no renames). */
  migrationMap: Record<string, string[]>;
}

/* ------------------------------------------------------------------ */
/* Builder                                                              */
/* ------------------------------------------------------------------ */

type Spec = {
  label: string;
  type: TaxonomyNodeType;
  /* real category row (non-style) */
  category?: boolean;
  mapTo?: string[];
  tokens?: string[];
  crossTags?: string[];
  age?: KidsAge[];
  requiresSize?: boolean;
  children?: Spec[];
};

/* Nodes whose subtree never needs the Size step (small accessories). */
const NO_SIZE = false;
const SIZE = true;

/* Fits/styles shared across genders where the vocabulary is identical. */
const DENIM_FITS = [
  "Skinny",
  "Slim",
  "Regular",
  "Straight",
  "Tapered",
  "Bootcut",
  "Relaxed",
  "Loose/Baggy",
];

/* Offered after every suit type, so the type level is never terminal. */
const SUIT_FITS = ["Slim", "Modern", "Classic"];

function fit(label: string): Spec {
  return {
    label,
    type: "fit",
    tokens: [label.toLowerCase()],
  };
}

function style(label: string, extra: Partial<Spec> = {}): Spec {
  return {
    label,
    type: "style",
    tokens: [label.toLowerCase()],
    ...extra,
  };
}

function slugPart(label: string): string {
  return label
    .toLowerCase()
    /* hyphens inside a compound word collapse ("T-Shirts" -> tshirts) */
    .replace(/[-']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function build(
  gender: TaxonomyGender,
  genderPrefix: string,
  specs: Spec[]
): TaxonomyGenderTree {
  const nodes: Record<string, TaxonomyNode> = {};

  const walk = (
    spec: Spec,
    parentId: string | null
  ): string => {
    const id = parentId
      ? `${parentId}_${slugPart(spec.label)}`
      : `${genderPrefix}_${slugPart(spec.label)}`;

    const childIds: string[] = [];
    const children = spec.children ?? [];
    for (const child of children) {
      childIds.push(walk(child, id));
    }

    nodes[id] = {
      id,
      label: spec.label,
      type: spec.type,
      gender,
      children: childIds,
      parentId,
      categoryLike:
        spec.category ??
        (spec.type === "category" || spec.type === "subcategory"),
      mapTo: spec.mapTo ?? [],
      tokens: spec.tokens ?? [],
      crossTags: spec.crossTags ?? [],
      age: spec.age ?? [],
      requiresSize: spec.requiresSize ?? SIZE,
    };
    return id;
  };

  const roots = specs.map((spec) => walk(spec, null));

  return { gender, roots, nodes };
}

/* ------------------------------------------------------------------ */
/* Men's taxonomy                                                       */
/* ------------------------------------------------------------------ */

const MEN_SPECS: Spec[] = [
  {
    label: "Tops",
    type: "category",
    children: [
      {
        label: "Shirts",
        type: "subcategory",
        mapTo: ["Shirts"],
        tokens: ["shirt", "shirts"],
        children: [
          {
            label: "Dress Shirts",
            type: "subcategory",
            tokens: ["dress shirt", "dress shirts"],
            children: [
              fit("Formal Fit"),
              fit("Classic Fit"),
              fit("Slim Fit"),
              fit("Super Slim Fit"),
              fit("Athletic Fit"),
            ],
          },
          {
            label: "Casual Shirts",
            type: "subcategory",
            tokens: ["casual shirt", "casual shirts"],
            children: [
              style("Oxford Button-Down", { tokens: ["oxford", "button down"] }),
              style("Flannel/Plaid", { tokens: ["flannel", "plaid"] }),
              style("Denim", { tokens: ["denim shirt"] }),
              style("Linen", { tokens: ["linen"] }),
              style("Cuban Collar", { tokens: ["cuban collar"] }),
            ],
          },
        ],
      },
      {
        label: "T-Shirts & Polos",
        type: "subcategory",
        mapTo: ["T-Shirts", "Polo Shirts"],
        tokens: ["tshirt", "tshirts", "tee", "tees", "polo", "polos"],
        children: [
          {
            label: "Basic T-Shirts",
            type: "subcategory",
            mapTo: ["T-Shirts"],
            children: [
              style("Crewneck", { tokens: ["crewneck", "crew neck"] }),
              style("V-Neck", { tokens: ["v neck", "vneck"] }),
              style("Henley", { tokens: ["henley"] }),
              style("Longline", { tokens: ["longline"] }),
              style("Oversized", { tokens: ["oversized"] }),
            ],
          },
          {
            label: "Polo Shirts",
            type: "subcategory",
            mapTo: ["Polo Shirts"],
            children: [
              style("Pique Cotton", { tokens: ["pique", "pique cotton"] }),
              style("Knit Polo", { tokens: ["knit polo", "knitted polo"] }),
            ],
          },
          {
            label: "Tank Tops & Sleeveless",
            type: "subcategory",
            mapTo: ["Tank Tops"],
            crossTags: ["activewear"],
            tokens: ["tank", "tanks", "tanktop", "tanktops", "sleeveless"],
          },
        ],
      },
      {
        label: "Sweaters & Knitwear",
        type: "subcategory",
        mapTo: ["Sweaters", "Cardigans", "Sweatshirts", "Hoodies"],
        tokens: ["sweater", "sweaters", "knitwear", "jumper", "jumpers"],
        children: [
          {
            label: "Pullovers",
            type: "subcategory",
            mapTo: ["Sweaters", "Jumpers"],
            children: [
              style("Turtleneck", { tokens: ["turtleneck", "turtle neck"] }),
              style("Mock Neck", { tokens: ["mock neck"] }),
              style("V-Neck Knit", { tokens: ["v neck knit"] }),
              style("Cable Knit", { tokens: ["cable knit"] }),
            ],
          },
          {
            label: "Cardigans",
            type: "subcategory",
            mapTo: ["Cardigans"],
            children: [
              style("Buttoned", { tokens: ["buttoned cardigan"] }),
              style("Zippered", { tokens: ["zip cardigan", "zippered"] }),
              style("Shawl Collar", { tokens: ["shawl collar"] }),
            ],
          },
          {
            label: "Sweatshirts",
            type: "subcategory",
            mapTo: ["Sweatshirts"],
            crossTags: ["activewear"],
            children: [
              style("Crewneck", { tokens: ["crewneck sweatshirt"] }),
              style("Pullover", { tokens: ["pullover sweatshirt"] }),
              style("Zip-Up", { tokens: ["zip up sweatshirt"] }),
            ],
          },
          {
            label: "Hoodies",
            type: "subcategory",
            mapTo: ["Hoodies"],
            crossTags: ["activewear"],
            children: [
              style("Pullover Hoodies", { tokens: ["pullover hoodie"] }),
              style("Zip-Up Hoodies", { tokens: ["zip up hoodie"] }),
            ],
          },
        ],
      },
      {
        label: "Bodysuits",
        type: "subcategory",
        mapTo: ["Bodysuits"],
        tokens: ["bodysuit", "bodysuits"],
      },
      {
        label: "Performance Tops",
        type: "subcategory",
        mapTo: ["Sports Tops"],
        crossTags: ["activewear"],
        tokens: ["sports tops", "sportswear", "gym top"],
        children: [
          style("Compression Tops", { tokens: ["compression"] }),
          style("Gym Tank Tops", { tokens: ["gym tank"], mapTo: ["Tank Tops"] }),
        ],
      },
    ],
  },
  {
    label: "Bottoms",
    type: "category",
    children: [
      {
        label: "Jeans",
        type: "subcategory",
        mapTo: ["Jeans"],
        tokens: ["jeans", "denim"],
        children: DENIM_FITS.map((label) => fit(label)),
      },
      {
        label: "Trousers & Pants",
        type: "subcategory",
        mapTo: ["Trousers", "Chinos", "Cargo Pants"],
        tokens: ["trousers", "pants"],
        children: [
          {
            label: "Dress Pants",
            type: "subcategory",
            mapTo: ["Trousers"],
            children: [
              style("Flat Front", { tokens: ["flat front"] }),
              style("Pleated", { tokens: ["pleated"] }),
            ],
          },
          {
            label: "Chinos",
            type: "subcategory",
            mapTo: ["Chinos"],
            children: [
              style("Classic Chino", { tokens: ["chino"] }),
              style("Slim Chino", { tokens: ["slim chino"] }),
            ],
          },
{
            label: "Cargo Pants",
            type: "subcategory",
            mapTo: ["Cargo Pants"],
            tokens: ["cargo", "cargo pants"],
            children: [
              style("Slim Cargo", { tokens: ["slim cargo"] }),
              style("Utility Baggy Cargo", { tokens: ["utility cargo", "baggy cargo"] }),
            ],
          },
          {
            label: "Parachute Pants",
            type: "subcategory",
            mapTo: ["Trousers"],
            tokens: ["parachute pants", "parachute"],
          },
          {
            label: "Performance Bottoms",
            type: "subcategory",
            mapTo: ["Track Pants"],
            crossTags: ["activewear"],
            tokens: ["track pants", "trackpants", "performance pants"],
            children: [
              style("Compression Bottoms", { tokens: ["compression"] }),
              style("Mesh Running Shorts", { tokens: ["mesh shorts"], mapTo: ["Sports Shorts"] }),
              style("Track Pants", { tokens: ["track pants"], mapTo: ["Track Pants"] }),
            ],
          },
        ],
      },
      {
        label: "Cargo Pants",
        type: "subcategory",
        mapTo: ["Cargo Pants"],
        tokens: ["cargo", "cargo pants"],
        children: [
          style("Slim Cargo", { tokens: ["slim cargo"] }),
          style("Utility Baggy Cargo", { tokens: ["utility cargo", "baggy cargo"] }),
        ],
      },
      {
        label: "Joggers & Sweatpants",
        type: "subcategory",
        mapTo: ["Joggers"],
        crossTags: ["activewear"],
        tokens: ["joggers", "jogger", "sweatpants"],
        children: [
          style("Fleece", { tokens: ["fleece joggers", "fleece"] }),
          style("Cargo", { tokens: ["cargo joggers", "cargo"] }),
          style("Twill", { tokens: ["twill joggers", "twill"] }),
        ],
      },
      {
        label: "Shorts",
        type: "subcategory",
        mapTo: ["Shorts"],
        tokens: ["shorts", "short"],
        children: [
          style("Chino Shorts", { tokens: ["chino shorts"] }),
          style("Denim Shorts", { tokens: ["denim shorts"] }),
          style("Cargo Shorts", { tokens: ["cargo shorts"] }),
          style("Sweat Shorts", { tokens: ["sweat shorts"], crossTags: ["activewear"] }),
          style("Bermuda Shorts", { tokens: ["bermuda shorts", "bermudas"] }),
        ],
      },
      {
        label: "Swim Trunks",
        type: "subcategory",
        mapTo: ["Swimwear"],
        tokens: ["swim trunks", "swimwear"],
        children: [
          style("Board Shorts", { tokens: ["board shorts"] }),
          style("Rash Guards", { tokens: ["rash guard"] }),
        ],
      },
    ],
  },
  {
    label: "One-Pieces",
    type: "category",
    children: [
      {
        label: "Suits & Tailoring",
        type: "subcategory",
        mapTo: ["Blazers"],
        tokens: ["suit", "suits", "tailoring"],
        children: [
          {
            label: "Suits",
            type: "subcategory",
            mapTo: ["Blazers"],
            tokens: ["suit", "suits"],
            children: [
              {
                label: "Suit Type",
                type: "variant",
                children: [
                  {
                    label: "Two-Piece",
                    type: "style",
                    tokens: ["two piece suit", "two piece"],
                    children: SUIT_FITS.map((label) => fit(label)),
                  },
                  {
                    label: "Three-Piece",
                    type: "style",
                    tokens: ["three piece suit", "three piece"],
                    children: SUIT_FITS.map((label) => fit(label)),
                  },
                ],
              },
            ],
          },
          {
            label: "Tuxedos",
            type: "subcategory",
            mapTo: ["Blazers"],
            tokens: ["tuxedo", "tuxedos", "dinner suit"],
            children: [
              {
                label: "Lapel Style",
                type: "variant",
                children: [
                  style("Shawl Lapel", { tokens: ["shawl lapel"] }),
                  style("Peak Lapel", { tokens: ["peak lapel"] }),
                ],
              },
              fit("Slim Fit"),
              fit("Classic Fit"),
            ],
          },
          {
            label: "Blazers & Sport Coats",
            type: "subcategory",
            mapTo: ["Blazers"],
            tokens: ["blazer", "blazers", "sport coat"],
          },
        ],
      },
      {
        label: "Jumpsuits & Overalls",
        type: "subcategory",
        mapTo: ["Jumpsuits"],
        tokens: ["jumpsuit", "jumpsuits", "overalls"],
        children: [
          style("Jumpsuits", { tokens: ["jumpsuit"] }),
          style("Overalls/Dungarees", { tokens: ["overalls", "dungarees"] }),
          style("Boilersuits", { tokens: ["boilersuit", "coverall"] }),
        ],
      },
    ],
  },
  {
    label: "Outerwear",
    type: "category",
    children: [
      {
        label: "Jackets",
        type: "subcategory",
        mapTo: ["Jackets"],
        tokens: ["jacket", "jackets"],
        children: [
          style("Bomber Jackets", { tokens: ["bomber", "bomber jacket"] }),
          style("Leather Jackets", { tokens: ["leather jacket"] }),
          style("Trucker Denim Jackets", { tokens: ["trucker", "denim jacket"] }),
          style("Windbreakers", { tokens: ["windbreaker"] }),
          style("Track Jackets", { tokens: ["track jacket"], crossTags: ["activewear"] }),
        ],
      },
      {
        label: "Coats",
        type: "subcategory",
        mapTo: ["Coats", "Parkas", "Puffer Jackets"],
        tokens: ["coat", "coats"],
        children: [
          style("Trench Coats", { tokens: ["trench coat", "trench"] }),
          style("Overcoats/Wool Coats", { tokens: ["wool coat", "overcoat"] }),
          style("Puffer Coats", { tokens: ["puffer coat"] }),
          style("Parkas", { tokens: ["parka", "parkas"] }),
        ],
      },
      {
        label: "Vests",
        type: "subcategory",
        mapTo: ["Vests"],
        tokens: ["vest", "vests", "waistcoat"],
      },
      {
        label: "Tracksuits",
        type: "subcategory",
        mapTo: ["Sports Tops"],
        crossTags: ["activewear"],
        tokens: ["tracksuit", "tracksuits"],
      },
    ],
  },
  {
    label: "Underwear & Sleepwear",
    type: "category",
    children: [
      {
        label: "Underwear",
        type: "subcategory",
        mapTo: ["Underwear"],
        tokens: ["underwear", "boxers", "briefs"],
        children: [
          style("Boxer Briefs", { tokens: ["boxer briefs"] }),
          style("Briefs", { tokens: ["briefs"] }),
          style("Undershirts", { tokens: ["undershirt"] }),
          style("Thermal Layers", { tokens: ["thermal"] }),
        ],
      },
      {
        label: "Sleepwear",
        type: "subcategory",
        mapTo: ["Underwear"],
        tokens: ["pajamas", "sleepwear"],
        children: [
          style("Pajama Sets", { tokens: ["pajama set"] }),
          style("Robes", { tokens: ["robe", "robes"] }),
        ],
      },
      {
        label: "Socks",
        type: "subcategory",
        mapTo: ["Socks"],
        tokens: ["socks", "sock"],
      },
    ],
  },
  {
    label: "Shoes",
    type: "category",
    children: [
      {
        label: "Dress Shoes",
        type: "subcategory",
        mapTo: ["Formal Shoes"],
        tokens: ["dress shoes", "formal shoes"],
        children: [
          style("Oxfords", { tokens: ["oxfords", "oxford"] }),
          style("Derbies", { tokens: ["derbies", "derby"] }),
          style("Loafers", { tokens: ["loafers", "loafer"], mapTo: ["Loafers"] }),
          style("Monk Straps", { tokens: ["monk strap", "monk straps"] }),
          style("Chelsea Boots", { tokens: ["chelsea boots"], mapTo: ["Boots"] }),
        ],
      },
      {
        label: "Casual & Sneakers",
        type: "subcategory",
        mapTo: ["Sneakers"],
        crossTags: ["activewear"],
        tokens: ["sneakers", "trainer", "trainers"],
        children: [
          style("Running Shoes", { tokens: ["running shoes"], mapTo: ["Running Trainers"] }),
          style("Gym Sneakers", { tokens: ["gym sneakers"] }),
          style("White Canvas Sneakers", { tokens: ["canvas sneakers"] }),
        ],
      },
      {
        label: "Sandals & Slides",
        type: "subcategory",
        mapTo: ["Sandals"],
        tokens: ["sandals", "sandal"],
      },
      {
        label: "Boots",
        type: "subcategory",
        mapTo: ["Boots"],
        tokens: ["boots", "boot"],
      },
    ],
  },
  {
    label: "Accessories",
    type: "category",
    children: [
      {
        label: "Belts",
        type: "subcategory",
        mapTo: ["Belts"],
        requiresSize: NO_SIZE,
        tokens: ["belt", "belts"],
      },
      {
        label: "Ties & Bow Ties",
        type: "subcategory",
        mapTo: ["Ties & Bow Ties"],
        requiresSize: NO_SIZE,
        tokens: ["tie", "ties", "bow tie"],
      },
      {
        label: "Sunglasses",
        type: "subcategory",
        mapTo: ["Sunglasses"],
        requiresSize: NO_SIZE,
        tokens: ["sunglasses", "sunglass"],
      },
      {
        label: "Watches",
        type: "subcategory",
        mapTo: ["Watches"],
        requiresSize: NO_SIZE,
        tokens: ["watch", "watches"],
      },
      {
        label: "Jewelry",
        type: "subcategory",
        mapTo: ["Jewelry"],
        requiresSize: NO_SIZE,
        tokens: ["jewelry", "jewellery"],
        children: [
          style("Necklaces", { tokens: ["necklace"] }),
          style("Bracelets", { tokens: ["bracelet"] }),
          style("Rings", { tokens: ["ring", "rings"] }),
        ],
      },
      {
        label: "Scarves & Hijabs",
        type: "subcategory",
        mapTo: ["Scarves and Hijabs"],
        requiresSize: NO_SIZE,
        tokens: ["scarves", "scarf"],
      },
      {
        label: "Headwear",
        type: "subcategory",
        mapTo: ["Beanies", "Hats", "Caps"],
        tokens: ["beanies", "hats", "caps"],
        children: [
          style("Beanies", { tokens: ["beanie"], mapTo: ["Beanies"] }),
          style("Hats", { tokens: ["hat"], mapTo: ["Hats"] }),
          style("Caps", { tokens: ["cap", "baseball cap"], mapTo: ["Caps"] }),
        ],
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Women's taxonomy                                                     */
/* ------------------------------------------------------------------ */

const WOMEN_SPECS: Spec[] = [
  {
    label: "Tops",
    type: "category",
    children: [
      {
        label: "Shirts & Blouses",
        type: "subcategory",
        mapTo: ["Shirts", "Blouses"],
        tokens: ["shirt", "shirts", "blouse", "blouses"],
        children: [
          {
            label: "Button-Down Shirts",
            type: "subcategory",
            mapTo: ["Shirts"],
            children: [
              style("Classic Fit", { tokens: ["classic fit"] }),
              style("Oversized", { tokens: ["oversized"] }),
              style("Cropped", { tokens: ["cropped"] }),
            ],
          },
          {
            label: "Blouses",
            type: "subcategory",
            mapTo: ["Blouses"],
            children: [
              style("Chiffon", { tokens: ["chiffon"] }),
              style("Silk", { tokens: ["silk"] }),
              style("Lace", { tokens: ["lace"] }),
            ],
          },
        ],
      },
      {
        label: "T-Shirts & Basics",
        type: "subcategory",
        mapTo: ["T-Shirts", "Tank Tops"],
        tokens: ["tshirt", "tshirts", "tee", "tees"],
        children: [
          {
            label: "Basic T-Shirts",
            type: "subcategory",
            mapTo: ["T-Shirts"],
            children: [
              style("Crewneck", { tokens: ["crewneck"] }),
              style("V-Neck", { tokens: ["v neck"] }),
              style("Longline", { tokens: ["longline"] }),
              style("Boxy", { tokens: ["boxy"] }),
            ],
          },
          {
            label: "Tank Tops & Camisoles",
            type: "subcategory",
            mapTo: ["Tank Tops"],
            crossTags: ["activewear"],
            tokens: ["tank", "tanks", "camisole"],
            children: [
              style("Camisole", { tokens: ["camisole"] }),
              style("Tube Top", { tokens: ["tube top"] }),
              style("Bandeau", { tokens: ["bandeau"] }),
            ],
          },
          {
            label: "Corsets & Bodysuits",
            type: "subcategory",
            mapTo: ["Bodysuits"],
            tokens: ["bodysuit", "bodysuits", "corset"],
          },
        ],
      },
      {
        label: "Sweaters & Knitwear",
        type: "subcategory",
        mapTo: ["Sweaters", "Cardigans", "Sweatshirts", "Hoodies"],
        tokens: ["sweater", "sweaters", "jumper", "jumpers", "knitwear"],
        children: [
          {
            label: "Pullovers",
            type: "subcategory",
            mapTo: ["Sweaters", "Jumpers"],
            children: [
              style("Turtleneck", { tokens: ["turtleneck"] }),
              style("V-Neck Knit", { tokens: ["v neck knit"] }),
              style("Cropped Knit", { tokens: ["cropped knit"] }),
            ],
          },
          {
            label: "Cardigans",
            type: "subcategory",
            mapTo: ["Cardigans"],
            children: [
              style("Buttoned", { tokens: ["buttoned cardigan"] }),
              style("Longline", { tokens: ["longline cardigan"] }),
            ],
          },
          {
            label: "Sweatshirts & Hoodies",
            type: "subcategory",
            mapTo: ["Sweatshirts", "Hoodies"],
            crossTags: ["activewear"],
            tokens: ["sweatshirt", "hoodie"],
            children: [
              style("Crewneck", { tokens: ["crewneck"] }),
              style("Pullover Hoodies", { tokens: ["pullover hoodie"] }),
              style("Zip-Up Hoodies", { tokens: ["zip up hoodie"] }),
            ],
          },
          {
            label: "Yoga & Studio Tops",
            type: "subcategory",
            mapTo: ["Sports Tops"],
            crossTags: ["activewear"],
            tokens: ["yoga top", "studio top"],
            children: [
              style("Yoga Tops", { tokens: ["yoga top"], mapTo: ["Sports Tops"] }),
              style("Longline Tops", { tokens: ["longline top"] }),
              style("Sports Bras", {
                mapTo: ["Sports Bras"],
                tokens: ["sports bra", "sports bras"],
                crossTags: ["activewear"],
                children: [
                  style("High Impact", { tokens: ["high impact"] }),
                  style("Medium Support", { tokens: ["medium support"] }),
                  style("Low Impact", { tokens: ["low impact"] }),
                ],
              }),
            ],
          },
        ],
      },
    ],
  },
  {
    label: "Bottoms",
    type: "category",
    children: [
      {
        label: "Jeans",
        type: "subcategory",
        mapTo: ["Jeans"],
        tokens: ["jeans", "denim"],
        children: [
          "Skinny",
          "Slim",
          "Regular",
          "Straight",
          "Tapered",
          "Bootcut & Flare",
          "Wide-Leg",
          "Mom Jeans",
          "Boyfriend Jeans",
        ].map((label) => fit(label)),
      },
      {
        label: "Trousers & Pants",
        type: "subcategory",
        mapTo: ["Trousers", "Chinos", "Leggings"],
        tokens: ["trousers", "pants"],
        children: [
          {
            label: "Tailored Trousers",
            type: "subcategory",
            mapTo: ["Trousers"],
            children: [
              style("Palazzo", { tokens: ["palazzo"] }),
              style("Culottes", { tokens: ["culottes"] }),
              style("Cigarette", { tokens: ["cigarette"] }),
              style("Wide-Leg Trousers", { tokens: ["wide leg trousers"] }),
            ],
          },
          {
            label: "Chinos",
            type: "subcategory",
            mapTo: ["Chinos"],
          },
          {
            label: "Leggings & Jeggings",
            type: "subcategory",
            mapTo: ["Leggings"],
            crossTags: ["activewear"],
            tokens: ["leggings", "jeggings"],
            children: [
              style("Classic", { tokens: ["classic leggings"] }),
              style("Distressed", { tokens: ["distressed"] }),
            ],
          },
          {
            label: "Joggers & Sweatpants",
            type: "subcategory",
            mapTo: ["Joggers"],
            crossTags: ["activewear"],
            tokens: ["joggers", "sweatpants"],
            children: [
              style("Fleece Joggers", { tokens: ["fleece joggers"] }),
              style("Cargo Joggers", { tokens: ["cargo joggers"] }),
            ],
          },
        ],
      },
{
        label: "Skirts",
        type: "subcategory",
        mapTo: ["Skirts"],
        tokens: ["skirt", "skirts"],
        children: [
          style("Pencil", { tokens: ["pencil skirt"] }),
          style("Pleated", { tokens: ["pleated skirt"] }),
          style("A-Line", { tokens: ["a line skirt"] }),
          style("Slit", { tokens: ["slit skirt"] }),
          style("Tiered & Ruffle", { tokens: ["tiered skirt", "ruffle skirt"] }),
          style("Denim", { tokens: ["denim skirt"] }),
        ],
      },
      {
        label: "Shorts",
        type: "subcategory",
        mapTo: ["Shorts"],
        tokens: ["shorts", "short"],
        children: [
          style("Denim Shorts", { tokens: ["denim shorts"] }),
          style("Chino Shorts", { tokens: ["chino shorts"] }),
          style("Cycling Shorts", { tokens: ["cycling shorts"], crossTags: ["activewear"] }),
          style("Bermuda Shorts", { tokens: ["bermuda shorts"] }),
        ],
      },
      {
        label: "Yoga & Studio Bottoms",
        type: "subcategory",
        mapTo: ["Leggings"],
        crossTags: ["activewear"],
        tokens: ["yoga pants", "studio bottoms"],
        children: [
          style("Yoga Leggings", { tokens: ["yoga leggings"], mapTo: ["Leggings"] }),
          style("Bike Shorts", { tokens: ["bike shorts"] }),
          style("Flares & Leg Warmers", { tokens: ["flare pants"] }),
        ],
      },
    ],
  },
  {
    label: "One-Pieces",
    type: "category",
    children: [
      {
        label: "Dresses",
        type: "subcategory",
        mapTo: ["Dresses"],
        tokens: ["dress", "dresses"],
        children: [
          {
            label: "Casual Dresses",
            type: "subcategory",
            mapTo: ["Dresses"],
            tokens: ["casual dress"],
            children: [
              style("Shirt Dress", { tokens: ["shirt dress"] }),
              style("Wrap Dress", { tokens: ["wrap dress"] }),
              style("Slip Dress", { tokens: ["slip dress"] }),
              style("Sundress", { tokens: ["sundress"] }),
              style("T-Shirt Dress", { tokens: ["tshirt dress"] }),
            ],
          },
          {
            label: "Formal & Evening Dresses",
            type: "subcategory",
            mapTo: ["Dresses"],
            tokens: ["formal dress", "evening dress"],
            children: [
              style("Cocktail Dresses", { tokens: ["cocktail dress"] }),
              style("Maxi Dresses", { tokens: ["maxi dress"] }),
              style("Gowns", { tokens: ["gown", "gowns"] }),
            ],
          },
        ],
      },
      {
        label: "Jumpsuits & Rompers",
        type: "subcategory",
        mapTo: ["Jumpsuits"],
        tokens: ["jumpsuit", "romper"],
        children: [
          style("Jumpsuits", { tokens: ["jumpsuit"] }),
          style("Rompers", { tokens: ["romper"] }),
        ],
      },
    ],
  },
  {
    label: "Outerwear",
    type: "category",
    children: [
      {
        label: "Jackets",
        type: "subcategory",
        mapTo: ["Jackets", "Blazers"],
        tokens: ["jacket", "jackets"],
        children: [
          style("Blazers", { tokens: ["blazer", "blazers"], mapTo: ["Blazers"] }),
          style("Leather Jackets", { tokens: ["leather jacket"] }),
          style("Denim Jackets", { tokens: ["denim jacket"] }),
          style("Bomber & Tweed", { tokens: ["bomber jacket", "tweed jacket"] }),
        ],
      },
      {
        label: "Coats",
        type: "subcategory",
        mapTo: ["Coats", "Parkas", "Puffer Jackets"],
        tokens: ["coat", "coats"],
        children: [
          style("Trench Coats", { tokens: ["trench coat"] }),
          style("Wool Coats", { tokens: ["wool coat"] }),
          style("Puffer Jackets", { tokens: ["puffer jacket"], mapTo: ["Puffer Jackets"] }),
          style("Parkas", { tokens: ["parka"], mapTo: ["Parkas"] }),
        ],
      },
      {
        label: "Vests",
        type: "subcategory",
        mapTo: ["Vests"],
        tokens: ["vest", "vests"],
      },
      {
        label: "Tracksuits",
        type: "subcategory",
        mapTo: ["Sports Tops"],
        crossTags: ["activewear"],
        tokens: ["tracksuit", "tracksuits"],
      },
    ],
  },
  {
    label: "Lingerie & Sleepwear",
    type: "category",
    children: [
      {
        label: "Bras",
        type: "subcategory",
        mapTo: ["Bras"],
        tokens: ["bra", "bras"],
      },
      {
        label: "Underwear",
        type: "subcategory",
        mapTo: ["Underwear"],
        tokens: ["underwear", "panties", "briefs"],
      },
      {
        label: "Shapewear",
        type: "subcategory",
        mapTo: ["Underwear"],
        tokens: ["shapewear"],
      },
      {
        label: "Sleepwear",
        type: "subcategory",
        mapTo: ["Underwear"],
        tokens: ["pajamas", "sleepwear"],
        children: [
          style("Pajama Sets", { tokens: ["pajama set"] }),
          style("Robes", { tokens: ["robe", "robes"] }),
        ],
      },
      {
        label: "Socks",
        type: "subcategory",
        mapTo: ["Socks"],
        tokens: ["socks"],
      },
    ],
  },
  {
    label: "Swimwear",
    type: "category",
    children: [
      {
        label: "Swimwear",
        type: "subcategory",
        mapTo: ["Swimwear"],
        tokens: ["swimwear", "swimsuit"],
        children: [
          style("One-Piece Swimsuits", { tokens: ["one piece swimsuit"] }),
          style("Bikinis", { tokens: ["bikini", "bikinis"] }),
          style("Sarongs & Cover-Ups", { tokens: ["sarong", "cover up"] }),
        ],
      },
    ],
  },
  {
    label: "Shoes",
    type: "category",
    children: [
      {
        label: "Heels",
        type: "subcategory",
        mapTo: ["Heels"],
        tokens: ["heels", "heel"],
        children: [
          style("Stilettos", { tokens: ["stiletto", "stilettos"] }),
          style("Block Heels", { tokens: ["block heels"] }),
          style("Platforms", { tokens: ["platform heels"] }),
          style("Heeled Boots", { tokens: ["heeled boots"], mapTo: ["Boots"] }),
        ],
      },
      {
        label: "Flats & Sneakers",
        type: "subcategory",
        mapTo: ["Flats", "Sneakers", "Loafers"],
        tokens: ["flats", "sneakers", "loafers"],
        children: [
          style("Ballerinas", { tokens: ["ballerina", "ballerinas"], mapTo: ["Flats"] }),
          style("Loafers", { tokens: ["loafer"], mapTo: ["Loafers"] }),
          style("Casual Sneakers", { tokens: ["casual sneakers"], mapTo: ["Sneakers"] }),
        ],
      },
      {
        label: "Sandals & Mules",
        type: "subcategory",
        mapTo: ["Sandals"],
        tokens: ["sandals", "mules"],
      },
      {
        label: "Boots",
        type: "subcategory",
        mapTo: ["Boots"],
        tokens: ["boots", "boot"],
      },
    ],
  },
  {
    label: "Bags",
    type: "category",
    children: [
      {
        label: "Handbags",
        type: "subcategory",
        mapTo: ["Handbags"],
        requiresSize: NO_SIZE,
        tokens: ["handbag", "handbags", "purse"],
      },
      {
        label: "Backpacks",
        type: "subcategory",
        mapTo: ["Backpacks"],
        requiresSize: NO_SIZE,
        tokens: ["backpack", "backpacks"],
      },
      {
        label: "Shoulder & Crossbody Bags",
        type: "subcategory",
        mapTo: ["Shoulder Bags", "Crossbody Bags"],
        requiresSize: NO_SIZE,
        tokens: ["shoulder bag", "crossbody bag"],
      },
      {
        label: "Tote Bags",
        type: "subcategory",
        mapTo: ["Tote Bags"],
        requiresSize: NO_SIZE,
        tokens: ["tote bag"],
      },
      {
        label: "Wallets",
        type: "subcategory",
        mapTo: ["Wallets"],
        requiresSize: NO_SIZE,
        tokens: ["wallet", "wallets"],
      },
    ],
  },
  {
    label: "Accessories",
    type: "category",
    children: [
      {
        label: "Jewelry",
        type: "subcategory",
        mapTo: ["Jewelry"],
        requiresSize: NO_SIZE,
        tokens: ["jewelry", "jewellery"],
        children: [
          style("Necklaces", { tokens: ["necklace"] }),
          style("Earrings", { tokens: ["earrings"] }),
          style("Bracelets", { tokens: ["bracelet"] }),
        ],
      },
      {
        label: "Belts",
        type: "subcategory",
        mapTo: ["Belts"],
        requiresSize: NO_SIZE,
        tokens: ["belt", "belts"],
      },
      {
        label: "Scarves & Hijabs",
        type: "subcategory",
        mapTo: ["Scarves and Hijabs"],
        requiresSize: NO_SIZE,
        tokens: ["scarves", "hijab"],
      },
      {
        label: "Watches",
        type: "subcategory",
        mapTo: ["Watches"],
        requiresSize: NO_SIZE,
        tokens: ["watch", "watches"],
      },
      {
        label: "Sunglasses",
        type: "subcategory",
        mapTo: ["Sunglasses"],
        requiresSize: NO_SIZE,
        tokens: ["sunglasses"],
      },
      {
        label: "Headwear",
        type: "subcategory",
        mapTo: ["Beanies", "Hats", "Caps"],
        tokens: ["hats", "caps", "beanies"],
        children: [
          style("Beanies", { tokens: ["beanie"], mapTo: ["Beanies"] }),
          style("Hats", { tokens: ["hat"], mapTo: ["Hats"] }),
          style("Caps", { tokens: ["cap"], mapTo: ["Caps"] }),
        ],
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Kids taxonomy                                                        */
/* ------------------------------------------------------------------ */

const KIDS_SPECS: Spec[] = [
  {
    label: "Tops",
    type: "category",
    children: [
      {
        label: "T-Shirts & Polos",
        type: "subcategory",
        mapTo: ["T-Shirts", "Polo Shirts"],
        age: ["all", "0-3", "4-14"],
        tokens: ["tshirt", "tee", "polo"],
        children: [
          {
            label: "Graphic Tees",
            type: "subcategory",
            mapTo: ["T-Shirts"],
            age: ["all", "4-14"],
            children: [
              style("Cartoon & Print", { tokens: ["graphic tee", "cartoon"] }),
              style("Plain", { tokens: ["plain tee"] }),
            ],
          },
          {
            label: "Polo Shirts",
            type: "subcategory",
            mapTo: ["Polo Shirts"],
            age: ["all", "4-14"],
          },
          {
            label: "Baby Bodysuits",
            type: "subcategory",
            mapTo: ["Bodysuits"],
            age: ["0-3"],
            tokens: ["bodysuit", "onesie"],
            children: [
              style("Short Sleeve", { tokens: ["short sleeve bodysuit"] }),
              style("Long Sleeve", { tokens: ["long sleeve bodysuit"] }),
              style("Snap Button", { tokens: ["snap button"] }),
            ],
          },
        ],
      },
      {
        label: "Shirts & Blouses",
        type: "subcategory",
        mapTo: ["Shirts", "Blouses"],
        age: ["all", "4-14"],
        tokens: ["shirt", "blouse"],
        children: [
          style("Flannel", { tokens: ["flannel"] }),
          style("Linen", { tokens: ["linen"] }),
          style("Denim", { tokens: ["denim"] }),
        ],
      },
      {
        label: "Sweatshirts & Hoodies",
        type: "subcategory",
        mapTo: ["Sweatshirts", "Hoodies"],
        age: ["all", "0-3", "4-14"],
        crossTags: ["activewear"],
        tokens: ["sweatshirt", "hoodie"],
        children: [
          style("Crewneck", { tokens: ["crewneck"] }),
          style("Pullover Hoodies", { tokens: ["pullover hoodie"] }),
          style("Zip-Up Hoodies", { tokens: ["zip up hoodie"] }),
          style("Fleece", { tokens: ["fleece"] }),
        ],
      },
      {
        label: "Knitwear",
        type: "subcategory",
        mapTo: ["Sweaters"],
        age: ["all", "4-14"],
        tokens: ["sweater", "cardigan"],
      },
      {
        label: "Sports Tops",
        type: "subcategory",
        mapTo: ["Sports Tops"],
        age: ["all", "4-14"],
        crossTags: ["activewear"],
        tokens: ["sports top", "sportswear", "activewear"],
        children: [
          style("Performance Tees", { tokens: ["performance tee"] }),
          style("Sports Jerseys", { tokens: ["sports jersey"] }),
        ],
      },
    ],
  },
  {
    label: "Bottoms",
    type: "category",
    children: [
      {
        label: "Jeans & Pants",
        type: "subcategory",
        mapTo: ["Jeans", "Trousers", "Chinos"],
        age: ["all", "4-14"],
        tokens: ["jeans", "pants", "trousers"],
        children: [
          {
            label: "Jeans",
            type: "subcategory",
            mapTo: ["Jeans"],
            age: ["all", "4-14"],
            tokens: ["jeans"],
            children: [
              fit("Skinny"),
              fit("Straight"),
              fit("Loose/Baggy"),
              fit("Elastic Waist"),
            ],
          },
          {
            label: "Chinos & Cargos",
            type: "subcategory",
            mapTo: ["Chinos", "Cargo Pants"],
            age: ["all", "4-14"],
            tokens: ["chinos", "cargo"],
          },
          {
            label: "Joggers & Sweatpants",
            type: "subcategory",
            mapTo: ["Joggers"],
            age: ["all", "0-3", "4-14"],
            crossTags: ["activewear"],
            tokens: ["joggers", "sweatpants"],
            children: [
              style("Fleece Joggers", { tokens: ["fleece joggers"] }),
              style("Tapered Joggers", { tokens: ["tapered joggers"] }),
            ],
          },
          {
            label: "Leggings",
            type: "subcategory",
            mapTo: ["Leggings"],
            age: ["all", "0-3", "4-14"],
            crossTags: ["activewear"],
            tokens: ["leggings"],
          },
        ],
      },
      {
        label: "Shorts",
        type: "subcategory",
        mapTo: ["Shorts"],
        age: ["all", "0-3", "4-14"],
        tokens: ["shorts"],
        children: [
          style("Denim Shorts", { tokens: ["denim shorts"] }),
          style("Cargo Shorts", { tokens: ["cargo shorts"] }),
          style("Sweat Shorts", { tokens: ["sweat shorts"], crossTags: ["activewear"] }),
          style("Sports Shorts", { tokens: ["sports short"], mapTo: ["Sports Shorts"] }),
          style("Bermuda Shorts", { tokens: ["bermuda shorts"] }),
        ],
      },
      {
        label: "Skirts",
        type: "subcategory",
        mapTo: ["Skirts"],
        age: ["all", "4-14"],
        tokens: ["skirt", "skirts"],
        children: [
          {
            label: "Skort",
            type: "variant",
            age: ["all", "4-14"],
            children: [
              style("Tutu", { tokens: ["tutu skirt"] }),
              style("Denim", { tokens: ["denim skirt"] }),
              style("Chino", { tokens: ["chino skirt"] }),
              style("Jersey", { tokens: ["jersey skirt"] }),
            ],
          },
          style("Pleated", { tokens: ["pleated skirt"] }),
        ],
      },
    ],
  },
  {
    label: "One-Pieces",
    type: "category",
    children: [
      {
        label: "Infants",
        type: "subcategory",
        mapTo: ["Jumpsuits"],
        age: ["0-3"],
        tokens: ["infant", "onesie", "sleepsuit"],
        children: [
          style("Onesies", { tokens: ["onesie", "onesies"], mapTo: ["Bodysuits"] }),
          style("Sleepsuits", { tokens: ["sleepsuit"] }),
          style("Footie Pajamas", { tokens: ["footie pajamas", "footie"] }),
        ],
      },
      {
        label: "Kids Dresses",
        type: "subcategory",
        mapTo: ["Dresses"],
        age: ["4-14"],
        tokens: ["dress", "dresses"],
        children: [
          style("Everyday Dresses", { tokens: ["everyday dress"] }),
          style("Party Dresses", { tokens: ["party dress"] }),
          style("Sundresses", { tokens: ["sundress"] }),
        ],
      },
      {
        label: "Overalls & Jumpsuits",
        type: "subcategory",
        mapTo: ["Jumpsuits"],
        age: ["all", "4-14"],
        tokens: ["overalls", "jumpsuit"],
        children: [
          style("Dungarees", { tokens: ["dungarees"] }),
          style("Jumpsuits", { tokens: ["jumpsuit"] }),
        ],
      },
    ],
  },
  {
    label: "Outerwear",
    type: "category",
    children: [
      {
        label: "Jackets & Coats",
        type: "subcategory",
        mapTo: ["Jackets", "Coats"],
        age: ["all", "0-3", "4-14"],
        tokens: ["jacket", "coat"],
        children: [
          style("Windbreakers", { tokens: ["windbreaker"] }),
          style("Denim Jackets", { tokens: ["denim jacket"] }),
          style("Puffer Jackets", { tokens: ["puffer jacket"], mapTo: ["Puffer Jackets"] }),
          style("Parkas", { tokens: ["parka"], mapTo: ["Parkas"] }),
          style("Raincoats", { tokens: ["raincoat"] }),
        ],
      },
      {
        label: "Vests",
        type: "subcategory",
        mapTo: ["Vests"],
        age: ["all", "4-14"],
        tokens: ["vest"],
      },
      {
        label: "Tracksuits",
        type: "subcategory",
        mapTo: ["Track Pants"],
        age: ["all", "4-14"],
        crossTags: ["activewear"],
        tokens: ["tracksuit", "tracksuits"],
      },
    ],
  },
  {
    label: "Underwear & Sleepwear",
    type: "category",
    children: [
      {
        label: "Underwear",
        type: "subcategory",
        mapTo: ["Underwear"],
        age: ["all", "0-3", "4-14"],
        tokens: ["underwear", "briefs"],
      },
      {
        label: "Sleepwear",
        type: "subcategory",
        mapTo: ["Underwear"],
        age: ["all", "0-3", "4-14"],
        tokens: ["pajamas", "sleepwear"],
      },
      {
        label: "Socks",
        type: "subcategory",
        mapTo: ["Socks"],
        age: ["all", "0-3", "4-14"],
        tokens: ["socks"],
      },
    ],
  },
  {
    label: "Swimwear",
    type: "category",
    children: [
      {
        label: "Swimwear",
        type: "subcategory",
        mapTo: ["Swimwear"],
        age: ["all", "0-3", "4-14"],
        tokens: ["swimwear", "swimsuit"],
        children: [
          style("One-Piece Swimsuits", { tokens: ["swimsuit"] }),
          style("Swim Sets", { tokens: ["swim set"] }),
        ],
      },
    ],
  },
  {
    label: "Shoes",
    type: "category",
    children: [
      {
        label: "Everyday Shoes",
        type: "subcategory",
        mapTo: ["Sneakers"],
        age: ["all", "0-3", "4-14"],
        crossTags: ["activewear"],
        tokens: ["sneakers", "trainers"],
        children: [
          style("Runners", { tokens: ["runners"], mapTo: ["Running Trainers"] }),
          style("Light-Up Shoes", { tokens: ["light up shoes"] }),
          style("Canvas Sneakers", { tokens: ["canvas sneakers"] }),
        ],
      },
      {
        label: "Formal Shoes",
        type: "subcategory",
        mapTo: ["Formal Shoes"],
        age: ["all", "4-14"],
        tokens: ["formal shoes", "school shoes"],
      },
      {
        label: "Boots & Sandals",
        type: "subcategory",
        mapTo: ["Boots", "Sandals"],
        age: ["all", "0-3", "4-14"],
        tokens: ["boots", "sandals"],
      },
    ],
  },
  {
    label: "Accessories",
    type: "category",
    children: [
      {
        label: "Headwear",
        type: "subcategory",
        mapTo: ["Beanies", "Hats", "Caps"],
        age: ["all", "0-3", "4-14"],
        tokens: ["beanies", "hats", "caps"],
        children: [
          style("Beanies", { tokens: ["beanie"], mapTo: ["Beanies"] }),
          style("Hats", { tokens: ["hat"], mapTo: ["Hats"] }),
          style("Caps", { tokens: ["cap"], mapTo: ["Caps"] }),
        ],
      },
      {
        label: "Backpacks",
        type: "subcategory",
        mapTo: ["Backpacks"],
        requiresSize: NO_SIZE,
        age: ["all", "4-14"],
        tokens: ["backpack", "backpacks"],
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Assembled taxonomy                                                   */
/* ------------------------------------------------------------------ */

const MEN_TREE = build("MEN", "mens", MEN_SPECS);
const WOMEN_TREE = build("WOMEN", "womens", WOMEN_SPECS);
const KIDS_TREE = build("KIDS", "kids", KIDS_SPECS);

/**
 * Old DB slug -> new taxonomy IDs. Reference only: no DB rename is
 * performed, this simply documents where each legacy category landed.
 * An empty list means the legacy slug has no node in the new tree.
 */
const MIGRATION_MAP: Record<string, string[]> = {
  "t-shirts": [
    "mens_tops_tshirts_and_polos_basic_tshirts",
    "womens_tops_tshirts_and_basics_basic_tshirts",
    "kids_tops_tshirts_and_polos_graphic_tees",
  ],
  "tank-tops": [
    "mens_tops_tshirts_and_polos_tank_tops_and_sleeveless",
    "womens_tops_tshirts_and_basics_tank_tops_and_camisoles",
  ],
  "polos": [
    "mens_tops_tshirts_and_polos_polo_shirts",
    "kids_tops_tshirts_and_polos_polo_shirts",
  ],
  shirts: [
    "mens_tops_shirts",
    "womens_tops_shirts_and_blouses",
    "kids_tops_shirts_and_blouses",
  ],
  blouses: [
    "womens_tops_shirts_and_blouses_blouses",
    "kids_tops_shirts_and_blouses",
  ],
  sweaters: [
    "mens_tops_sweaters_and_knitwear_pullovers",
    "womens_tops_sweaters_and_knitwear_pullovers",
    "kids_tops_knitwear",
  ],
  cardigans: [
    "mens_tops_sweaters_and_knitwear_cardigans",
    "womens_tops_sweaters_and_knitwear_cardigans",
  ],
  sweatshirts: [
    "mens_tops_sweaters_and_knitwear_sweatshirts",
    "womens_tops_sweaters_and_knitwear_sweatshirts_and_hoodies",
    "kids_tops_sweatshirts_and_hoodies",
  ],
  hoodies: [
    "mens_tops_sweaters_and_knitwear_hoodies",
    "womens_tops_sweaters_and_knitwear_sweatshirts_and_hoodies",
    "kids_tops_sweatshirts_and_hoodies",
  ],
  bodysuits: [
    "mens_tops_bodysuits",
    "womens_tops_tshirts_and_basics_corsets_and_bodysuits",
    "kids_tops_tshirts_and_polos_baby_bodysuits",
  ],
  jeans: [
    "mens_bottoms_jeans",
    "womens_bottoms_jeans",
    "kids_bottoms_jeans_and_pants_jeans",
  ],
  chinos: [
    "mens_bottoms_trousers_and_pants_chinos",
    "womens_bottoms_trousers_and_pants_chinos",
    "kids_bottoms_jeans_and_pants_chinos_and_cargos",
  ],
  trousers: [
    "mens_bottoms_trousers_and_pants",
    "womens_bottoms_trousers_and_pants",
    "kids_bottoms_jeans_and_pants",
  ],
  cargo: [
    "mens_bottoms_trousers_and_pants_cargo_pants",
    "kids_bottoms_jeans_and_pants_chinos_and_cargos",
  ],
  joggers: [
    "mens_bottoms_joggers_and_sweatpants",
    "womens_bottoms_trousers_and_pants_joggers_and_sweatpants",
    "kids_bottoms_jeans_and_pants_joggers_and_sweatpants",
  ],
  shorts: [
    "mens_bottoms_shorts",
    "womens_bottoms_shorts",
    "kids_bottoms_shorts",
  ],
  skirts: ["womens_bottoms_skirts", "kids_bottoms_skirts"],
  leggings: [
    "womens_bottoms_trousers_and_pants_leggings_and_jeggings",
    "kids_bottoms_jeans_and_pants_leggings",
  ],
  dresses: [
    "womens_onepieces_dresses",
    "kids_onepieces_kids_dresses",
  ],
  jumpsuits: [
    "mens_onepieces_jumpsuits_and_overalls",
    "womens_onepieces_jumpsuits_and_rompers",
    "kids_onepieces_overalls_and_jumpsuits",
  ],
  jackets: [
    "mens_outerwear_jackets",
    "womens_outerwear_jackets",
    "kids_outerwear_jackets_and_coats",
  ],
  coats: [
    "mens_outerwear_coats",
    "womens_outerwear_coats",
    "kids_outerwear_jackets_and_coats",
  ],
  blazers: [
    "mens_onepieces_suits_and_tailoring",
    "womens_outerwear_jackets",
  ],
  parkas: [
    "mens_outerwear_coats",
    "womens_outerwear_coats",
    "kids_outerwear_jackets_and_coats",
  ],
  "puffer-jackets": [
    "mens_outerwear_coats",
    "womens_outerwear_coats",
    "kids_outerwear_jackets_and_coats",
  ],
  vests: [
    "mens_outerwear_vests",
    "womens_outerwear_vests",
    "kids_outerwear_vests",
  ],
  "sports-tops": [
    "mens_tops_performance_tops",
    "womens_tops_sweaters_and_knitwear_yoga_and_studio_tops",
    "kids_tops_sports_tops",
  ],
  "sports-bras": [
    "womens_tops_sweaters_and_knitwear_yoga_and_studio_tops_sports_bras",
  ],
  "track-pants": [
    "mens_bottoms_trousers_and_pants_performance_bottoms",
    "kids_outerwear_tracksuits",
  ],
  "sports-shorts": [
    "mens_bottoms_trousers_and_pants_performance_bottoms",
    "kids_bottoms_shorts_sports_shorts",
  ],
  swimwear: [
    "mens_bottoms_swim_trunks",
    "womens_swimwear_swimwear",
    "kids_swimwear_swimwear",
  ],
  underwear: [
    "mens_underwear_and_sleepwear_underwear",
    "womens_lingerie_and_sleepwear_underwear",
    "kids_underwear_and_sleepwear_underwear",
  ],
  bras: ["womens_lingerie_and_sleepwear_bras"],
  socks: [
    "mens_underwear_and_sleepwear_socks",
    "womens_lingerie_and_sleepwear_socks",
    "kids_underwear_and_sleepwear_socks",
  ],
  sneakers: [
    "mens_shoes_casual_and_sneakers",
    "womens_shoes_flats_and_sneakers",
    "kids_shoes_everyday_shoes",
  ],
  "running-trainers": [
    "mens_shoes_casual_and_sneakers",
    "kids_shoes_everyday_shoes",
  ],
  boots: [
    "mens_shoes_boots",
    "womens_shoes_boots",
    "kids_shoes_boots_and_sandals",
  ],
  sandals: [
    "mens_shoes_sandals_and_slides",
    "womens_shoes_sandals_and_mules",
    "kids_shoes_boots_and_sandals",
  ],
  heels: ["womens_shoes_heels"],
  flats: ["womens_shoes_flats_and_sneakers"],
  loafers: [
    "mens_shoes_dress_shoes",
    "womens_shoes_flats_and_sneakers",
  ],
  "formal-shoes": [
    "mens_shoes_dress_shoes",
    "kids_shoes_formal_shoes",
  ],
  belts: ["mens_accessories_belts", "womens_accessories_belts"],
  "scarves-hijabs": [
    "mens_accessories_scarves_and_hijabs",
    "womens_accessories_scarves_and_hijabs",
  ],
  "ties-bow-ties": ["mens_accessories_ties_and_bow_ties"],
  sunglasses: [
    "mens_accessories_sunglasses",
    "womens_accessories_sunglasses",
  ],
  watches: [
    "mens_accessories_watches",
    "womens_accessories_watches",
  ],
  jewelry: [
    "mens_accessories_jewelry",
    "womens_accessories_jewelry",
  ],
  handbags: ["womens_bags_handbags"],
  backpacks: [
    "womens_bags_backpacks",
    "kids_accessories_backpacks",
  ],
  "shoulder-bags": ["womens_bags_shoulder_and_crossbody_bags"],
  "crossbody-bags": ["womens_bags_shoulder_and_crossbody_bags"],
  "duffle-travel-bags": [],
  "bum-bags": [],
  "tote-bags": ["womens_bags_tote_bags"],
  wallets: ["womens_bags_wallets"],
  beanies: [
    "mens_accessories_headwear",
    "womens_accessories_headwear",
    "kids_accessories_headwear",
  ],
  hats: [
    "mens_accessories_headwear",
    "womens_accessories_headwear",
    "kids_accessories_headwear",
  ],
  caps: [
    "mens_accessories_headwear",
    "womens_accessories_headwear",
    "kids_accessories_headwear",
  ],
};

export const taxonomyDefinition: AppTaxonomy = {
  version: "2.0.0",
  trees: {
    MEN: MEN_TREE,
    WOMEN: WOMEN_TREE,
    KIDS: KIDS_TREE,
  },
  migrationMap: MIGRATION_MAP,
};

export const taxonomyTrees: Record<
  TaxonomyGender,
  TaxonomyGenderTree
> = {
  MEN: MEN_TREE,
  WOMEN: WOMEN_TREE,
  KIDS: KIDS_TREE,
};