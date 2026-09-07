/* WebGL capability detection for the 3D avatar.
   Pure + dependency-free: a single cached probe that tells Review
   whether it can render a live 3D scene or must use the 2D fallback.
   Safe on the server (returns false) and inside privacy modes. */

let cached: boolean | null = null;

export function detectWebGL(): boolean {
  if (cached !== null) return cached;
  if (typeof document === "undefined") {
    cached = false;
    return cached;
  }
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      (canvas.getContext as (
        id: string
      ) => unknown)("experimental-webgl");
    const ok = gl !== null && gl !== undefined;
    cached = ok;
    return ok;
  } catch {
    cached = false;
    return cached;
  }
}

/* Reset only for tests. */
export function _resetWebGLCache(): void {
  cached = null;
}