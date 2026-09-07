/* AvatarScene — the live 3D avatar wearing the reviewed garments.

   A real, interactive three.js scene:
     - the avatar is built DETERMINISTICALLY from an AvatarProfile
       (gender/height/body-shape/skin/hair — visual properties only);
     - garments are generic GarmentVisuals produced by the outfit's
       garment layer, so the scene depends on the smart-data garment
       shape, never on a product source;
     - the SAME profile is reused across garment changes — the person
       stays the same, the clothes swap;
     - desktop: drag to rotate, wheel/pinch to zoom; mobile: one-finger
       rotate + two-finger pinch zoom; Front / Sides / Back view
       presets with smooth damping;
     - WebGL failure or SSR is handled by the caller (2D fallback).

   Level-1 structured rendering: silhouettes + colors from canonical
   product data. It is an approximation for styling, not an exact fit.
   (This is where Level-2 photo-scanned assets / Level-3 AI
   reconstruction plug in later — through GarmentVisual.assetUri, never
   through this component's product knowledge.) */

"use client";

import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useRef,
  type CSSProperties,
} from "react";
import * as THREE from "three";
import type { AvatarProfile } from "@/lib/avatar/profile";
import {
  SKIN_TONE_HEX,
  HAIR_COLOR_HEX,
  avatarDimensionsFor,
} from "@/lib/avatar/profile";
import type { GarmentVisual } from "@/lib/outfit/garment";

export type AvatarSceneHandle = {
  setView: (
    view: "front" | "left" | "right" | "back" | "reset"
  ) => void;
};

type Props = {
  profile: AvatarProfile;
  garments: GarmentVisual[];
  className?: string;
  style?: CSSProperties;
};

/* swapped axis helpers: yaw rotates the camera around the avatar */
type BodyBuild = {
  scale: number;
  hipY: number;
  torsoLen: number;
  torsoCenterY: number;
  neckBaseY: number;
  shoulderY: number;
  headCenterY: number;
  headRadius: number;
  shoulderHalf: number;
  chestRadius: number;
  waistRadius: number;
  hipHalf: number;
  legRadius: number;
  armLen: number;
  armShoulderY: number;
  skin: THREE.Material;
  hair: THREE.Material;
};

function standardMaterial(
  color: string,
  opts: Partial<THREE.MeshStandardMaterialParameters> = {}
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.72,
    metalness: 0.05,
    ...opts,
  });
}

function capsuleMesh(
  radius: number,
  length: number,
  material: THREE.Material
): THREE.Mesh {
  const geo = new THREE.CapsuleGeometry(radius, length, 4, 12);
  const mesh = new THREE.Mesh(geo, material);
  mesh.geometry = geo;
  return mesh;
}

function sphereMesh(
  radius: number,
  material: THREE.Material,
  scales?: [number, number, number]
): THREE.Mesh {
  const geo = new THREE.SphereGeometry(radius, 24, 16);
  const mesh = new THREE.Mesh(geo, material);
  if (scales) mesh.scale.set(...scales);
  return mesh;
}

function cylinderMesh(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  material: THREE.Material,
  radialSegments = 20
): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(
    radiusTop,
    radiusBottom,
    height,
    radialSegments
  );
  return new THREE.Mesh(geo, material);
}

