/**
 * Texture sampling for the draw pipeline: the `SamplerFn` factory whose
 * results the emitted shader code calls through the per-draw `SMP` array,
 * indexed by texture unit.
 *
 * Three decisions shape this module:
 *
 * 1. **Completeness is enforced the way GL enforces it.** A unit with no
 *    texture, a texture with no base image, or a texture whose min filter
 *    still requires a mipmap chain (the just-created default,
 *    NEAREST_MIPMAP_LINEAR, is one — binding decision 9 keeps mip filters out
 *    of 0.1.0) samples as opaque black (0, 0, 0, 1), exactly the "texture
 *    renders black" behavior a browser shows for an incomplete texture —
 *    honest, and the most recognizable symptom to debug.
 * 2. **One filter per lookup: the magnification filter.** Choosing between
 *    min and mag needs a texel-footprint estimate from UV derivatives, which
 *    0.1.0 does not compute (no derivatives are in the GLSL subset either).
 *    The magnification filter is used for every lookup because the engines'
 *    non-mip textures are drawn at 1:1 or magnified (HUD glyphs, billboards),
 *    and the min filter's remaining role is the completeness rule above.
 * 3. **The result view is owned and reused.** Emitted shader code copies the
 *    four components into scalars immediately after each call (the emitter's
 *    documented contract), so one Float64Array per sampler avoids a per-lookup
 *    allocation in the hottest loop of the package.
 *
 * All arithmetic is f64 on byte values divided by 255 — deterministic, and
 * exact at texel centers so a NEAREST (or center-aligned LINEAR) lookup of an
 * uploaded byte round-trips byte-exact through `colorByte`.
 */

import { GL } from "../constants";
import type { SamplerFn } from "../glsl/link";
import type { TextureImage, TextureObject } from "../objects";

/**
 * Wraps a texel index into [0, size) per the texture's wrap mode. Operating on
 * integer texel indices (rather than pre-wrapping the normalized coordinate)
 * keeps REPEAT seams exact: index arithmetic has no float rounding to leak one
 * texel across the wrap boundary.
 */
function wrapIndex(index: number, size: number, mode: number): number {
  if (!Number.isFinite(index)) return 0;
  if (mode === GL.CLAMP_TO_EDGE) return index < 0 ? 0 : index >= size ? size - 1 : index;
  if (mode === GL.REPEAT) {
    const m = index % size;
    return m < 0 ? m + size : m;
  }
  // MIRRORED_REPEAT: the pattern reflects every `size` texels, period 2*size.
  const period = 2 * size;
  let m = index % period;
  if (m < 0) m += period;
  return m < size ? m : period - 1 - m;
}

/**
 * Reads one texel into `out` as RGBA floats in [0, 1], expanding the stored
 * format per the GL fetch rules: RGB fills alpha with 1, RED fills green/blue
 * with 0, LUMINANCE broadcasts to rgb, ALPHA carries only alpha.
 */
function fetchTexel(image: TextureImage, x: number, y: number, out: Float64Array): void {
  const d = image.data;
  const base = (y * image.width + x) * image.channels;
  switch (image.format) {
    case GL.RGBA:
      out[0] = (d[base] ?? 0) / 255;
      out[1] = (d[base + 1] ?? 0) / 255;
      out[2] = (d[base + 2] ?? 0) / 255;
      out[3] = (d[base + 3] ?? 0) / 255;
      return;
    case GL.RGB:
      out[0] = (d[base] ?? 0) / 255;
      out[1] = (d[base + 1] ?? 0) / 255;
      out[2] = (d[base + 2] ?? 0) / 255;
      out[3] = 1;
      return;
    case GL.RED:
      out[0] = (d[base] ?? 0) / 255;
      out[1] = 0;
      out[2] = 0;
      out[3] = 1;
      return;
    case GL.LUMINANCE: {
      const l = (d[base] ?? 0) / 255;
      out[0] = l;
      out[1] = l;
      out[2] = l;
      out[3] = 1;
      return;
    }
    case GL.LUMINANCE_ALPHA: {
      const l = (d[base] ?? 0) / 255;
      out[0] = l;
      out[1] = l;
      out[2] = l;
      out[3] = (d[base + 1] ?? 0) / 255;
      return;
    }
    default: {
      // ALPHA — the only remaining stored format.
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      out[3] = (d[base] ?? 0) / 255;
    }
  }
}

/** Whether the texture can be sampled at all, per the completeness decision above. */
function isComplete(texture: TextureObject | null): texture is TextureObject & { image: TextureImage } {
  if (texture === null || texture.deleted || texture.image === null) return false;
  if (texture.image.width < 1 || texture.image.height < 1) return false;
  // A mip-requiring min filter with no mip chain is incomplete, per GL; the
  // only reachable mip value is the just-created default (setting one throws).
  return texture.minFilter === GL.NEAREST || texture.minFilter === GL.LINEAR;
}

/**
 * Builds the sampler function for one texture unit. The `lod` argument
 * `textureLod` forwards is accepted and ignored: only the base level exists
 * in 0.1.0 (binding decision 9), so every lod resolves to it.
 */
export function samplerFor(texture: TextureObject | null): SamplerFn {
  const out = new Float64Array(4);
  if (!isComplete(texture)) {
    // Incomplete: opaque black, constant, computed once.
    out[3] = 1;
    return () => out;
  }
  const image = texture.image;
  const wrapS = texture.wrapS;
  const wrapT = texture.wrapT;
  const w = image.width;
  const h = image.height;

  if (texture.magFilter === GL.NEAREST) {
    return (u: number, v: number): Float64Array => {
      const x = wrapIndex(Math.floor(u * w), w, wrapS);
      const y = wrapIndex(Math.floor(v * h), h, wrapT);
      fetchTexel(image, x, y, out);
      return out;
    };
  }

  // LINEAR: sample positions sit at texel centers, so the footprint around
  // (u*w - 0.5, v*h - 0.5) blends the four surrounding texels; at an exact
  // texel center the fractions are 0 and the texel value comes back exact.
  const t00 = new Float64Array(4);
  const t10 = new Float64Array(4);
  const t01 = new Float64Array(4);
  const t11 = new Float64Array(4);
  return (u: number, v: number): Float64Array => {
    const su = u * w - 0.5;
    const sv = v * h - 0.5;
    const fu = Math.floor(su);
    const fv = Math.floor(sv);
    const du = Number.isFinite(su) ? su - fu : 0;
    const dv = Number.isFinite(sv) ? sv - fv : 0;
    const x0 = wrapIndex(fu, w, wrapS);
    const x1 = wrapIndex(fu + 1, w, wrapS);
    const y0 = wrapIndex(fv, h, wrapT);
    const y1 = wrapIndex(fv + 1, h, wrapT);
    fetchTexel(image, x0, y0, t00);
    fetchTexel(image, x1, y0, t10);
    fetchTexel(image, x0, y1, t01);
    fetchTexel(image, x1, y1, t11);
    for (let c = 0; c < 4; c += 1) {
      const top = (t00[c] ?? 0) + du * ((t10[c] ?? 0) - (t00[c] ?? 0));
      const bottom = (t01[c] ?? 0) + du * ((t11[c] ?? 0) - (t01[c] ?? 0));
      out[c] = top + dv * (bottom - top);
    }
    return out;
  };
}
