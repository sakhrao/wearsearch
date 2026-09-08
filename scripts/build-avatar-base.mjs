// Builds public/models/avatar/base.glb from the vendored CC0 MakeHuman/MPFB2
// base data (public/models/avatar/source, licensed CC0 - see source/LICENSE.md).
//
// Inputs (all CC0):
//   - source/3dobjs/base.obj            hm08 base mesh: Y-up, decimeters,
//                                       origin at body centre, faces +Z,
//                                       `body` group + helper/joint-* groups.
//   - source/rigs/standard/rig.mixamo.json   52-bone mixamorig:* rig; each bone
//                                       head/tail via MEAN (vertex pairs) or
//                                       CUBE (centroid of a joint-* group).
//   - source/rigs/standard/weights.mixamo.json  sparse per-bone vertex weights.
//   - source/targets/*.target.gz        sparse morph deltas (idx dx dy dz, OBJ
//                                       units). Composed into named glTF morphs.
//
// Output: a single rigged, morphable, skinned GLB (Y-up meters, feet on the
// ground, facing +Z) + avatar-manifest.json describing its morphs.
//
// Run: node scripts/build-avatar-base.mjs

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// three's GLTFExporter needs Blob + FileReader even for raw binary output;
// Node ships Blob but not FileReader.
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = buf;
        if (typeof this.onloadend === 'function') this.onloadend();
      });
    }
  };
}
const SRC = resolve(ROOT, 'public/models/avatar/source');
const OUT_DIR = resolve(ROOT, 'public/models/avatar');
const OUT_GLB = resolve(OUT_DIR, 'base.glb');
const OUT_MANIFEST = resolve(OUT_DIR, 'avatar-manifest.json');

const DM = 0.1; // MakeHuman decimeters -> meters

/* ------------------------------------------------------------------ *
 * 1. Parse base.obj (positions, uv, per-face group labels)
 * ------------------------------------------------------------------ */
function parseObj(text) {
  const pos = [];      // global: [[x,y,z], ...]
  const uv = [];
  const groups = {};   // group name -> global vertex index set (for joint cubes)
  const groupOrder = [];
  let cur = 'body';    // faces before any `g` line belong to the body
  const faces = [];    // { group, verts: [globalIndex...] }

  const ensureGroup = (name) => {
    if (!groups[name]) { groups[name] = new Set(); groupOrder.push(name); }
  };
  ensureGroup(cur);

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const [tag, ...rest] = line.split(/\s+/);
    if (tag === 'v') {
      pos.push([parseFloat(rest[0]), parseFloat(rest[1]), parseFloat(rest[2])]);
    } else if (tag === 'vt') {
      uv.push([parseFloat(rest[0]), parseFloat(rest[1])]);
    } else if (tag === 'g') {
      cur = rest.join(' ') || 'body';
      ensureGroup(cur);
    } else if (tag === 'o') {
      cur = rest.join(' ') || cur;
      ensureGroup(cur);
    } else if (tag === 'f') {
      const verts = [];
      for (const corner of rest) {
        const vIdx = parseInt(corner.split('/')[0], 10);
        verts.push(vIdx > 0 ? vIdx - 1 : pos.length + vIdx);
      }
      for (const v of verts) groups[cur].add(v);
      faces.push({ group: cur, verts });
    }
  }
  return { pos, uv, groups, groupOrder, faces };
}

/* ------------------------------------------------------------------ *
 * 2. Morph target readers
 * ------------------------------------------------------------------ */
function readTarget(rel) {
  const buf = gunzipSync(readFileSync(resolve(SRC, rel)));
  const deltas = new Map(); // global vertex index -> [dx,dy,dz]
  const text = buf.toString('utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 4) continue;
    deltas.set(
      parseInt(parts[0], 10),
      [parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])],
    );
  }
  return deltas;
}