function makeBody(profile: AvatarProfile): BodyBuild {
  const d = avatarDimensionsFor(profile);
  const totalScale = d.scale;
  const hipY = d.legLength;
  const torsoLen = d.torsoLength;
  const neckBaseY = hipY + torsoLen;
  const headCenterY = neckBaseY + d.neckLength + d.headRadius;
  const shoulderY = hipY + torsoLen * 0.72;
  const chestRadius =
    d.chestDepth * 0.42 * d.shapeChest;
  const waistRadius = d.chestDepth * 0.34 * d.shapeWaist;
  const legRadius = d.hipWidth * 0.11 * (profile.gender === "MEN" ? 1 : 0.92);

  const skin = standardMaterial(SKIN_TONE_HEX[profile.skinTone], {
    roughness: 0.6,
  });
  const hair = standardMaterial(HAIR_COLOR_HEX[profile.hairColor], {
    roughness: 0.85,
  });

  return {
    scale: totalScale,
    hipY,
    torsoLen,
    torsoCenterY: hipY + torsoLen * 0.5,
    neckBaseY,
    shoulderY,
    headCenterY,
    headRadius: d.headRadius,
    shoulderHalf: (d.shoulderWidth * d.shapeChest) / 2,
    chestRadius: Math.max(0.07, chestRadius),
    waistRadius: Math.max(0.055, waistRadius),
    hipHalf: (d.hipWidth * d.shapeHip) / 2,
    legRadius: Math.max(0.055, legRadius),
    armLen: d.armLength,
    armShoulderY: shoulderY,
    skin,
    hair,
  };
}

/* ---- body assembly (mannequin + hair) ---- */
function buildBodyMesh(body: BodyBuild, profile: AvatarProfile): THREE.Group {
  const g = new THREE.Group();

  /* pelvis + hips */
  const pelvis = sphereMesh(
    body.hipHalf,
    body.skin,
    [1, 0.82, 0.86]
  );
  pelvis.position.set(0, body.hipY, 0);
  g.add(pelvis);

  /* torso */
  const torso = capsuleMesh(
    body.chestRadius,
    body.torsoLen * 0.9,
    body.skin
  );
  torso.position.set(0, body.torsoCenterY, 0);
  g.add(torso);

  /* shoulders */
  const shoulders = capsuleMesh(
    body.chestRadius * 0.78,
    body.shoulderHalf * 1.7,
    body.skin
  );
  shoulders.rotation.z = Math.PI / 2;
  shoulders.position.set(0, body.shoulderY, 0);
  g.add(shoulders);

  /* neck */
  const neck = cylinderMesh(
    body.headRadius * 0.4,
    body.headRadius * 0.4,
    body.neckBaseY ? 0.09 : 0.09,
    body.skin,
    12
  );
  neck.position.set(0, body.neckBaseY, 0);
  g.add(neck);

  /* head (smooth mannequin head — no uncanny facial detail) */
  const head = sphereMesh(body.headRadius, body.skin);
  head.position.set(0, body.headCenterY, 0);
  g.add(head);

  /* arms + hands */
  for (const side of [-1, 1]) {
    const arm = capsuleMesh(
      body.chestRadius * 0.26,
      body.armLen * 0.9,
      body.skin
    );
    arm.position.set(
      side * body.shoulderHalf,
      body.armShoulderY - body.armLen * 0.45,
      0
    );
    arm.rotation.z = side * 0.08;
    g.add(arm);
    const hand = sphereMesh(body.chestRadius * 0.24, body.skin);
    hand.position.set(
      side * (body.shoulderHalf + 0.02),
      body.armShoulderY - body.armLen * 0.92,
      0.01
    );
    g.add(hand);
  }

  /* legs + feet */
  for (const side of [-1, 1]) {
    const leg = capsuleMesh(
      body.legRadius,
      body.hipY * 0.94,
      body.skin
    );
    leg.position.set(side * body.hipHalf * 0.42, body.hipY / 2, 0);
    g.add(leg);
    const foot = sphereMesh(
      body.legRadius * 1.1,
      body.skin,
      [1.9, 0.6, 1]
    );
    foot.position.set(
      side * body.hipHalf * 0.45,
      body.legRadius * 0.32,
      body.legRadius * 0.9
    );
    g.add(foot);
  }

  addHair(g, body, profile);
  return g;
}

