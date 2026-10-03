/**
 * Shared style vocabulary - the single source of truth for every
 * style / fit / variant in the application.
 *
 * THE INVARIANT THIS FILE EXISTS TO ENFORCE
 *
 *   Gender != Style
 *
 * A style is a COMMERCIAL/FASHION CONCEPT, not a property of a person.
 * "Boyfriend Jeans" being a women's bestseller says nothing about whether
 * the concept exists for men; only the product data can settle that, and
 * gender is applied there as a product-matching filter. So a style is
 * declared ONCE here, with no gender field, and every category that
 * offers it links to it.
 *
 * Where a style appears is decided by Category + Subcategory + Concept,
 * never by gender. That is what keeps "Boyfriend" out of Men > Shoes
 * while allowing it in Men > Bottoms > Jeans.
 *
 * Reading a style name as a gender signal (Boyfriend => women,
 * Oversized => women, Baggy => men) is a fashion-naming habit, not a
 * data constraint, and is deliberately absent from this file.
 */

/** The role a style plays. Mirrors the taxonomy node types it produces. */
export type StyleType = "style" | "fit" | "variant";

export interface StyleDefinition {
  /**
   * Gender-free concept id, derived from the label. Two categories in
   * two different genders that offer "Slim" resolve to the SAME id, so
   * the concept has one identity no matter how many trees use it.
   */
  id: string;
  label: string;
  type: StyleType;
  /** Free-text search tokens this style contributes when selected. */
  tokens: string[];
  /** Legacy DB category names this leaf maps to (empty for pure styles). */
  mapTo: string[];
  /** Cross-cutting search labels this leaf carries. */
  crossTags: string[];
  /** Size-step override for this leaf. */
  requiresSize?: boolean;
}

/* ------------------------------------------------------------------ */
/* Style id derivation                                                  */
/* ------------------------------------------------------------------ */

/**
 * Canonical, gender-free id for a style label. Kept in sync with the
 * taxonomy's slug rules so ids read the same everywhere.
 */
