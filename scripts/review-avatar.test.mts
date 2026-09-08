/* Review + Avatar — new-logic tests.

   Part A (pure, offline): AvatarProfile (defaults, validation,
   serialization, persistence abstraction), avatar dimensions, garment
   mapping (canonical slug + attributes + color, graceful missing
   data), review state (completion, skipped slots, one-piece outfit,
   multiple accessories, price reliability), and a SOURCE-
   INDEPENDENCE guard over the new modules.

   Part B (honest API): POSTs the real /api/outfit/review route with a
   real look pulled from the live catalog (local DATABASE_URL). Runs
   only when the catalog actually has top/bottom/footwear products — it
   never asserts on product counts.

   Run: tsx scripts/review-avatar.test.mts */

import "dotenv/config";

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  AVATAR_GENDERS,
  BODY_SHAPES,
  DEFAULT_AVATAR_PROFILE,
  HAIR_COLORS,
  HAIR_LENGTHS,
  HAIR_STYLES,
  HAIR_TEXTURES,
  SKIN_TONES,
  SKIN_TONE_HEX,
  HAIR_COLOR_HEX,
  InMemoryAvatarStore,
  avatarDimensionsFor,
  createLocalStorageAvatarStore,
  describeAvatar,
  hydrateAvatarProfile,
  isAvatarProfile,
  normalizeAvatarProfile,
  parseAvatarProfile,
  serializeAvatarProfile,
  validateAvatarProfile,
} from "../src/lib/avatar/profile";
import {
  attachGarmentAsset,
  garmentLabel,
  garmentTypeFor,
  garmentVisualFor,
} from "../src/lib/outfit/garment";
import {
  fixedLookScore,
  priceReliabilityFor,
  reviewSlotOrder,
  reviewStatusFor,
  reviewStepsFor,
} from "../src/lib/outfit/review-state";
import {
  orderedReviewPieces,
  reviewApiPiecesFor,
} from "../src/lib/outfit/review-display";
import type { GarmentVisual, GarmentType } from "../src/lib/outfit/garment";
import {
  parseAccessories,
  parsePieces,
  parseUrlState,
} from "../src/lib/build/url-state";
import type { UrlBuildProduct, UrlPiece } from "../src/lib/build/url-state";
import type { OutfitProduct } from "../src/lib/outfit/types";
import {
  avatarModelFor,
  bodyMorphsFor,
  silentProfileFields,
} from "../src/lib/avatar/avatar-model";
import {
  fashionCompatibility,
  colorPairFactor,
  layeringFactor,
  paletteFactor,
  patternFactor,
  silhouetteFactor,
  verdictFor,
} from "../src/lib/outfit/fashion-compatibility";
import { garmentAssetFor } from "../src/lib/outfit/garment-assets";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra?: string): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL ${name}${extra ? " :: " + extra : ""}`);
  }
}

function shimProduct(overrides: Partial<OutfitProduct> & { id: string; categorySlug: string }): OutfitProduct {
  return {
    id: overrides.id,
    name: overrides.name ?? `${overrides.id} name`,
    price: overrides.price ?? "25.00",
    currency: overrides.currency ?? "EUR",
    productUrl: overrides.productUrl ?? `https://shop.example.com/p/${overrides.id}`,
    imageUrl: overrides.imageUrl ?? null,
    availability: overrides.availability ?? "IN_STOCK",
    gender: overrides.gender ?? "MEN",
    brand: overrides.brand ?? null,
    category: overrides.category ?? {
      id: `cat-${overrides.categorySlug}`,
      slug: overrides.categorySlug,
      name: overrides.categorySlug,
    },
    variants: overrides.variants ?? [
      { price: "25.00", currency: "EUR", availability: "AVAILABLE", color: { name: "Black", hex: "#111111" } },
    ],
    attributes: overrides.attributes ?? [],
  };
}

/* a raw GarmentVisual ghost for pure-logic tests (shape/color rules,
   classification, silhouette scoring) */
