/* GarmentSystem — draws a realistic garment for every GarmentVisual on the
   actual rigged human.

   Two render paths share this module:

   - BODY path (default, browser): the garment is cut from the REAL
     skinned, morphed body surface. Per-vertex skin weights classify every
     vertex into a region (torso / shoulder / arm / forearm / leg / foot /
     neck / head); garment categories are unions of those regions deflated
     outward along the posed surface normals by a fit gap. A tee = torso
     shell + arm sleeves + collar; jeans = seat band + crotch + two leg
     tubes + waistband; shoes = the deflated foot shell + sole + laces.
     This is what produces a person *visibly wearing* the garment —
     nothing primitive, nothing floats.

   - FIT path (offline pure-tests / server preview without a body): a
     fallback that builds the same categories from the measured FitSheet
     alone (lathe/conic silhouettes). It needs no skinned geometry and is
     the reference the offline test-suite pins.

   No product source is consulted. GarmentAsset.assetUri will supersede the
   generated mesh through the same API. */

import * as THREE from "three";
import type { FitSheet } from "@/lib/avatar/human-model";
import { skinnedPositions } from "@/lib/avatar/human-model";
import type { GarmentVisual } from "./garment";

export type GarmentCategory =
  | "top" | "layer" | "bottom" | "footwear" | "accessory" | "one-piece";

export type GarmentAsset = {
  type: GarmentVisual["type"];
  category: GarmentCategory;
  layer: "under" | "mid" | "outer" | "accessory" | "footwear";
  assetUri: string | null;
};

/* Category / layer classification — the pure contract between garment.slug
   and the renderer. Tests assert this mapping stays stable. */
export function garmentAssetFor(visual: GarmentVisual): GarmentAsset {
  const type = visual.type;
  let category: GarmentCategory = "top";
  let layer: GarmentAsset["layer"] = "mid";

  const ACCESSORY = new Set([
    "headwear", "glasses", "watch", "belt", "bag", "socks",
    "scarf", "tie", "jewelry",
  ]);
  const FOOTWEAR = new Set([
    "sneakers", "running-shoes", "boots", "sandals", "heels",
    "flats", "loafers", "formal-shoes", "solid-shoes",
  ]);
  const OUTER = new Set(["jacket", "coat", "blazer", "hoodie", "sweatshirt", "vest", "knit"]);
  const ONE_PIECE = new Set(["dress", "jumpsuit"]);
  const PANTS = new Set(["jeans", "trousers", "shorts", "skirt", "leggings", "solid-legs"]);

  if (ONE_PIECE.has(type)) { category = "one-piece"; layer = "mid"; }
  else if (PANTS.has(type)) { category = "bottom"; layer = "mid"; }
  else if (FOOTWEAR.has(type)) { category = "footwear"; layer = "footwear"; }
  else if (ACCESSORY.has(type)) { category = "accessory"; layer = "accessory"; }
  else { category = "top"; layer = OUTER.has(type) ? "outer" : "mid"; }

  return { type, category, layer, assetUri: visual.assetUri ?? null };
}

const FIT_GAP: Record<GarmentVisual["fit"], number> = {
  slim: 0.016,
  fitted: 0.016,
  regular: 0.04,
  relaxed: 0.08,
  oversized: 0.125,
  unknown: 0.04,
};

const LEN_FRAC: Record<GarmentVisual["length"], number> = {
  cropped: 0.5,
  short: 0.58,
  regular: 0.68,
  long: 0.82,
  ankle: 0.94,
  full: 1.0,
};

// layer draw order: under < mid < outer < accessory (footwear last)
const LAYER_ORDER: Record<GarmentAsset["layer"], number> = {
  under: 10,
  mid: 20,
  outer: 30,
  accessory: 40,
  footwear: 50,
};

function baseMat(color: number, roughness: number, metalness = 0, env = 0.4) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, envMapIntensity: env });
}

export function materialFor(visual: GarmentVisual, colorHex: number): THREE.MeshStandardMaterial {
  switch (visual.type) {
    case "jeans": return baseMat(colorHex, 0.85, 0);
    case "leggings": case "knit": case "sweatshirt": case "hoodie":
      return baseMat(colorHex, 0.95, 0, 0.2);
    case "jacket": case "boots": case "belt": case "formal-shoes": case "loafers":
      return baseMat(colorHex, 0.4, 0.05, 0.8);
    case "coat": case "blazer": return baseMat(colorHex, 0.5, 0.02, 0.9);
    case "dress": case "jumpsuit": return baseMat(colorHex, 0.45, 0, 1.1);
    case "sneakers": case "running-shoes": return baseMat(colorHex, 0.7, 0, 0.5);
    default: return baseMat(colorHex, 0.88, 0, 0.35);
  }
}

/* Lathe (rotation around Y) from (y, r) control points. The profile points
   must ASCEND in y (hem -> neck, bottom -> top): LatheGeometry builds its
   ring winding from the profile direction, so a top-down profile yields
   inward-facing (back-face-culled) surfaces. The control points here are
   authored top-down (natural to read), so we reverse before building. */
function latheMesh(points: Array<{ y: number; r: number }>, mat: THREE.Material, seg = 44): THREE.Mesh {
  const profile = points
    .filter((p) => p.r > 0)
    .map((p) => new THREE.Vector2(p.r, p.y));
  const ascending = [...profile].reverse();
  const geo = new THREE.LatheGeometry(ascending, seg);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

/* tapered cylinder between two points (radius top/bottom) */
function conic(from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number, mat: THREE.Material, seg = 20): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(to, from);
  const h = dir.length();
  const geo = new THREE.CylinderGeometry(r0, r1, h, seg, 1, false);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
  m.position.copy(mid);
  if (h > 1e-4) m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}

function shellMat(mat: THREE.Material): THREE.Material {
  const m = mat.clone();
  m.side = THREE.DoubleSide;
  m.needsUpdate = true;
  return m;
}

