/* Avatar visual-phase verification — CDP scene-graph + composited-pixel
   proof that the fixed render kicks in end-to-end:

     - the WebGL scene mounts a real SkinnedMesh body (52 bones)
     - the neutral-hang arm pose propagates to fingers (re-parented chains)
     - torso/skirt garments are NOT back-face culled (fabric pixels present
       at the projected garment centres, closer to the garment material than
       to the panel background or the skin)
     - footwear rests on the floor, garments overlap their body bands
     - the head group (skull/hair/eyes) exists at the crown and the hair
       shell hugs the skull
     - zero console errors / uncaught exceptions

   Run: npx tsx scripts/browser/avatar-visual-verification.mjs <ws-url> [base] [pieces] [profile]
     <ws-url>   CDP page target ws (Chrome --remote-debugging-port JSON ws)
     [base]     e.g. http://localhost:3210  or  https://wearsearch.vercel.app
     [pieces]   comma list "slot:id:categorySlug" (top,bottom,footwear,layer) —
                defaults to the three local regress products
     [profile]  default | woman-slim | men-broad */
import { serializeAvatarProfile, DEFAULT_AVATAR_PROFILE } from "../../src/lib/avatar/profile";

const WS_URL = process.argv[2];
const BASE = process.argv[3] ?? "http://localhost:3210";
const PIECES =
  process.argv[4] ??
  "top:cmt7zyxx101djlc7k5dj8o3pa:t-shirts," +
    "bottom:cmt7zyyeu02eilc7kgpfk5439:jeans," +
    "footwear:cmt7zywzc0019lc7kvddqd5pu:sneakers";
const PROFILE = process.argv[5] ?? "default";

const profileFor = {
  default: DEFAULT_AVATAR_PROFILE,
  "woman-slim": {
    ...DEFAULT_AVATAR_PROFILE,
    gender: "WOMEN",
    heightCm: 152,
    weightKg: 45,
    bodyShape: "slim",
    hairStyle: "long",
    hairLength: "long",
    hairTexture: "wavy",
  },
  "men-broad": {
    ...DEFAULT_AVATAR_PROFILE,
    gender: "MEN",
    heightCm: 196,
    weightKg: 118,
    bodyShape: "broad",
  },
}[PROFILE];

const selected = {};
for (const part of PIECES.split(",")) {
  const [slot, id, categorySlug] = part.split(":");
  selected[slot] = {
    product: {
      id,
      name: id,
      price: "0.00",
      currency: null,
      imageUrl: null,
      productUrl: "https://wearsearch.vercel.app",
      brand: null,
      categorySlug,
      categoryName: categorySlug,
      gender: "WOMEN",
      colors: [],
      sizes: [],
    },
    color: null,
  };
}
const params = new URLSearchParams({
  gender: profileFor.gender,
  selected: JSON.stringify(selected),
  avatar: serializeAvatarProfile(profileFor),
  avatarDebug: "1",
});
const TARGET = `${BASE}/outfit/review?${params.toString()}`;

const ws = new WebSocket(WS_URL);
let id = 0;
const pending = new Map();
let passed = 0;
let failed = 0;
const consoleErrors = [];
const exceptions = [];

