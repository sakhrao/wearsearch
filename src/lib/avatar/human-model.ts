/* HumanModel — the three.js runtime for the CC0 rigged-human base GLB.

   loadAvatarBase() parses public/models/avatar/base.glb ONCE (module-level
   cache) and hands back a fresh, working copy. applyProfile() morphs the
   SkinnedMesh from AvatarModelConfig, applies the PBR skin material and the
   height scale. computeFit() reads the morph-deformed geometry CPU-side and
   produces a FitSheet (band radii + skeleton-derived joints) that the
   GarmentSystem uses so clothing hugs the actual, customised body. */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
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
  reBindSkeleton(copy);
  return copy;
}

/* Parse a GLB/glTF buffer into the avatar base scene — used by the Node
   test-suite (no DOM, no network) and as the build entry for tools. */
export async function avatarFromBytes(bytes: ArrayBuffer): Promise<THREE.Group> {
  const gltf = await new Promise<GLTF>((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.parse(bytes, "", (g) => resolve(g), (e) => reject(e instanceof Error ? e : new Error(String(e))));
  });
  return gltf.scene;
}

/* Reparent `child` under `parent` while preserving its world transform
   (the flesh keeps its exact bind pose; the chain only gains a pivot). */
function reparentPreservingWorld(child: THREE.Bone, parent: THREE.Bone): void {
  child.updateWorldMatrix(true, false);
  const world = child.matrixWorld.clone();
  parent.updateWorldMatrix(true, false);
  const inv = new THREE.Matrix4().copy(parent.matrixWorld).invert();
  const local = inv.multiply(world);
  local.decompose(child.position, child.quaternion, child.scale);
  child.parent?.remove(child);
  parent.add(child);
  child.updateMatrix();
}

/* The baked GLB carries a FLAT bone hierarchy — every bone hangs directly
   off the scene root with its bind transform baked into the local frame.
   That pins each part in space: rotating a shoulder cannot swing the arm.
   This re-parents the arm (and finger) chains so the joints get real
   pivots (world transforms preserved → zero visual change at bind), which
   then lets poseArmsNeutral give the avatar a natural, neutral hang. */
function hierarchizeArms(bones: THREE.Bone[]): void {
  const byName = new Map(bones.map((b) => [b.name, b] as const));
  const reparent = (childName: string, parentName: string): void => {
    const child = byName.get(childName);
    const parent = byName.get(parentName);
    if (!child || !parent || child === parent) return;
    if (child.parent === parent) return;                 /* already a chain */
    if (child.parent && (child.parent as THREE.Bone).isBone) return;
    reparentPreservingWorld(child, parent);
  };
  for (const side of ["Left", "Right"]) {
    const base = `mixamorig${side}`;
    reparent(`${base}Arm`, `${base}Shoulder`);
    reparent(`${base}ForeArm`, `${base}Arm`);
    reparent(`${base}Hand`, `${base}ForeArm`);
    for (const finger of [
      "HandThumb1", "HandThumb2", "HandThumb3",
      "HandIndex1", "HandIndex2", "HandIndex3",
      "HandMiddle1", "HandMiddle2", "HandMiddle3",
      "HandRing1", "HandRing2", "HandRing3",
      "HandPinky1", "HandPinky2", "HandPinky3",
    ]) {
      reparent(`${base}${finger}`, `${base}Hand`);
    }
  }
}

/* Re-own the cloned bone hierarchy: three's clone() duplicates bones, so
   a fresh Skeleton over the COPY is required for correct skinning.

   The bones array MUST keep the GLB/joint order (the order the mesh's
   skinIndices were baked against). Loading the list from body.skeleton
   preserves that; rebuilding via root.traverse() can visit the scene in a
   different order (notably after clone()), silently pointing every skin
   index at the wrong joint and skinned geometry comes out garbled. */
function reBindSkeleton(root: THREE.Group): THREE.SkinnedMesh {
  const body = findBody(root);
  if (!body) throw new Error("avatar base missing 'body' SkinnedMesh");
  root.updateMatrixWorld(true);
  const bones: THREE.Bone[] = [];
  const jointOrder = body.skeleton?.bones;
  if (jointOrder && jointOrder.length > 0) {
    for (const b of jointOrder) {
      if (b && (b as unknown as THREE.Bone).isBone && b !== bones[bones.length - 1]) {
        bones.push(b as THREE.Bone);
      }
    }
  } else {
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone);
    });
  }
  hierarchizeArms(bones);   /* arms become real (parent→child) chains */
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  body.bind(skeleton, body.matrixWorld);
  body.updateMatrixWorld(true);
  return body;
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