export function styleId(label: string): string {
  return label
    .toLowerCase()
    .replace(/[-']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/* ------------------------------------------------------------------ */
/* The registry                                                         */
/* ------------------------------------------------------------------ */

/**
 * Every shared style concept, keyed by its gender-free id.
 *
 * `concepts` lists the concept keys this style may attach to. A category
 * opts into a concept (via its own `concepts` list), and only styles
 * carrying that concept are offered under it. This is the whole of the
 * "where does this style belong" rule - there is no gender term in it.
 */
type RegistryEntry = {
  label: string;
  type: StyleType;
  tokens?: string[];
  /** Legacy DB category names this style maps to, when it is a leaf row. */
  mapTo?: string[];
  /** Cross-cutting search labels inherited by the node. */
  crossTags?: string[];
  /** Overrides the default Size requirement for this style leaf. */
  requiresSize?: boolean;
  /** Concept keys this style may be offered under. */
  concepts: string[];
};

const REGISTRY: Record<string, RegistryEntry> = {
  /* ---------------- Denim / jean fits ---------------- */
  skinny: { label: "Skinny", type: "fit", concepts: ["denim", "legCut"] },
  slim: { label: "Slim", type: "fit", concepts: ["denim", "legCut", "trouserFit", "shirtFit", "suit"] },
  regular: { label: "Regular", type: "fit", concepts: ["denim", "legCut", "trouserFit", "shirtFit"] },
  straight: { label: "Straight", type: "fit", concepts: ["denim", "legCut", "trouserFit"] },
  relaxed: { label: "Relaxed", type: "fit", concepts: ["denim", "legCut", "trouserFit", "shirtFit"] },
  tapered: { label: "Tapered", type: "fit", concepts: ["denim", "legCut", "trouserFit"] },
  bootcut: { label: "Bootcut", type: "fit", concepts: ["denim", "legCut"] },
  bootcut_and_flare: { label: "Bootcut & Flare", type: "fit", tokens: ["bootcut and flare"], concepts: ["denim", "legCut"] },
  loose_baggy: { label: "Loose/Baggy", type: "fit", tokens: ["loose", "baggy"], concepts: ["denim", "legCut", "trouserFit"] },
  wide_leg: { label: "Wide-Leg", type: "fit", tokens: ["wide leg"], concepts: ["denim", "legCut", "trouserFit"] },
  /* "Boyfriend" and "Mom" are cuts that read as gendered in fashion
     copy. They are cuts of the garment, so they are denim concepts like
     any other and carry no gender. */
  boyfriend_jeans: { label: "Boyfriend Jeans", type: "fit", tokens: ["boyfriend", "boyfriend jeans"], concepts: ["denim"] },
  mom_jeans: { label: "Mom Jeans", type: "fit", tokens: ["mom", "mom jeans"], concepts: ["denim"] },
  elastic_waist: { label: "Elastic Waist", type: "style", concepts: ["denim"] },
  super_slim_fit: { label: "Super Slim Fit", type: "fit", tokens: ["super slim"], concepts: ["denim", "shirtFit", "suit"] },

  /* ---------------- Trouser / chino cuts ---------------- */
  flat_front: { label: "Flat Front", type: "style", concepts: ["trouserFit"] },
  pleated: { label: "Pleated", type: "style", tokens: ["pleated skirt"], concepts: ["trouserFit", "skirt"] },
  classic_chino: { label: "Classic Chino", type: "style", tokens: ["classic"], concepts: ["trouserFit"] },
  slim_chino: { label: "Slim Chino", type: "style", tokens: ["slim"], concepts: ["trouserFit"] },
  palazzo: { label: "Palazzo", type: "style", concepts: ["trouserFit"] },
  culottes: { label: "Culottes", type: "style", concepts: ["trouserFit"] },
  cigarette: { label: "Cigarette", type: "style", concepts: ["trouserFit"] },
  wide_leg_trousers: { label: "Wide-Leg Trousers", type: "style", tokens: ["wide leg trousers"], concepts: ["trouserFit"] },

  /* ---------------- Shorts ---------------- */
  bermuda_shorts: { label: "Bermuda Shorts", type: "style", tokens: ["bermudas"], concepts: ["shorts"] },
  cargo_shorts: { label: "Cargo Shorts", type: "style", concepts: ["shorts"] },
  chino_shorts: { label: "Chino Shorts", type: "style", concepts: ["shorts"] },
  denim_shorts: { label: "Denim Shorts", type: "style", concepts: ["shorts"] },
  sweat_shorts: { label: "Sweat Shorts", type: "style", crossTags: ["activewear"], concepts: ["shorts"] },
  cycling_shorts: { label: "Cycling Shorts", type: "style", crossTags: ["activewear"], concepts: ["shorts", "cycling"] },

  /* ---------------- Joggers ---------------- */
  fleece: { label: "Fleece", type: "style", concepts: ["jogger", "sweatshirt"] },
  fleece_joggers: { label: "Fleece Joggers", type: "style", tokens: ["fleece joggers"], concepts: ["jogger"] },
  cargo: { label: "Cargo", type: "style", concepts: ["jogger"] },
  cargo_joggers: { label: "Cargo Joggers", type: "style", tokens: ["cargo joggers"], concepts: ["jogger"] },
  twill: { label: "Twill", type: "style", concepts: ["jogger"] },
  tapered_joggers: { label: "Tapered Joggers", type: "style", tokens: ["tapered joggers"], concepts: ["jogger"] },

  /* ---------------- Tops: tees, tanks, polos ---------------- */
  crewneck: { label: "Crewneck", type: "style", tokens: ["crew neck"], concepts: ["tee", "sweatshirt", "knitwear"] },
  v_neck: { label: "V-Neck", type: "style", tokens: ["v neck", "vneck"], concepts: ["tee", "tank", "knitwear"] },
  henley: { label: "Henley", type: "style", concepts: ["tee"] },
  longline: { label: "Longline", type: "style", tokens: ["longline cardigan"], concepts: ["tee", "cardigan", "tank"] },
  longline_tops: { label: "Longline Tops", type: "style", tokens: ["longline tops"], concepts: ["tank"] },
  oversized: { label: "Oversized", type: "style", concepts: ["tee", "shirtFit"] },
  boxy: { label: "Boxy", type: "style", concepts: ["tee"] },
  scoop: { label: "Scoop", type: "style", concepts: ["tee", "tank"] },
  bandeau: { label: "Bandeau", type: "style", concepts: ["tank"] },
  camisole: { label: "Camisole", type: "style", concepts: ["tank"] },
  tube_top: { label: "Tube Top", type: "style", tokens: ["tube top"], concepts: ["tank"] },
  knit_polo: { label: "Knit Polo", type: "style", tokens: ["knit polo", "knitted polo"], concepts: ["polo"] },
  pique_cotton: { label: "Pique Cotton", type: "style", tokens: ["pique", "pique cotton"], concepts: ["polo"] },
  compression_tops: { label: "Compression Tops", type: "style", tokens: ["compression tops"], concepts: ["performance"] },
  compression_bottoms: { label: "Compression Bottoms", type: "style", tokens: ["compression bottoms"], concepts: ["performance"] },

  /* ---------------- Shirts: fabric and fit ---------------- */
  denim: { label: "Denim", type: "style", tokens: ["denim"], concepts: ["shirt", "jacket", "skirt"] },
  flannel_plaid: { label: "Flannel/Plaid", type: "style", tokens: ["flannel", "plaid"], concepts: ["shirt"] },
  flannel: { label: "Flannel", type: "style", concepts: ["shirt"] },
  linen: { label: "Linen", type: "style", concepts: ["shirt"] },
  oxford_button_down: { label: "Oxford Button-Down", type: "style", tokens: ["oxford", "button down"], concepts: ["shirt"] },
  cuban_collar: { label: "Cuban Collar", type: "style", tokens: ["cuban collar"], concepts: ["shirt"] },
  silk: { label: "Silk", type: "style", concepts: ["shirt"] },
  chiffon: { label: "Chiffon", type: "style", concepts: ["shirt"] },
  lace: { label: "Lace", type: "style", concepts: ["shirt"] },
  /* "Formality" axis for dress shirts. Formal/Classic/Slim/Relaxed/
     Athletic are fit words; none of them is gendered. */
  formal_fit: { label: "Formal Fit", type: "fit", tokens: ["formal fit"], concepts: ["shirtFit"] },
  classic_fit: { label: "Classic Fit", type: "fit", tokens: ["classic fit"], concepts: ["shirtFit", "suit"] },
  athletic_fit: { label: "Athletic Fit", type: "fit", tokens: ["athletic fit"], concepts: ["shirtFit"] },
  slim_fit: { label: "Slim Fit", type: "fit", tokens: ["slim fit"], concepts: ["shirtFit", "suit"] },
  cropped: { label: "Cropped", type: "style", concepts: ["shirtFit"] },
  cropped_knit: { label: "Cropped Knit", type: "style", tokens: ["cropped knit"], concepts: ["knitwear"] },
  fitted: { label: "Fitted", type: "style", concepts: ["shirtFit"] },

  /* ---------------- Knitwear ---------------- */
  cable_knit: { label: "Cable Knit", type: "style", tokens: ["cable knit"], concepts: ["knitwear"] },
  mock_neck: { label: "Mock Neck", type: "style", tokens: ["mock neck"], concepts: ["knitwear"] },
  turtleneck: { label: "Turtleneck", type: "style", tokens: ["turtle neck"], concepts: ["knitwear"] },
  v_neck_knit: { label: "V-Neck Knit", type: "style", tokens: ["v neck knit"], concepts: ["knitwear"] },
  buttoned: { label: "Buttoned", type: "style", concepts: ["cardigan"] },
  shawl_collar: { label: "Shawl Collar", type: "style", tokens: ["shawl collar"], concepts: ["cardigan", "lapel"] },
  zippered: { label: "Zippered", type: "style", tokens: ["zip cardigan"], concepts: ["cardigan"] },
  shawl_lapel: { label: "Shawl Lapel", type: "style", tokens: ["shawl lapel"], concepts: ["lapel"] },
  peak_lapel: { label: "Peak Lapel", type: "style", tokens: ["peak lapel"], concepts: ["lapel"] },
  notch_lapel: { label: "Notch Lapel", type: "style", tokens: ["notch lapel"], concepts: ["lapel"] },

  /* ---------------- Sweats ---------------- */
  pullover: { label: "Pullover", type: "style", concepts: ["sweatshirt"] },
  zip_up: { label: "Zip-Up", type: "style", tokens: ["zip up"], concepts: ["sweatshirt"] },
  pullover_hoodies: { label: "Pullover Hoodies", type: "style", tokens: ["pullover hoodie"], concepts: ["sweatshirt"] },
  zip_up_hoodies: { label: "Zip-Up Hoodies", type: "style", tokens: ["zip up hoodie"], concepts: ["sweatshirt"] },

  /* ---------------- Outerwear ---------------- */
  bomber_jackets: { label: "Bomber Jackets", type: "style", tokens: ["bomber", "bomber jacket"], concepts: ["jacket"] },
  bomber_tweed: { label: "Bomber & Tweed", type: "style", tokens: ["bomber jacket", "tweed jacket"], concepts: ["jacket"] },
  leather_jackets: { label: "Leather Jackets", type: "style", tokens: ["leather jacket"], concepts: ["jacket"] },
  trucker_denim_jackets: { label: "Trucker Denim Jackets", type: "style", tokens: ["trucker", "denim jacket"], concepts: ["jacket"] },
  denim_jackets: { label: "Denim Jackets", type: "style", tokens: ["denim jacket"], concepts: ["jacket"] },
  windbreakers: { label: "Windbreakers", type: "style", concepts: ["jacket"] },
  wool_coats: { label: "Wool Coats", type: "style", tokens: ["wool coat"], concepts: ["coat"] },
  overcoats_wool_coats: { label: "Overcoats/Wool Coats", type: "style", tokens: ["overcoat", "wool coat"], concepts: ["coat"] },
  puffer_coats: { label: "Puffer Coats", type: "style", tokens: ["puffer coat"], concepts: ["coat"] },
  trench_coats: { label: "Trench Coats", type: "style", tokens: ["trench coat", "trench"], concepts: ["coat"] },
  raincoats: { label: "Raincoats", type: "style", concepts: ["coat"] },

  /* ---------------- Tailoring ---------------- */
  /* Suit fits. "Classic"/"Modern"/"Slim" describe the cut of a suit. */
  classic: { label: "Classic", type: "fit", concepts: ["suit", "leggings"] },
  modern: { label: "Modern", type: "fit", concepts: ["suit"] },

  /* ---------------- Skirts ---------------- */
  a_line: { label: "A-Line", type: "style", tokens: ["a line"], concepts: ["skirt"] },
  pencil: { label: "Pencil", type: "style", concepts: ["skirt"] },
  slit: { label: "Slit", type: "style", concepts: ["skirt"] },
  tiered_ruffle: { label: "Tiered & Ruffle", type: "style", tokens: ["tiered skirt", "ruffle skirt"], concepts: ["skirt"] },

  /* ---------------- Leggings ---------------- */
  distressed: { label: "Distressed", type: "style", concepts: ["leggings"] },
  yoga_leggings: { label: "Yoga Leggings", type: "style", tokens: ["yoga leggings"], concepts: ["leggings"] },

  /* ---------------- Swim ---------------- */
  bikinis: { label: "Bikinis", type: "style", tokens: ["bikini", "bikinis"], concepts: ["swim"] },
  one_piece_swimsuits: { label: "One-Piece Swimsuits", type: "style", tokens: ["one piece swimsuit", "swimsuit"], concepts: ["swim"] },
  sarongs_cover_ups: { label: "Sarongs & Cover-Ups", type: "style", tokens: ["sarong", "cover up"], concepts: ["swim"] },
  swim_sets: { label: "Swim Sets", type: "style", tokens: ["swim set"], concepts: ["swim"] },
  board_shorts: { label: "Board Shorts", type: "style", concepts: ["swim"] },
  rash_guards: { label: "Rash Guards", type: "style", tokens: ["rash guard"], concepts: ["swim"] },

  /* ---------------- Sleepwear ---------------- */
  pajama_sets: { label: "Pajama Sets", type: "style", tokens: ["pajama set"], concepts: ["sleepwear"] },
  robes: { label: "Robes", type: "style", tokens: ["robe", "robes"], concepts: ["sleepwear"] },
  footie_pajamas: { label: "Footie Pajamas", type: "style", tokens: ["footie pajamas", "footie"], concepts: ["sleepwear"] },
  sleepsuits: { label: "Sleepsuits", type: "style", concepts: ["sleepwear"] },

  /* ---------------- Underwear / intimates ---------------- */
  boxer_briefs: { label: "Boxer Briefs", type: "style", tokens: ["boxer briefs"], concepts: ["intimate"] },
  briefs: { label: "Briefs", type: "style", concepts: ["intimate"] },
  thermal_layers: { label: "Thermal Layers", type: "style", tokens: ["thermal"], concepts: ["intimate"] },
  undershirts: { label: "Undershirts", type: "style", concepts: ["intimate"] },
  high_impact: { label: "High Impact", type: "style", tokens: ["high impact"], concepts: ["intimate"] },
  medium_support: { label: "Medium Support", type: "style", tokens: ["medium support"], concepts: ["intimate"] },
  low_impact: { label: "Low Impact", type: "style", tokens: ["low impact"], concepts: ["intimate"] },
  bodysuit_long_sleeve: { label: "Long Sleeve", type: "style", concepts: ["bodysuit"] },
  bodysuit_short_sleeve: { label: "Short Sleeve", type: "style", concepts: ["bodysuit"] },
  snap_button: { label: "Snap Button", type: "style", tokens: ["snap button"], concepts: ["bodysuit"] },

  /* ---------------- Dresses ---------------- */
  shirt_dress: { label: "Shirt Dress", type: "style", tokens: ["shirt dress"], concepts: ["dress"] },
  slip_dress: { label: "Slip Dress", type: "style", tokens: ["slip dress"], concepts: ["dress"] },
  sundress: { label: "Sundress", type: "style", concepts: ["dress"] },
  sundresses: { label: "Sundresses", type: "style", concepts: ["dress"] },
  t_shirt_dress: { label: "T-Shirt Dress", type: "style", tokens: ["t shirt dress"], concepts: ["dress"] },
  wrap_dress: { label: "Wrap Dress", type: "style", tokens: ["wrap dress"], concepts: ["dress"] },
  everyday_dresses: { label: "Everyday Dresses", type: "style", tokens: ["everyday dress"], concepts: ["dress"] },
  party_dresses: { label: "Party Dresses", type: "style", tokens: ["party dress"], concepts: ["dress"] },
  cocktail_dresses: { label: "Cocktail Dresses", type: "style", tokens: ["cocktail dress"], concepts: ["dress"] },
  gowns: { label: "Gowns", type: "style", tokens: ["gown", "gowns"], concepts: ["dress"] },
  maxi_dresses: { label: "Maxi Dresses", type: "style", tokens: ["maxi dress"], concepts: ["dress"] },

  /* ---------------- One-pieces ---------------- */
  jumpsuits: { label: "Jumpsuits", type: "style", concepts: ["onePiece"] },
  overalls_dungarees: { label: "Overalls/Dungarees", type: "style", tokens: ["overalls", "dungarees"], concepts: ["onePiece"] },
  dungarees: { label: "Dungarees", type: "style", concepts: ["onePiece"] },
  rompers: { label: "Rompers", type: "style", concepts: ["onePiece"] },
  boilersuits: { label: "Boilersuits", type: "style", tokens: ["boilersuit", "coverall"], concepts: ["onePiece"] },

  /* ---------------- Shoes ---------------- */
  oxfords: { label: "Oxfords", type: "style", tokens: ["oxfords", "oxford"], concepts: ["dressShoe"] },
  derbies: { label: "Derbies", type: "style", tokens: ["derbies", "derby"], concepts: ["dressShoe"] },
  monk_straps: { label: "Monk Straps", type: "style", tokens: ["monk strap", "monk straps"], concepts: ["dressShoe"] },
  ballerinas: { label: "Ballerinas", type: "style", tokens: ["ballerina", "ballerinas"], concepts: ["dressShoe"] },
  chelsea_boots: { label: "Chelsea Boots", type: "style", tokens: ["chelsea boot"], concepts: ["boot"] },
  heeled_boots: { label: "Heeled Boots", type: "style", tokens: ["heeled boot"], concepts: ["boot", "heel"] },
  block_heels: { label: "Block Heels", type: "style", tokens: ["block heel"], concepts: ["heel"] },
  platforms: { label: "Platforms", type: "style", concepts: ["heel"] },
  stilettos: { label: "Stilettos", type: "style", tokens: ["stiletto", "stilettos"], concepts: ["heel"] },
  gym_sneakers: { label: "Gym Sneakers", type: "style", tokens: ["gym sneaker"], concepts: ["casualShoe"] },
  white_canvas_sneakers: { label: "White Canvas Sneakers", type: "style", tokens: ["white canvas sneaker"], concepts: ["casualShoe"] },
  casual_sneakers: { label: "Casual Sneakers", type: "style", tokens: ["casual sneaker"], concepts: ["casualShoe"] },
  canvas_sneakers: { label: "Canvas Sneakers", type: "style", tokens: ["canvas sneaker"], concepts: ["casualShoe", "kidsShoe"] },
  runners: { label: "Runners", type: "style", concepts: ["casualShoe", "kidsShoe"] },
  light_up_shoes: { label: "Light-Up Shoes", type: "style", tokens: ["light up shoe"], concepts: ["kidsShoe"] },

  /* ---------------- Jewelry ---------------- */
  bracelets: { label: "Bracelets", type: "style", concepts: ["jewelry"] },
  necklaces: { label: "Necklaces", type: "style", concepts: ["jewelry"] },
  rings: { label: "Rings", type: "style", tokens: ["ring", "rings"], concepts: ["jewelry"] },
  earrings: { label: "Earrings", type: "style", concepts: ["jewelry"] },

  /* ---------------- Kids-specific garment details ---------------- */
  cartoon_print: { label: "Cartoon & Print", type: "style", tokens: ["graphic tee", "cartoon"], concepts: ["graphic"] },
  plain: { label: "Plain", type: "style", concepts: ["graphic"] },
  performance_tees: { label: "Performance Tees", type: "style", tokens: ["performance tee"], concepts: ["graphic"] },
  sports_jerseys: { label: "Sports Jerseys", type: "style", tokens: ["sports jersey"], concepts: ["graphic"] },
  sports_tops: { label: "Sports Tops", type: "style", tokens: ["sports top"], concepts: ["graphic"] },
  jersey: { label: "Jersey", type: "style", concepts: ["graphic"] },
  tutu: { label: "Tutu", type: "style", concepts: ["graphic"] },
  bike_shorts: { label: "Bike Shorts", type: "style", tokens: ["bike short"], concepts: ["cycling"] },
  flares_leg_warmers: { label: "Flares & Leg Warmers", type: "style", tokens: ["flares", "leg warmers"], concepts: ["cycling"] },

  /* ---------------- Headwear and remaining leaves ---------------- */
  /* Several of these still map to their own legacy DB category (see the
     mapTo on the spec) and are declared here only so their identity is
     shared like every other style. */
  beanies: { label: "Beanies", type: "style", tokens: ["beanie"], mapTo: ["Beanies"], concepts: ["headwear"] },
  hats: { label: "Hats", type: "style", tokens: ["hat"], mapTo: ["Hats"], concepts: ["headwear"] },
  caps: { label: "Caps", type: "style", tokens: ["cap", "baseball cap"], mapTo: ["Caps"], concepts: ["headwear"] },
  blazers: { label: "Blazers", type: "style", tokens: ["blazer", "blazers"], mapTo: ["Blazers"], concepts: ["jacket"] },
  gym_tank_tops: { label: "Gym Tank Tops", type: "style", tokens: ["gym tank"], mapTo: ["Tank Tops"], concepts: ["tank"] },
  loafers: { label: "Loafers", type: "style", tokens: ["loafers", "loafer"], mapTo: ["Loafers"], concepts: ["dressShoe"] },
  running_shoes: { label: "Running Shoes", type: "style", tokens: ["running shoes"], mapTo: ["Running Trainers"], concepts: ["casualShoe"] },
  mesh_running_shorts: { label: "Mesh Running Shorts", type: "style", tokens: ["mesh shorts"], mapTo: ["Sports Shorts"], concepts: ["performance"] },
  track_pants: { label: "Track Pants", type: "style", tokens: ["track pants"], mapTo: ["Track Pants"], concepts: ["jogger"] },
  sports_shorts: { label: "Sports Shorts", type: "style", tokens: ["sports short"], mapTo: ["Sports Shorts"], concepts: ["shorts"] },
  sports_bras: { label: "Sports Bras", type: "style", tokens: ["sports bra", "sports bras"], concepts: ["intimate"] },
  onesies: { label: "Onesies", type: "style", tokens: ["onesie", "onesies"], mapTo: ["Bodysuits"], concepts: ["bodysuit"] },
  yoga_tops: { label: "Yoga Tops", type: "style", tokens: ["yoga top"], mapTo: ["Sports Tops"], concepts: ["tee"] },
  slim_cargo: { label: "Slim Cargo", type: "style", tokens: ["slim cargo"], concepts: ["cargoPants"] },
  utility_baggy_cargo: { label: "Utility Baggy Cargo", type: "style", tokens: ["utility cargo", "baggy cargo"], concepts: ["cargoPants"] },
  chino: { label: "Chino", type: "style", tokens: ["chino skirt"], concepts: ["skirt"] },
  track_jackets: { label: "Track Jackets", type: "style", tokens: ["track jacket"], crossTags: ["activewear"], concepts: ["jacket"] },
  puffer_jackets: { label: "Puffer Jackets", type: "style", tokens: ["puffer jacket"], mapTo: ["Puffer Jackets"], concepts: ["coat"] },
  parkas: { label: "Parkas", type: "style", tokens: ["parka", "parkas"], mapTo: ["Parkas"], concepts: ["coat"] },
};

/** Public, read-only view of every shared style concept. */
export const STYLE_REGISTRY: Readonly<Record<string, StyleDefinition>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(REGISTRY).map(([id, entry]) => [
        id,
        Object.freeze({
          id,
          label: entry.label,
          type: entry.type,
          tokens: Object.freeze([
            ...new Set([id.replace(/_/g, " "), ...(entry.tokens ?? [])]),
          ]),
          mapTo: Object.freeze([...(entry.mapTo ?? [])]),
          crossTags: Object.freeze([...(entry.crossTags ?? [])]),
          requiresSize: entry.requiresSize,
        }) as StyleDefinition,
      ])
    )
  );

/**
 * Label -> shared style, so call sites resolve by the name a person reads
 * while the id stays a stable machine key. Keys above are deliberately
 * readable ids, not the slug of the label: "Boyfriend Jeans" is
 * `boyfriend_jeans`, and a label rename never silently changes identity.
 */
const STYLE_BY_LABEL: Readonly<Record<string, StyleDefinition>> =
  Object.freeze(
    Object.fromEntries(
      Object.values(STYLE_REGISTRY).map((def) => [def.label, def])
    )
  );

export function styleByLabel(label: string): StyleDefinition | undefined {
  return STYLE_BY_LABEL[label];
}

/* ------------------------------------------------------------------ */
/* Concepts                                                             */
/* ------------------------------------------------------------------ */

/**
 * A concept is the axis a set of styles shares (denim cuts, shirt fits,
 * knitwear, ...). A category opts into concepts; the styles it then
 * offers are exactly the registry entries carrying those concepts.
 *
 * Gender is never a concept. There is no "womenJeans" concept and no
 * "menFits" concept, because that is the mistake being removed.
 */
export const STYLE_CONCEPTS = Object.freeze({
  denim: [
    "skinny", "slim", "regular", "straight", "relaxed", "tapered",
    "bootcut", "bootcut_and_flare", "loose_baggy", "wide_leg",
    "boyfriend_jeans", "mom_jeans", "elastic_waist",
  ],
  legCut: [
    "skinny", "slim", "straight", "relaxed", "tapered",
    "bootcut_and_flare", "wide_leg", "loose_baggy",
  ],
  trouserFit: [
    "flat_front", "pleated", "slim", "regular", "relaxed", "tapered",
    "straight", "wide_leg", "loose_baggy", "palazzo", "culottes",
    "cigarette", "wide_leg_trousers", "classic_chino", "slim_chino",
  ],
  shorts: [
    "bermuda_shorts", "cargo_shorts", "chino_shorts", "denim_shorts",
    "sweat_shorts", "cycling_shorts", "sports_shorts",
  ],
  jogger: [
    "fleece", "fleece_joggers", "cargo", "cargo_joggers", "twill",
    "tapered_joggers",
  ],
  tee: ["crewneck", "v_neck", "henley", "longline", "oversized", "boxy", "scoop"],
  tank: ["bandeau", "camisole", "tube_top", "longline_tops", "v_neck", "scoop"],
  polo: ["knit_polo", "pique_cotton"],
  shirt: [
    "denim", "flannel_plaid", "flannel", "linen", "oxford_button_down",
    "cuban_collar", "silk", "chiffon", "lace",
  ],
  shirtFit: [
    "formal_fit", "classic_fit", "slim_fit", "super_slim_fit", "athletic_fit",
    "regular", "relaxed", "oversized", "cropped", "fitted",
  ],
  knitwear: [
    "cable_knit", "mock_neck", "turtleneck", "v_neck_knit", "cropped_knit",
    "crewneck",
  ],
  cardigan: ["buttoned", "shawl_collar", "zippered", "longline"],
  lapel: ["notch_lapel", "peak_lapel", "shawl_lapel"],
  sweatshirt: [
    "crewneck", "pullover", "zip_up", "pullover_hoodies", "zip_up_hoodies",
    "fleece",
  ],
  jacket: [
    "bomber_jackets", "bomber_tweed", "leather_jackets", "track_jackets",
    "trucker_denim_jackets", "denim_jackets", "windbreakers",
  ],
  coat: [
    "wool_coats", "overcoats_wool_coats", "parkas", "puffer_coats",
    "puffer_jackets", "trench_coats", "raincoats",
  ],
  suit: ["slim", "modern", "classic", "slim_fit", "classic_fit"],
  skirt: ["a_line", "pencil", "pleated", "slit", "tiered_ruffle", "denim"],
  leggings: ["classic", "distressed", "yoga_leggings"],
  swim: ["bikinis", "one_piece_swimsuits", "sarongs_cover_ups", "swim_sets"],
  sleepwear: ["pajama_sets", "robes", "footie_pajamas", "sleepsuits"],
  intimate: [
    "boxer_briefs", "briefs", "thermal_layers", "undershirts",
    "high_impact", "medium_support", "low_impact",
  ],
  bodysuit: ["bodysuit_long_sleeve", "bodysuit_short_sleeve", "snap_button"],
  dress: [
    "shirt_dress", "slip_dress", "sundress", "sundresses", "t_shirt_dress",
    "wrap_dress", "everyday_dresses", "party_dresses", "cocktail_dresses",
    "gowns", "maxi_dresses",
  ],
  onePiece: ["jumpsuits", "overalls_dungarees", "dungarees", "rompers", "boilersuits"],
  dressShoe: ["oxfords", "derbies", "monk_straps", "ballerinas"],
  boot: ["chelsea_boots", "heeled_boots"],
  heel: ["block_heels", "platforms", "stilettos", "heeled_boots"],
  casualShoe: ["gym_sneakers", "white_canvas_sneakers", "casual_sneakers", "canvas_sneakers", "runners"],
  kidsShoe: ["light_up_shoes", "canvas_sneakers", "runners"],
  jewelry: ["bracelets", "necklaces", "rings", "earrings"],
  graphic: [
    "cartoon_print", "plain", "performance_tees", "sports_jerseys",
    "sports_tops", "jersey", "tutu",
  ],
  cycling: ["bike_shorts", "cycling_shorts", "flares_leg_warmers"],
  performance: ["compression_tops", "compression_bottoms", "mesh_running_shorts"],
  headwear: ["beanies", "hats", "caps"],
  hoodie: ["pullover_hoodies", "zip_up_hoodies"],
  cargoPants: ["slim_cargo", "utility_baggy_cargo"],
});

export type StyleConcept = keyof typeof STYLE_CONCEPTS;

/** Style ids declared for a concept, in display order. */
export function stylesInConcept(concept: string): string[] {
  const ids = (STYLE_CONCEPTS as Record<string, string[]>)[concept];
  if (!ids) {
    throw new Error(
      `Unknown style concept "${concept}". Declare it in STYLE_CONCEPTS before use.`
    );
  }
  return ids;
}

/** Registry entry for a style id, or undefined if unregistered. */
export function styleDefinition(id: string): StyleDefinition | undefined {
  return STYLE_REGISTRY[id];
}

/**
 * Concepts a style id belongs to, i.e. the reverse of STYLE_CONCEPTS.
 * A style may sit in several concepts (Slim is a denim cut, a trouser cut
 * and a shirt fit), which is what lets one concept drive three unrelated
 * categories without any of them naming the others.
 */
const CONCEPTS_BY_STYLE: Readonly<Record<string, readonly string[]>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(REGISTRY).map(([id, entry]) => [id, entry.concepts])
    )
  );

export function conceptsForStyle(id: string): readonly string[] {
  return CONCEPTS_BY_STYLE[id] ?? [];
}

/**
 * Styles that attach to a concept by declaration in the registry - the
 * full union, as opposed to the display-ordered list above. Tests use
 * this to prove a category offers nothing outside its concepts.
 */
export function styleIdsForConcept(concept: string): string[] {
  return Object.entries(CONCEPTS_BY_STYLE)
    .filter(([, concepts]) => concepts.includes(concept))
    .map(([id]) => id);
}