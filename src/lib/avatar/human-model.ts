/* HumanModel — the three.js runtime for the CC0 rigged-human base GLB.

   loadAvatarBase() parses public/models/avatar/base.glb ONCE (module-level
   cache) and hands back a fresh, working copy. applyProfile() morphs the
   SkinnedMesh from AvatarModelConfig, applies the PBR skin material and the
   height scale. computeFit() reads the morph-deformed geometry CPU-side and
   produces a FitSheet (band radii + skeleton-derived joints) that the
   GarmentSystem uses so clothing hugs the actual, customised body. */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { AvatarModelConfig } from "@/lib/avatar/avatar-model";
import { avatarModelFor } from "@/lib/avatar/avatar-model";
import type { AvatarProfile } from "@/lib/avatar/profile";

const BASE_URL = "/models/avatar/base.glb";

let cached: Promise<THREE.Group> | null = null;

function loadAvatarBase(): Promise<THREE.Group> {
  if (!cached) {
    cached = new Promise<THREE.Group>((resolve, reject) => {
      const loader = new GLTFLoader();
      loader.load(
        BASE_URL,
        (gltf) => resolve(gltf.scene),
        undefined,
        (err) => {
          cached = null;
          reject(err as Error);
        }
      );
    });
  }
  return cached;
}

/* Fresh, independent copy of the parsed avatar (deep-cloned geometry + a
   re-bound skeleton on the cloned bone hierarchy). */
export async function cloneAvatarBase(): Promise<THREE.Group> {
  const base = await loadAvatarBase();
  const copy = base.clone(true);
  const body = findBody(copy);
  if (!body) throw new Error("avatar base missing 'body' SkinnedMesh");
  const bones: THREE.Bone[] = [];
  copy.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone);
  });
  const skeleton = new THREE.Skeleton(bones);
  body.bind(skeleton, body.matrixWorld);
  body.updateMatrixWorld(true);
  return copy;
}

export function findBody(root: THREE.Object3D): THREE.SkinnedMesh | null {
  let found: THREE.SkinnedMesh | null = null;
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh && o.name === "body") {
      found = o as THREE.SkinnedMesh;
    }
  });
  return found;
}

/* CPU-side morph-deformed positions (morphs are GPU-only at render time;
   tools need the real, deformed surface). Returns a Float32Array xyz. */
export function morphedPositions(body: THREE.SkinnedMesh): Float32Array {
  const g = body.geometry;
  const base = g.attributes.position.array as Float32Array;
  const count = base.length;
  const out = new Float32Array(base);
  const morphs = g.morphAttributes?.position;
  if (!morphs) return out;
  const infl = body.morphTargetInfluences ?? [];
  for (let m = 0; m < morphs.length; m++) {
    const influence = infl[m];
    if (!influence || influence === 0) continue;
    const delta = morphs[m].array as Float32Array;
    for (let i = 0; i < count; i++) out[i] += delta[i] * influence;
  }
  return out;
}

export type FitBand = { y: number; r: number };

export type FitSheet = {
  height: number;          // head top y
  totalHeight: number;     // band-normalised
  bands: FitBand[];        // silhouette radius per height (p75 over azimuths)
  // joints (bone world positions, local space)
  hipY: number; hipX: number;
  kneeY: number; ankleY: number;
  shoulderY: number; shoulderX: number;
  elbowY: number; wristY: number;
  neckY: number; headY: number; headR: number;
  bustY: number; waistY: number; chestY: number;
  crownY: number; eyeY: number; noseY: number; chinY: number;
  neckR: number; chestR: number; waistR: number; hipR: number;
  bustR: number; kneeR: number; ankleR: number; armR: number; legR: number;
  leftEye: THREE.Vector3; rightEye: THREE.Vector3;
  leftShoulder: THREE.Vector3; rightShoulder: THREE.Vector3;
  leftElbow: THREE.Vector3; rightElbow: THREE.Vector3;
  leftWrist: THREE.Vector3; rightWrist: THREE.Vector3;
  leftLeg: THREE.Vector3; rightLeg: THREE.Vector3;
  leftAnkle: THREE.Vector3; rightAnkle: THREE.Vector3;
  leftFoot: THREE.Vector3; rightFoot: THREE.Vector3;
};