function addHair(
  root: THREE.Group,
  body: BodyBuild,
  profile: AvatarProfile
): void {
  if (profile.hairStyle === "bald") return;
  const r = body.headRadius;

  /* deterministic pseudo-random for hair volume scatter */
  let seed = 7;
  const prand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  if (profile.hairStyle === "curly") {
    const bumps = Math.max(6, Math.round(body.headRadius * 90));
    for (let i = 0; i < bumps; i++) {
      const phi = prand() * Math.PI * 2;
      const theta = prand() * Math.PI * 0.45;
      const ball = sphereMesh(r * 0.34, body.hair);
      ball.position.set(
        Math.sin(theta) * Math.cos(phi) * r * 1.02,
        body.headCenterY + Math.cos(theta) * r * 1.02,
        Math.sin(theta) * Math.sin(phi) * r * 1.02
      );
      root.add(ball);
    }
    return;
  }

  const cap = sphereMesh(r * 1.03, body.hair);
  cap.scale.set(1.02, 1, 1.02);
  cap.position.set(0, body.headCenterY + r * 0.02, 0);
  cap.geometry = new THREE.SphereGeometry(
    r * 1.03,
    24,
    14,
    0,
    Math.PI * 2,
    0,
    Math.PI * 0.62
  );
  root.add(cap);

  /* back / nape volume per style + length */
  const style = profile.hairStyle;
  const length = profile.hairLength;
  let backLen = 0;
  if (style === "medium") backLen = length === "long" ? r * 1.5 : r * 1.0;
  if (style === "long" || style === "ponytail") backLen = length === "long" ? r * 2.1 : r * 1.4;
  if (backLen > 0) {
    const back = capsuleMesh(r * 0.5, backLen, body.hair);
    back.position.set(0, body.headCenterY - r * 0.3 - backLen / 2, r * 0.28);
    back.rotation.x = 0.18;
    root.add(back);
  }
  if (style === "ponytail") {
    const tail = capsuleMesh(r * 0.3, r * 1.5, body.hair);
    tail.position.set(0, body.headCenterY - r * 0.8, r * 0.62);
    tail.rotation.x = -0.5;
    tail.rotation.y = 0.12;
    root.add(tail);
  }
}

/* ---- garments ---- */
const TORSO_TYPES = new Set([
  "tee", "polo", "shirt", "blouse", "knit", "hoodie", "sweatshirt",
  "vest", "jacket", "coat", "blazer", "dress", "jumpsuit", "solid-torso",
]);
const BOTTOM_TYPES = new Set([
  "jeans", "trousers", "shorts", "skirt", "leggings", "solid-legs",
]);

const FIT_GAP: Record<string, number> = {
  slim: 0.02,
  fitted: 0.02,
  regular: 0.05,
  relaxed: 0.09,
  oversized: 0.13,
};