export function buildGarmentVisual(
  visual: GarmentVisual,
  fit: FitSheet,
  body?: THREE.SkinnedMesh | null
): THREE.Group {
  const asset = garmentAssetFor(visual);
  const g = new THREE.Group();
  g.userData.garment = asset;
  g.userData.visual = { slot: visual.slot, type: visual.type, label: visual.label, pattern: visual.pattern };

  const colorHex = visual.color?.hex ? parseInt(visual.color.hex.replace("#", ""), 16) : 0x99948c;
  const mat = shellMat(materialFor(visual, colorHex));
  const gap = FIT_GAP[visual.fit] ?? 0.04;

  const hasBody = !!(body && body.isSkinnedMesh && body.geometry.attributes.skinIndex);
  buildFitBody(g, fit, visual, mat, gap, hasBody ? body : undefined);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.renderOrder = (o.renderOrder ?? 0) + LAYER_ORDER[asset.layer];
    }
  });
  return g;
}

/* ===================================================================== */
/* FIT path — FitSheet-only silhouettes (offline reference/preview)      */
/* ===================================================================== */

function buildFitBody(g: THREE.Group, fit: FitSheet, v: GarmentVisual, mat: THREE.Material, gap: number, body?: THREE.SkinnedMesh): void {
  const asset = garmentAssetFor(v);
  switch (asset.category) {
    case "top":
    case "layer":
      if (body) buildTorsoBody(g, fit, v, mat, gap, body);
      else buildTorso(g, fit, v, mat, gap);
      break;
    case "one-piece":
      if (body) buildOnePieceBody(g, fit, v, mat, gap, body, v.type === "jumpsuit");
      else buildOnePiece(g, fit, v, mat, gap, v.type === "jumpsuit");
      break;
    case "bottom":
      if (body) buildBottomBody(g, fit, v, mat, gap, body);
      else buildBottom(g, fit, v, mat, gap);
      break;
    case "footwear":
      if (body) buildFootwearBody(g, fit, v, mat, body);
      else buildFootwear(g, fit, v, mat);
      break;
    case "accessory":
      buildAccessory(g, fit, v, mat);
      break;
    default:
      break;
  }
}

/* torso top/layer: lathe following chest/waist/hip + sleeves + collar */
function buildTorso(g: THREE.Group, fit: FitSheet, v: GarmentVisual, mat: THREE.Material, gap: number): void {
  const lenFrac = LEN_FRAC[v.length] ?? 0.68;
  const hemY = fit.neckY - (fit.neckY - fit.hipY) * (lenFrac * 0.92 + 0.08) * 0.92 - 0.01;
  const drape = v.fit === "oversized" ? 1.5 : v.fit === "relaxed" ? 1.2 : v.fit === "slim" ? 0.82 : 1;

  const points = [
    { y: fit.neckY - 0.02, r: Math.max(0.035, fit.neckR * 0.9 + gap * 0.5) },
    { y: fit.chestY + 0.06, r: fit.chestR * 1.04 + gap },
    { y: fit.chestY, r: fit.chestR + gap },
    { y: fit.waistY, r: fit.waistR * 0.98 + gap * 0.9 },
    { y: Math.max(fit.hipY, hemY), r: (fit.hipR + gap) * drape * 1.06 },
  ];
  g.add(latheMesh(points, mat));

  const sleeveLen = v.sleeve === "sleeveless" ? 0 : v.sleeve === "cap" ? 0.12 : v.sleeve === "short" ? 0.34 : v.sleeve === "three-quarter" ? 0.62 : 1;
  if (sleeveLen > 0) {
    for (const side of [-1, 1]) {
      const src = side < 0 ? fit.leftShoulder : fit.rightShoulder;
      const elbow = side < 0 ? fit.leftElbow : fit.rightElbow;
      const wrist = side < 0 ? fit.leftWrist : fit.rightWrist;
      const e = new THREE.Vector3().lerpVectors(src, elbow, sleeveLen);
      const w = new THREE.Vector3().lerpVectors(elbow, wrist, Math.max(0, sleeveLen - 0.34));
      const r = fit.armR * 1.28 + gap;
      g.add(conic(src, e, r * 1.08, r * 0.98, mat));
      if (sleeveLen > 0.4) g.add(conic(e, w, r * 0.98, r * 0.9, mat));
    }
  }

  const band = v.collar;
  if (band === "crew" || band === "high" || band === "mock" || band === "round" || band === "boat") {
    const c = new THREE.Mesh(new THREE.TorusGeometry(Math.max(0.04, fit.neckR * 0.95 + gap * 0.5), gap * 0.55 + 0.008, 10, 26), mat);
    c.position.set(0, fit.neckY - 0.015, 0);
    c.rotation.x = Math.PI / 2;
    g.add(c);
  } else if (band === "polo" || band === "collar") {
    const c = new THREE.Mesh(new THREE.TorusGeometry(Math.max(0.045, fit.neckR + gap * 0.5), 0.014 + gap * 0.3, 10, 26), mat);
    c.position.set(0, fit.neckY - 0.01, 0);
    c.rotation.x = Math.PI / 2;
    g.add(c);
  }
}

