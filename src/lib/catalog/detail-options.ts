/* Context-aware "Anything else" options for the Questionnaire.

   The details step offers structured detail chips tuned to the picked
   category, including leaf-level profiles: shoe categories get the
   vocabulary shoe shoppers actually use (closure, sole, width, heel,
   strap, silhouette), headwear/bags/ties/eyewear/jewelry get theirs,
   and clothing is tuned per sub-group (outerwear weatherproofing,
   dresses cut+sleeve, skirts mini/midi/maxi, sock lengths, ...).
   Free text stays available in addition.

   Every option maps to a REAL search behaviour:

     - when the option's group matches an attribute group the catalog
       actually exposes (meta.attributeGroups), the picked value is a
       soft attribute filter (the engine's supported attribute match);
     - otherwise the picked value is appended to the query as a real
       text token, exactly as if the user typed it ("Lace-Up", "Water-
       proof", "Aviator"). No option is ever a UI-only filter that
       disappears on submit.

   No profile restates the picked category: the old "Type" groups that
   listed other leaf categories (Sneakers -> Type: Sneakers/Boots/...)
   are replaced by construction/use vocabulary.

   Groups are always derived from the category's taxonomy shape
   (root/group/slug), never hardcoded per leaf, and the module is
   pure + extensible: new vocabularies are new rows in PROFILES or a
   new case in the leaf-level helper.

   This module has no DB / network / I-O. */

export type DetailOptionGroup = {
  name: string;
  /* Catalog attribute group (meta.attributeGroups) this group maps to
     when the catalog actually exposes it; null groups are always
     query-token backed. */
  attributeKey: string | null;
  values: string[];
};

export type DetailContext = {
  root: string | null;
  group: string | null;
  slug: string | null;
};

const group = (
  name: string,
  attributeKey: string | null,
  values: readonly string[]
): DetailOptionGroup => ({ name, attributeKey, values: [...values] });

const FIT = group("Fit", "Fit", [
  "Slim",
  "Regular",
  "Relaxed",
  "Loose",
  "Oversized",
  "Tapered",
  "Fitted",
]);

const STYLE = group("Style", "Style", [
  "Casual",
  "Formal",
  "Sport",
  "Streetwear",
  "Vintage",
  "Minimal",
  "Classic",
]);

const MATERIAL = group("Material", "Material", [
  "Cotton",
  "Wool",
  "Linen",
  "Denim",
  "Silk",
  "Leather",
  "Suede",
  "Synthetic",
]);

const PATTERN = group("Pattern", "Pattern", [
  "Solid",
  "Striped",
  "Checked",
  "Floral",
  "Plain",
  "Camo",
]);

const SLEEVE = group("Sleeve", "Sleeve", [
  "Short",
  "Long",
  "Cap",
  "3/4",
]);

const COLLAR = group("Collar", "Collar", [
  "Crew",
  "Polo",
  "Button-Down",
  "Spread",
  "Collarless",
]);

const LENGTH = group("Length", "Length", [
  "Cropped",
  "Regular",
  "Ankle",
  "Full",
]);

const WASH = group("Wash", "Wash", [
  "Light",
  "Dark",
  "Raw",
  "Distressed",
  "Stonewash",
]);

const USE = group("Use", null, [
  "Everyday",
  "Running",
  "Gym",
  "Swim",
  "Outdoor",
  "Travel",
  "Formal",
]);

const SUPPORT = group("Support", null, [
  "Light",
  "Medium",
  "Full",
]);

const COVERAGE = group("Coverage", null, [
  "Full",
  "Partial",
]);

/* ---- Footwear vocabulary (leaf-tuned, no category restatement) ---- */
const CLOSURE = group("Closure", null, [
  "Lace-Up",
  "Slip-On",
  "Zip",
  "Velcro",
  "Buckle",
]);

const SOLE = group("Sole", null, [
  "Rubber",
  "EVA",
  "Foam",
  "Wedge",
  "Flat",
  "Chunky",
  "Vibram",
]);

/* Footwear-material first; the catalog's Material group (union with
   static values) keeps chips attribute-backed where it can. */
const SHOE_MATERIAL = group("Material", "Material", [
  "Leather",
  "Suede",
  "Canvas",
  "Mesh",
  "Synthetic",
  "Nubuck",
  "Rubber",
  "Patent",
]);

const WIDTH = group("Width", null, [
  "Narrow",
  "Regular",
  "Wide",
  "Extra Wide",
]);

const HEEL = group("Heel", null, [
  "Flat",
  "Low",
  "Mid",
  "High",
  "Block",
  "Wedge",
  "Stiletto",
]);

const STRAP = group("Strap", null, [
  "Ankle Strap",
  "Cross Strap",
  "Adjustable",
  "Buckle",
  "Slip-On",
]);

const SILHOUETTE = group("Silhouette", null, [
  "Oxford",
  "Derby",
  "Monk",
  "Brogue",
  "Pointed",
]);

/* ---- Headwear vocabulary ---- */
const KNIT = group("Knit", null, [
  "Ribbed",
  "Chunky",
  "Cuffed",
  "Oversized",
  "Pom Pom",
]);