type VP = THREE.Vector3;
const vp = (x: number, y: number, z: number): VP => new THREE.Vector3(x, y, z);

/* Band silhouette radius: p75 of the max-radius-per-azimuth at height y.
   Arms make a couple of azimuth spikes near the torso; the percentile keeps
   them from inflating the chest/waist/hip clothing radius. */
function bandRadius(
  pts: Float32Array,
  y: number,
  half: number,
  az = 48
): number {
  const maxPerAz = new Array(az).fill(0);
  let n = 0;
  for (let i = 0; i < pts.length; i += 3) {
    const py = pts[i + 1];
    if (py < y - half || py > y + half) continue;
    const px = pts[i];
    const pz = pts[i + 2];
    const r = Math.sqrt(px * px + pz * pz);
    const a = Math.floor((Math.atan2(pz, px) + Math.PI) / (Math.PI * 2 / az)) % az;
    if (r > maxPerAz[a]) maxPerAz[a] = r;
    n++;
  }
  if (n < 24) return 0;
  const sorted = maxPerAz.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.75)];
}

export function computeFit(body: THREE.SkinnedMesh): FitSheet {
  const pts = morphedPositions(body);
  let topY = 0, bottomY = Infinity;
  for (let i = 1; i < pts.length; i += 3) {
    if (pts[i] > topY) topY = pts[i];
    if (pts[i] < bottomY) bottomY = pts[i];
  }

  const joints = new Map<string, VP>();
  for (const bone of body.skeleton.bones as THREE.Bone[]) {
    const name = bone.name.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    joints.set(name, bone.position.clone());
  }
  const bone = (...names: string[]): VP => {
    for (const n of names) {
      const j = joints.get(n);
      if (j) return j.clone();
    }
    return vp(0, 0, 0);
  };

  const hips = bone("mixamorighips", "hips");
  const shoulderL = bone("mixamorigleftshoulder", "leftshoulder");
  const shoulderR = bone("mixamorigrightshoulder", "rightshoulder");
  const elbowL = bone("mixamorigleftforearm", "leftforearm", "leftarm");
  const elbowR = bone("mixamorigrightforearm", "rightforearm", "rightarm");
  const wristL = bone("mixamoriglefthand", "lefthand");
  const wristR = bone("mixamorigrighthand", "righthand");
  const legL = bone("mixamorigleftleg", "leftleg");
  const legR = bone("mixamorigrightleg", "rightleg");
  const ankL = bone("mixamorigleftfoot", "leftfoot");
  const ankR = bone("mixamorigrightfoot", "rightfoot");
  const footL = bone("mixamoriglefttoebase", "lefttoebase");
  const footR = bone("mixamorigrighttoebase", "righttoebase");
  const neck = bone("mixamorigin", "mixamorigneck", "neck");
  const head = bone("mixamorighead", "head");

  const shoulderY = Math.max(shoulderL.y, shoulderR.y, hips.y + 0.42);
  const neckY = Math.max(neck.y, head.y - 0.22, shoulderY + 0.1);
  const headY = Math.max(head.y, topY - 0.14);
  const crownY = topY;
  const hipY = Math.max(hips.y, bottomY + 0.95);
  const kneeY = legL.y || hipY - 0.42;
  const ankleY = ankL.y || hipY - 0.75;

  const chestY = shoulderY - 0.12;
  const bustY = chestY - 0.04;
  const waistY = hipY + 0.22;
  const legX = (Math.abs(legL.x) + Math.abs(legR.x)) / 2;
  const hipR = bandRadius(pts, hipY, 0.07);
  const waistR = bandRadius(pts, waistY, 0.06);
  const chestR = bandRadius(pts, chestY, 0.07);
  const bustR = bandRadius(pts, bustY, 0.06);
  const neckR = bandRadius(pts, neckY, 0.04) || 0.055;
  const kneeR = bandRadius(pts, kneeY, 0.05);
  const ankleR = bandRadius(pts, ankleY, 0.04);
  const armR = Math.max(0.05, bandRadius(pts, elbowL.y, 0.05));
  const headR = bandRadius(pts, headY, 0.05) || 0.1;
  const legR0 = bandRadius(pts, (hipY + kneeY) / 2, 0.07);

  const eyeY = neckY + (headY - neckY) * 0.58;
  const eyeZ = bandRadius(pts, eyeY, 0.03);
  const noseY = neckY + (headY - neckY) * 0.42;
  const chinY = neckY + (headY - neckY) * 0.24;
  const eyeX = headR * 0.72;

  return {
    height: topY,
    totalHeight: topY - bottomY,
    bands: [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.35, 1.4, 1.45, 1.5, 1.55, 1.6, 1.65, 1.7].map((y) => ({ y, r: bandRadius(pts, y, 0.03) })).filter((b) => b.r > 0),
    hipY, hipX: legX || Math.abs(hipR * 0.32) || 0,
    kneeY, ankleY,
    shoulderY, shoulderX: Math.max(Math.abs(shoulderL.x), Math.abs(shoulderR.x), waistR * 1.5) || 0.22,
    elbowY: elbowL.y || chestY - 0.1,
    wristY: wristL.y || shoulderY - 0.32,
    neckY, headY, headR,
    bustY, waistY, chestY,
    crownY, eyeY, noseY, chinY,
    neckR, chestR, waistR, hipR, bustR, kneeR, ankleR, armR, legR: legR0,
    leftEye: vp(-eyeX, eyeY, eyeZ), rightEye: vp(eyeX, eyeY, eyeZ),
    leftShoulder: shoulderL, rightShoulder: shoulderR,
    leftElbow: elbowL, rightElbow: elbowR,
    leftWrist: wristL, rightWrist: wristR,
    leftLeg: legL, rightLeg: legR,
    leftAnkle: ankL, rightAnkle: ankR,
    leftFoot: footL, rightFoot: footR,
  };
}