/* dress / jumpsuit: continuous silhouette from neck to hem (+ full legs for jumpsuit) */
function buildOnePiece(g: THREE.Group, fit: FitSheet, v: GarmentVisual, mat: THREE.Material, gap: number, withLegs: boolean): void {
  const lenFrac = LEN_FRAC[v.length] ?? 0.82;
  const hemBottom = withLegs ? fit.ankleY : fit.kneeY;
  const hemY = fit.neckY - (fit.neckY - hemBottom) * lenFrac * 0.96;
  const flare = v.fit === "slim" ? 1.02 : v.fit === "oversized" ? 1.3 : 1.14;
  const points = [
    { y: fit.neckY - 0.02, r: Math.max(0.04, fit.neckR * 0.92 + gap * 0.5) },
    { y: fit.chestY + 0.04, r: fit.chestR * 1.05 + gap },
    { y: fit.bustY, r: (fit.bustR || fit.chestR) + gap },
    { y: fit.waistY, r: fit.waistR * (withLegs ? 1.0 : 0.98) + gap },
    { y: fit.hipY, r: fit.hipR * 1.05 + gap },
    { y: hemY, r: (fit.hipR + gap) * flare },
  ];
  g.add(latheMesh(points, mat, 46));

  if (v.sleeve && v.sleeve !== "sleeveless") {
    const r = fit.armR * 1.25 + gap;
    for (const side of [-1, 1]) {
      const src = side < 0 ? fit.leftShoulder : fit.rightShoulder;
      const elbow = side < 0 ? fit.leftElbow : fit.rightElbow;
      const len = v.sleeve === "short" ? 0.34 : v.sleeve === "three-quarter" ? 0.62 : 1;
      const e = new THREE.Vector3().lerpVectors(src, elbow, len);
      g.add(conic(src, e, r * 1.06, r * 0.96, mat));
    }
  }

  if (withLegs) {
    const legGap = gap > 0.04 ? gap : 0.05;
    for (const side of [-1, 1]) {
      const x = side * fit.hipX;
      const top = new THREE.Vector3(x, fit.hipY - 0.02, 0);
      const knee = new THREE.Vector3(x, fit.kneeY, 0);
      const ank = new THREE.Vector3(x, fit.ankleY, 0);
      g.add(conic(top, knee, (fit.legR + legGap) * 1.15, fit.legR + legGap, mat));
      g.add(conic(knee, ank, fit.legR + legGap, fit.ankleR * 1.1 + legGap * 0.6, mat));
    }
  }
}

/* jeans / trousers / shorts / skirt / leggings */
function buildBottom(g: THREE.Group, fit: FitSheet, v: GarmentVisual, mat: THREE.Material, gap: number): void {
  const legGap = v.type === "leggings" ? 0.012 : gap * (v.type === "jeans" || v.type === "trousers" ? 1 : 1.2);

  if (v.type === "skirt") {
    const lenFrac = LEN_FRAC[v.length] ?? 0.45;
    const hemY = fit.waistY + (fit.kneeY - fit.waistY) * Math.min(1.1, lenFrac * 1.35);
    const flare = v.fit === "slim" ? 1.08 : v.fit === "oversized" ? 1.8 : 1.45;
    g.add(latheMesh([
      { y: fit.waistY, r: Math.max(0.1, fit.waistR * 1.06 + gap) },
      { y: fit.hipY, r: fit.hipR * 1.1 + gap },
      { y: hemY, r: (fit.hipR + gap) * flare },
    ], mat));
    return;
  }

  g.add(latheMesh([
    { y: fit.hipY + 0.1, r: fit.waistR * 1.02 + gap },
    { y: fit.hipY, r: fit.hipR * 1.08 + gap },
    { y: fit.hipY - 0.04, r: fit.hipR * 1.06 + gap },
  ], mat));

  const isShorts = v.type === "shorts";
  const legLen = isShorts ? 0.42 : 1;
  for (const side of [-1, 1]) {
    const x = side * fit.hipX;
    const top = new THREE.Vector3(x, fit.hipY - 0.03, 0);
    const knee = new THREE.Vector3(x, fit.kneeY, 0);
    const ank = new THREE.Vector3(x, fit.ankleY, 0);
    if (legLen >= 1) {
      g.add(conic(top, knee, (fit.legR + legGap) * 1.18, (fit.legR + legGap) * 0.98, mat));
      g.add(conic(knee, ank, (fit.legR + legGap) * 0.98, fit.ankleR * 1.1 + legGap * 0.5, mat));
    } else {
      const hem = new THREE.Vector3(x, fit.hipY + (fit.kneeY - fit.hipY) * 0.45, 0);
      g.add(conic(top, hem, (fit.legR + legGap) * 1.2, (fit.legR + legGap) * 1.1, mat));
    }
  }
}

/* shoes anchored to the real feet */
function buildFootwear(g: THREE.Group, fit: FitSheet, v: GarmentVisual, mat: THREE.Material): void {
  const frontZ = 0.02;
  for (const side of [-1, 1]) {
    const toe = side < 0 ? fit.leftFoot : fit.rightFoot;
    const fallback = new THREE.Vector3(side * fit.hipX, fit.ankleY - 0.04, frontZ);
    const base = toe.y > 0.01 ? toe : fallback;
    const x = base.x;
    const z = base.z > 0.3 ? base.z : frontZ;
    const y = Math.min(base.y, fit.ankleY) - 0.02;

    const soleMat = baseMat(0x141210, 0.55, 0, 0.3);

    switch (v.type) {
      case "heels": {
        const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.052, 18, 12), mat);
        shoe.scale.set(1.5, 0.55, 2.0);
        shoe.position.set(x, y + 0.03, z);
        g.add(shoe);
        const heel = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.01, 0.07, 8), soleMat);
        heel.position.set(x, y - 0.015, z - 0.03);
        g.add(heel);
        const sole = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.2), soleMat);
        sole.position.set(x, y, z);
        g.add(sole);
        break;
      }
      case "boots": {
        const foot = new THREE.Mesh(new THREE.SphereGeometry(0.055, 18, 12), mat);
        foot.scale.set(1.35, 0.6, 1.9);
        foot.position.set(x, y + 0.03, z);
        g.add(foot);
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.22, 14), mat);
        shaft.position.set(x, y + 0.14, z - 0.04);
        g.add(shaft);
        const sole = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.02, 0.24), soleMat);
        sole.position.set(x, y - 0.005, z);
        g.add(sole);
        break;
      }
      case "sandals": {
        const sole = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.015, 0.22), soleMat);
        sole.position.set(x, y, z);
        g.add(sole);
        for (const zz of [-0.04, 0.06]) {
          const strap = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.008, 8, 18), mat);
          strap.position.set(x, y + 0.035, z + zz);
          strap.rotation.x = Math.PI / 2;
          g.add(strap);
        }
        break;
      }
      case "flats":
      case "loafers": {
        const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.052, 18, 12), mat);
        shoe.scale.set(1.4, 0.48, 1.85);
        shoe.position.set(x, y + 0.02, z);
        g.add(shoe);
        const sole = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.015, 0.22), soleMat);
        sole.position.set(x, y - 0.005, z);
        g.add(sole);
        break;
      }
      case "formal-shoes": {
        const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.05, 18, 12), mat);
        shoe.scale.set(1.35, 0.5, 1.9);
        shoe.position.set(x, y + 0.025, z);
        g.add(shoe);
        const sole = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.012, 0.22), soleMat);
        sole.position.set(x, y - 0.008, z);
        g.add(sole);
        break;
      }
      default: { /* sneakers / running-shoes */
        const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.055, 18, 12), mat);
        shoe.scale.set(1.4, 0.55, 1.9);
        shoe.position.set(x, y + 0.03, z);
        g.add(shoe);
        const sole = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.02, 0.24), soleMat);
        sole.position.set(x, y, z);
        g.add(sole);
        const accent = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), baseMat(0xf4f2ed, 0.5));
        accent.position.set(x, y + 0.05, z + 0.09);
        g.add(accent);
      }
    }
  }
}