const CAP_STYLE = group("Cap Style", null, [
  "Snapback",
  "Fitted",
  "Adjustable",
  "Strapback",
  "Trucker",
]);

const HAT_STYLE = group("Hat Style", null, [
  "Fedora",
  "Bucket",
  "Wide Brim",
  "Panama",
  "Straw",
]);

/* ---- Clothing vocabulary beyond the shared Fit/Style ---- */
const WEATHERPROOF = group("Weatherproof", null, [
  "Waterproof",
  "Windproof",
  "Insulated",
  "Hooded",
  "Padded",
  "Quilted",
  "Ventilated",
]);

const COAT_CUT = group("Cut", null, [
  "Cropped",
  "Hip",
  "Knee",
  "Long",
  "Oversized",
]);

const NECKLINE = group("Neckline", null, [
  "Crew Neck",
  "V-Neck",
  "Turtleneck",
  "Hooded",
  "Cowl",
]);

const SWIM_STYLE = group("Style", null, [
  "Bikini",
  "One-Piece",
  "Tankini",
  "Shorts",
  "Trunks",
]);

const SOCK_LENGTH = group("Sock Length", null, [
  "No-Show",
  "Ankle",
  "Crew",
  "Knee",
  "Over-the-Knee",
]);

/* Skirt length is its own scale (mini/midi/maxi), not the trouser
   Length cut. */
const SKIRT_LENGTH = group("Length", null, [
  "Mini",
  "Midi",
  "Maxi",
  "Pleated",
]);

/* ---- Accessory vocabulary ---- */
const BAG_SIZE = group("Size", null, [
  "Small",
  "Medium",
  "Large",
  "Extra Large",
]);

const BAG_CLOSURE = group("Closure", null, [
  "Zip",
  "Flap",
  "Magnetic",
  "Button",
  "Drawstring",
]);

const BAG_STRAP = group("Strap", null, [
  "Adjustable",
  "Crossbody",
  "Shoulder",
  "Top Handle",
]);

const TIE_STYLE = group("Tie Style", null, [
  "Slim",
  "Regular",
  "Skinny",
  "Bow Tie",
  "Knitted",
]);

const FRAME = group("Frame", null, [
  "Round",
  "Square",
  "Aviator",
  "Wayfarer",
  "Cat Eye",
]);

const LENS = group("Lens", null, [
  "Polarized",
  "Mirrored",
  "Gradient",
  "Photochromic",
]);

const METAL = group("Metal", null, [
  "Gold",
  "Silver",
  "Rose Gold",
  "Gold-Plated",
  "White Gold",
  "Stainless Steel",
]);

const WATCH_CASE = group("Case", null, [
  "Round",
  "Square",
  "Chronograph",
  "Minimal",
  "Sport",
]);

const WATCH_STRAP = group("Strap", null, [
  "Leather",
  "Metal",
  "Silicone",
  "Steel",
  "Nylon",
  "Mesh",
]);

const SCARF_TYPE = group("Type", null, [
  "Classic",
  "Oversized",
  "Silk",
  "Knitted",
  "Lightweight",
]);

/* ---- Leaf matchers (taxonomy-driven, never per-product) ---- */
function isBras(context: DetailContext): boolean {
  const slug = context.slug ?? "";
  return slug === "bras" || /bra/i.test(slug);
}

function isScarves(context: DetailContext): boolean {
  const slug = context.slug ?? "";
  return /scarves|hijab|hijabs/i.test(slug);
}

function isTrousers(context: DetailContext): boolean {
  const slug = context.slug ?? "";
  return /trousers|chinos/i.test(slug);
}

function isJeans(context: DetailContext): boolean {
  const slug = context.slug ?? "";
  return /^jeans$/i.test(slug);
}

function isShirts(context: DetailContext): boolean {
  const slug = context.slug ?? "";
  return slug === "shirts";
}

function isBags(context: DetailContext): boolean {
  const slug = context.slug ?? "";
  return /handbag|backpack|shoulder-bag|crossbody|tote|bum|duffle|travel-bag/i.test(slug);
}

/* ---- Root-specific profiles ---- */
function shoesProfile(context: DetailContext): DetailOptionGroup[] {
  switch (context.slug) {
    case "heels":
      return [HEEL, STRAP, SHOE_MATERIAL, WIDTH];
    case "sandals":
      return [STRAP, SOLE, SHOE_MATERIAL, WIDTH, USE];
    case "boots":
      return [HEEL, CLOSURE, SHOE_MATERIAL, WIDTH];
    case "formal-shoes":
      return [SILHOUETTE, HEEL, SHOE_MATERIAL, WIDTH];
    case "running-trainers":
      return [USE, SOLE, SHOE_MATERIAL, WIDTH];
    case "flats":
      return [STRAP, SOLE, SHOE_MATERIAL, WIDTH, STYLE];
    case "loafers":
      return [STYLE, SHOE_MATERIAL, WIDTH, SOLE];
    default:
      return [STYLE, SHOE_MATERIAL, CLOSURE, WIDTH, USE];
  }
}