/* ---- materials ---- */
export function skinMaterial(colorHex: number, roughness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness,
    metalness: 0.0,
    envMapIntensity: 0.55,
  });
}

export function applyProfile(body: THREE.SkinnedMesh, config: AvatarModelConfig): void {
  const dict = body.morphTargetDictionary ?? {};
  for (const [name, influence] of Object.entries(config.morphs)) {
    const idx = dict[name] ?? Number(name);
    if (Number.isFinite(idx) && idx >= 0 && body.morphTargetInfluences) {
      body.morphTargetInfluences[idx] = influence;
    }
  }
  if (body.material !== null) {
    (body.material as THREE.MeshStandardMaterial).dispose();
  }
  body.material = skinMaterial(config.skin.color, config.skin.roughness);
  body.updateMatrixWorld(true);
}

/* ---- eyes (procedural, anchored to the head) ---- */
export function buildEyes(fit: FitSheet): THREE.Group {
  const g = new THREE.Group();
  const scleraMat = new THREE.MeshStandardMaterial({ color: 0xf7f4ee, roughness: 0.2, metalness: 0.0 });
  const irisMat = new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 0.15, metalness: 0.0 });
  const scleraGeo = new THREE.SphereGeometry(fit.headR * 0.14, 16, 12);
  const irisGeo = new THREE.CircleGeometry(fit.headR * 0.06, 18);
  for (const side of [-1, 1]) {
    const s = new THREE.Mesh(scleraGeo, scleraMat);
    const e = side < 0 ? fit.leftEye : fit.rightEye;
    s.position.copy(e);
    s.scale.z = 1.25;
    g.add(s);
    const iris = new THREE.Mesh(irisGeo, irisMat);
    iris.position.set(e.x, e.y, e.z + fit.headR * 0.12);
    iris.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    g.add(iris);
  }
  return g;
}

