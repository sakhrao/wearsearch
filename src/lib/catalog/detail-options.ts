/* Context-aware "Anything else" options for the Questionnaire.

   The details step offers structured detail chips tuned to the picked
   category (gender-explicit pieces narrow, shoes/headwear/accessories
   get their own vocabulary), plus free text. Every option maps to a
   REAL search behaviour:

     - when the option's group matches an attribute group the catalog
       actually exposes (meta.attributeGroups), the picked value is a
       soft attribute filter (the engine's supported attribute match);
     - otherwise the picked value is appended to the query as a real
       text token, exactly as if the user typed it ("striped", "wool",
       "running"). No option is ever a UI-only filter that disappears
       on submit.

   Groups are always derived from the category's taxonomy shape
   (root/group/slug), never hardcoded per leaf, and the module is
   pure + extensible: new vocabularies are new rows in PROFILES.

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

const USE = group("Use", "Use", [
  "Everyday",
  "Running",
  "Gym",
  "Swim",
  "Outdoor",
  "Travel",
  "Formal",
]);

const SHOE_TYPE = group("Type", "Type", [
  "Sneakers",
  "Boots",
  "Loafers",
  "Trainers",
  "Sandals",
  "Heels",
]);

const HEADWEAR_TYPE = group("Type", "Type", [
  "Snapback",
  "Bucket",
  "Fedora",
  "Beanie",
  "Baseball",
]);

const ACCESSORY_TYPE = group("Type", "Type", [
  "Classic",
  "Modern",
  "Sport",
  "Formal",
]);

const SCARF_TYPE = group("Type", "Type", [
  "Classic",
  "Oversized",
  "Silk",
  "Knitted",
  "Lightweight",
]);

const SUPPORT = group("Support", "Support", [
  "Light",
  "Medium",
  "Full",
]);

const COVERAGE = group("Coverage", "Coverage", [
  "Full",
  "Partial",
]);

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

function profileFor(
  context: DetailContext
): DetailOptionGroup[] {
  if (isScarves(context)) {
    return [SCARF_TYPE, MATERIAL, PATTERN];
  }

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

  switch (context.root) {
    case "Shoes":
      return [SHOE_TYPE, MATERIAL, USE];
    case "Headwear":
      return [HEADWEAR_TYPE, MATERIAL, COVERAGE];
    case "Accessories":
      return [ACCESSORY_TYPE, MATERIAL, USE];
  }

  /* General clothing: profile by sub-group, defaulting to the shared
     clothing vocabulary (Fit/Style/Material/Pattern). */
  const clothing =
    context.root === "Clothing" ? context.group : null;
  if (clothing === "Sportswear") {
    return [USE, FIT, MATERIAL];
  }
  if (
    clothing === "Swimwear & Basics" ||
    clothing === "Underwear"
  ) {
    return [STYLE, MATERIAL];
  }
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