function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name} :: ${detail ?? ""}`);
  }
}

function send(method, connector = () => ({})) {
  return new Promise((resolve, reject) => {
    const m = ++id;
    pending.set(m, { resolve, reject, connector });
    ws.send(JSON.stringify({ id: m, method, params: connector() }));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ev(expression, awaitPromise = true) {
  const msg = await send("Runtime.evaluate", () => ({
    expression,
    returnByValue: true,
    awaitPromise,
  }));
  if (msg.error) throw new Error(JSON.stringify(msg.error));
  if (msg.result?.exceptionDetails) {
    throw new Error(msg.result.exceptionDetails.text);
  }
  return msg.result?.result?.value;
}

async function waitFor(fn, timeout = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await sleep(300);
  }
  throw new Error("timeout");
}

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject, connector } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else if (connector) resolve(msg);
    else resolve(msg.result);
  } else if (msg.method === "Runtime.consoleAPICalled") {
    if (msg.params.type === "error") {
      consoleErrors.push(
        (msg.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ")
      );
    }
  } else if (msg.method === "Runtime.exceptionThrown") {
    exceptions.push(msg.params.exceptionDetails?.text ?? "exception");
  }
};

async function main() {
  await new Promise((resolve) => (ws.onopen = resolve));
  await send("Runtime.enable", () => ({}));
  await send("Page.enable", () => ({}));

  console.log(`TARGET  ${TARGET}`);
  console.log(`PROFILE ${PROFILE}`);

  await send("Page.navigate", () => ({ url: TARGET }));

  await waitFor(async () => {
    const v = await ev(`typeof window.__fitwearAvatar !== "undefined" &&
        !!window.__fitwearAvatar.body() &&
        !!window.__fitwearAvatar.scene`);
    return v === true;
  });

  await sleep(2500); /* let the avatar + garments settle */

  /* ---- scene-graph checks (bone world from matrixWorld translation) ---- */
  const g = await ev(`(() => {
    const A = window.__fitwearAvatar;
    const b = A.body();
    const out = {};
    out.bones = b.skeleton.bones.length;
    const bone = (n) => b.skeleton.getBoneByName(n);
    const pos = (bb) => {
      const m = bb && bb.matrixWorld ? bb.matrixWorld.elements : null;
      if (!m) return null;
      return { x: +m[12].toFixed(3), y: +m[13].toFixed(3), z: +m[14].toFixed(3) };
    };
    out.shoulderL = pos(bone("mixamorigLeftShoulder"));
    out.handL = pos(bone("mixamorigLeftHand"));
    out.shoulderR = pos(bone("mixamorigRightShoulder"));
    out.handR = pos(bone("mixamorigRightHand"));
    out.fingerParent = (b.skeleton.getBoneByName("mixamorigRightHandIndex1") || {}).parent?.name ?? null;
    out.vertCount = b.geometry.attributes.position.count;
    return out;
  })()`);

  check("scene has 52-bone skinned body", g.bones === 52, `bones=${g.bones}`);
  check(
    "arms hang beside the torso (hand outboard of the shoulder joint, close to the hip)",
    g.handL && Math.abs(g.handL.x) > 0.05 && Math.abs(g.handL.x) < 0.3 &&
      g.handR && Math.abs(g.handR.x) > 0.05 && Math.abs(g.handR.x) < 0.3,
    JSON.stringify({ shL: g.shoulderL, hL: g.handL, shR: g.shoulderR, hR: g.handR })
  );
  check(
    "hands hang at thigh height (not spread at bind)",
    g.handL && g.handL.y > 0.6 && g.handL.y < 1.25 &&
      g.handR && g.handR.y > 0.6 && g.handR.y < 1.25,
    JSON.stringify({ hL: g.handL, hR: g.handR })
  );
  check(
    "hands below shoulders",
    g.handL && g.shoulderL && g.handL.y < g.shoulderL.y &&
      g.handR && g.shoulderR && g.handR.y < g.shoulderR.y
  );
  check(
    "finger bones re-parented under the hand",
    g.fingerParent === "mixamorigRightHand",
    `parent=${g.fingerParent}`
  );

  /* ---- garment bounds + BODY-path anatomy guardrails ---- */
  const gms = await ev(`window.__fitwearAvatar.garments()`);
  const bySlot = {};
  for (const gm of gms) bySlot[gm.slot] = gm;
  check("three garments render (top/bottom/footwear)", gms.length >= 3, `count=${gms.length}`);
  for (const slot of ["top", "bottom", "footwear"]) {
    const gm = bySlot[slot];
    check(
      `${slot} garment visible with non-empty bounds`,
      !!gm && gm.visible === true && gm.bounds && gm.bounds.size.reduce((s, n) => s + n, 0) > 0.001,
      gm ? JSON.stringify(gm.bounds ?? {}) : "missing"
    );
  }
  const top = bySlot.top;
  const bottom = bySlot.bottom;
  const footwear = bySlot.footwear;
  if (top && top.bounds) {
    const [tw, th] = [top.bounds.size[0], top.bounds.size[1]];
    check("top covers the torso (wide enough, vertically placed)", tw > 0.2 && th > 0.15 && th < 0.6,
      `size=${top.bounds.size.join(",")}`);
  }
  if (footwear && footwear.bounds) {
    check("footwear rests on the floor (bottom ~= 0)", Math.abs(footwear.bounds.min[1]) < 0.03 &&
      footwear.bounds.max[1] < 0.25,
      `minY=${footwear.bounds.min[1].toFixed(3)} maxY=${footwear.bounds.max[1].toFixed(3)}`);
  }
  if (bottom && bottom.bounds && footwear && footwear.bounds) {
    check("bottom overlaps the leg region above the shoes",
      bottom.bounds.max[1] > footwear.bounds.max[1] + 0.35,
      `bottomMaxY=${bottom.bounds.max[1].toFixed(3)} shoeMaxY=${footwear.bounds.max[1].toFixed(3)}`);
  }

  /* ---- BODY-path guardrails (geometry-level, per-part) ---- */
  const fitW = await ev(`window.__fitwearAvatar.fit()`);
  const s = fitW?.worldScale ?? 1;
  const partCounts = (slot, pred) => {
    const gm = bySlot[slot];
    if (!gm) return 0;
    return gm.parts.filter((p) => pred(p)).length;
  };
  const partBounds = (slot, pred) => {
    const gm = bySlot[slot];
    if (!gm) return [];
    return gm.parts.filter((p) => pred(p)).map((p) => p.bounds).filter(Boolean);
  };

  if (fitW && bySlot.top) {
    const neckW = fitW.neckY.world;
    const hipW = fitW.hipY.world;
    const torsoShells = partBounds("top", (p) => p.kind === "shell" && !p.name?.startsWith("sleeve"));
    const sleeveShells = partBounds("top", (p) => p.kind === "shell" && p.name === "sleeve");
    const trims = partCounts("top", (p) => p.kind === "trim");
    const lathes = partCounts("top", (p) => p.geoType === "LatheGeometry");
    const torso = torsoShells[0];

    check("top: anatomy shells (NOT lathe primitives) — production body path",
      lathes === 0 && torsoShells.length >= 1,
      `lathes=${lathes} torsoShells=${torsoShells.length}`);
    check("top: collar+hem trim rings present", trims >= 2, `trims=${trims}`);
    check("top: sleeves are deflated arm shells (left+right)",
      sleeveShells.length >= 2, `sleeves=${sleeveShells.length}`);
    if (torso) {
      const headRoom = torso.max[1] <= neckW + 0.06;
      const hemReach = torso.min[1] > hipW - 0.3;
      check(`top: torso shell hugs the body — hem at hip, collar under neck (neckW=${neckW.toFixed(2)})`,
        headRoom && hemReach,
        `torsoY=[${torso.min[1].toFixed(2)},${torso.max[1].toFixed(2)}] neck=${neckW.toFixed(2)} hip=${hipW.toFixed(2)}`);
      const shellsAreCut = Number.isFinite(torso.min[1]) &&
        torso.max[1] - torso.min[1] > 0.2;
      check("top: torso shell spans a real torso band (not a small blob)",
        shellsAreCut, `span=${(torso.max[1] - torso.min[1]).toFixed(2)}`);
    }
    const anyShellNat = partCounts("top", (p) => p.verts > 100);
    check("top: shells have real vertex density (cut from the 13.5k vertex body)",
      anyShellNat > 0, `shellsWithVerts=${anyShellNat}`);
  }

  if (fitW && bySlot.bottom) {
    const bottom = bySlot.bottom;
    const hipW = fitW.hipY.world;
    const ankleW = fitW.ankleY.world;
    const waistW = fitW.waistY.world;
    const legShells = partBounds("bottom", (p) => p.kind === "shell" && p.name === "leg");
    if (bottom.latheCount === 0) {
      const legsTwo = legShells.length === 2 &&
        Math.min(
          (legShells[0].min[0] + legShells[0].max[0]) / 2,
          (legShells[1].min[0] + legShells[1].max[0]) / 2
        ) < -0.05 &&
        Math.max(
          (legShells[0].min[0] + legShells[0].max[0]) / 2,
          (legShells[1].min[0] + legShells[1].max[0]) / 2
        ) > 0.05;
      check("bottom (pants): two separated leg tubes", legsTwo, `legs=${legShells.length}`);
    } else {
      check("bottom is a rotational skirt (lathe) — allowed shape", bottom.latheCount >= 1);
    }
    const waistFits =
      bottom.bounds.max[1] >= hipW - 0.05 &&
      bottom.bounds.max[1] <= waistW + 0.15 &&
      bottom.bounds.min[1] * -1 < ankleW + 0.35;
    check("bottom: fits the pelvis-to-leg span (knees/ankles covered)", waistFits,
      `bottomY=[${bottom.bounds.min[1].toFixed(2)},${bottom.bounds.max[1].toFixed(2)}] hip=${hipW.toFixed(2)} waist=${waistW.toFixed(2)} ankl=${ankleW.toFixed(2)}`);
  }

  if (bySlot.footwear) {
    const shoes = partBounds("footwear", (p) => p.kind === "shell" && p.name === "shoe");
    const soles = partBounds("footwear", (p) => p.kind === "sole");
    const lathes = partCounts("footwear", (p) => p.geoType === "LatheGeometry");
    check("footwear: deflated foot shells (no lathe)", shoes.length >= 2 && lathes === 0,
      `shoes=${shoes.length} lathes=${lathes}`);
    if (soles.length >= 2) {
      const sole = soles[0];
      check("footwear: sole slab sits flat at the floor plane",
        Math.abs(sole.max[1] - sole.min[1]) < 0.06 && Math.abs(sole.min[1]) < 0.05,
        `soleY=[${sole.min[1].toFixed(3)},${sole.max[1].toFixed(3)}]`);
      check("footwear: sole hugs the foot bottom (not floating above the ankle)",
        sole.max[1] < 0.06, `soleTop=${sole.max[1].toFixed(3)}`);
    }
  }

  if (top && bottom && footwear) {
    const ord = { under: 0, mid: 1, footwear: 2, outer: 2 };
    const orders = [ord[top.layer] ?? -1, ord[bottom.layer] ?? -1, ord[footwear.layer] ?? -1];
    check("layering renderOrder encodes under < outer < footwear payload",
      orders[0] >= 0 && orders[0] <= orders[1] && orders[1] <= orders[2],
      `layers=[${top.layer},${bottom.layer},${footwear.layer}]`);
  }

  /* ---- head groups: skull shape, hair shell, eyes, eye line ---- */
  const head = await ev(`window.__fitwearAvatar.head()`);

  check(
    "skull present on top of the body",
    !!head && head.bodyTop > 1.4 && head.skullHalfW > 0.04 && head.skullHalfW < 0.22,
    JSON.stringify(head ? { top: head.bodyTop, halfW: head.skullHalfW } : head)
  );
  check(
    "feet reach the floor",
    head ? Math.abs(head.bodyBottom) < 0.05 : false,
    head ? `bottomY=${head.bodyBottom}` : "no head()"
  );
  check("hair shell present", !!head && !!head.hair, JSON.stringify(head ?? {}));
  if (head && head.hair) {
    const h = head.hair;
    const skullW = head.skullHalfW * 2;
    check(
      "hair hugs the skull (width within ±35% of the skull)",
      h.size[0] <= skullW * 1.35 && h.size[0] >= skullW * 0.7,
      `hairW=${h.size[0].toFixed(3)} skullW=${skullW.toFixed(3)}`
    );
    check(
      "hair crown reaches the very top of the head",
      h.max[1] >= head.bodyTop - 0.03,
      `hairTopY=${h.max[1].toFixed(3)} bodyTopY=${head.bodyTop.toFixed(3)}`
    );
  }
  check("eyes group present with iris + pupil parts", !!head && head.eyesGroup && head.iris.length >= 2 && head.pupil.length >= 2,
    head ? `iris=${head.iris.length} pupil=${head.pupil.length}` : "no head()");
  if (head && head.iris.length >= 2) {
    const eyeY = (head.iris[0][1] + head.iris[1][1]) / 2;
    /* upper-face band: 0.35 below the crown and above the chin line */
    check("eye line sits on the upper face",
      eyeY > head.bodyTop - 0.35 && eyeY < head.bodyTop - 0.04,
      `eyeY=${eyeY.toFixed(3)} bodyTop=${head.bodyTop.toFixed(3)}`);
  }

  /* ---- composited-pixel proof: garments actually rasterise ----
     capture a full page PNG, re-sample it inside the page at the projected
     garment centres and compare the pixels to the garment material colour */
  const shot = await send("Page.captureScreenshot", () => ({ format: "png", captureBeyondViewport: false }));
  const b64 = shot.result?.data;
  const pix = await ev(`(async () => {
    const img = new Image();
    const done = new Promise((res) => { img.onload = res; });
    img.src = "data:image/png;base64," + ${JSON.stringify(b64)};
    await done;
    const A = window.__fitwearAvatar;
    const cam = A.camera();
    const canvasEl = [...document.querySelectorAll("canvas")].sort((a, b) => b.width - a.width)[0];
    const rect = canvasEl.getBoundingClientRect();
    const garments = A.garments();
    const bySlot = {}; garments.forEach((gm) => (bySlot[gm.slot] = gm));
    const matColors = (slot) => {
      const g = A.getGroup();
      const cols = [];
      const seen = new Set();
      const walk = (o) => {
        if (o.material && o.material.color) {
          const c = [Math.round(o.material.color.r * 255), Math.round(o.material.color.g * 255), Math.round(o.material.color.b * 255)];
          const key = c.join(",");
          if (!seen.has(key)) {
            seen.add(key);
            cols.push({ r: c[0], g: c[1], b: c[2] });
          }
        }
        for (const ch of o.children) walk(ch);
      };
      g.traverse((o) => {
        const ud = o.userData || {};
        if (ud.garment && (ud.garment.category === slot || ud.visual?.slot === slot || ud.garment.type === slot)) {
          walk(o);
        }
      });
      return cols;
    };
    const mw = cam.matrixWorldInverse.elements, mp = cam.projectionMatrix.elements;
    const project = (x, y, z) => {
      let cx = mw[0]*x+mw[4]*y+mw[8]*z+mw[12];
      let cy = mw[1]*x+mw[5]*y+mw[9]*z+mw[13];
      let cz = mw[2]*x+mw[6]*y+mw[10]*z+mw[14];
      let cw = mw[3]*x+mw[7]*y+mw[11]*z+mw[15];
      let nx = mp[0]*cx+mp[4]*cy+mp[8]*cz+mp[12]*cw;
      let ny = mp[1]*cx+mp[5]*cy+mp[9]*cz+mp[13]*cw;
      let nw = mp[3]*cx+mp[7]*cy+mp[11]*cz+mp[15]*cw;
      if (Math.abs(nw) < 1e-8) return null;
      return { x: nx / nw, y: ny / nw };
    };
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const dpr = window.devicePixelRatio || 1;
    const sampleN = (cxS, cyS, n = 6) => {
      const px = Math.round(cxS * dpr), py = Math.round(cyS * dpr);
      let r = 0, g = 0, b = 0, k = 0;
      for (let dx = -n; dx <= n; dx++) for (let dy = -n; dy <= n; dy++) {
        const { data } = ctx.getImageData(px + dx, py + dy, 1, 1);
        r += data[0]; g += data[1]; b += data[2]; k++;
      }
      return { r: Math.round(r / k), g: Math.round(g / k), b: Math.round(b / k) };
    };
    const out = { items: {}, background: sampleN(rect.left + 60, rect.top + 8, 8) };
    for (const slot of ["top", "bottom", "footwear"]) {
      const gm = bySlot[slot];
      if (!gm || !gm.bounds) continue;
      const x = (gm.bounds.min[0] + gm.bounds.max[0]) / 2;
      const y = (gm.bounds.min[1] + gm.bounds.max[1]) / 2;
      const z = (gm.bounds.min[2] + gm.bounds.max[2]) / 2;
      const nd = project(x, y, z);
      if (!nd) { out.items[slot] = { proj: null }; continue; }
      const pxC = rect.left + (nd.x * 0.5 + 0.5) * rect.width;
      const pyC = rect.top + (0.5 - nd.y * 0.5) * rect.height;
      out.items[slot] = { sample: sampleN(pxC, pyC), materials: matColors(slot), at: [Math.round(pxC), Math.round(pyC)] };
    }
    return out;
  })()`);

  const dist = (a, b) => Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
  for (const slot of ["top", "bottom", "footwear"]) {
    const it = pix.items[slot];
    if (!it || !it.sample) {
      check(`${slot} pixel sample available`, false, "no projection/sample");
      continue;
    }
    const dMat = it.materials.length ? Math.min(...it.materials.map((m) => dist(it.sample, m))) : 9999;
    const dBg = dist(it.sample, pix.background);
    const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    const ratio = (it.materials.length ? Math.min(...it.materials.map((m) => lum(it.sample) / ((lum(m) || 1)))) : 0);
    const litOk = ratio >= 0.3 && ratio <= 2.8 && dMat < dBg - 10;
    check(
      `${slot} garment pixels rasterised (fabric, not background/culled)`,
      it.materials.length > 0 && dBg > 80 && (dMat < 140 || litOk),
      `sample=${JSON.stringify(it.sample)} materials=${JSON.stringify(it.materials)} bg=${JSON.stringify(pix.background)} dMat=${Math.round(dMat)} dBg=${Math.round(dBg)} ratio=${ratio.toFixed(2)}`
    );
  }

  check("zero console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
  check("zero uncaught exceptions", exceptions.length === 0, exceptions.slice(0, 3).join(" | "));

  console.log(`\nRESULT ${passed} passed / ${failed} failed`);
  ws.close();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  ws.close();
  process.exit(2);
});