/**
 * Triangle rasterization and the shared per-fragment output stage.
 *
 * The rasterizer is a plain edge-function scanner over the triangle's
 * bounding box ∩ the draw's raster bounds, with a **top-left fill rule**: a
 * pixel center exactly on an edge belongs to the triangle whose traversal of
 * that edge runs downward (dy < 0) or exactly leftward along a horizontal
 * (dy == 0, dx < 0) — in this package's y-up window space that is the
 * left-and-top ownership rule, and since the two triangles sharing an edge
 * traverse it in opposite directions, exactly one of them owns every shared
 * pixel: no seam gap, no double blend, deterministically.
 *
 * `shadeFragment` is the one fragment output path — depth test, fragment
 * shader, discard, blending, masks, byte conversion — shared with the line
 * and point rasterizers so every primitive kind writes pixels by identical
 * arithmetic. Fragments are emitted in a fixed scan order (rows bottom-up,
 * columns left-to-right) per primitive, all f64, so identical op streams
 * produce byte-identical framebuffers.
 */

import { GL } from "../constants";
import type { FragmentFn, SamplerFn } from "../glsl/link";
import { colorByte } from "./framebuffer";
import type { WindowVertex } from "./clip";

/**
 * Everything one draw call's fragments depend on, resolved once by the
 * pipeline: the target planes, the fixed-function state snapshot, the
 * program's fragment function, and the reused per-fragment scratch buffers
 * (safe to reuse because rasterization is single-threaded and emitted shader
 * code copies out of them before the next fragment).
 */
export interface DrawEnv {
  /* -- target ---------------------------------------------------------- */
  readonly color: Uint8Array;
  readonly depth: Float32Array;
  /** Plane width in samples (`framebuffer.sampleWidth`) — the row stride of every write. */
  readonly fbWidth: number;
  /**
   * Samples per device pixel axis (1, or 2 under the antialias attribute).
   * Triangles never consult it — they rasterize per sample, which is the
   * antialiasing — but lines and points do, to write whole device-pixel
   * subsample blocks (see `line.ts` for why).
   */
  readonly scale: number;
  /** With `alpha: false` the stored alpha byte is forced to 255 at every write. */
  readonly opaque: boolean;

  /* -- raster bounds: viewport ∩ scissor ∩ framebuffer, half-open ------- */
  readonly bx0: number;
  readonly by0: number;
  readonly bx1: number;
  readonly by1: number;

  /* -- depth state ------------------------------------------------------ */
  readonly depthTest: boolean;
  /** Whether passing fragments write depth (depthMask; writes also need depthTest on, per GL). */
  readonly depthWrite: boolean;
  readonly depthFunc: number;

  /* -- blending --------------------------------------------------------- */
  readonly blend: boolean;
  readonly blendSrcRgb: number;
  readonly blendDstRgb: number;
  readonly blendSrcAlpha: number;
  readonly blendDstAlpha: number;
  readonly blendEquationRgb: number;
  readonly blendEquationAlpha: number;
  readonly blendConstant: readonly [number, number, number, number];

  /* -- masks ------------------------------------------------------------ */
  readonly colorMask: readonly [boolean, boolean, boolean, boolean];

  /* -- culling (consulted by the triangle rasterizer only, per GL) ------ */
  readonly cullEnabled: boolean;
  readonly cullMode: number;
  readonly frontFaceCcw: boolean;

  /* -- polygon offset (triangles only, per GL) -------------------------- */
  readonly polygonOffsetOn: boolean;
  readonly polygonOffsetFactor: number;
  readonly polygonOffsetUnits: number;

  /* -- the program ------------------------------------------------------ */
  readonly fragment: FragmentFn;
  readonly uniforms: Float64Array;
  readonly samplers: readonly SamplerFn[];
  readonly varyingCount: number;

  /* -- reused per-fragment scratch -------------------------------------- */
  readonly varyings: Float64Array;
  readonly fragCoord: Float64Array;
  readonly colorOut: Float64Array;
}

/** Clamps to [0, 1]; comparison-first so NaN falls to 0 and stays deterministic. */
function clamp01(v: number): number {
  return v > 0 ? (v < 1 ? v : 1) : 0;
}