/* accessories at logical anchors */
function buildAccessory(g: THREE.Group, fit: FitSheet, v: GarmentVisual, mat: THREE.Material): void {
  switch (v.type) {
    case "belt": {
      const torus = new THREE.Mesh(new THREE.TorusGeometry(Math.max(0.12, fit.waistR * 1.18), 0.024, 10, 36), mat);
      torus.position.set(0, fit.waistY, 0);
      torus.rotation.x = Math.PI / 2;
      g.add(torus);
      const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.02), baseMat(0xb8b2a6, 0.3));
      buckle.position.set(0, fit.waistY, Math.max(0.13, fit.waistR * 1.22));
      g.add(buckle);
      break;
    }
    case "socks": {
      for (const side of [-1, 1]) {
        const x = side * fit.hipX;
        const ankle = new THREE.Vector3(x, fit.ankleY - 0.01, 0.01);
        const top = new THREE.Vector3(x, fit.ankleY + 0.1, 0.01);
        g.add(conic(ankle, top, fit.ankleR * 1.1, fit.legR * 1.08, mat));
      }
      break;
    }
    case "headwear": {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(fit.headR * 1.04, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.6), mat);
      dome.position.set(0, fit.crownY - fit.headR * 0.18, 0);
      g.add(dome);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(fit.headR * 1.35, fit.headR * 1.35, 0.015, 28), mat);
      brim.position.set(0, fit.crownY - fit.headR * 0.34, 0);
      g.add(brim);
      break;
    }
    case "glasses": {
      for (const side of [-1, 1]) {
        const e = side < 0 ? fit.leftEye : fit.rightEye;
        const lens = new THREE.Mesh(new THREE.TorusGeometry(fit.headR * 0.3, 0.011, 8, 20), mat);
        lens.position.set(e.x, e.y - fit.headR * 0.04, e.z + fit.headR * 0.3);
        g.add(lens);
      }
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(fit.headR * 0.3, 0.012, 0.012), mat);
      bridge.position.set(0, fit.eyeY - fit.headR * 0.04, fit.leftEye.z + fit.headR * 0.3);
      g.add(bridge);
      break;
    }
    case "watch": {
      for (const side of [-1, 1]) {
        const w = side < 0 ? fit.leftWrist : fit.rightWrist;
        const band = new THREE.Mesh(new THREE.TorusGeometry(fit.armR * 1.15, 0.013, 8, 18), mat);
        band.position.copy(w);
        g.add(band);
        const face = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.01, 12), mat);
        face.rotation.x = Math.PI / 2;
        face.position.set(w.x, w.y, w.z + fit.armR * 1.12);
        g.add(face);
      }
      break;
    }
    case "bag": {
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12), mat);
      body.position.set(fit.hipX + 0.1, fit.waistY - 0.05, 0.1);
      body.scale.set(1.1, 0.8, 0.35);
      g.add(body);
      const strap = new THREE.Mesh(new THREE.TorusGeometry(fit.chestR * 1.1, 0.012, 8, 24), mat);
      strap.position.set(0, fit.chestY, -0.02);
      strap.rotation.x = Math.PI / 2 + 0.15;
      g.add(strap);
      break;
    }
    case "scarf": {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(Math.max(0.05, fit.neckR * 1.15), 0.03, 10, 26), mat);
      ring.position.set(0, fit.neckY - 0.02, 0.01);
      ring.rotation.x = Math.PI / 2 + 0.1;
      g.add(ring);
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.03), mat);
      flap.position.set(0, fit.neckY - 0.12, fit.chestR * 0.9);
      g.add(flap);
      break;
    }
    case "tie": {
      const halfW = 0.03;
      const tie = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2, fit.waistY - fit.chestY + 0.12, 0.008), mat);
      tie.position.set(0, (fit.chestY + fit.waistY) / 2 - 0.02, fit.chestR * 0.95);
      g.add(tie);
      const knot = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.04, 12), mat);
      knot.position.set(0, fit.chestY - 0.02, fit.chestR * 0.95);
      knot.rotation.x = Math.PI;
      g.add(knot);
      break;
    }
    case "jewelry": {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(Math.max(0.045, fit.neckR * 1.25), 0.01, 10, 28), mat);
      ring.position.set(0, fit.neckY - 0.05, 0.005);
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
      const pendant = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), mat);
      pendant.position.set(0, fit.bustY, fit.chestR * 0.85);
      g.add(pendant);
      break;
    }
    default:
      break;
  }
}

/* ===================================================================== */
/* BODY path — garment shells cut from the real posed body surface       */
/* ===================================================================== */

const REG = {
  TORSO: 1 << 0,
  SHOULDER: 1 << 1,
  ARM: 1 << 2,
  FOREARM: 1 << 3,
  HAND: 1 << 4,
  UPLEG: 1 << 5,
  LEG: 1 << 6,
  FOOT: 1 << 7,
  NECK: 1 << 8,
  HEAD: 1 << 9,
  L: 1 << 10,
  R: 1 << 11,
} as const;