function buildGarment(
  visual: GarmentVisual,
  body: BodyBuild
): THREE.Group | null {
  const g = new THREE.Group();
  const mat = standardMaterial(visual.color?.hex ?? "#b9b4ac");
  const gap = FIT_GAP[visual.fit] ?? 0.05;

  if (TORSO_TYPES.has(visual.type)) {
    const lengthScale = lengthFactor(visual);
    const torsoRadius = body.chestRadius + gap;
    const shirt = capsuleMesh(
      torsoRadius,
      body.torsoLen * 0.88 * lengthScale,
      mat
    );
    shirt.position.set(0, body.torsoCenterY - 0.02, 0);
    g.add(shirt);

    /* sleeves */
    const sleeve = sleeveFactor(visual.sleeve);
    if (sleeve > 0) {
      for (const side of [-1, 1]) {
        const cuff = capsuleMesh(
          body.chestRadius * 0.3 + gap * 0.6,
          body.armLen * 0.62 * sleeve,
          mat
        );
        cuff.position.set(
          side * body.shoulderHalf,
          body.armShoulderY - body.armLen * 0.4 * sleeve,
          0
        );
        g.add(cuff);
      }
    }

    /* collar */
    addCollar(g, visual, body, mat);

    /* long coats / dresses cover the legs a little */
    if (visual.type === "coat" && visual.length === "long") {
      const legH = body.hipY;
      for (const side of [-1, 1]) {
        const skirt = cylinderMesh(
          body.chestRadius + gap,
          body.chestRadius * 1.05 + gap,
          legH * 0.4,
          mat
        );
        skirt.position.set(
          side * body.hipHalf * 0.34,
          body.hipY + legH * 0.2,
          0
        );
        g.add(skirt);
      }
      const hang = cylinderMesh(
        body.hipHalf * 1.05,
        body.hipHalf * 1.15,
        legH * 0.55,
        mat
      );
      hang.position.set(0, body.hipY + legH * 0.24, 0);
      g.add(hang);
    }
  }

  if (BOTTOM_TYPES.has(visual.type)) {
    const legR = body.legRadius + (visual.type === "leggings" ? 0.01 : gap);
    const fullness = visual.type === "shorts" ? 0.5 : 1;
    const legH = body.hipY;
    for (const side of [-1, 1]) {
      const leg = capsuleMesh(legR, body.hipY * 0.9 * fullness, mat);
      leg.position.set(
        side * body.hipHalf * 0.42,
        body.hipY * (fullness === 1 ? 0.48 : 0.26),
        0
      );
      g.add(leg);
    }
    if (visual.type === "skirt" || visual.type === "dress") {
      const skirt = cylinderMesh(
        Math.max(body.hipHalf, body.waistRadius) * 1.1,
        body.hipHalf * 1.25,
        legH * 0.55,
        mat
      );
      skirt.position.set(0, body.hipY + legH * 0.26, 0);
      g.add(skirt);
    }
  }

  /* footwear */
  addFootwear(g, visual, body);

  /* accessories */
  addAccessory(g, visual, body);

  return g;
}

function lengthFactor(visual: GarmentVisual): number {
  switch (visual.length) {
    case "cropped": return 0.72;
    case "short": return 0.8;
    case "long": return 1.12;
    case "ankle": return 1.25;
    case "full": return 1.3;
    default: return 1;
  }
}

function sleeveFactor(sleeve: GarmentVisual["sleeve"]): number {
  switch (sleeve) {
    case "sleeveless": return 0;
    case "cap": return 0.25;
    case "short": return 0.55;
    case "three-quarter": return 0.7;
    case "long": return 1;
    default: return 0.55;
  }
}

function addCollar(
  g: THREE.Group,
  visual: GarmentVisual,
  body: BodyBuild,
  mat: THREE.Material
): void {
  const y = body.neckBaseY - 0.01;
  switch (visual.collar) {
    case "polo":
    case "collar": {
      const band = cylinderMesh(
        body.chestRadius * 0.42,
        body.chestRadius * 0.5,
        0.05,
        mat,
        12
      );
      band.position.set(0, y, 0);
      g.add(band);
      break;
    }
    case "crew":
    case "high":
    case "round":
    case "mock":
    case "boat":
    case "square":
    case "scoop":
    case "halter": {
      const band = cylinderMesh(
        body.chestRadius * 0.4,
        body.chestRadius * 0.46,
        0.04,
        mat,
        12
      );
      band.position.set(0, y, 0);
      g.add(band);
      break;
    }
    default:
      break;
  }
}

