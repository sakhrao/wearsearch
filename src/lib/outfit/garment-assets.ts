/* GarmentSystem — draws a generic but realistic, body-hugging garment for
   every GarmentVisual on the actual rigged human.

   The garment meshes are built from the FitSheet of the REAL, morphed body
   (radii + skeleton-derived joints), so a coat follows the shoulders, jeans
   follow the legs, shoes sit on the feet, a necklace circles the neck. Nothing
   floats: every mesh is a surface offset a small gap away from the measured
   body. One-pieces (dress / jumpsuit) are continuous silhouettes. No product
   source is ever consulted — this is the GarmentSystem layer, decoupled from
   the Avatar.

   This is the "template phase" of the roadmap: category-specific realistic
   meshes. When exact garment assets exist, GarmentAsset.assetUri replaces the
   generated mesh through the same API. */

import * as THREE from "three";
import type { FitSheet } from "@/lib/avatar/human-model";
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

/* Lathe (rotation around Y) from (y, r) control points.
   The profile points must ASCEND in y (hem -> neck, bottom -> top):
   LatheGeometry builds its ring winding from the profile direction, so a
   top-down profile yields inward-facing (back-face-culled) surfaces. The
   control points here are authored top-down (natural to read), so we
   reverse before building. Returns only the surface whose front faces
   remain OUTWARD, i.e. visible from outside. */
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

export function buildGarmentVisual(visual: GarmentVisual, fit: FitSheet): THREE.Group {
  const asset = garmentAssetFor(visual);
  const g = new THREE.Group();
  g.userData.garment = asset;
  g.userData.visual = { slot: visual.slot, type: visual.type, label: visual.label, pattern: visual.pattern };

  const colorHex = visual.color?.hex ? parseInt(visual.color.hex.replace("#", ""), 16) : 0x99948c;
  const mat = materialFor(visual, colorHex);
  const gap = FIT_GAP[visual.fit] ?? 0.04;

  switch (asset.category) {
    case "top":
    case "layer":
      buildTorso(g, fit, visual, mat, gap);
      break;
    case "one-piece":
      if (visual.type === "jumpsuit") buildOnePiece(g, fit, visual, mat, gap, true);
      else buildOnePiece(g, fit, visual, mat, gap, false);
      break;
    case "bottom":
      buildBottom(g, fit, visual, mat, gap);
      break;
    case "footwear":
      buildFootwear(g, fit, visual, mat);
      break;
    case "accessory":
      buildAccessory(g, fit, visual, mat);
      break;
    default:
      break;
  }
  return g;
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

  /* sleeves along shoulder → elbow → wrist */
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

  /* collar band */
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
  const hemBottom = withLegs ? fit.hipY + 0.05 : fit.ankleY;
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

  /* sleeves for dresses */
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

  /* hips band */
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