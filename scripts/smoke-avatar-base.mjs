// Structural smoke test for public/models/avatar/base.glb — verifies the baked
// asset (skinned, morphable, sane proportions, morphs actually deform) without
// a DOM. Runner: node scripts/smoke-avatar-base.mjs
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buf = readFileSync(resolve(ROOT, 'public/models/avatar/base.glb'));

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
  console.log(`${cond ? 'ok ' : 'FAIL'} ${msg}`);
};
const rng = (arr, stride, k) => {
  let lo = Infinity, hi = -Infinity;
  for (let i = k; i < arr.length; i += stride) {
    const v = arr[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
};

const loader = new GLTFLoader();
loader.parse(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  '',
  (gltf) => {
    let body;
    gltf.scene.traverse((o) => { if (o.isMesh && o.name === 'body') body = o; });

    check(!!body, 'scene contains "body" mesh');
    if (!body) return;

    const skinned = body.isSkinnedMesh;
    check(skinned, 'body is a SkinnedMesh');
    check(body.skeleton && body.skeleton.bones.length === 52, `skeleton bones = ${body.skeleton?.bones.length}`);

    const pos = body.geometry.attributes.position.array;
    const [minX, maxX] = rng(pos, 3, 0);
    const [minY, maxY] = rng(pos, 3, 1);
    const [minZ, maxZ] = rng(pos, 3, 2);
    const height = maxY - minY;

    check(minY < 0.05 && minY > -0.05, `feet on ground (min.y = ${minY.toFixed(3)})`);
    check(height > 1.55 && height < 1.85, `human scale 1.7m (height = ${height.toFixed(2)})`);
    check(Math.abs(maxX) < 0.6 && Math.abs(minX) < 0.6, `about ±0.5m wide (x ${minX.toFixed(2)}..${maxX.toFixed(2)})`);
    check(minZ > -0.2 && maxZ > 0, `facing +Z (z ${minZ.toFixed(2)}..${maxZ.toFixed(2)})`);

    // Skin weights: every vertex should reach at least one bone.
    const skinIndex = body.geometry.attributes.skinIndex.array;
    const skinWeight = body.geometry.attributes.skinWeight.array;
    check(skinIndex.length / 4 === body.geometry.attributes.position.count, 'skinIndex per-vertex');
    // Weight sum of the top-4 slots should be ≈1.
    let badWeights = 0;
    for (let i = 0; i < skinWeight.length; i += 4) {
      const s = skinWeight[i] + skinWeight[i + 1] + skinWeight[i + 2] + skinWeight[i + 3];
      if (s < 0.9 || s > 1.1) badWeights++;
    }
    check(badWeights === 0, `skin weights normalized (bad = ${badWeights})`);

    const names = body.morphTargetDictionary ? Object.keys(body.morphTargetDictionary) : [];
    const EXPECTED = [
      'weightUp', 'weightDown', 'muscleUp', 'muscleDown', 'bustUp', 'bustDown',
      'waistUp', 'waistDown', 'hipsUp', 'hipsDown', 'shouldersUp', 'shouldersDown',
      'torsoWidthUp', 'torsoWidthDown', 'torsoDepthUp', 'torsoDepthDown',
      'stomachToned', 'stomachSoft', 'glutesUp', 'glutesDown', 'legsUp', 'legsDown',
      'armsUp', 'armsDown', 'neckUp', 'neckDown', 'jawUp', 'jawDown',
      'genderToFemale', 'genderToMale',
    ];
    const missing = EXPECTED.filter((n) => !names.includes(n));
    check(missing.length === 0, `expected morphs present (missing: ${missing.join(', ') || 'none'})`);

    // Each morph must actually deform a meaningful number of vertices.
    let emptyMorphs = 0;
    for (const n of names) {
      const m = body.geometry.morphAttributes.position[body.morphTargetDictionary[n]].array;
      let nonZero = 0;
      for (let i = 0; i < m.length; i += 3) {
        if (m[i] !== 0 || m[i + 1] !== 0 || m[i + 2] !== 0) nonZero++;
      }
      if (nonZero < 50) { emptyMorphs++; console.log(`   (${n} only moves ${nonZero} verts)`); }
    }
    check(emptyMorphs === 0, `every morph deforms ≥50 vertices (empty = ${emptyMorphs})`);

    if (failures.length) {
      console.error('\nFAILURES:\n- ' + failures.join('\n- '));
      process.exit(1);
    }
    console.log('\navatar-base.glb structural smoke test OK');
  },
  (e) => { console.error('GLB parse failed:', e); process.exit(1); },
);