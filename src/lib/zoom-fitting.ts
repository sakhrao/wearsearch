/* Content-aware zoom fitting.

   Shared by the browser ProductCardImage component and the diagnostic
   script (scripts/validate-content.mts) so both use identical logic.

   Input is a single-channel RGBA buffer representing the image rendered
   with object-contain into a SQUARE canvas (W == H == size). The letterbox
   area is transparent (alpha < OPACITY). The image's own background is a
   normal opaque light grey/white.

   Policy (CONSERVATIVE):
   - Only zoom when the detected product is strictly INSIDE the frame (real
     whitespace on all sides). If the product touches the frame border, or
     detection is uncertain, fall back to scale 1 (never zoom -> never crop).
   - The zoom scales about the product's actual center (NOT the frame
     center), so off-center products are kept inside too.
   - The scale is bounded so the detected content stays inside the frame in
     both axes, with a safety margin that also absorbs modest detection
     under-measurement.
   - White-on-white is handled by estimating the background from the image's
     own borders and by adding saturation + edge(gradient) signals, so a
     light product is still localised rather than mistaken for empty space.
*/

export const CANVAS_SIZE = 96;
const OPACITY = 200; // below this -> letterbox (not image content)
const COLOR_T = 90; // Manhattan RGB distance from background to count as content (image scaled 0..255)
const EDGE_T = 70; // 4-neighbour channel-delta magnitude to count as content
const SAT_T = 70; // saturation (max-min per pixel) OR'd into the color signal
const INSIDE_FRAC = 0.035; // require >= this fraction clear of each frame edge to allow zoom
const MIN_HALF_FRAC = 0.05; // require the smaller content half-dim >= this fraction of the frame (real object, not noise)
const SAFETY = 0.85; // multiply the no-crop bound so detection under-measurement cannot crop
const MAX_SCALE = 1.8;

export interface ZoomFit {
  shouldZoom: boolean;
  scale: number;
  originX: number; // transform-origin x as FRACTION of frame (0..1)
  originY: number;
  contentW: number; // detected content width as fraction of frame
  contentH: number; // detected content height as fraction of frame
  centerXF: number; // content center x as fraction (0..1)
  centerYF: number;
  inFrame: boolean; // transformed content bbox fully inside the frame
}

export function computeZoomFit(
  rgba: Uint8ClampedArray,
  size: number
): ZoomFit {
  const N = size;
  const pick = (x: number, y: number) => (y * N + x) * 4;

  /* 1) Estimate image background from the image's own border ring,
        skipping transparent letterbox pixels. */
  const ring: number[] = [];
  const push = (x: number, y: number) => {
    const i = pick(x, y);
    if (rgba[i + 3] >= OPACITY) {
      ring.push(rgba[i], rgba[i + 1], rgba[i + 2]);
    }
  };
  const rw = Math.max(1, Math.floor(N * 0.06));
  for (let x = 0; x < N; x++) {
    for (let k = 0; k < rw; k++) {
      push(x, k);
      push(x, N - 1 - k);
    }
  }
  for (let y = 0; y < N; y++) {
    for (let k = 0; k < rw; k++) {
      push(k, y);
      push(N - 1 - k, y);
    }
  }
  if (ring.length < 9) {
    // almost nothing opaque -> no confidence
    return fallback(N);
  }
  const med = (arr: number[]) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const bgR = med(ring.filter((_, i) => i % 3 === 0));
  const bgG = med(ring.filter((_, i) => i % 3 === 1));
  const bgB = med(ring.filter((_, i) => i % 3 === 2));

  /* 2) classify content per pixel */
  const content = new Uint8Array(N * N);
  let count = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = pick(x, y);
      if (rgba[i + 3] < OPACITY) continue; // letterbox
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      const d = Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB);
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      if (d > COLOR_T || sat > SAT_T) {
        content[y * N + x] = 1;
        count++;
        continue;
      }
      // gradient (edge) signal against 4 neighbours
      let edge = 0;
      if (x > 0) edge = Math.max(edge, Math.abs(r - rgba[pick(x - 1, y)]) + Math.abs(g - rgba[pick(x - 1, y) + 1]) + Math.abs(b - rgba[pick(x - 1, y) + 2]));
      if (x < N - 1) edge = Math.max(edge, Math.abs(r - rgba[pick(x + 1, y)]) + Math.abs(g - rgba[pick(x + 1, y) + 1]) + Math.abs(b - rgba[pick(x + 1, y) + 2]));
      if (y > 0) edge = Math.max(edge, Math.abs(r - rgba[pick(x, y - 1)]) + Math.abs(g - rgba[pick(x, y - 1) + 1]) + Math.abs(b - rgba[pick(x, y - 1) + 2]));
      if (y < N - 1) edge = Math.max(edge, Math.abs(r - rgba[pick(x, y + 1)]) + Math.abs(g - rgba[pick(x, y + 1) + 1]) + Math.abs(b - rgba[pick(x, y + 1) + 2]));
      if (edge > EDGE_T) {
        content[y * N + x] = 1;
        count++;
      }
    }
  }

  if (count === 0) return fallback(N);

  /* 3) bounding box */
  let minX = N, maxX = -1, minY = N, maxY = -1;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (content[y * N + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const cwPx = maxX - minX + 1;
  const chPx = maxY - minY + 1;
  const cwF = cwPx / N;
  const chF = chPx / N;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cxF = cx / N;
  const cyF = cy / N;

  /* 4) conservative gating: only zoom if the product is strictly inside */
  const inside =
    minX >= INSIDE_FRAC * N &&
    maxX <= N - INSIDE_FRAC * N &&
    minY >= INSIDE_FRAC * N &&
    maxY <= N - INSIDE_FRAC * N;
  const realSize = Math.min(cwPx, chPx) >= MIN_HALF_FRAC * 2 * N;
  if (!inside || !realSize) return fallback(N, cwF, chF, cxF, cyF);

  /* offset from frame center, content half-extents, in pixels */
  const ox = cx - N / 2;
  const oy = cy - N / 2;
  const wh = cwPx / 2;
  const hh = chPx / 2;
  /* max scale that keeps the DETECTED content inside the frame (no-crop) */
  const safeScale = Math.min((N / 2 - Math.abs(ox)) / wh, (N / 2 - Math.abs(oy)) / hh);
  /* apply the safety margin to the ZOOM GAIN (not the absolute scale) so a
     small safe zoom is not erased while still leaving headroom against
     detection under-measurement */
  const gainScale = 1 + Math.max(0, safeScale - 1) * SAFETY;
  const scale = Math.min(MAX_SCALE, Math.max(1, gainScale));

  /* verify the transformed content bbox stays inside the frame */
  const left = cx - scale * wh;
  const right = cx + scale * wh;
  const top = cy - scale * hh;
  const bottom = cy + scale * hh;
  const inFrame = left >= 0 && right <= N && top >= 0 && bottom <= N;

  return {
    shouldZoom: scale > 1.001,
    scale: Math.max(1, scale),
    originX: cxF,
    originY: cyF,
    contentW: cwF,
    contentH: chF,
    centerXF: cxF,
    centerYF: cyF,
    inFrame,
  };
}

function fallback(N: number, cwF = 1, chF = 1, cxF = 0.5, cyF = 0.5): ZoomFit {
  void N;
  return {
    shouldZoom: false,
    scale: 1,
    originX: 0.5,
    originY: 0.5,
    contentW: cwF,
    contentH: chF,
    centerXF: cxF,
    centerYF: cyF,
    inFrame: true,
  };
}