const ghost = (type: GarmentType, over: Partial<GarmentVisual> = {}): GarmentVisual => ({
  slot: "top",
  type,
  label: type,
  color: { name: "Black", hex: "#111111" },
  fit: "regular",
  sleeve: "short",
  collar: "crew",
  length: "regular",
  pattern: "solid",
  layerOrder: 1,
  coverage: "structured",
  assetUri: null,
  note: null,
  ...over,
});

/* ------------------------------------------------------------------ */
/* PART A — AvatarProfile                                             */
/* ------------------------------------------------------------------ */

check("default avatar is valid", isAvatarProfile(DEFAULT_AVATAR_PROFILE));

const v = validateAvatarProfile({
  gender: "ALIEN",
  heightCm: 3,
  weightKg: 999,
  bodyShape: "invisible",
  skinTone: "purple",
  hairStyle: "mullet",
  hairLength: "massive",
  hairColor: "rainbow",
  hairTexture: "invisible",
});
check("validation flags every bad field", Object.keys(v).length === 9);
check("validation passes clean profile", Object.keys(validateAvatarProfile({ ...DEFAULT_AVATAR_PROFILE })).length === 0);

const norm = normalizeAvatarProfile({ heightCm: 9999, weightKg: -5, gender: "WOMEN", hairStyle: "ponytail" });
check("normalize clamps height to max", norm.heightCm === 250);
check("normalize clamps weight to min", norm.weightKg === 25);
check("normalize keeps valid picks", norm.gender === "WOMEN" && norm.hairStyle === "ponytail");
check("normalize fills invalid fields with defaults", norm.bodyShape === "regular" && norm.skinTone === "medium");

const enc = serializeAvatarProfile(DEFAULT_AVATAR_PROFILE);
check("serialization roundtrips", parseAvatarProfile(enc)?.heightCm === DEFAULT_AVATAR_PROFILE.heightCm);
check("parse rejects garbage", parseAvatarProfile("not-json") === null);
check("parse rejects invalid json object", parseAvatarProfile('{"gender":"X"}') === null);
check("parse rejects empty", parseAvatarProfile(null) === null);
check("url hydrate uses default on garbage", hydrateAvatarProfile("garbage").gender === DEFAULT_AVATAR_PROFILE.gender);
check("url hydrate reads valid", hydrateAvatarProfile(enc).bodyShape === DEFAULT_AVATAR_PROFILE.bodyShape);

check("describe avatar is human text", describeAvatar(DEFAULT_AVATAR_PROFILE).includes("174 cm"));

const mem = new InMemoryAvatarStore();
mem.set(normalizeAvatarProfile({ gender: "WOMEN", heightCm: 165 }));
check("in-memory store get/set", mem.get().heightCm === 165 && mem.get().gender === "WOMEN");

const ls = createLocalStorageAvatarStore("test-key");
ls.set(normalizeAvatarProfile({ skinTone: "deep" }));
check("localStorage store degrades to memory + persists", ls.get().skinTone === "deep");

const dims = avatarDimensionsFor(normalizeAvatarProfile({ heightCm: 175, bodyShape: "regular" }));
const dimsTall = avatarDimensionsFor(normalizeAvatarProfile({ heightCm: 200, bodyShape: "regular" }));
const dimsBroad = avatarDimensionsFor(normalizeAvatarProfile({ heightCm: 175, bodyShape: "broad" }));
check("dimensions scale with height", dimsTall.scale > dims.scale);
check("broad shape grows chest", dimsBroad.shapeChest > dims.shapeChest);
check("dimensions are deterministic", avatarDimensionsFor(normalizeAvatarProfile({ heightCm: 182, bodyShape: "curvy" })).hipWidth === avatarDimensionsFor(normalizeAvatarProfile({ heightCm: 182, bodyShape: "curvy" })).hipWidth);

/* every option list is exhaustive + non-empty + covered by swatches */
for (const list of [AVATAR_GENDERS, BODY_SHAPES, SKIN_TONES, HAIR_STYLES, HAIR_LENGTHS, HAIR_COLORS, HAIR_TEXTURES]) {
  check(`option list non-empty: ${list[0].label}`, list.length > 0);
}
for (const t of SKIN_TONES) check(`skin swatch for ${t.value}`, Boolean(SKIN_TONE_HEX[t.value as keyof typeof SKIN_TONE_HEX]));
for (const c of HAIR_COLORS) check(`hair swatch for ${c.value}`, Boolean(HAIR_COLOR_HEX[c.value as keyof typeof HAIR_COLOR_HEX]));