type BodyData = {
  vcount: number;
  pts: Float32Array;   /* posed skin positions, unscaled local frame */
  nrm: Float32Array;   /* per-vertex outward normal in the same frame */
  reg: Uint16Array;    /* region bitmask per vertex */
  tri: Uint32Array;    /* triangle indices */
};

const bodyDataCache = new WeakMap<THREE.SkinnedMesh, BodyData>();

function regionBitsOf(boneName: string): number {
  const b = boneName || "";
  let r: number = REG.TORSO;
  if (/Neck/i.test(b)) r = REG.NECK;
  else if (/Head/i.test(b)) r = REG.HEAD;
  else if (/Shoulder/i.test(b)) r = REG.SHOULDER;
  else if (/ForeArm/i.test(b)) r = REG.FOREARM;
  else if (/Arm/i.test(b)) r = REG.ARM;
  else if (/Hand/i.test(b)) r = REG.HAND;
  else if (/ToeBase/i.test(b)) r = REG.FOOT;
  else if (/Foot/i.test(b)) r = REG.FOOT;
  else if (/UpLeg/i.test(b)) r = REG.UPLEG;
  else if (/Leg/i.test(b)) r = REG.LEG;
  else if (/Spine/i.test(b)) r = REG.TORSO;
  if (/Left/i.test(b)) r |= REG.L;
  if (/Right/i.test(b)) r |= REG.R;
  return r;
}

export function bodyDataFor(body: THREE.SkinnedMesh): BodyData | null {
  const hit = bodyDataCache.get(body);
  if (hit) return hit;

  const skinI = body.geometry.attributes.skinIndex.array as Uint16Array;
  const skinW = body.geometry.attributes.skinWeight.array as Float32Array;
  const bones = body.skeleton.bones as THREE.Bone[];
  const vcount = Math.floor(skinI.length / 4);
  if (vcount === 0) return null;

  const s = body.getWorldScale(new THREE.Vector3()).x || 1;
  const sk = skinnedPositions(body);
  const pts = new Float32Array(vcount * 3);
  for (let i = 0; i < sk.length && i < pts.length; i++) pts[i] = sk[i] / s;

  const reg = new Uint16Array(vcount);
  const dominant = new Int16Array(vcount);
  for (let vi = 0; vi < vcount; vi++) {
    let b = 0;
    let w = -1;
    const i4 = vi * 4;
    for (let k = 0; k < 4; k++) {
      if (skinW[i4 + k] > w) {
        w = skinW[i4 + k];
        b = skinI[i4 + k];
      }
    }
    dominant[vi] = b;
    reg[vi] = regionBitsOf(bones[b]?.name ?? "");
  }

  /* Bind-surface normals (scratch geometry — the live body is untouched),
     rotated into the pose by the dominant bone, then into the local frame. */
  const bindPos = body.geometry.attributes.position.array as Float32Array;
  const scratch = new THREE.BufferGeometry();
  scratch.setAttribute("position", new THREE.BufferAttribute(new Float32Array(bindPos), 3));
  if (body.geometry.index) scratch.setIndex(body.geometry.index.clone());
  scratch.computeVertexNormals();
  const bindN = scratch.getAttribute("normal").array as Float32Array;
  scratch.dispose();

  const qBodyInv = new THREE.Quaternion().setFromRotationMatrix(body.matrixWorld).invert();
  const nrm = new Float32Array(vcount * 3);
  const v = new THREE.Vector3();
  const rotCache = new Map<number, THREE.Quaternion>();
  for (let vi = 0; vi < vcount; vi++) {
    const bi = dominant[vi];
    let q = rotCache.get(bi);
    if (!q) {
      q = new THREE.Quaternion().multiplyQuaternions(qBodyInv, new THREE.Quaternion().setFromRotationMatrix(bones[bi].matrixWorld));
      q.normalize();
      rotCache.set(bi, q);
    }
    v.set(bindN[vi * 3], bindN[vi * 3 + 1], bindN[vi * 3 + 2]);
    v.applyQuaternion(q);
    if (v.lengthSq() < 1e-12) v.set(0, 1, 0);
    else v.normalize();
    nrm[vi * 3] = v.x;
    nrm[vi * 3 + 1] = v.y;
    nrm[vi * 3 + 2] = v.z;
  }

  let tri: Uint32Array;
  if (body.geometry.index) {
    tri = new Uint32Array(body.geometry.index.array);
  } else {
    tri = new Uint32Array(vcount * 3);
    for (let i = 0; i < tri.length; i++) tri[i] = i;
  }

  const data: BodyData = { vcount, pts, nrm, reg, tri };
  bodyDataCache.set(body, data);
  return data;
}

/* Deflate the selected body-region vertices along the posed normals by
   `gap` and keep only the triangles fully inside the selection. */
/* Side bits union over every body region, so side membership must be tested
   separately: the low bits hold the region mask, the high bits (<< 16) hold
   the required side bit. `deflectShell` requires BOTH. */
function sideBit(sb: number): number {
  return (sb & 0xffff) << 16;
}

