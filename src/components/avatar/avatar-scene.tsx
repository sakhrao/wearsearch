/* AvatarScene — the live 3D avatar wearing the reviewed garments.

   A real, interactive three.js scene:
     - the avatar is a REAL rigged human mesh + skeleton + morph targets,
       built DETERMINISTICALLY from an AvatarProfile by buildAvatar()
       (gender/height/body-shape/skin/hair — visual properties only);
     - garments are GarmentVisuals rendered by the GarmentSystem
       (buildGarmentVisual) which hugs the ACTUAL measured body of the
       customised avatar — a coat follows the shoulders, jeans follow the
       legs, shoes sit on the feet, a necklace circles the neck;
     - the scene depends on the smart-data garment shape + the Avatar
       system, never on a product source;
     - the SAME profile is reused across garment changes — the person
       stays the same, the clothes swap (live, no page refresh);
     - desktop: drag to rotate, ctrl-wheel/trackpad-pinch to zoom; mobile:
       one-finger rotate + two-finger pinch zoom; Front / Sides / Back
       view presets with smooth damping;
     - WebGL failure or SSR is handled by the caller (2D fallback). */

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
import { buildAvatar } from "@/lib/avatar/human-model";
import type { GarmentVisual } from "@/lib/outfit/garment";
import { buildGarmentVisual } from "@/lib/outfit/garment-assets";

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
  /* called when WebGL cannot be started OR the render loop dies, so
     the caller can switch to the visible 2D panel instead of leaving
     a silently-blank canvas. Also called when the base GLB fails. */
  onFatal?: () => void;
};

function neutralMat(color: number, r: number, m = 0, env = 0.5) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: r,
    metalness: m,
    envMapIntensity: env,
  });
}

const AvatarScene = memo(
  forwardRef<AvatarSceneHandle, Props>(function AvatarScene(
    { profile, garments, className, style, onFatal },
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

      /* Sizing is the classic silent killer: a canvas sized 0 is never
         visible even though everything else works. Measure from the
         bounding rect, keep a sane floor, and re-run the fit on the next
         frame + on every ResizeObserver tick. */
      const measure = (): { w: number; h: number } => {
        const rect = mount.getBoundingClientRect();
        const w = Math.max(rect.width, mount.clientWidth);
        const h = Math.max(rect.height, mount.clientHeight);
        return {
          w: Math.max(240, Math.round(w)),
          h: Math.max(240, Math.round(h)),
        };
      };

      let renderer: THREE.WebGLRenderer;
      let camera: THREE.PerspectiveCamera;
      let scene: THREE.Scene;
      let buildId = 0;

      try {
        renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        mount.appendChild(renderer.domElement);

        scene = new THREE.Scene();
        const fov = 38;
        camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 100);

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
      } catch (err) {
        console.error("avatar scene init failed, showing 2D fallback:", err);
        mount.childNodes.forEach((n) => mount.removeChild(n));
        onFatal?.();
        return;
      }

      /* ---- build the avatar + garments (async: GLB clone) ---- */
      const rebuild = async () => {
        const id = ++buildId;
        /* swap a (mostly) neutral placeholder in so the canvas reads
           "loading someone" instead of blanking */
        const scaleRef = stateRef.current;
        if (scaleRef.group) {
          scene.remove(scaleRef.group);
          disposeGroup(scaleRef.group);
          scaleRef.group = null;
        }
        const holder = new THREE.Group();
        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(0.5, 20, 14),
          neutralMat(0xf2ece2, 0.55)
        );
        sphere.position.set(0, 0.62, 0);
        const cyl = new THREE.Mesh(
          new THREE.CylinderGeometry(0.3, 0.34, 0.62, 20),
          neutralMat(0xe3dcd0, 0.6)
        );
        cyl.position.set(0, 0.24, 0);
        holder.add(cyl, sphere);
        scene.add(holder);

        try {
          const { root, fit } = await buildAvatar(profile);
          /* children of root: body + eyes + hair (already added) */
          const garmentLayer = new THREE.Group();
          garmentLayer.name = "garments";
          for (const visual of garments) {
            const g = buildGarmentVisual(visual, fit);
            if (g) garmentLayer.add(g);
          }
          root.add(garmentLayer);
          root.name = "avatar";

          if (id !== buildId) {
            disposeGroup(root);
            scene.remove(holder);
            disposeGroup(holder);
            return;
          }
          scene.remove(holder);
          disposeGroup(holder);
          scene.add(root);
          stateRef.current.group = root;

          /* frame the avatar once */
          const s = stateRef.current;
          s.tDist = 4.4;
          s.dist = 4.4;
          s.tPitch = 0.42;
          s.pitch = 0.42;
          s.tYaw = 0;
          s.yaw = 0;
        } catch (err) {
          console.error("avatar build failed, showing 2D fallback:", err);
          scene.remove(holder);
          disposeGroup(holder);
          if (id === buildId) onFatal?.();
        }
      };
      void rebuild();

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
        /* Only intercept ctrlKey wheel events (trackpad pinch and
           Ctrl+scroll) for zoom. A plain scroll over the avatar must
           scroll the PAGE — trapping it is what made the review page
           feel scroll-locked. */
        if (!e.ctrlKey) return;
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
      let loopFailures = 0;
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
        try {
          renderer.render(scene, camera);
        } catch (err) {
          /* a GPU/driver failure mid-loop must not leave a silent
             blank canvas — surface it as a visible fallback instead */
          loopFailures += 1;
          if (loopFailures >= 3) {
            console.error(
              "avatar scene render loop failed, showing 2D fallback:",
              err
            );
            running = false;
            cancelAnimationFrame(state.raf);
            onFatal?.();
            return;
          }
        }
        state.raf = requestAnimationFrame(tick);
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
        const { w, h } = measure();
        renderer.setSize(w, h, true);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(mount);
      const rafId = requestAnimationFrame(() => resize());

      return () => {
        running = false;
        buildId += 1;
        cancelAnimationFrame(rafId);
        document.removeEventListener("visibilitychange", onVis);
        ro.disconnect();
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointercancel", onPointerUp);
        canvas.removeEventListener("wheel", onWheel);
        cancelAnimationFrame(state.raf);
        if (state.group) {
          disposeGroup(state.group);
          state.group = null;
        }
        scene?.traverse((obj) => {
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
    }, [profile, garments, onFatal]);

    return (
      <div
        ref={mountRef}
        className={className}
        style={{ touchAction: "pan-y", ...style }}
        aria-label="3D outfit preview"
        role="img"
      />
    );
  })
);
AvatarScene.displayName = "AvatarScene";

/* dispose a built avatar root without double-disposing shared geometry:
   the base GLB geometry is CLONED per avatar (cloneAvatarBase), so every
   mesh owns its geometry and materials. */
function disposeGroup(group: THREE.Object3D): void {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry?.dispose?.();
      const m = obj.material;
      if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
      else m?.dispose?.();
    }
  });
}

function clampDist(d: number): number {
  return Math.min(7, Math.max(2.2, d));
}

function clampPitch(p: number): number {
  return Math.min(1.3, Math.max(-0.15, p));
}

export default AvatarScene;