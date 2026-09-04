/**
 * Line and point rasterization. Lines are one-pixel DDA walks — GL leaves
 * line rasterization loosely specified and the engines' docs pin only "one
 * device pixel wide", never a line's exact pixels — with **linear** depth
 * along the walk and perspective-correct varyings (the interpolation
 * machinery exists, so lines share it rather than diverging from triangles).
 * Points raster as the single pixel containing the vertex, the 1×1 case the
 * spec scopes for 0.1.0.
 *
 * Lines and points rasterize at **device-pixel** granularity even on a
 * supersampled buffer: the walk runs in device coordinates and every covered
 * device pixel gets its whole `scale`×`scale` subsample block written with
 * the same depth and varyings. All subsamples agreeing means the resolve
 * returns the exact fragment bytes — a line stays one full-intensity device
 * pixel wide and byte-identical to the single-sample picture, where a
 * sample-space walk would resolve into a quarter-covered smear. Triangles,
 * by contrast, rasterize per sample: their edges are what the antialiasing
 * exists for.
 *
 * The step count is `ceil` of the longer device-axis span, which keeps every
 * step at most one pixel in each axis — no skipped column or row on any
 * slope — and lands the final step exactly on the second endpoint, so both
 * endpoint pixels are always written. Consecutive duplicate pixels are
 * deduplicated so a blended line never double-writes a pixel within itself.
 *
 * gl_FrontFacing is true for every non-polygon fragment, per GL.
 */

import type { WindowVertex } from "./clip";
import { shadeFragment, type DrawEnv } from "./triangle";

/**
 * Writes one device pixel's full subsample block through `shadeFragment`,
 * clipping each subsample against the draw's (sample-space) raster bounds.
 * Scissor, viewport, and framebuffer bounds are all device-aligned, so a
 * block is in practice written whole or not at all; the per-subsample check
 * is the belt to that braces. Depth tests and writes run per subsample,
 * exactly as triangle fragments do, so lines and polygons occlude each other
 * consistently at every sample.
 */
function shadePixelBlock(
  env: DrawEnv,
  px: number,
  py: number,
  z: number,
  invW: number,
): void {
  const s = env.scale;
  for (let j = 0; j < s; j += 1) {
    const sy = py * s + j;
    if (sy < env.by0 || sy >= env.by1) continue;
    for (let i = 0; i < s; i += 1) {
      const sx = px * s + i;
      if (sx < env.bx0 || sx >= env.bx1) continue;
      shadeFragment(env, sx, sy, z, invW, true);
    }
  }
}

/** Rasterizes one window-space segment as a 1-device-pixel DDA walk. */
export function rasterizeLine(
  env: DrawEnv,
  a: WindowVertex,
  b: WindowVertex,
): void {
  if (!Number.isFinite(a.x + a.y + b.x + b.y)) return;
  // Window coordinates arrive in sample space (the viewport transform is
  // sample-scaled); the walk runs in device space, per the module header.
  const s = env.scale;
  const ax = a.x / s;
  const ay = a.y / s;
  const dx = b.x / s - ax;
  const dy = b.y / s - ay;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  const varyings = env.varyings;
  const count = env.varyingCount;
  let lastPx = Number.NaN;
  let lastPy = Number.NaN;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const px = Math.floor(ax + t * dx);
    const py = Math.floor(ay + t * dy);
    if (px === lastPx && py === lastPy) continue;
    lastPx = px;
    lastPy = py;
    // Depth interpolates linearly along the walk (window z is already
    // screen-linear); varyings interpolate perspective-correct through the
    // 1/w numerators, exactly as triangle fragments do.
    const z = a.z + t * (b.z - a.z);
    const invW = a.invW + t * (b.invW - a.invW);
    for (let j = 0; j < count; j += 1) {
      varyings[j] =
        ((a.vow[j] ?? 0) + t * ((b.vow[j] ?? 0) - (a.vow[j] ?? 0))) / invW;
    }
    shadePixelBlock(env, px, py, z, invW);
  }
}

/** Rasterizes one point as the single device pixel containing the vertex. */
export function rasterizePoint(env: DrawEnv, v: WindowVertex): void {
  if (!Number.isFinite(v.x + v.y)) return;
  const px = Math.floor(v.x / env.scale);
  const py = Math.floor(v.y / env.scale);
  const varyings = env.varyings;
  for (let j = 0; j < env.varyingCount; j += 1) {
    varyings[j] = (v.vow[j] ?? 0) / v.invW;
  }
  shadePixelBlock(env, px, py, v.z, v.invW);
}