function addFootwear(
  g: THREE.Group,
  visual: GarmentVisual,
  body: BodyBuild
): void {
  const mat = standardMaterial(visual.color?.hex ?? "#2c2a27", {
    roughness: 0.5,
  });
  const soleY = body.legRadius * 0.3;
  const type = visual.type;

  for (const side of [-1, 1]) {
    const x = side * body.hipHalf * 0.45;

    if (type === "boots") {
      const shaft = cylinderMesh(
        body.legRadius * 1.1,
        body.legRadius * 1.05,
        body.legRadius * 5,
        mat
      );
      shaft.position.set(x, soleY + body.legRadius * 2.4, 0.05);
      g.add(shaft);
    }

    if (type === "heels") {
      const heel = cylinderMesh(0.035, 0.02, 0.1, mat, 8);
      heel.position.set(x, soleY + 0.02, body.legRadius * 1.5);
      g.add(heel);
    }

    if (type === "sandals") {
      const sole = cylinderMesh(
        0.04,
        0.04,
        body.legRadius * 1.1,
        mat,
        10
      );
      sole.position.set(x, soleY, 0.3);
      g.add(sole);
      const strap = new THREE.TorusGeometry(
        body.legRadius * 0.85,
        0.02,
        8,
        20
      );
      const band = new THREE.Mesh(strap, mat);
      band.position.set(x, soleY + body.legRadius * 1.4, 0.25);
      g.add(band);
      continue;
    }

    if (type === "flats" || type === "loafers") {
      const sole = sphereMesh(body.legRadius * 1.05, mat, [2, 0.5, 1.4]);
      sole.position.set(x, soleY, body.legRadius * 0.85);
      g.add(sole);
      continue;
    }

    /* sneakers / running / formal / generic shoes */
    const sole = sphereMesh(body.legRadius * 1.1, mat, [2.1, 0.55, 1.4]);
    sole.position.set(x, soleY, body.legRadius * 0.85);
    g.add(sole);
    const toecap = sphereMesh(body.legRadius * 0.62, mat, [1.5, 0.8, 1]);
    toecap.position.set(x, soleY + body.legRadius * 0.4, body.legRadius * 1.35);
    g.add(toecap);
  }
}

function addAccessory(
  g: THREE.Group,
  visual: GarmentVisual,
  body: BodyBuild
): void {
  const mat = standardMaterial(visual.color?.hex ?? "#8a8478");
  switch (visual.type) {
    case "belt": {
      const torus = new THREE.TorusGeometry(
        body.waistRadius * 1.12,
        0.02,
        10,
        28
      );
      const m = new THREE.Mesh(torus, mat);
      m.position.set(0, body.hipY + 0.03, 0);
      g.add(m);
      break;
    }
    case "socks": {
      for (const side of [-1, 1]) {
        const sock = cylinderMesh(
          body.legRadius * 1.08,
          body.legRadius * 1.05,
          body.legRadius * 2.2,
          mat,
          10
        );
        sock.position.set(side * body.hipHalf * 0.42, body.legRadius * 1.2, 0);
        g.add(sock);
      }
      break;
    }
    case "headwear": {
      const cap = sphereMesh(
        body.headRadius * 1.06,
        mat,
        [1.02, 0.55, 1.02]
      );
      cap.position.set(0, body.headCenterY + body.headRadius * 0.7, 0);
      g.add(cap);
      break;
    }
    case "glasses": {
      for (const side of [-1, 1]) {
        const lens = new THREE.TorusGeometry(
          body.headRadius * 0.34,
          0.012,
          8,
          18
        );
        const m = new THREE.Mesh(lens, mat);
        m.position.set(
          side * body.headRadius * 0.55,
          body.headCenterY + body.headRadius * 0.18,
          body.headRadius * 0.92
        );
        g.add(m);
      }
      break;
    }
    case "watch": {
      for (const side of [-1, 1]) {
        const band = new THREE.TorusGeometry(
          body.chestRadius * 0.29,
          0.015,
          8,
          16
        );
        const m = new THREE.Mesh(band, mat);
        m.position.set(
          side * (body.shoulderHalf + 0.02),
          body.armShoulderY - body.armLen * 0.8,
          0.02
        );
        g.add(m);
      }
      break;
    }
    case "bag": {
      const bag = sphereMesh(body.hipHalf * 0.5, mat, [1, 0.8, 0.55]);
      bag.position.set(body.hipHalf * 0.95, body.hipY - 0.02, body.waistRadius * 0.5);
      g.add(bag);
      break;
    }
    case "scarf": {
      const torus = new THREE.TorusGeometry(
        body.chestRadius * 0.6,
        0.045,
        10,
        24
      );
      const m = new THREE.Mesh(torus, mat);
      m.position.set(0, body.neckBaseY + 0.02, body.chestRadius * 0.15);
      m.rotation.x = Math.PI / 2 + 0.25;
      g.add(m);
      break;
    }
    case "tie": {
      const tie = cylinderMesh(0.03, 0.02, body.torsoLen * 0.55, mat, 8);
      tie.position.set(0, body.torsoCenterY + body.torsoLen * 0.12, body.chestRadius * 0.7);
      g.add(tie);
      break;
    }
    case "jewelry": {
      const torus = new THREE.TorusGeometry(
        body.chestRadius * 0.52,
        0.014,
        8,
        20
      );
      const m = new THREE.Mesh(torus, mat);
      m.position.set(0, body.neckBaseY + 0.03, 0);
      g.add(m);
      break;
    }
    default:
      break;
  }
}