/* CPU-side SKINNED positions: the morph-deformed bind vertices pushed through
   the CURRENT skeleton pose (Σ weightᵢ · matrixWorldᵢ · bindInverseᵢ), i.e.
   exactly what the GPU rasterizes. computeFit reads this so the torso bands
   reflect the neutral-hang arms — otherwise measurements would keep "seeing"
   the spread bind pose and read a waist wider than the hips. */
export function skinnedPositions(body: THREE.SkinnedMesh): Float32Array {
  const g = body.geometry;
  const bind = morphedPositions(body);
  const idx = g.attributes.skinIndex.array as Uint16Array;
  const wgt = g.attributes.skinWeight.array as Float32Array;
  const bones = body.skeleton.bones as THREE.Bone[];
  const invs = body.skeleton.boneInverses;
  if (!idx || !wgt || bones.length === 0 || invs.length === 0) return bind;
  const out = new Float32Array(bind.length);
  const te = new Float32Array(16);
  const poseMatrix = new THREE.Matrix4();
  const tmp = new THREE.Matrix4();
  const v = new THREE.Vector3();
  for (let i = 0; i < idx.length; i += 4) {
    te.fill(0);
    for (let k = 0; k < 4; k++) {
      const b = idx[i + k];
      const w = wgt[i + k];
      if (!w || !bones[b] || !invs[b]) continue;
      const e = tmp.multiplyMatrices(bones[b].matrixWorld, invs[b]).elements;
      for (let m = 0; m < 16; m++) {
        te[m] += e[m] * w;
      }
    }
    poseMatrix.fromArray(te);
    const vi = i;               /* i is the 4-wide vertex counter → 4 * vert */
    const b3 = (vi / 4) * 3;    /* component base of this vertex in xyz */
    v
      .set(bind[b3], bind[b3 + 1], bind[b3 + 2])
      .applyMatrix4(poseMatrix);
    out[b3] = v.x;
    out[b3 + 1] = v.y;
    out[b3 + 2] = v.z;
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

/* Band silhouette radius: the MEDIAN of the max-radius-per-azimuth of the
   cross-section ring at height y, measured around the RING'S OWN centroid.
   The centroid kills the head/belly sitting forward of the spine axis (an
   axis-based "r" reads the offset, not the width), and the median over fine
   azimuth bins keeps the few arm-peak bins from inflating the value. */
function bandRadius(
  pts: Float32Array,
  y: number,
  half: number,
  az = 72
): number {
  let n = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < pts.length; i += 3) {
    const py = pts[i + 1];
    if (py < y - half || py > y + half) continue;
    cx += pts[i];
    cz += pts[i + 2];
    n++;
  }
  if (n < 12) return 0;
  cx /= n;
  cz /= n;
  const maxPerAz = new Array(az).fill(0);
  for (let i = 0; i < pts.length; i += 3) {
    const py = pts[i + 1];
    if (py < y - half || py > y + half) continue;
    const dx = pts[i] - cx;
    const dz = pts[i + 2] - cz;
    const r = Math.sqrt(dx * dx + dz * dz);
    const a = Math.floor((Math.atan2(dz, dx) + Math.PI) / (Math.PI * 2 / az)) % az;
    if (r > maxPerAz[a]) maxPerAz[a] = r;
  }
  const vals = maxPerAz.filter((v) => v > 0).sort((a, b) => a - b);
  if (vals.length === 0) return 0;
  return vals[Math.floor(vals.length * 0.5)];
}

/* Express a WORLD-space rotation `worldRot` as a rotation in `bone`'s LOCAL
   parent frame (bone's own frame is rotated by its parents in the chain). */
function localFrameRotation(bone: THREE.Bone, worldRot: THREE.Quaternion): THREE.Quaternion {
  const parent = bone.parent ? (bone.parent as THREE.Object3D) : bone;
  const pw = new THREE.Quaternion();
  parent.getWorldQuaternion(pw);
  return pw.clone().invert().multiply(worldRot).multiply(pw);
}

/* Neutral-hang arm pose. The MakeHuman hm08 rest pose spreads the arms well
   away from the torso (hands at x≈±0.45–0.5, forward of the chest), which
   reads as an unnatural stance and inflates the waist/hip torso bands. This
   swings each shoulder chain so the hand hangs at the side of the thigh,
   then re-bends the forearm for a soft, natural elbow. Called AFTER morphs,
   BEFORE fit measurement, so garments inherit the corrected joints too. */
export function poseArmsNeutral(body: THREE.SkinnedMesh): void {
  const sk = body.skeleton as unknown as { getBoneByName(name: string): THREE.Bone | null };
  const targetHandX = 0.14;   /* hand hangs just outside the hip */
  const targetHandZ = 0.045;  /* slightly in front of the thigh plane */
  for (const side of ["left", "right"] as const) {
    const cap = side[0].toUpperCase() + side.slice(1);
    const shoulder = sk.getBoneByName(`mixamorig${cap}Shoulder`);
    const arm = sk.getBoneByName(`mixamorig${cap}Arm`);
    const forearm = sk.getBoneByName(`mixamorig${cap}ForeArm`);
    const hand = sk.getBoneByName(`mixamorig${cap}Hand`);
    if (!shoulder || !arm || !forearm || !hand) continue;

    const S = new THREE.Vector3();
    shoulder.getWorldPosition(S);
    const H = new THREE.Vector3();
    hand.getWorldPosition(H);
    const dirH = new THREE.Vector3().subVectors(H, S);
    const armLen = dirH.length();
    if (armLen < 1e-3) continue;
    dirH.divideScalar(armLen);
    const towardOwnSide = S.x >= 0 ? 1 : -1;
    const drop = Math.max(0.46, Math.min(0.72, -dirH.y * armLen));
    const T = new THREE.Vector3(
      towardOwnSide * targetHandX,
      S.y - drop,
      S.z + targetHandZ
    );
    const dirT = new THREE.Vector3().subVectors(T, S).normalize();

    /* rotate the shoulder — the whole now-chained arm swings about it */
    const q1 = new THREE.Quaternion().setFromUnitVectors(dirH, dirT);
    if (Math.abs(q1.w) < 0.9985) {
      shoulder.quaternion.premultiply(localFrameRotation(shoulder, q1));
    }

    /* re-bend the forearm so the wrist lands on the target hang line */
    const E = new THREE.Vector3();
    forearm.getWorldPosition(E);
    const H2 = new THREE.Vector3();
    hand.getWorldPosition(H2);
    const dirFA = new THREE.Vector3().subVectors(H2, E);
    const faLen = dirFA.length();
    if (faLen < 1e-3) continue;
    dirFA.divideScalar(faLen);
    const dirT2 = new THREE.Vector3().subVectors(T, E).normalize();
    const q2 = new THREE.Quaternion().setFromUnitVectors(dirFA, dirT2);
    if (Math.abs(q2.w) < 0.9995) {
      forearm.quaternion.premultiply(localFrameRotation(forearm, q2));
    }
  }
  body.updateMatrixWorld(true);
}

export function computeFit(body: THREE.SkinnedMesh): FitSheet {
  const pts = skinnedPositions(body);
  let topY = 0, bottomY = Infinity;
  for (let i = 1; i < pts.length; i += 3) {
    if (pts[i] > topY) topY = pts[i];
    if (pts[i] < bottomY) bottomY = pts[i];
  }

  const joints = new Map<string, VP>();
  for (const bone of body.skeleton.bones as THREE.Bone[]) {
    const name = bone.name.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    joints.set(name, bone.getWorldPosition(new THREE.Vector3()));
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

/* ---- eyes (procedural, anchored to the head) ----
   The eyeball is embedded in the socket (slightly recessed) so only the
   front sphere bulges; the iris + pupil are discs ON the front of the
   sclera (facing +Z, the head's forward), clearly visible. A tiny white
   highlight sells the wet-glint. The old build hidden the iris INSIDE the
   opaque sclera sphere — pupils were never rendered. */
export function buildEyes(fit: FitSheet): THREE.Group {
  const g = new THREE.Group();
  const scleraMat = new THREE.MeshStandardMaterial({ color: 0xf7f4ee, roughness: 0.18, metalness: 0.0, envMapIntensity: 0.7 });
  const irisMat = new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 0.1, metalness: 0.0, envMapIntensity: 0.8 });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x0b0a08, roughness: 0.08, metalness: 0.02 });
  const glintMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, envMapIntensity: 1.2 });

  const eyeR = fit.headR * 0.15;
  const socketDepth = fit.headR * 0.20;   /* embed the ball into the skull */
  const frontZ = (z: number) => z - socketDepth + eyeR * 1.16;

  for (const side of [-1, 1]) {
    const e = side < 0 ? fit.leftEye : fit.rightEye;

    const ball = new THREE.Mesh(new THREE.SphereGeometry(eyeR, 18, 14), scleraMat);
    ball.position.set(e.x, e.y, e.z - socketDepth);
    ball.scale.z = 1.16;
    ball.userData.part = "sclera";
    g.add(ball);

    const fz = frontZ(e.z);
    const iris = new THREE.Mesh(new THREE.CircleGeometry(eyeR * 0.5, 20), irisMat);
    iris.position.set(e.x, e.y, fz + 0.0015);
    iris.userData.part = "iris";
    g.add(iris);

    const pupil = new THREE.Mesh(new THREE.CircleGeometry(eyeR * 0.24, 16), pupilMat);
    pupil.position.set(e.x, e.y, fz + 0.003);
    pupil.userData.part = "pupil";
    g.add(pupil);

    const glint = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 0.14, 8, 6), glintMat);
    glint.position.set(e.x - eyeR * 0.2, e.y + eyeR * 0.22, fz + 0.0045);
    glint.userData.part = "glint";
    g.add(glint);

    /* brow: a gently arched strand above each eye — sells the face */
    const browMat = new THREE.MeshStandardMaterial({ color: 0x2b1f16, roughness: 0.9 });
    const brow = new THREE.Mesh(new THREE.TorusGeometry(eyeR * 1.1, eyeR * 0.16, 6, 14, Math.PI * 1.15), browMat);
    brow.position.set(e.x, e.y + eyeR * 1.35, e.z - socketDepth + eyeR * 0.92);
    brow.rotation.z = Math.PI / 2;
    brow.userData.part = "brow";
    g.add(brow);
  }
  return g;
}