/** The depth comparison, per depthFunc. */
function depthPasses(func: number, incoming: number, stored: number): boolean {
  switch (func) {
    case GL.NEVER:
      return false;
    case GL.LESS:
      return incoming < stored;
    case GL.EQUAL:
      return incoming === stored;
    case GL.LEQUAL:
      return incoming <= stored;
    case GL.GREATER:
      return incoming > stored;
    case GL.NOTEQUAL:
      return incoming !== stored;
    case GL.GEQUAL:
      return incoming >= stored;
    default:
      // ALWAYS — the only remaining value the state machine stores.
      return true;
  }
}

/**
 * One blend factor's value for a color channel (`channel` 0–2), per the ES
 * 3.0 factor table. `src`/`dst`/`constant` are RGBA floats in [0, 1].
 */
function rgbFactor(factor: number, channel: number, src: Float64Array, dst: Float64Array, constant: readonly [number, number, number, number]): number {
  switch (factor) {
    case GL.ZERO:
      return 0;
    case GL.ONE:
      return 1;
    case GL.SRC_COLOR:
      return src[channel] ?? 0;
    case GL.ONE_MINUS_SRC_COLOR:
      return 1 - (src[channel] ?? 0);
    case GL.DST_COLOR:
      return dst[channel] ?? 0;
    case GL.ONE_MINUS_DST_COLOR:
      return 1 - (dst[channel] ?? 0);
    case GL.SRC_ALPHA:
      return src[3] ?? 0;
    case GL.ONE_MINUS_SRC_ALPHA:
      return 1 - (src[3] ?? 0);
    case GL.DST_ALPHA:
      return dst[3] ?? 0;
    case GL.ONE_MINUS_DST_ALPHA:
      return 1 - (dst[3] ?? 0);
    case GL.CONSTANT_COLOR:
      return constant[channel] ?? 0;
    case GL.ONE_MINUS_CONSTANT_COLOR:
      return 1 - (constant[channel] ?? 0);
    case GL.CONSTANT_ALPHA:
      return constant[3];
    case GL.ONE_MINUS_CONSTANT_ALPHA:
      return 1 - constant[3];
    default:
      // SRC_ALPHA_SATURATE — min(As, 1 - Ad) for the color channels.
      return Math.min(src[3] ?? 0, 1 - (dst[3] ?? 0));
  }
}

/** The same factor's alpha-channel value; the color factors read alpha analogues, per the table. */
function alphaFactor(factor: number, src: Float64Array, dst: Float64Array, constant: readonly [number, number, number, number]): number {
  switch (factor) {
    case GL.ZERO:
      return 0;
    case GL.ONE:
      return 1;
    case GL.SRC_COLOR:
    case GL.SRC_ALPHA:
      return src[3] ?? 0;
    case GL.ONE_MINUS_SRC_COLOR:
    case GL.ONE_MINUS_SRC_ALPHA:
      return 1 - (src[3] ?? 0);
    case GL.DST_COLOR:
    case GL.DST_ALPHA:
      return dst[3] ?? 0;
    case GL.ONE_MINUS_DST_COLOR:
    case GL.ONE_MINUS_DST_ALPHA:
      return 1 - (dst[3] ?? 0);
    case GL.CONSTANT_COLOR:
    case GL.CONSTANT_ALPHA:
      return constant[3];
    case GL.ONE_MINUS_CONSTANT_COLOR:
    case GL.ONE_MINUS_CONSTANT_ALPHA:
      return 1 - constant[3];
    default:
      // SRC_ALPHA_SATURATE — 1 for the alpha channel, per the table.
      return 1;
  }
}

/** Applies one blend equation to a source and destination term. */
function blendCombine(equation: number, srcValue: number, srcFactor: number, dstValue: number, dstFactor: number): number {
  if (equation === GL.FUNC_SUBTRACT) return srcValue * srcFactor - dstValue * dstFactor;
  if (equation === GL.FUNC_REVERSE_SUBTRACT) return dstValue * dstFactor - srcValue * srcFactor;
  return srcValue * srcFactor + dstValue * dstFactor;
}

/* Module-level scratch for blending; safe because rasterization is single-threaded. */
const SRC = new Float64Array(4);
const DST = new Float64Array(4);

/**
 * The one fragment output path. `env.varyings` must already hold the
 * fragment's interpolated varyings; `px`/`py` are the target pixel (already
 * inside the draw's raster bounds), `z` the window depth before clamping,
 * `invW` the interpolated 1/w for gl_FragCoord.w.
 *
 * Order per the GL pipeline as observable here: depth test first (legal to
 * hoist because the fragment shader has no side effects), then the shader
 * and its discard, then blending, masks, and the byte writes. Depth writes
 * happen only when the depth test is enabled, per the ES specification.
 */