function deflectShell(
  data: BodyData,
  mat: THREE.Material,
  mask: number,
  gap: number,
  opts: { yMin?: number; yMax?: number; planeY?: number; gapScale?: number } = {}
): THREE.Mesh {
  void data;
  const regionMask = mask & 0xffff;
  const side = mask >>> 16;
  const sel = new Uint8Array(data.vcount);
  for (let vi = 0; vi < data.vcount; vi++) {
    if (!(data.reg[vi] & regionMask)) continue;
    if (side && !(data.reg[vi] & side)) continue;
    const y = data.pts[vi * 3 + 1];
    if (opts.yMin !== undefined && y < opts.yMin) continue;
    if (opts.yMax !== undefined && y > opts.yMax) continue;
    sel[vi] = 1;
  }

  const localGap = (opts.gapScale ?? 1) * gap;
  const oldToNew = new Int32Array(data.vcount).fill(-1);
  let newCount = 0;
  for (let vi = 0; vi < data.vcount; vi++) {
    if (sel[vi]) oldToNew[vi] = newCount++;
  }
  if (newCount === 0) {
    const emptyGeo = new THREE.BufferGeometry();
    emptyGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
    const m = new THREE.Mesh(emptyGeo, mat);
    m.userData.kind = "shell";
    return m;
  }

  const pos = new Float32Array(newCount * 3);
  for (let vi = 0; vi < data.vcount; vi++) {
    if (!sel[vi]) continue;
    const nv = oldToNew[vi];
    let py = data.pts[vi * 3 + 1] + data.nrm[vi * 3 + 1] * localGap;
    if (opts.planeY !== undefined && py < opts.planeY) py = opts.planeY;
    pos[nv * 3] = data.pts[vi * 3] + data.nrm[vi * 3] * localGap;
    pos[nv * 3 + 1] = py;
    pos[nv * 3 + 2] = data.pts[vi * 3 + 2] + data.nrm[vi * 3 + 2] * localGap;
  }

  const faceCount = data.tri.length / 3;
  const kept = new Uint32Array(faceCount * 3);
  let k = 0;
  for (let f = 0; f < faceCount; f++) {
    const a = oldToNew[data.tri[f * 3]];
    const b = oldToNew[data.tri[f * 3 + 1]];
    const c = oldToNew[data.tri[f * 3 + 2]];
    if (a < 0 || b < 0 || c < 0) continue;
    if (a === b || b === c || a === c) continue;
    kept[k++] = a;
    kept[k++] = b;
    kept[k++] = c;
  }

  const geo = new THREE.BufferGeometry();
  geo.setIndex(new THREE.BufferAttribute(kept.subarray(0, k), 1));
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.computeVertexNormals();

  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.userData.kind = "shell";
  return m;
}

function trimRing(g: THREE.Group, mat: THREE.Material, y: number, r: number, w: number, seg = 26): void {
  const geo = new THREE.CylinderGeometry(r + w, r + w, w * 2, seg, 1, true);
  const m = new THREE.Mesh(geo, mat);
  m.position.y = y;
  m.castShadow = true;
  m.userData.kind = "trim";
  g.add(m);
}

/* Average radius of a shell's open rim — so collars hug the real neckline
   and hems hug the real silhouette instead of a guessed circle. */
function rimRing(g: THREE.Group, mesh: THREE.Mesh, mat: THREE.Material, w: number, edge: "top" | "bottom", seg = 32): void {
  const pos = mesh.geometry.attributes.position;
  if (!pos) return;
  const p = pos.array as Float32Array;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 1; i < p.length; i += 3) {
    if (p[i] < minY) minY = p[i];
    if (p[i] > maxY) maxY = p[i];
  }
  const band = Math.max(0.008, (maxY - minY) * 0.06);
  const probeY = edge === "top" ? maxY - band * 0.4 : minY + band * 0.4;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < p.length; i += 3) {
    if (Math.abs(p[i + 1] - probeY) <= band) {
      sum += Math.hypot(p[i], p[i + 2]);
      n++;
    }
  }
  if (n < 12) return;
  trimRing(g, mat, edge === "top" ? maxY - w * 0.5 : minY + w * 0.5, Math.max(0.03, sum / n), w, seg);
}

/* Sleeves are deflated sections of the arm chain cut at the right height,
   matching the garment's SleeveType. The torso shell above merges smoothly
   because both deflate the same shoulder-region surface by the same gap. */
/* Deployed vertical span of one arm in the CURRENT posed/morphed body,
   measured from the skinned ARM-region cloud itself (per side). Windows
   derived from fit joints silently miss arms that the Broad/curvy morphs
   + neutral hang swing outward and LOW — the fat arm's top lands ~0.15
   UNDER the shoulder bone, so a shoulder-anchored sleeve window catches
   nothing and the t-shirt would render sleeveless. */
function armSpan(data: BodyData, sb: number): { top: number; bottom: number } {
  const reg = data.reg as Uint16Array;
  const pts = data.pts as Float32Array;
  let top = -Infinity;
  let bottom = Infinity;
  for (let vi = 0; vi < reg.length; vi++) {
    if (!(reg[vi] & REG.ARM) || !(reg[vi] & sb)) continue;
    const y = pts[vi * 3 + 1];
    if (y > top) top = y;
    if (y < bottom) bottom = y;
  }
  return { top, bottom };
}

function addSleeves(g: THREE.Group, data: BodyData, fit: FitSheet, mat: THREE.Material, gap: number, sleeve: string | null, gapScale: number): void {
  const len = sleeve === "sleeveless" ? 0 : sleeve === "cap" ? 0.12 : sleeve === "short" ? 0.34 : sleeve === "three-quarter" ? 0.62 : 1;
  if (!len) return;

  for (const sb of [REG.L, REG.R]) {
    const span = armSpan(data, sb);
    const haveArm = Number.isFinite(span.top) && span.top > -1;
    const topY = haveArm ? span.top + 0.02 : fit.shoulderY + 0.07;
    const armBottom = haveArm ? Math.min(span.bottom, span.top - 0.05) : fit.wristY;
    const armLen = Math.max(0.05, topY - armBottom);

    if (len <= 0.4) {
      /* cap / short: a tube over the bicep ending at the sleeve hem */
      const hemY = topY - armLen * len - 0.02;
      const shell = deflectShell(data, mat, REG.ARM | sideBit(sb), gap, { yMin: hemY, yMax: topY, gapScale });
      if (shell.geometry.attributes.position.count > 0) {
        shell.name = "sleeve";
        g.add(shell);
      }
      continue;
    }

    /* three-quarter / long: bicep tube + forearm cuff along the deployed arm */
    const bicepTop = topY;
    const bicepHem = topY - armLen * 0.68;
    const bicep = deflectShell(data, mat, REG.ARM | sideBit(sb), gap, { yMin: bicepHem, yMax: bicepTop, gapScale });
    if (bicep.geometry.attributes.position.count > 0) {
      bicep.name = "sleeve";
      g.add(bicep);
    }

    const foreTop = topY - armLen * 0.62;
    const foreHem = len === 1 ? armBottom - 0.06 : foreTop - armLen * 0.34;
    const fore = deflectShell(data, mat, REG.FOREARM | sideBit(sb), gap, { yMin: foreHem, yMax: foreTop, gapScale });
    let cx = 0;
    if (fore.geometry.attributes.position.count > 0) {
      const p = fore.geometry.attributes.position;
      let fmin = Infinity, fmax = -Infinity;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        if (x < fmin) fmin = x;
        if (x > fmax) fmax = x;
      }
      cx = (fmin + fmax) / 2;
      if (len === 1) {
        fore.name = "sleeve";
        g.add(fore);
      }
    }
    if (len === 1) {
      const wristY = haveArm ? topY - armLen : fit.wristY;
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(fit.armR * 0.95 + gap, fit.armR * 0.95 + gap, 0.02, 18, 1, true), mat);
      cuff.position.set(cx, wristY + 0.005, 0);
      cuff.userData.kind = "trim";
      g.add(cuff);
    } else {
      fore.name = "sleeve";
      g.add(fore);
    }
  }
}