/* ---- hair (procedural per style/length/texture) ----
   A scalp-hugging shell (hemisphere centred ON the skull, not floating
   above it) + a nape/back mass that reaches the hairline + a fringe for
   the short/medium cuts + layered crown tufts for curls. All radii are
   measured from the morphed head, so the hair follows a thin/heavy or
   short/tall customization too. */
export function buildHair(fit: FitSheet, config: AvatarModelConfig): THREE.Group {
  const g = new THREE.Group();
  const { style, length, texture, color } = config.hair;
  if (style === "bald") return g;

  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.88, side: THREE.DoubleSide });
  const r = fit.headR;
  const cy = fit.headY;          /* mid-skull reference */
  const crown = fit.crownY;      /* actual head top */
  const skullY = cy - r * 0.12;  /* skull centre: below mid so the shell hugs */
  const scalpR = r * 1.05;

  const seed1 = 101;
  let seed = seed1;
  const prand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  /* full scalp shell: from the crown down past the hairline to the nape
     (thetaLength ~0.78π), flattened slightly front-to-back. The vertical
     scale is stretched per-fit so the pole CRESTS the actual crown (the
     skull top), not a fixed cap that sits a few cm below it. */
  const shell = () => {
    const geo = new THREE.SphereGeometry(scalpR, 30, 18, 0, Math.PI * 2, 0, Math.PI * 0.78);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(0, skullY, 0);
    /* pole at theta=0 lands at y = skullY + r · scaleY → target the crown */
    const shellTop = Math.max(crown, skullY + scalpR) + 0.004;
    m.scale.set(1, Math.max(1.02, (shellTop - skullY) / scalpR), 0.96);
    g.add(m);
  };

  /* back mass: fills the nape / above-neck so the hairline reads solid */
  const backMass = (lenFrac: number) => {
    const geo = new THREE.SphereGeometry(scalpR * 0.92, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.7);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(0, skullY - scalpR * 0.28, -r * 0.12);
    m.scale.set(1 + lenFrac * 0.35, 0.7 + lenFrac * 0.8, 0.6 + lenFrac * 0.35);
    g.add(m);
  };

  /* long fall: hangs down the back of the neck toward the shoulders */
  const fall = (lenFrac: number) => {
    const geo = new THREE.CapsuleGeometry(r * 0.3, scalpR * 1.15 * lenFrac, 5, 12);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(0, skullY - scalpR * 0.55 - scalpR * 0.55 * lenFrac, -r * 0.3);
    m.rotation.x = 0.14;
    g.add(m);
  };

  /* hairline strands: fine tapered cones ringing the forehead hairline —
     reads as hair instead of a solid blob cap */
  const hairline = (density: number) => {
    const count = Math.round(26 * density);
    for (let i = 0; i < count; i++) {
      const phi = (i / count) * Math.PI * 2 + prand() * 0.15;
      const hx = Math.sin(phi) * scalpR * 0.92;
      const hz = Math.cos(phi) * scalpR * 0.86;
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.008 + prand() * 0.006, 0.035 + prand() * 0.02, 6), mat);
      c.position.set(hx, skullY + Math.sqrt(Math.max(0, scalpR * scalpR - hx * hx - hz * hz * 0.86)) * 0.86, hz);
      c.rotation.x = Math.PI * (0.5 + prand() * 0.25);
      c.rotation.z = Math.atan2(hx, hz) * 0.4;
      g.add(c);
    }
  };

  const longFrac = length === "long" ? 1 : length === "medium" ? 0.62 : 0.34;

  /* curly tufts spread across the crown surface */
  const curly = (n: number, size: number) => {
    for (let i = 0; i < n; i++) {
      const phi = prand() * Math.PI * 2;
      const theta = prand() * Math.PI * 0.58;
      const c = new THREE.Mesh(new THREE.SphereGeometry(scalpR * size, 12, 10), mat);
      c.position.set(
        Math.sin(theta) * Math.cos(phi) * scalpR * 0.92,
        skullY + Math.cos(theta) * scalpR * 0.9,
        Math.sin(theta) * Math.sin(phi) * scalpR * 0.92
      );
      g.add(c);
    }
  };

  switch (style) {
    case "buzz":
      shell();
      break;
    case "short":
      shell();
      backMass(0.35);
      hairline(0.7);
      break;
    case "medium":
      shell();
      backMass(0.65);
      hairline(1);
      fall(longFrac);
      break;
    case "long":
      shell();
      backMass(longFrac);
      hairline(0.9);
      fall(longFrac);
      break;
    case "curly":
    case "ponytail": {
      const dense = texture === "coily" ? 1.3 : texture === "curly" ? 1 : 0.85;
      shell();
      curly(Math.round(30 * dense), 0.3);
      curly(Math.round(18 * dense), 0.2);
      hairline(0.8);
      if (style === "ponytail") {
        const tail = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.24, r * 1.5, 6, 12), mat);
        tail.position.set(0, crown + r * 0.45, -r * 0.28);
        tail.rotation.x = -0.5;
        g.add(tail);
      }
      break;
    }
    default:
      shell();
      backMass(0.4);
  }

  return g;
}