export function shadeFragment(env: DrawEnv, px: number, py: number, z: number, invW: number, frontFacing: boolean): void {
  const depth = clamp01(z);
  const index = py * env.fbWidth + px;
  if (env.depthTest && !depthPasses(env.depthFunc, depth, env.depth[index] ?? 0)) return;

  const fragCoord = env.fragCoord;
  fragCoord[0] = px + 0.5;
  fragCoord[1] = py + 0.5;
  fragCoord[2] = depth;
  fragCoord[3] = invW;

  // An output the shader never writes stays at this deterministic zero (GLSL
  // calls it undefined; this package must not).
  const out = env.colorOut;
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  const discarded = env.fragment(env.varyings, env.uniforms, env.samplers, fragCoord, frontFacing, out);
  if (discarded) return;

  // Fragment outputs clamp to [0, 1] before blending, the fixed-point rule.
  SRC[0] = clamp01(out[0] ?? 0);
  SRC[1] = clamp01(out[1] ?? 0);
  SRC[2] = clamp01(out[2] ?? 0);
  SRC[3] = clamp01(out[3] ?? 0);

  const color = env.color;
  const ci = index * 4;
  let r = SRC[0] ?? 0;
  let g = SRC[1] ?? 0;
  let b = SRC[2] ?? 0;
  let a = SRC[3] ?? 0;
  if (env.blend) {
    // Destination reads back as bytes / 255, the value blending is specified
    // over; under `alpha: false` the stored 255 reads as 1 naturally.
    DST[0] = (color[ci] ?? 0) / 255;
    DST[1] = (color[ci + 1] ?? 0) / 255;
    DST[2] = (color[ci + 2] ?? 0) / 255;
    DST[3] = (color[ci + 3] ?? 0) / 255;
    const k = env.blendConstant;
    r = clamp01(blendCombine(env.blendEquationRgb, SRC[0] ?? 0, rgbFactor(env.blendSrcRgb, 0, SRC, DST, k), DST[0] ?? 0, rgbFactor(env.blendDstRgb, 0, SRC, DST, k)));
    g = clamp01(blendCombine(env.blendEquationRgb, SRC[1] ?? 0, rgbFactor(env.blendSrcRgb, 1, SRC, DST, k), DST[1] ?? 0, rgbFactor(env.blendDstRgb, 1, SRC, DST, k)));
    b = clamp01(blendCombine(env.blendEquationRgb, SRC[2] ?? 0, rgbFactor(env.blendSrcRgb, 2, SRC, DST, k), DST[2] ?? 0, rgbFactor(env.blendDstRgb, 2, SRC, DST, k)));
    a = clamp01(blendCombine(env.blendEquationAlpha, SRC[3] ?? 0, alphaFactor(env.blendSrcAlpha, SRC, DST, k), DST[3] ?? 0, alphaFactor(env.blendDstAlpha, SRC, DST, k)));
  }

  const mask = env.colorMask;
  if (mask[0]) color[ci] = colorByte(r);
  if (mask[1]) color[ci + 1] = colorByte(g);
  if (mask[2]) color[ci + 2] = colorByte(b);
  // Under `alpha: false` the forced channel wins even through the mask.
  if (env.opaque) color[ci + 3] = 255;
  else if (mask[3]) color[ci + 3] = colorByte(a);

  if (env.depthTest && env.depthWrite) env.depth[index] = depth;
}

/**
 * The top-left ownership predicate for a pixel center exactly on an edge,
 * over the edge's traversal direction. Exactly one of a direction and its
 * reverse satisfies it, which is what makes shared-edge pixels single-owner.
 */
function edgeOwns(dx: number, dy: number): boolean {
  return dy < 0 || (dy === 0 && dx < 0);
}

/** The smallest resolvable depth difference polygonOffset units scale by (the f32 depth plane's ulp scale). */
const DEPTH_RESOLUTION = 2 ** -23;

/**
 * Rasterizes one window-space triangle: facing and culling, the top-left
 * fill rule, perspective-correct varying interpolation (numerators and 1/w
 * interpolated linearly in screen space, divided per fragment), screen-linear
 * depth with polygon offset, then `shadeFragment` per covered pixel.
 */