function headwearProfile(context: DetailContext): DetailOptionGroup[] {
  switch (context.slug) {
    case "beanies":
      return [KNIT, MATERIAL, PATTERN];
    case "caps":
      return [CAP_STYLE, MATERIAL, PATTERN];
    case "hats":
      return [HAT_STYLE, MATERIAL, PATTERN, COVERAGE];
    default:
      return [STYLE, MATERIAL, PATTERN];
  }
}

function accessoryProfile(context: DetailContext): DetailOptionGroup[] {
  switch (context.slug) {
    case "ties":
    case "ties-bow-ties":
      return [TIE_STYLE, MATERIAL, PATTERN];
    case "sunglasses":
      return [FRAME, LENS, MATERIAL];
    case "watches":
      return [WATCH_CASE, WATCH_STRAP, STYLE];
    case "jewelry":
      return [METAL, STYLE, MATERIAL];
    case "belts":
      return [STYLE, MATERIAL, USE];
    case "wallets":
      return [BAG_SIZE, BAG_CLOSURE, MATERIAL];
    default:
      if (isBags(context)) {
        return [BAG_SIZE, BAG_CLOSURE, BAG_STRAP, MATERIAL];
      }
      return [STYLE, MATERIAL, USE];
  }
}

function clothingProfile(context: DetailContext): DetailOptionGroup[] {
  /* Some matchers are slug-based because the leaf name is stable
     across taxonomy edits (t-shirts stays t-shirts). */
  if (/sweaters|cardigans|^jumpers$|^jumper$/.test(context.slug ?? "")) {
    return [NECKLINE, FIT, MATERIAL, PATTERN];
  }
  if (/^hoodies$|^hoodie$/.test(context.slug ?? "")) {
    return [FIT, STYLE, MATERIAL, PATTERN];
  }
  if (/^sweatshirts$|^sweatshirt$/.test(context.slug ?? "")) {
    return [NECKLINE, FIT, MATERIAL, PATTERN];
  }
  if (/^polo-shirts$|^polo$|button-up/.test(context.slug ?? "")) {
    return [FIT, SLEEVE, COLLAR, MATERIAL];
  }
  if (/^dresses$|^dress$|^jumpsuits$|^jumpsuit$/.test(context.slug ?? "")) {
    return [LENGTH, SLEEVE, FIT, MATERIAL, PATTERN];
  }
  if (/^skirts$|^skirt$/.test(context.slug ?? "")) {
    return [SKIRT_LENGTH, FIT, MATERIAL, PATTERN];
  }
  if (/^leggings$|^legging$/.test(context.slug ?? "")) {
    return [FIT, MATERIAL, USE];
  }
  if (/^socks$|^sock$/.test(context.slug ?? "")) {
    return [SOCK_LENGTH, MATERIAL, PATTERN, USE];
  }
  if (/^swimwear$|^swim$/.test(context.slug ?? "")) {
    return [SWIM_STYLE, MATERIAL, USE];
  }
  if (/^underwear$|briefs|panties/.test(context.slug ?? "")) {
    return [STYLE, MATERIAL];
  }
  switch (context.group) {
    case "Outerwear":
      return [WEATHERPROOF, COAT_CUT, STYLE, MATERIAL];
    case "Sportswear":
      return [USE, FIT, MATERIAL];
    case "Dresses & Jumpsuits":
      return [LENGTH, SLEEVE, FIT, MATERIAL, PATTERN];
    case "Bottoms":
      return [FIT, LENGTH, MATERIAL, USE];
    case "Swimwear & Basics":
      return [STYLE, MATERIAL];
  }
  if (context.group === "Tops") {
    return [FIT, SLEEVE, STYLE, MATERIAL, PATTERN];
  }
  return [FIT, STYLE, MATERIAL, PATTERN];
}

function profileFor(
  context: DetailContext
): DetailOptionGroup[] {
  if (isBras(context)) {
    return [STYLE, MATERIAL, SUPPORT];
  }

  if (isShirts(context)) {
    /* Shirts are sized like general tops but their fit lives in the
       cut + sleeve + collar: Fit/Style/Sleeve/Collar/Material is the
       vocabulary clothing shoppers actually use for a shirt. */
    return [FIT, STYLE, SLEEVE, COLLAR, MATERIAL];
  }

  if (isJeans(context)) {
    return [FIT, LENGTH, WASH, MATERIAL];
  }

  if (isTrousers(context)) {
    return [FIT, LENGTH, PATTERN, MATERIAL];
  }

  if (isScarves(context)) {
    return [SCARF_TYPE, MATERIAL, PATTERN];
  }

  switch (context.root) {
    case "Shoes":
      return shoesProfile(context);
    case "Headwear":
      return headwearProfile(context);
    case "Accessories":
      return accessoryProfile(context);
    case "Clothing":
      return clothingProfile(context);
  }

  /* Unknown shapes fall back to a reasonable shared vocabulary. */
  return [FIT, STYLE, MATERIAL, PATTERN];
}

export function detailOptionGroupsFor(
  context: DetailContext
): DetailOptionGroup[] {
  return profileFor(context).map((g) => ({
    name: g.name,
    attributeKey: g.attributeKey,
    values: [...g.values],
  }));
}