/* ---- top-level builder ----
   buildAvatarFrom builds the full avatar on an ALREADY-parsed base root
   (shared by buildAvatar and the Node test-suite, which cannot fetch or
   create a DOM). buildAvatar = parse via the network loader + build. */
export function buildAvatarFrom(
  baseRoot: THREE.Group,
  profile: AvatarProfile
): {
  root: THREE.Group;
  body: THREE.SkinnedMesh;
  fit: FitSheet;
  config: AvatarModelConfig;
} {
  const config = avatarModelFor(profile);
  const root = baseRoot;
  const body = reBindSkeleton(root);
  body.name = "body";
  applyProfile(body, config);
  poseArmsNeutral(body);
  root.updateMatrixWorld(true);

  /* fit is measured on the posed, un-scaled body so every value lives in
     the model's own local frame (the height scale is applied afterwards to
     the whole root — garments + avatar — together). */
  const fit = computeFit(body);
  root.scale.setScalar(config.heightScale);
  root.children
    .filter((c) => c.name === "eyes" || c.name === "hair")
    .forEach((c) => root.remove(c));
  const eyes = buildEyes(fit);
  eyes.name = "eyes";
  root.add(eyes);
  const hair = buildHair(fit, config);
  hair.name = "hair";
  root.add(hair);

  root.updateMatrixWorld(true);
  return { root, body, fit, config };
}

export async function buildAvatar(profile: AvatarProfile): Promise<{
  root: THREE.Group;
  body: THREE.SkinnedMesh;
  fit: FitSheet;
  config: AvatarModelConfig;
}> {
  return buildAvatarFrom(await cloneAvatarBase(), profile);
}