/* ---- hair (procedural per style/length/texture) ---- */
export function buildHair(fit: FitSheet, config: AvatarModelConfig): THREE.Group {
  const g = new THREE.Group();
  const { style, length, texture, color } = config.hair;
  if (style === "bald") return g;

  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, side: THREE.DoubleSide });
  const r = fit.headR;
  const cy = fit.headY;
  const seed1 = 101;
  let seed = seed1;
  const prand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  const cap = (scaleY: number) => {
    const geo = new THREE.SphereGeometry(r * 1.06, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.62);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(0, cy + r * 0.06, 0);
    m.scale.set(1, scaleY, 1);
    g.add(m);
  };

  const backMass = (len: number, rx: number) => {
    const geo = new THREE.SphereGeometry(r * 0.62, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.7);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(0, cy - r * 0.22 - len * 0.3, r * 0.14);
    m.scale.set(1 + rx, len / (r * 1.3), 1 + rx);
    g.add(m);
  };

  const fall = (len: number) => {
    const geo = new THREE.CapsuleGeometry(r * 0.34, len * 0.8, 6, 14);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(0, cy - r * 0.4 - len * 0.45, r * 0.2);
    m.rotation.x = 0.16;
    g.add(m);
  };

  const curly = (n: number, size: number) => {
    for (let i = 0; i < n; i++) {
      const phi = prand() * Math.PI * 2;
      const theta = prand() * Math.PI * 0.48;
      const c = new THREE.Mesh(new THREE.SphereGeometry(r * size, 12, 10), mat);
      c.position.set(
        Math.sin(theta) * Math.cos(phi) * r * 1.05,
        cy + Math.cos(theta) * r * 1.05,
        Math.sin(theta) * Math.sin(phi) * r * 1.05
      );
      g.add(c);
    }
  };

  switch (style) {
    case "buzz":
      cap(0.62);
      break;
    case "short":
      cap(0.78);
      backMass(length === "long" ? r * 1.0 : r * 0.45, 0.1);
      break;
    case "medium":
      cap(0.92);
      backMass(length === "long" ? r * 1.6 : r * 1.0, 0.18);
      break;
    case "long":
      cap(1.0);
      backMass(r * 1.2, 0.15);
      fall(length === "long" ? r * 1.9 : r * 1.2);
      break;
    case "curly":
    case "ponytail": {
      const dense = texture === "coily" ? 1.25 : texture === "curly" ? 1 : 0.85;
      cap(1.0);
      curly(Math.round(22 * dense), 0.34);
      curly(Math.round(14 * dense), 0.24);
      if (style === "ponytail") {
        const tail = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.24, r * 1.6, 6, 12), mat);
        tail.position.set(0, cy + r * 0.9, r * 0.4);
        tail.rotation.x = -0.55;
        g.add(tail);
      }
      break;
    }
    default:
      cap(0.8);
  }

  return g;
}

/* ---- top-level builder ---- */
export async function buildAvatar(profile: AvatarProfile): Promise<{
  root: THREE.Group;
  body: THREE.SkinnedMesh;
  fit: FitSheet;
  config: AvatarModelConfig;
}> {
  const config = avatarModelFor(profile);
  const root = await cloneAvatarBase();
  const body = findBody(root);
  if (!body) throw new Error("avatar base has no body");
  body.name = "body";
  applyProfile(body, config);
  root.scale.setScalar(config.heightScale);

  const fit = computeFit(body);
  const eyes = buildEyes(fit);
  root.add(eyes);
  const hair = buildHair(fit, config);
  hair.name = "hair";
  root.add(hair);

  root.updateMatrixWorld(true);
  return { root, body, fit, config };
}