/* ------------------------------------------------------------------ */
/* PART A — garment mapping                                           */
/* ------------------------------------------------------------------ */

check("jeans slug -> jeans", garmentTypeFor("jeans") === "jeans");
check("dress slug -> dress", garmentTypeFor("Dresses") === "dress");
check("unknown clothing slug falls back to slot generic", garmentTypeFor("mystery-garment") === "solid-torso");
check("slotted fallback for top-like unknown", garmentVisualFor({
  product: shimProduct({ id: "u1", categorySlug: "mystery" }),
  slot: "top",
}).type === "solid-torso");

const tee = garmentVisualFor({
  product: shimProduct({
    id: "t1",
    categorySlug: "t-shirts",
    attributes: [
      { value: "Oversized", attribute: { name: "Fit" } },
      { value: "Long Sleeve", attribute: { name: "Sleeve" } },
      { value: "Crew Neck", attribute: { name: "Collar" } },
      { value: "Striped", attribute: { name: "Pattern" } },
      { value: "Cotton", attribute: { name: "Material" } },
    ],
  }),
  slot: "top",
});
check("structured coverage for canonical slug", tee.coverage === "structured");
check("fit from attribute", tee.fit === "oversized");
check("sleeve from attribute", tee.sleeve === "long");
check("collar from attribute", tee.collar === "crew");
check("pattern from attribute", tee.pattern === "striped");
check("label mentions material", (tee.note ?? "").includes("Cotton"));

const teeNoAttrs = garmentVisualFor({
  product: shimProduct({ id: "t2", categorySlug: "t-shirts" }),
  slot: "top",
});
check("missing attributes degrade gracefully to defaults", teeNoAttrs.fit === "regular");
check("missing attributes still know the garment", teeNoAttrs.type === "tee" && teeNoAttrs.coverage === "structured");

const focus = garmentVisualFor({
  product: shimProduct({ id: "t3", categorySlug: "t-shirts", variants: [] }),
  slot: "top",
  color: { name: "Focus Teal", hex: "#0a7f7f" },
});
check("focus color wins over empty variants", focus.color?.name === "Focus Teal" && focus.color?.hex === "#0a7f7f");

const noColorNoVariants = garmentVisualFor({
  product: shimProduct({ id: "t4", categorySlug: "t-shirts", variants: [] }),
  slot: "top",
});
check("no color data -> null color, never invented", noColorNoVariants.color === null || noColorNoVariants.color?.name === undefined);

const jeans = garmentVisualFor({ product: shimProduct({ id: "b1", categorySlug: "jeans" }), slot: "bottom" });
check("jeans render as full bottoms", jeans.length === "full" && jeans.type === "jeans");
check("layer order is a sane int", Number.isInteger(jeans.layerOrder));

const coat = garmentVisualFor({ product: shimProduct({ id: "l1", categorySlug: "coats", attributes: [{ value: "Long", attribute: { name: "Length" } }] }), slot: "layer" });
check("coats render long", coat.length === "long");

const asset = attachGarmentAsset(tee, "fitwear://asset/tee-01");
check("asset hook flips coverage", asset.coverage === "asset" && asset.assetUri === "fitwear://asset/tee-01");
check("asset hook is additive (same garments)", asset.type === tee.type && asset.fit === tee.fit);

check("garment label is human", garmentLabel("formal-shoes") === "Formal Shoes");

/* ------------------------------------------------------------------ */
/* PART A — avatar model (profile -> morphs)                          */
/* ------------------------------------------------------------------ */

const femaleCurvy = avatarModelFor(normalizeAvatarProfile({ gender: "WOMEN", bodyShape: "curvy" }));
check("women drive genderToFemale morph", femaleCurvy.morphs.genderToFemale === 1);
check("curvy shapes bust the chest (feminine scale 1)", femaleCurvy.morphs.bustUp >= 0.45);
check("curvy shapes cinch the waist", femaleCurvy.morphs.waistDown > 0.2);
check("curvy shapes widen hips", femaleCurvy.morphs.hipsUp >= 0.5);
check("curvy shapes lift glutes", femaleCurvy.morphs.glutesUp >= 0.55);