export function rasterizeTriangle(env: DrawEnv, v0: WindowVertex, v1: WindowVertex, v2: WindowVertex): void {
  if (!Number.isFinite(v0.x + v0.y + v1.x + v1.y + v2.x + v2.y)) return;
  const signedArea2 = (v1.x - v0.x) * (v2.y - v0.y) - (v1.y - v0.y) * (v2.x - v0.x);
  if (signedArea2 === 0 || !Number.isFinite(signedArea2)) return;

  // Facing from the original winding in y-up window space, per frontFace.
  const ccw = signedArea2 > 0;
  const front = ccw === env.frontFaceCcw;
  if (env.cullEnabled) {
    if (env.cullMode === GL.FRONT_AND_BACK) return;
    if (env.cullMode === GL.BACK ? !front : front) return;
  }

  // Orient to counter-clockwise so the inside test is uniformly e >= 0.
  let a = v0;
  let b = v1;
  let c = v2;
  let area = signedArea2;
  if (!ccw) {
    b = v2;
    c = v1;
    area = -signedArea2;
  }

  const minX = Math.min(a.x, b.x, c.x);
  const maxX = Math.max(a.x, b.x, c.x);
  const minY = Math.min(a.y, b.y, c.y);
  const maxY = Math.max(a.y, b.y, c.y);
  // Candidate pixels are those whose +0.5 center lies inside the bounding
  // box, intersected with the draw's raster bounds.
  const x0 = Math.max(env.bx0, Math.ceil(minX - 0.5));
  const x1 = Math.min(env.bx1 - 1, Math.floor(maxX - 0.5));
  const y0 = Math.max(env.by0, Math.ceil(minY - 0.5));
  const y1 = Math.min(env.by1 - 1, Math.floor(maxY - 0.5));
  if (x1 < x0 || y1 < y0) return;

  // Polygon offset is constant per triangle: factor scales the max depth
  // slope, units scale the depth plane's resolution. On a supersampled
  // buffer the slope is per *sample* (half the per-pixel slope at scale 2) —
  // legal, because GL specifies the offset only up to an implementation
  // constant, and deterministic either way.
  let offset = 0;
  if (env.polygonOffsetOn) {
    const dzdx = ((b.z - a.z) * (c.y - a.y) - (c.z - a.z) * (b.y - a.y)) / area;
    const dzdy = ((c.z - a.z) * (b.x - a.x) - (b.z - a.z) * (c.x - a.x)) / area;
    offset = env.polygonOffsetFactor * Math.max(Math.abs(dzdx), Math.abs(dzdy)) + env.polygonOffsetUnits * DEPTH_RESOLUTION;
  }

  // Edge ownership flags, hoisted out of the pixel loop.
  const ownBC = edgeOwns(c.x - b.x, c.y - b.y);
  const ownCA = edgeOwns(a.x - c.x, a.y - c.y);
  const ownAB = edgeOwns(b.x - a.x, b.y - a.y);

  const varyings = env.varyings;
  const count = env.varyingCount;
  for (let py = y0; py <= y1; py += 1) {
    const cy = py + 0.5;
    for (let px = x0; px <= x1; px += 1) {
      const cx = px + 0.5;
      // Edge functions: eA (opposite vertex a) over edge b→c, and so on.
      const eA = (c.x - b.x) * (cy - b.y) - (c.y - b.y) * (cx - b.x);
      if (eA < 0 || (eA === 0 && !ownBC)) continue;
      const eB = (a.x - c.x) * (cy - c.y) - (a.y - c.y) * (cx - c.x);
      if (eB < 0 || (eB === 0 && !ownCA)) continue;
      const eC = (b.x - a.x) * (cy - a.y) - (b.y - a.y) * (cx - a.x);
      if (eC < 0 || (eC === 0 && !ownAB)) continue;

      const la = eA / area;
      const lb = eB / area;
      const lc = eC / area;
      const z = la * a.z + lb * b.z + lc * c.z + offset;
      const invW = la * a.invW + lb * b.invW + lc * c.invW;
      for (let j = 0; j < count; j += 1) {
        varyings[j] = (la * (a.vow[j] ?? 0) + lb * (b.vow[j] ?? 0) + lc * (c.vow[j] ?? 0)) / invW;
      }
      shadeFragment(env, px, py, z, invW, front);
    }
  }
}