/* torso top / layer garments (body path) */
function buildTorsoBody(g: THREE.Group, fit: FitSheet, v: GarmentVisual, mat: THREE.Material, gap: number, body: THREE.SkinnedMesh): void {
  const data = bodyDataFor(body);
  if (!data) return buildTorso(g, fit, v, mat, gap);

  const isLayer = v.type === "jacket" || v.type === "coat" || v.type === "blazer" || v.type === "vest" || v.type === "hoodie" || v.type === "sweatshirt" || v.type === "knit";
  const sleeveType = v.type === "vest" ? "sleeveless" : v.sleeve;
  const gapOuter = isLayer ? gap * 1.55 : gap;

  const lenFrac = LEN_FRAC[v.length] ?? 0.68;
  const hemY = fit.neckY - (fit.neckY - fit.hipY) * lenFrac - 0.01;

  const torso = deflectShell(data, mat, REG.TORSO | REG.SHOULDER | REG.NECK, gapOuter, {
    yMin: hemY - 0.015,
    yMax: fit.neckY,
  });
  torso.name = "torso";
  g.add(torso);

  if (sleeveType !== "sleeveless") {
    addSleeves(g, data, fit, mat, gapOuter, sleeveType, 1.1);
  }

  if (v.collar === "crew" || v.collar === "high" || v.collar === "mock" || v.collar === "round" || v.collar === "boat" || v.collar === "polo" || v.collar === "collar") {
    rimRing(g, torso, mat, gapOuter * 0.5 + 0.008, "top", 30);
  }

  rimRing(g, torso, mat, gapOuter * 0.35 + 0.006, "bottom", 32);

  if (v.type === "hoodie") {
    const hood = new THREE.Mesh(new THREE.SphereGeometry(fit.headR * 1.18, 22, 14, Math.PI * 0.55, Math.PI * 0.9, 0, Math.PI * 0.7), mat);
    hood.position.set(0, fit.neckY + fit.headR * 0.3, -fit.headR * 0.2);
    hood.castShadow = true;
    hood.userData.kind = "shell";
    g.add(hood);
  }
}

/* dress / jumpsuit (body path) */
function buildOnePieceBody(g: THREE.Group, fit: FitSheet, v: GarmentVisual, mat: THREE.Material, gap: number, body: THREE.SkinnedMesh, withLegs: boolean): void {
  const data = bodyDataFor(body);
  if (!data) return buildOnePiece(g, fit, v, mat, gap, withLegs);

  if (withLegs) {
    const torsoTop = deflectShell(data, mat, REG.TORSO | REG.SHOULDER | REG.NECK, gap, {
      yMin: fit.hipY - 0.16,
      yMax: fit.neckY,
    });
    torsoTop.name = "jumpsuit-torso";
    g.add(torsoTop);
    for (const sb of [REG.L, REG.R]) {
      const leg = deflectShell(data, mat, REG.UPLEG | REG.LEG | sideBit(sb), gap, {
        yMin: fit.ankleY + 0.02,
        yMax: fit.hipY - 0.14,
      });
      leg.name = "jumpsuit-leg";
      g.add(leg);
    }
    if (v.sleeve && v.sleeve !== "sleeveless") addSleeves(g, data, fit, mat, gap, v.sleeve, 1.05);
    return;
  }

  const lenFrac = LEN_FRAC[v.length] ?? 0.82;
  const flare = v.fit === "slim" ? 0.92 : v.fit === "oversized" ? 1.3 : 1.12;
  const hemY = fit.neckY - (fit.neckY - fit.kneeY) * lenFrac;

  const top = deflectShell(data, mat, REG.TORSO | REG.SHOULDER | REG.NECK, gap, {
    yMin: fit.hipY - 0.07,
    yMax: fit.neckY,
  });
  top.name = "dress-torso";
  g.add(top);

  const skirt = latheMesh([
    { y: Math.max(fit.hipY - 0.05, fit.hipY - 0.07), r: (fit.hipR + gap) * 1.04 },
    { y: fit.hipY, r: fit.hipR * 1.08 + gap },
    { y: fit.hipY + 0.05, r: (fit.hipR + gap) * 1.12 },
    { y: hemY, r: (fit.hipR + gap) * flare },
  ], mat, 40);
  skirt.userData.kind = "skirt";
  g.add(skirt);
  trimRing(g, mat, hemY, Math.max(0.06, (fit.hipR + gap) * (v.fit === "slim" ? 0.94 : 1.02)), gap * 0.3 + 0.006, 34);

  if (v.sleeve && v.sleeve !== "sleeveless") addSleeves(g, data, fit, mat, gap, v.sleeve, 0.95);
  if (v.collar) {
    rimRing(g, top, mat, gap * 0.5 + 0.007, "top", 30);
  }
}