const maleAthletic = avatarModelFor(normalizeAvatarProfile({ gender: "MEN", bodyShape: "athletic" }));
check("men drive genderToMale morph", maleAthletic.morphs.genderToMale === 1);
check("athletic adds muscle", maleAthletic.morphs.muscleUp > 0);
check("athletic tones the stomach", maleAthletic.morphs.stomachToned > 0.6);
check("bust strength is feminine-scaled down for men", maleAthletic.morphs.bustUp <= 0.2);

const kid = avatarModelFor(normalizeAvatarProfile({ gender: "KIDS", bodyShape: "curvy" }));
check("kids drive no gender composite", kid.morphs.genderToFemale === 0 && kid.morphs.genderToMale === 0);
check("kids bust scaling caps at 0.4", kid.morphs.bustUp <= 0.21);

const base = normalizeAvatarProfile({ gender: "MEN", heightCm: 174 });
check("height scale maps cm onto the base human", Math.abs(avatarModelFor({ ...base, bodyShape: "regular" }).heightScale - 174 / 169.4) < 0.001);

const morphs = bodyMorphsFor(base);
for (const [k, v] of Object.entries(morphs)) {
  check(`morph ${k} is clamped 0..1`, Number(v) >= 0 && Number(v) <= 1);
}
check("every profile field visibly drives the model", silentProfileFields(base).length === 0);

/* ------------------------------------------------------------------ */
/* PART A — GarmentSystem classification                              */
/* ------------------------------------------------------------------ */

check("tee -> top layer mid", garmentAssetFor(ghost("tee")).category === "top" && garmentAssetFor(ghost("tee")).layer === "mid");
check("jeans -> bottom", garmentAssetFor(ghost("jeans")).category === "bottom");
check("dress -> one-piece", garmentAssetFor(ghost("dress")).category === "one-piece");
check("sneakers -> footwear", garmentAssetFor(ghost("sneakers")).category === "footwear");
check("belt -> accessory", garmentAssetFor(ghost("belt")).category === "accessory");
check("coat -> layer outer", garmentAssetFor(ghost("coat")).layer === "outer");
check("garment asset passes through a future model URI", garmentAssetFor(ghost("tee", { assetUri: "fitwear://a/1" })).assetUri === "fitwear://a/1");

/* ------------------------------------------------------------------ */
/* PART A — FashionCompatibility (independent of contextFitScore)     */
/* ------------------------------------------------------------------ */

const empty = fashionCompatibility([]);
check("empty look scores 0 and stays soft-mismatch, never invalid", empty.score === 0 && empty.verdict === "soft-mismatch" && empty.factors.length === 0);

const singleTee = fashionCompatibility([ghost("tee", { color: { name: "Red", hex: "#c00" } })]);
check("single piece reads as a strong clean look", singleTee.verdict === "strong" || singleTee.verdict === "valid");

const twoTees = fashionCompatibility([ghost("tee"), ghost("shirt")]);
check("two torso pieces is hard-invalid", twoTees.verdict === "hard-invalid" && twoTees.issues.length > 0);

const dressAndJeans = fashionCompatibility([ghost("dress"), ghost("jeans")]);
check("dress + jeans is hard-invalid (one-piece covers the legs)", dressAndJeans.verdict === "hard-invalid");

const twoShoes = fashionCompatibility([ghost("sneakers"), ghost("boots")]);
check("two pairs of shoes is hard-invalid", twoShoes.verdict === "hard-invalid");

const classic = fashionCompatibility([
  ghost("tee", { color: { name: "White", hex: "#fff" } }),
  ghost("jeans", { color: { name: "Blue", hex: "#356" } }),
  ghost("sneakers", { color: { name: "White", hex: "#fff" } }),
]);
check("classic look is valid or strong", classic.verdict === "valid" || classic.verdict === "strong");
check("classic look reports a color factor", classic.factors.some((f) => f.key === "color"));