/* ---- scene setup + controls ---- */
const AvatarScene = memo(
  forwardRef<AvatarSceneHandle, Props>(function AvatarScene(
    { profile, garments, className, style },
    ref
  ) {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const stateRef = useRef<{
      renderer: THREE.WebGLRenderer | null;
      group: THREE.Group | null;
      yaw: number;
      pitch: number;
      dist: number;
      tYaw: number;
      tPitch: number;
      tDist: number;
      raf: number;
      disposed: boolean;
    }>({
      renderer: null,
      group: null,
      yaw: 0,
      pitch: 0,
      dist: 0,
      tYaw: 0,
      tPitch: 0,
      tDist: 0,
      raf: 0,
      disposed: false,
    });

    useImperativeHandle(ref, () => ({
      setView(view) {
        const s = stateRef.current;
        if (view === "front") s.tYaw = 0;
        else if (view === "back") s.tYaw = Math.PI;
        else if (view === "left") s.tYaw = -Math.PI / 2;
        else if (view === "right") s.tYaw = Math.PI / 2;
        else {
          s.tYaw = 0;
          s.tPitch = 0.42;
          s.tDist = 4.4;
        }
      },
    }));

    useEffect(() => {
      const mount = mountRef.current;
      if (!mount) return;
      const state = stateRef.current;

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      mount.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const fov = 38;
      const camera = new THREE.PerspectiveCamera(
        fov,
        mount.clientWidth / Math.max(1, mount.clientHeight),
        0.1,
        100
      );

      /* lights */
      scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d0c4, 0.85));
      const key = new THREE.DirectionalLight(0xffffff, 1.7);
      key.position.set(2.4, 4, 3.4);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0xcdd8ff, 0.55);
      rim.position.set(-2.5, 2.5, -3);
      scene.add(rim);
      const fill = new THREE.DirectionalLight(0xffffff, 0.3);
      fill.position.set(0, 1.5, -4);
      scene.add(fill);

      /* ground disc + soft contact shadow */
      const groundMat = new THREE.MeshStandardMaterial({
        color: 0x292520,
        roughness: 0.95,
      });
      const ground = new THREE.Mesh(
        new THREE.CircleGeometry(2.6, 40),
        groundMat
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = 0.001;
      ground.receiveShadow = true;
      scene.add(ground);
      const shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(2.6, 2.6),
        new THREE.ShadowMaterial({ opacity: 0.32 })
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.004;
      shadow.receiveShadow = true;
      scene.add(shadow);

      const rebuild = () => {
        const body = makeBody(profile);
        const group = buildBodyMesh(body, profile);
        for (const visual of garments) {
          const g = buildGarment(visual, body);
          if (g) group.add(g);
        }
        scene.add(group);
        stateRef.current.group = group;

        /* frame the avatar once */
        const s = stateRef.current;
        s.tDist = 4.2;
        s.dist = 4.2;
        s.tPitch = 0.42;
        s.pitch = 0.42;
        s.tYaw = 0;
        s.yaw = 0;
      };
      rebuild();

      /* ---- interactions ---- */
      const pointers = new Map<number, { x: number; y: number }>();
      let pinchDist = 0;
      const canvas = renderer.domElement;

      const drag = (e: PointerEvent) => {
        const s = stateRef.current;
        if (pointers.size === 2) {
          const pts = [...pointers.values()];
          const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          if (pinchDist > 0) {
            s.tDist = clampDist(s.tDist / (d / pinchDist));
          }
          pinchDist = d;
        } else if (pointers.size === 1) {
          s.tYaw -= e.movementX * 0.008;
          s.tPitch = clampPitch(s.tPitch + e.movementY * 0.006);
        }
      };

      const onPointerDown = (e: PointerEvent) => {
        canvas.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        pinchDist = 0;
      };
      const onPointerMove = (e: PointerEvent) => {
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        drag(e);
      };
      const onPointerUp = (e: PointerEvent) => {
        pointers.delete(e.pointerId);
        pinchDist = 0;
      };
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const s = stateRef.current;
        s.tDist = clampDist(s.tDist + e.deltaY * 0.003);
      };

      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerup", onPointerUp);
      canvas.addEventListener("pointercancel", onPointerUp);
      canvas.addEventListener("wheel", onWheel, { passive: false });

      /* ---- animation ---- */
      const lookAt = new THREE.Vector3(0, 1.02, 0);
      let running = true;
      const tick = () => {
        if (!running) return;
        const s = stateRef.current;
        const k = 0.12;
        s.yaw += (s.tYaw - s.yaw) * k;
        s.pitch += (s.tPitch - s.pitch) * k;
        s.dist += (s.tDist - s.dist) * k;
        camera.position.set(
          lookAt.x + s.dist * Math.sin(s.yaw) * Math.cos(s.pitch),
          lookAt.y + s.dist * Math.sin(s.pitch),
          lookAt.z + s.dist * Math.cos(s.yaw) * Math.cos(s.pitch)
        );
        camera.lookAt(lookAt);
        renderer.render(scene, camera);
        s.raf = requestAnimationFrame(tick);
      };
      state.raf = requestAnimationFrame(tick);

      const onVis = () => {
        if (document.hidden) {
          running = false;
          cancelAnimationFrame(state.raf);
        } else if (!running) {
          running = true;
          state.raf = requestAnimationFrame(tick);
        }
      };
      document.addEventListener("visibilitychange", onVis);

      /* ---- resize ---- */
      const resize = () => {
        const w = mount.clientWidth;
        const h = mount.clientHeight;
        if (w === 0 || h === 0) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(mount);

      return () => {
        running = false;
        document.removeEventListener("visibilitychange", onVis);
        ro.disconnect();
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointercancel", onPointerUp);
        canvas.removeEventListener("wheel", onWheel);
        cancelAnimationFrame(state.raf);
        scene.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.geometry?.dispose?.();
            const m = obj.material;
            if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
            else m?.dispose?.();
          }
        });
        renderer.dispose();
        if (renderer.domElement.parentNode === mount) {
          mount.removeChild(renderer.domElement);
        }
      };
    }, [profile, garments]);

    return (
      <div
        ref={mountRef}
        className={className}
        style={{ touchAction: "none", ...style }}
        aria-label="3D outfit preview"
        role="img"
      />
    );
  })
);
AvatarScene.displayName = "AvatarScene";

function clampDist(d: number): number {
  return Math.min(7, Math.max(2.2, d));
}

function clampPitch(p: number): number {
  return Math.min(1.3, Math.max(-0.15, p));
}

export default AvatarScene;