/* bottoms (body path) */
function buildBottomBody(g: THREE.Group, fit: FitSheet, v: GarmentVisual, mat: THREE.Material, gap: number, body: THREE.SkinnedMesh): void {
  const data = bodyDataFor(body);
  if (!data) return buildBottom(g, fit, v, mat, gap);

  const legGap = v.type === "leggings" ? 0.012 : gap * (v.type === "jeans" || v.type === "trousers" ? 1 : 1.2);
  const isShorts = v.type === "shorts";

  if (v.type === "skirt") {
    const lenFrac = LEN_FRAC[v.length] ?? 0.45;
    const hemY = fit.waistY + (fit.kneeY - fit.waistY) * Math.min(1.1, lenFrac * 1.35);
    const flare = v.fit === "slim" ? 1.08 : v.fit === "oversized" ? 1.8 : 1.45;
    g.add(latheMesh([
      { y: fit.waistY, r: Math.max(0.1, fit.waistR * 1.06 + gap) },
      { y: fit.hipY, r: fit.hipR * 1.1 + gap },
      { y: hemY, r: (fit.hipR + gap) * flare },
    ], mat, 30));
    trimRing(g, mat, hemY, Math.max(0.1, (fit.hipR + gap) * flare * 0.98), gap * 0.3 + 0.006, 32);
    return;
  }

  const seat = deflectShell(data, mat, REG.TORSO, legGap, {
    yMin: fit.hipY - 0.03,
    yMax: fit.waistY + 0.02,
  });
  seat.name = "seat";
  g.add(seat);

  const crotch = deflectShell(data, mat, REG.UPLEG, legGap, {
    yMin: fit.hipY - 0.16,
    yMax: fit.hipY + 0.0,
  });
  crotch.name = "crotch";
  g.add(crotch);

  trimRing(g, mat, fit.waistY + 0.015, Math.max(0.06, fit.waistR * 1.06 + legGap), legGap * 0.5 + 0.008, 32);

  for (const sb of [REG.L, REG.R]) {
    if (isShorts) {
      const hemShortY = fit.hipY - (fit.hipY - fit.kneeY) * 0.45;
      const leg = deflectShell(data, mat, REG.UPLEG | REG.LEG | sideBit(sb), legGap, {
        yMin: hemShortY,
        yMax: fit.hipY - 0.02,
      });
      leg.name = "leg";
      g.add(leg);
    } else {
      const leg = deflectShell(data, mat, REG.UPLEG | REG.LEG | sideBit(sb), legGap, {
        yMin: fit.ankleY + 0.02,
        yMax: fit.hipY - 0.14,
      });
      leg.name = "leg";
      g.add(leg);
      let cx = 0;
      if (leg.geometry.attributes.position.count > 0) {
        const p = leg.geometry.attributes.position;
        let fmin = Infinity, fmax = -Infinity;
        for (let i = 0; i < p.count; i++) { const x = p.getX(i); if (x < fmin) fmin = x; if (x > fmax) fmax = x; }
        cx = (fmin + fmax) / 2;
      }
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(fit.ankleR * 1.08 + legGap, fit.ankleR * 1.08 + legGap, 0.018, 20, 1, true), mat);
      cuff.position.set(cx, fit.ankleY + 0.011, 0);
      cuff.userData.kind = "trim";
      g.add(cuff);
    }
  }
}

/* footwear (body path) — the deflated foot shell + sole + type accents */
function buildFootwearBody(g: THREE.Group, fit: FitSheet, v: GarmentVisual, mat: THREE.Material, body: THREE.SkinnedMesh): void {
  const data = bodyDataFor(body);
  if (!data) return buildFootwear(g, fit, v, mat);

  const soleMat = baseMat(0x141210, 0.55, 0, 0.3);
  const shGap = v.type === "formal-shoes" || v.type === "loafers" || v.type === "flats" ? 0.045 : 0.055;
  const solePlane = 0.012;

  for (const sb of [REG.L, REG.R]) {
    const shoe = deflectShell(data, mat, REG.FOOT | sideBit(sb), shGap, {
      yMin: fit.ankleY - 0.03,
      planeY: solePlane,
    });
    shoe.name = "shoe";
    g.add(shoe);

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity;
    const p = shoe.geometry.attributes.position.array as Float32Array;
    const cnt = shoe.geometry.attributes.position.count;
    for (let i = 0; i < cnt; i++) {
      const x = p[i * 3];
      const z = p[i * 3 + 2];
      const y = p[i * 3 + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
      if (y < minY) minY = y;
    }
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const w = Math.max(0.09, maxX - minX);
    const len = Math.max(0.18, maxZ - minZ);
    const soleTop = Number.isFinite(minY) ? minY : solePlane;

    const sole = new THREE.Mesh(new THREE.BoxGeometry(w, 0.022, len), soleMat);
    sole.position.set(cx, soleTop - 0.011, cz);
    sole.userData.kind = "sole";
    g.add(sole);

    if (v.type === "boots") {
      const shaft = deflectShell(data, mat, REG.LEG | sideBit(sb), shGap * 0.9, {
        yMin: fit.ankleY - 0.01,
        yMax: fit.ankleY + 0.16,
      });
      shaft.name = "boot-shaft";
      g.add(shaft);
    } else if (v.type === "heels") {
      const heel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.008, 0.05, 10), soleMat);
      heel.position.set(cx, soleTop + 0.018, cz - len * 0.3);
      g.add(heel);
    } else if (v.type === "sandals") {
      for (const fz of [-len * 0.12, len * 0.18]) {
        const strap = new THREE.Mesh(new THREE.TorusGeometry(w * 0.55, 0.008, 8, 18), mat);
        strap.position.set(cx, soleTop + 0.012, cz + fz);
        strap.rotation.x = Math.PI / 2;
        g.add(strap);
      }
    } else if (v.type === "sneakers" || v.type === "running-shoes") {
      for (const fz of [0.02, 0.05]) {
        const lace = new THREE.Mesh(new THREE.BoxGeometry(w * 0.86, 0.012, 0.014), mat);
        lace.position.set(cx, soleTop + 0.028, cz + fz);
        g.add(lace);
      }
    }
  }
}