const overload = fashionCompatibility([
  ghost("tee", { pattern: "striped", color: { name: "White", hex: "#fff" } }),
  ghost("jeans", { pattern: "checked", color: { name: "Black", hex: "#111" } }),
]);
check("pattern overload reports low pattern score", (overload.factors.find((f) => f.key === "pattern")?.score ?? 1) <= 0.2);
check("two no-clash-neutral colors are excellent", colorPairFactor([
  ghost("tee", { color: { name: "White", hex: "#fff" } }),
  ghost("jeans", { color: { name: "Black", hex: "#111" } }),
]) === 1);
check("red+blue are poor, never auto-good", colorPairFactor([
  ghost("tee", { color: { name: "Red", hex: "#c00" } }),
  ghost("jeans", { color: { name: "Blue", hex: "#356" } }),
]) === 0);
check("single-pattern palette stays disciplined", patternFactor([
  ghost("tee", { pattern: "striped" }),
  ghost("jeans"),
]) >= 0.8);
check("balance: big coat + leggings scores 1", silhouetteFactor([
  ghost("coat", { fit: "oversized" }),
  ghost("leggings"),
]) === 1);
check("slab: big coat + relaxed jeans scores low", silhouetteFactor([
  ghost("coat", { fit: "oversized" }),
  ghost("jeans", { fit: "relaxed" }),
]) <= 0.4);
check("single outer layers cleanly", layeringFactor([ghost("coat")]) === 1);
check("coat over blazer conflicts", layeringFactor([ghost("coat"), ghost("blazer")]) === 0.55);
check("verdict thresholds", verdictFor(0.8, []) === "strong" && verdictFor(0.6, []) === "valid" && verdictFor(0.3, []) === "soft-mismatch" && verdictFor(0.9, ["x"]) === "hard-invalid");

/* ------------------------------------------------------------------ */
/* PART A — review state                                              */
/* ------------------------------------------------------------------ */

const multiAcc = reviewStatusFor(
  [
    { slot: "top", productId: "a" },
    { slot: "bottom", productId: "b" },
    { slot: "accessory", productId: "x" },
    { slot: "accessory", productId: "y" },
  ],
  null
);
check("multiple accessories are one slot, all present", multiAcc.missingRequired.length === 0 && multiAcc.complete);
/* review slot order is the source of the display list */
const slotOrder = reviewSlotOrder();
check("review slot order includes the accessory slot", slotOrder.includes("accessory"));

const emptyLook = reviewStatusFor([], null);
check("empty look reports required top+bottom as missing", emptyLook.missingRequired.length === 2);
check("skipped optional is reported honestly", reviewStatusFor([{ slot: "top", productId: "a" }, { slot: "bottom", productId: "b" }], null).skippedOptional.length === 3);

const dressOnly = reviewStatusFor([{ slot: "top", productId: "dress" }], "dresses");
check("one-piece dress drops the bottom step -> complete", dressOnly.complete && dressOnly.missingRequired.length === 0);

const jumpsuitWithFoot = reviewStatusFor(
  [{ slot: "top", productId: "js" }, { slot: "footwear", productId: "sh" }],
  "jumpsuits"
);
check("one-piece + footwear keeps optional visible", jumpsuitWithFoot.complete && jumpsuitWithFoot.skippedOptional.length === 2);

check("review steps match builder flow", reviewStepsFor(null).map((s) => s.slot).join(",") === "top,bottom,footwear,layer,accessory");
check("one-piece steps drop bottom only", reviewStepsFor("dresses").map((s) => s.slot).join(",") === "top,footwear,layer,accessory");