// Recipe: list of [relative target path, scale]. Composes a full delta array.
const T = (rel, scale = 1) => ({ rel, scale });
function composeMorph(recipe, vertCount) {
  const out = new Float32Array(vertCount * 3);
  for (const { rel, scale } of recipe) {
    const deltas = readTarget(`targets/${rel}.target.gz`);
    for (const [vi, d] of deltas) {
      const o = vi * 3;
      out[o] += d[0] * scale * DM;
      out[o + 1] += d[1] * scale * DM;
      out[o + 2] += d[2] * scale * DM;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 3. Curated morph set  (name -> recipe)
 * ------------------------------------------------------------------ */
const MACRO = 'macrodetails';
const side = (a, b) => [a, b];
const MORPHS = [
  ['weightUp', [T(`${MACRO}/universal-male-young-averagemuscle-maxweight`)]],
  ['weightDown', [T(`${MACRO}/universal-male-young-averagemuscle-minweight`)]],
  ['muscleUp', [T(`${MACRO}/universal-male-young-maxmuscle-averageweight`)]],
  ['muscleDown', [T(`${MACRO}/universal-male-young-minmuscle-averageweight`)]],
  ['bustUp', [T('torso/measure-bust-circ-incr')]],
  ['bustDown', [T('torso/measure-bust-circ-decr')]],
  ['waistUp', [T('torso/measure-waist-circ-incr')]],
  ['waistDown', [T('torso/measure-waist-circ-decr')]],
  ['hipsUp', [T('torso/measure-hips-circ-incr'), T('hip/hip-scale-horiz-incr', 0.8)]],
  ['hipsDown', [T('torso/measure-hips-circ-decr'), T('hip/hip-scale-horiz-decr', 0.8)]],
  ['shouldersUp', [T('torso/measure-shoulder-dist-incr')]],
  ['shouldersDown', [T('torso/measure-shoulder-dist-decr')]],
  ['torsoWidthUp', [T('torso/torso-scale-horiz-incr')]],
  ['torsoWidthDown', [T('torso/torso-scale-horiz-decr')]],
  ['torsoDepthUp', [T('torso/torso-scale-depth-incr')]],
  ['torsoDepthDown', [T('torso/torso-scale-depth-decr')]],
  ['stomachToned', [T('stomach/stomach-tone-incr')]],
  ['stomachSoft', [T('stomach/stomach-tone-decr'), T('stomach/stomach-navel-out', 1.5)]],
  ['glutesUp', [T('buttocks/buttocks-volume-incr')]],
  ['glutesDown', [T('buttocks/buttocks-volume-decr')]],
  ['legsUp', [...side('l', 'r').flatMap((s) => [
    T(`legs/${s}-upperleg-fat-incr`),
    T(`legs/${s}-lowerleg-fat-incr`),
    T(`legs/${s}-upperleg-muscle-incr`, 0.4),
    T(`legs/${s}-lowerleg-muscle-incr`, 0.4),
  ])]],
  ['legsDown', [...side('l', 'r').flatMap((s) => [
    T(`legs/${s}-upperleg-fat-decr`),
    T(`legs/${s}-lowerleg-fat-decr`),
  ])]],
  ['armsUp', [...side('l', 'r').flatMap((s) => [
    T(`arms/${s}-upperarm-fat-incr`),
    T(`arms/${s}-lowerarm-fat-incr`),
    T(`arms/${s}-upperarm-muscle-incr`, 0.4),
  ])]],
  ['armsDown', [...side('l', 'r').flatMap((s) => [
    T(`arms/${s}-upperarm-fat-decr`),
    T(`arms/${s}-lowerarm-fat-decr`),
  ])]],
  ['neckUp', [T('neck/neck-scale-horiz-incr')]],
  ['neckDown', [T('neck/neck-scale-horiz-decr')]],
  ['jawUp', [T('chin/chin-width-incr')]],
  ['jawDown', [T('chin/chin-width-decr')]],

  // Gender composites over the androgynous hm08 base (female / male full-strength).
  ['genderToFemale', [
    T('torso/measure-bust-circ-incr', 1.0),
    T('hip/hip-scale-horiz-incr', 1.4),
    T('torso/measure-waist-circ-decr', 1.5),
    T('torso/measure-shoulder-dist-decr', 0.9),
    T('neck/neck-scale-horiz-decr', 0.8),
    T('buttocks/buttocks-volume-incr', 1.1),
    T('chin/chin-width-decr', 0.7),
  ]],
  ['genderToMale', [
    T('torso/torso-vshape-incr', 1.0),
    T('torso/measure-shoulder-dist-incr', 1.3),
    T('torso/measure-waist-circ-incr', 1.0),
    T('neck/neck-scale-horiz-incr', 1.1),
    T('chin/chin-width-incr', 1.0),
    T('torso/torso-muscle-pectoral-incr', 0.9),
    T('torso/torso-scale-horiz-incr', 0.8),
  ]],
];

/* ------------------------------------------------------------------ *
 * 4. Build the body geometry
 * ------------------------------------------------------------------ */
const obj = parseObj(readFileSync(resolve(SRC, '3dobjs/base.obj'), 'utf8'));

// Body faces only. Map global vertex index -> local index, local -> global.
const localToGlobal = [];
const globalToLocal = new Map();
function localIndex(gi) {
  let li = globalToLocal.get(gi);
  if (li === undefined) { li = localToGlobal.length; localToGlobal.push(gi); globalToLocal.set(gi, li); }
  return li;
}

const bodyFaces = obj.faces.filter((f) => f.group === 'body');
const positions = [];
const uvs = [];
const indices = [];
for (const f of bodyFaces) {
  const li = f.verts.map(localIndex);
  for (let i = 1; i < li.length - 1; i++) indices.push(li[0], li[i], li[i + 1]);
}
for (const gi of localToGlobal) {
  const p = obj.pos[gi];
  positions.push(p[0] * DM, p[1] * DM, p[2] * DM);
  if (obj.uv[gi]) uvs.push(obj.uv[gi][0], 1 - obj.uv[gi][1]);
  else { uvs.push(0, 0); }
}

const geo = new THREE.BufferGeometry();
geo.setIndex(indices);
geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
geo.computeVertexNormals();

// Shift so feet land at y = 0 (min Y over the whole mesh, incl. helper verts).
let minY = Infinity;
for (let i = 0; i < obj.pos.length; i++) minY = Math.min(minY, obj.pos[i][1]);
const SHIFT = -minY * DM;
{
  const p = geo.attributes.position.array;
  for (let i = 1; i < p.length; i += 3) p[i] += SHIFT;
  geo.attributes.position.needsUpdate = true;
}

/* ------------------------------------------------------------------ *
 * 5. Skeleton from rig.mixamo.json
 * ------------------------------------------------------------------ */
const rig = JSON.parse(readFileSync(resolve(SRC, 'rigs/standard/rig.mixamo.json'), 'utf8'));
const bonesDef = rig.bones;

function groupCentroid(name) {
  const g = obj.groups[name];
  if (!g || g.size === 0) return null;
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (const gi of g) {
    const p = obj.pos[gi];
    sx += p[0]; sy += p[1]; sz += p[2]; n++;
  }
  return [sx / n, sy / n, sz / n];
}
function meanOf(indices) {
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (const vi of indices) {
    const p = obj.pos[vi];
    sx += p[0]; sy += p[1]; sz += p[2]; n++;
  }
  return n ? [sx / n, sy / n, sz / n] : null;
}
function posOf(def) {
  if (!def) return null;
  if (def.strategy === 'CUBE') return groupCentroid(def.cube_name);
  if (def.strategy === 'MEAN') return meanOf(def.vertex_indices || []);
  return def.default_position ? [...def.default_position] : null;
}

// Compute heads/tails in meters (shifted).
const headOf = new Map();
const tailOf = new Map();
const parents = new Map();
for (const [name, def] of Object.entries(bonesDef)) {
  const head = posOf(def.head);
  if (head) { head[0] *= DM; head[1] = head[1] * DM + SHIFT; head[2] *= DM; }
  const tail = def.tail ? posOf(def.tail) : null;
  if (tail) { tail[0] *= DM; tail[1] = tail[1] * DM + SHIFT; tail[2] *= DM; }
  headOf.set(name, head);
  tailOf.set(name, tail);
  parents.set(name, def.parent || null);
}

// Topological order: parents before children.
const order = [];
const done = new Set();
function addBone(name) {
  if (done.has(name)) return;
  const p = parents.get(name);
  if (p && !done.has(p)) addBone(p);
  for (let i = order.length - 1; i >= 0; i--) {
    if (order[i] === name) return;
  }
  done.add(name);
  order.push(name);
}
for (const name of Object.keys(bonesDef)) addBone(name);

const boneByName = new Map();
const bones = [];
const boneIndex = new Map();
for (const name of order) {
  const bone = new THREE.Bone();
  bone.name = name;
  const head = headOf.get(name);
  bone.position.set(head ? head[0] : 0, head ? head[1] : 0, head ? head[2] : 0);

  let tail = tailOf.get(name);
  if (!tail) {
    // Fall back to the first child's head (classic chain), else default+0.2Y.
    const children = Object.keys(bonesDef).filter((n) => parents.get(n) === name);
    const childHead = children.map((c) => headOf.get(c)).find(Boolean);
    tail = childHead || [bone.position.x, bone.position.y + 0.2, bone.position.z];
  }
  const dir = new THREE.Vector3(tail[0] - head[0], tail[1] - head[1], tail[2] - head[2]);
  if (dir.lengthSq() > 1e-8) {
    bone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  }
  bone.updateMatrix();
  boneByName.set(name, bone);
  bones.push(bone);
}
// Set parent AFTER all exist.
for (const name of order) {
  const p = parents.get(name);
  if (p && boneByName.has(p)) boneByName.get(p).add(boneByName.get(name));
}

/* ------------------------------------------------------------------ *
 * 6. Skin weights (sparse per-bone [[vertexIndex, weight], ...])
 * ------------------------------------------------------------------ */
const weightsJson = JSON.parse(readFileSync(resolve(SRC, 'rigs/standard/weights.mixamo.json'), 'utf8'));
const vCount = localToGlobal.length;
const perVertex = new Array(vCount).fill(0).map(() => []);
for (const [bname, list] of Object.entries(weightsJson.weights)) {
  const bi = order.indexOf(bname);
  if (bi < 0) continue;
  for (const [gi, w] of list) {
    const li = globalToLocal.get(gi);
    if (li === undefined || w <= 0) continue;
    perVertex[li].push([bi, w]);
  }
}
const skinIndex = new Uint16Array(vCount * 4);
const skinWeight = new Float32Array(vCount * 4);
for (let li = 0; li < vCount; li++) {
  const w = perVertex[li];
  w.sort((a, b) => b[1] - a[1]);
  let sum = 0;
  for (let k = 0; k < Math.min(4, w.length); k++) sum += w[k][1];
  if (sum <= 0) skinWeight[li * 4] = 1; // fully unskinned -> stick to bone 0
  else for (let k = 0; k < Math.min(4, w.length); k++) {
    skinIndex[li * 4 + k] = w[k][0];
    skinWeight[li * 4 + k] = w[k][1] / sum;
  }
}
geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));

/* ------------------------------------------------------------------ *
 * 7. Morph targets (deltas, relative)
 * ------------------------------------------------------------------ */
const morphAttrs = [];
for (const [name, recipe] of MORPHS) {
  const attr = new THREE.Float32BufferAttribute(composeMorph(recipe, vCount), 3);
  attr.name = name;
  morphAttrs.push(attr);
}
geo.morphAttributes.position = morphAttrs;
geo.morphTargetsRelative = true;

/* ------------------------------------------------------------------ *
 * 8. Assemble + export
 * ------------------------------------------------------------------ */
const root = new THREE.Group();
root.name = 'avatar-human';
for (const b of bones) root.add(b);

const material = new THREE.MeshStandardMaterial({
  color: 0xc9a17f,
  roughness: 0.78,
  metalness: 0.0,
  name: 'skin',
});
const mesh = new THREE.SkinnedMesh(geo, material);
mesh.name = 'body';
mesh.castShadow = true;
mesh.receiveShadow = true;
const skeleton = new THREE.Skeleton(bones);
mesh.bind(skeleton);
root.add(mesh);

root.updateMatrixWorld(true);

const exporter = new GLTFExporter();
exporter.parse(
  root,
  (result) => {
    const buf = Buffer.from(result);
    writeFileSync(OUT_GLB, buf);
    const mb = (buf.length / 1048576).toFixed(2);
    console.log(`wrote ${OUT_GLB} (${mb} MB)`);

    const manifest = {
      generatedAt: new Date().toISOString(),
      source: 'public/models/avatar/source (MakeHuman/MPFB2 hm08, CC0)',
      license: 'CC0 1.0 Universal (see source/LICENSE.md)',
      scene: {
        units: 'meters', up: '+Y', facing: '+Z', origin: 'feet on ground',
        vertexCount: vCount,
        triangleCount: indices.length / 3,
        boneCount: bones.length,
        boneNames: order,
      },
      morphs: MORPHS.map(([name, recipe]) => ({
        name,
        type: name.endsWith('Up') || name.endsWith('Down') || name === 'genderToMale' || name === 'genderToFemale' || name.endsWith('Soft') || name.endsWith('Toned') ? 'body' : 'body',
        recipe: recipe.map((r) => r.rel),
      })),
    };
    writeFileSync(OUT_MANIFEST, JSON.stringify(manifest, null, 2));
    console.log(`wrote ${OUT_MANIFEST}`);
    console.log(`morphs: ${MORPHS.length}, verts: ${vCount}, tris: ${indices.length / 3}, bones: ${bones.length}`);
  },
  (err) => { console.error('GLTFExport failed:', err); process.exit(1); },
  { binary: true, onlyVisible: false },
);