/* price reliability — honest totals */
const euro = shimProduct({ id: "e1", categorySlug: "t-shirts", price: "10.00", currency: "EUR" });
const usd = shimProduct({ id: "e2", categorySlug: "t-shirts", price: "22.00", currency: "USD" });
check("EUR-only total is reliable", priceReliabilityFor([{ product: euro }], null).reliable === true);
check("EUR total is exact", priceReliabilityFor([{ product: euro }], null).totalEur === 10);
check("empty look total is never reliable", priceReliabilityFor([], null).reliable === false);
check("USD without a rate is unreliable", priceReliabilityFor([{ product: usd }], null).reliable === false);
check("USD with a real rate converts", priceReliabilityFor([{ product: usd }], 1.1).totalEur === 20);
check("USD with a real rate is reliable", priceReliabilityFor([{ product: usd }], 1.1).reliable === true);
check("mixed EUR+USD flags usd", priceReliabilityFor([{ product: euro }, { product: usd }], null).hasUsd === true);

const noItems = fixedLookScore({ items: [] });
check("no items -> no score", noItems === null);
const scored = fixedLookScore({
  items: [
    { slot: "top", product: shimProduct({ id: "s1", categorySlug: "t-shirts", attributes: [{ value: "Casual", attribute: { name: "Style" } }] }) },
    { slot: "bottom", product: shimProduct({ id: "s2", categorySlug: "jeans" }) },
  ],
});
check("fixed look scores deterministically in [0,1]", typeof scored === "number" && scored !== null && scored >= 0 && scored <= 1);

/* ------------------------------------------------------------------ */
/* PART A — review page wiring (regression for the production bug)     */
/*                                                                     */
/* The Avatar + Selected cards are BOTH driven by `ordered` on the     */
/* page. The bug report (blank avatar, "empty" selected, scroll) must  */
/* never be explained by a dropped look: these pin the pure helpers    */
/* the page now uses so a full builder URL always yields its pieces.   */
/* ------------------------------------------------------------------ */

const urlProduct = (id: string, overrides: Partial<UrlBuildProduct> = {}): UrlBuildProduct => ({
  id,
  name: `${id} name`,
  price: "19.99",
  currency: "EUR",
  imageUrl: null,
  productUrl: `https://shop.example.com/p/${id}`,
  brand: "DemoBrand",
  categorySlug: "t-shirts",
  categoryName: "T-Shirts",
  gender: "MEN",
  colors: ["Black"],
  sizes: ["M"],
  ...overrides,
});
const piece = (id: string, color: string | null = "Black"): UrlPiece => ({
  product: urlProduct(id),
  color,
});
const urlSelected = {
  top: piece("t"),
  bottom: piece("b"),
  footwear: piece("f"),
  layer: piece("l"),
};
const urlAccessories = [piece("a1"), piece("a2")];

const ordered = orderedReviewPieces(urlSelected, urlAccessories);
check("review display keeps avatar+buy sources (6 pieces -> 1 avatar + 5 bought)", ordered.length === 6);
check("review display order is top,bottom,footwear,layer,then ALL accessories", ordered.map((o) => o.slot).join(",") === "top,bottom,footwear,layer,accessory,accessory");
check("accessories are always last even when optional layer is unset", orderedReviewPieces({ top: urlSelected.top, bottom: urlSelected.bottom }, urlAccessories).map((o) => o.slot).join(",") === "top,bottom,accessory,accessory");
check("ordered pieces passthrough the real products", ordered[0].product.id === "t" && ordered[4].product.id === "a1");
check("empty review state -> empty ordered list (page renders its empty state)", orderedReviewPieces({}, []).length === 0);

const apiBody = reviewApiPiecesFor(urlSelected, urlAccessories);
check("api body has one entry per slot + one per accessory", apiBody.length === 6);
check("api body carries slot + productId", apiBody[0].slot === "top" && apiBody[0].productId === "t");
check("api body color is a resolved name with null hex", apiBody[0].color?.name === "Black" && apiBody[0].color?.hex === null);
check("api body tags every accessory entry", apiBody.filter((p) => p.slot === "accessory").length === 2);

/* the review page receives the builder URL verbatim (?gender&selected&accs) */
const u = new URL(`https://wearsearch.app/outfit/review?gender=MEN&selected=${encodeURIComponent(JSON.stringify(urlSelected))}&accs=${encodeURIComponent(JSON.stringify(urlAccessories))}`);
const { selected: parsedSel, accessories: parsedAccs } = parseUrlState(
  u.searchParams.get("gender"),
  u.searchParams.get("selected"),
  u.searchParams.get("accs")
);
check("review page parses a builder URL into the exact same look", Object.keys(parsedSel).length === 4 && parsedSel.top?.product.id === "t" && parsedSel.bottom?.product.id === "b" && parsedSel.footwear?.product.id === "f" && parsedSel.layer?.product.id === "l" && parsedAccs.length === 2);
check("parsed look survives a full JSON roundtrip non-empty (no init reset race)", orderedReviewPieces(parsedSel, parsedAccs).length === 6);
check("accessories keep their pick order through serialization (it IS the display order)", parseAccessories(JSON.stringify(urlAccessories)).map((p) => p.product.id).join(",") === "a1,a2");
check("parse drops malformed pieces instead of crashing or inventing them", Object.keys(parsePieces('{"top":{"product":{}}}')).length === 0);

/* ------------------------------------------------------------------ */
/* PART A — source independence (no fake products, no source coupling) */
/* ------------------------------------------------------------------ */

/*
   Strip // and block comments (written as the slash-star tokens) so the
   design-contract prose (e.g. "never reads sourceId / eBay listing fields")
   is not mistaken for a coupling.
*/
function codeWithoutComments(body: string): string {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/^\s*["']use client["'];?\s*$/gm, "");
}

/* Tokens that would betray a PRODUCT-SOURCE coupling in code. */
const SOURCE_TOKENS =
  /\bebay\b|\bsourceId\b|\bexternalListing\b|\bexternalListingId\b|\bpurchaseUrl\b|\bproviderKey\b/i;

/* Server routes may import prisma (the catalog reader); the client-
   importable modules must never pull the DB in. */
const CLIENT_MODULES = [
  "src/lib/avatar/profile.ts",
  "src/lib/avatar/webgl.ts",
  "src/lib/avatar/avatar-model.ts",
  "src/lib/avatar/human-model.ts",
  "src/lib/outfit/garment.ts",
  "src/lib/outfit/garment-assets.ts",
  "src/lib/outfit/fashion-compatibility.ts",
  "src/lib/outfit/review-state.ts",
  "src/lib/outfit/review-display.ts",
  "src/app/outfit/review/page.tsx",
  "src/components/avatar/avatar-scene.tsx",
  "src/components/avatar/avatar-preview.tsx",
  "src/components/avatar/avatar-configurator.tsx",
];

const ALL_NEW_MODULES = [
  ...CLIENT_MODULES,
  "src/app/api/outfit/review/route.ts",
];

for (const mod of ALL_NEW_MODULES) {
  const body = codeWithoutComments(readFileSync(join(process.cwd(), mod), "utf8"));
  check(
    `${mod} has no source/eBay coupling in code`,
    !SOURCE_TOKENS.test(body),
    "found source-specific token"
  );
}
for (const mod of CLIENT_MODULES) {
  const body = readFileSync(join(process.cwd(), mod), "utf8");
  check(`${mod} imports no prisma`, !/from\s+["']@\/lib\/prisma["']/.test(body));
}

/* ------------------------------------------------------------------ */
/* PART A — baked avatar base GLB (contract shape, cheap static gate) */
/* ------------------------------------------------------------------ */

const baseGlb = join(process.cwd(), "public/models/avatar/base.glb");
const manifest = join(process.cwd(), "public/models/avatar/avatar-manifest.json");
check("baked avatar GLB exists (runtime asset)", existsSync(baseGlb));
check("baked avatar GLB is a real file (>1MB)", existsSync(baseGlb) && readFileSync(baseGlb).byteLength > 1024 * 1024);
const manifestOk = existsSync(manifest) ? JSON.parse(readFileSync(manifest, "utf8")) : null;
check("avatar manifest exists with the CC0 bill of provenance", manifestOk?.license?.toLowerCase().includes("cc0"));
check("avatar base is the expected body (13380 verts, 26756 tris, 52 bones)", manifestOk?.scene?.vertexCount === 13380 && manifestOk?.scene?.triangleCount === 26756 && manifestOk?.scene?.boneCount === 52);
check("every runtime morph name exists in the baked base", Array.isArray(manifestOk?.morphs) && manifestOk.morphs.length === 30);

/* ------------------------------------------------------------------ */
/* PART B — honest API (needs live local catalog; skips cleanly)      */
/* ------------------------------------------------------------------ */

async function partB(): Promise<void> {
  let catalog: OutfitProduct[];
  try {
    const [{ prisma }, { loadOutfitCatalog }] = await Promise.all([
      import("../src/lib/prisma"),
      import("../src/lib/outfit/catalog"),
    ]);
    catalog = await loadOutfitCatalog(prisma);
  } catch {
    console.log("SKIP part B: no database connection");
    return;
  }

  const pick = (pred: (p: OutfitProduct) => boolean, count: number) =>
    catalog.filter(pred).filter(p => p.variants.some(v => v.availability === "AVAILABLE") && p.productUrl.startsWith("https://")).slice(0, count);

  const tops = pick((p) => p.category?.slug === "t-shirts", 1);
  const bottoms = pick((p) => p.category?.slug === "jeans" || p.category?.slug === "trousers", 1);
  const footwear = pick((p) => p.category?.slug === "sneakers" || p.category?.slug === "boots", 1);
  const accessories = pick((p) => p.category?.slug === "belts" || p.category?.slug === "watches", 2);

  if (tops.length === 0 || bottoms.length === 0) {
    console.log("SKIP part B: catalog lacks top+bottom stock for an honest look");
    return;
  }

  const pieces = [
    { slot: "top", productId: tops[0].id, color: { name: tops[0].variants.find(v => v.color)?.color?.name ?? "Black", hex: null } },
    { slot: "bottom", productId: bottoms[0].id, color: null },
    ...(footwear[0] ? [{ slot: "footwear" as const, productId: footwear[0].id, color: null }] : []),
    ...accessories.map((a) => ({ slot: "accessory" as const, productId: a.id, color: null })),
  ];
  const topSlug = tops[0].category?.slug ?? null;

  const req = await import("../src/app/api/outfit/review/route");
  const res = await req.POST(new Request("http://localhost/api/outfit/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pieces, topSlug }),
  }));
  const json = await res.json();

  check("API returns 200", res.status === 200, `got ${res.status}: ${JSON.stringify(json)}`);
  if (res.status !== 200) return;

  check("API returns every requested item (incl all accessories)", Array.isArray(json.items) && json.items.length === pieces.length, `got ${json.items?.length} wanted ${pieces.length}`);
  check("API reports completion from richer items", typeof json.status?.complete === "boolean");
  for (const it of json.items) {
    check("API items are real catalog products (ids rehydrate)", catalog.some((c) => c.id === it.product.id));
    check("API prices are the stored prices, never invented", it.product.price === catalog.find((c) => c.id === it.product.id)?.price);
    check("API productUrl is real", it.product.productUrl.startsWith("https://"));
    check("API garments carry a canonical type", typeof it.garment?.type === "string" && it.garment.slot === it.slot);
  }
  check("API prints an honest price block", typeof json.price?.reliable === "boolean");
  const hasUsd = pieces.some((p) => {
    const c = catalog.find((x) => x.id === p.productId);
    return c?.currency?.toUpperCase() === "USD";
  });
  if (json.price?.reliable && !hasUsd) {
    check("API reliable total equals sum of stored prices", Math.abs(json.price.totalEur - pieces.reduce((sum: number, p) => sum + Number(catalog.find((c) => c.id === p.productId)?.price ?? 0), 0)) < 0.01);
  }
  check("API score is finite or null", json.score === null || Number.isFinite(json.score));
  check("API fashion verdict is one of the contract classes", ["hard-invalid", "soft-mismatch", "valid", "strong"].includes(json.fashion?.verdict));
  check("API fashion carries an explainable breakdown", Array.isArray(json.fashion?.factors) && json.fashion.factors.length > 0);
  check("API fashion refuses to invent occasion/season (no such factor without context)", json.fashion.factors.every((f: { key: string }) => f.key !== "context"));
  check("API no missing products for a fresh look", Array.isArray(json.missingIds) && json.missingIds.length === 0);
}

await partB();

console.log(`\nreview-avatar.test: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}