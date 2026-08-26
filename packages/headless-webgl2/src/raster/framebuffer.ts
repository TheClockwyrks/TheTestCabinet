/**
 * The default framebuffer: a color plane of RGBA bytes and a depth plane of
 * 32-bit floats. Color rows are stored bottom-up — row 0 is the bottom of the
 * canvas, GL's own memory order — which makes `readPixels` a straight row
 * copy rather than a flip, and makes "rows bottom-up" true by construction
 * rather than by a conversion that could be forgotten.
 *
 * Bytes are produced with `Math.round(clamp01(c) * 255)` — explicitly, never
 * by letting `Uint8ClampedArray` coerce, because the typed array rounds
 * half-to-even while the package's byte-exactness contract (CSS hex colors
 * round-trip exactly) is the plain round-half-up rule.
 *
 * Antialiasing is 2×2 supersampling, kept entirely inside this module's
 * shape: with `scale` 2 the planes hold `2w × 2h` samples and `readPixels`
 * box-filters each 2×2 quad (sum, divide by four, `Math.round`) on the way
 * out. The resolve computes exactly the requested rect on every call rather
 * than caching a resolved plane, because a per-rect resolve is O(rect) with
 * nothing to invalidate — validators read single samples after a frame, and
 * a cache would only add a staleness bug surface. The averaging preserves
 * the byte-exactness contract where the docs claim it: four identical
 * subsample bytes average to that byte exactly, so an interior pixel of a
 * flat surface reads the same bytes the single-sample rasterizer would have
 * written, while a partially covered edge pixel reads the blend.
 */

/** Clamps to [0, 1]; written comparison-first so NaN falls to 0 and output stays deterministic. */
function clamp01(v: number): number {
  return v > 0 ? (v < 1 ? v : 1) : 0;
}

/** The one float→byte rule of the whole package. Exported so the rasterizer (stage 3) shares it. */
export function colorByte(v: number): number {
  return Math.round(clamp01(v) * 255);
}

/** An axis-aligned pixel rectangle, x/y at the bottom-left, in framebuffer coordinates. */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The color and depth planes behind one canvas, with the clear, resize, and
 * readback operations the context lowers onto.
 */
export class DefaultFramebuffer {
  #width: number;
  #height: number;

  /** RGBA bytes, row 0 = bottom, at `scale` samples per pixel axis. */
  #color: Uint8Array;

  /** One float per sample, same row order as color. */
  #depth: Float32Array;

  /**
   * With the `alpha: false` context attribute the drawing buffer has no alpha
   * channel, so every stored alpha byte is forced to 255 — at clear and resize
   * here, and at fragment write in stage 3.
   */
  readonly opaque: boolean;

  /**
   * Samples per pixel axis: 1 for a single-sample buffer, 2 for the
   * `antialias` attribute's 2×2 supersampling. Fixed at construction because
   * the WebGL attribute is fixed at context creation.
   */
  readonly scale: number;

  constructor(width: number, height: number, opaque: boolean, scale = 1) {
    this.#width = width;
    this.#height = height;
    this.opaque = opaque;
    this.scale = scale;
    this.#color = new Uint8Array(width * scale * height * scale * 4);
    this.#depth = new Float32Array(width * scale * height * scale);
    this.#reset();
  }

  get width(): number {
    return this.#width;
  }

  get height(): number {
    return this.#height;
  }

  /** The plane width in samples — what the rasterizer's coordinates run over. */
  get sampleWidth(): number {
    return this.#width * this.scale;
  }

  /** The plane height in samples. */
  get sampleHeight(): number {
    return this.#height * this.scale;
  }

  /** The raw planes (sample-space, `sampleWidth × sampleHeight`), for the rasterizer and for white-box tests; not part of the public context surface. */
  get colorPlane(): Uint8Array {
    return this.#color;
  }

  get depthPlane(): Float32Array {
    return this.#depth;
  }

  /**
   * Reallocates the planes to a new size and clears them — color to
   * transparent black (opaque black under `alpha: false`), depth to 1 — the
   * "assigning canvas.width reallocates and clears" contract. Always
   * reallocates, even to the same size, because assigning the same width to an
   * HTML canvas also resets it.
   */
  resize(width: number, height: number): void {
    this.#width = width;
    this.#height = height;
    this.#color = new Uint8Array(width * this.scale * height * this.scale * 4);
    this.#depth = new Float32Array(width * this.scale * height * this.scale);
    this.#reset();
  }

  #reset(): void {
    // A fresh Uint8Array is already zero; only the forced alpha and the
    // depth=1 fill need writing.
    if (this.opaque) {
      for (let i = 3; i < this.#color.length; i += 4) this.#color[i] = 255;
    }
    this.#depth.fill(1);
  }

  /** Clips a rect to the plane bounds; returns null when nothing survives. */
  #clip(rect: PixelRect): PixelRect | null {
    const x0 = Math.max(rect.x, 0);
    const y0 = Math.max(rect.y, 0);
    const x1 = Math.min(rect.x + rect.width, this.#width);
    const y1 = Math.min(rect.y + rect.height, this.#height);
    if (x1 <= x0 || y1 <= y0) return null;
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }

  /**
   * Clears the color plane over `rect` (already the scissor intersection the
   * context computed, in device pixels) to `rgba` floats, honoring the
   * per-channel color mask. Every subsample of a cleared pixel takes the same
   * bytes, so a cleared region resolves byte-exact — the letterbox-bar
   * contract survives supersampling.
   */
  clearColorRect(rect: PixelRect, rgba: readonly [number, number, number, number], mask: readonly [boolean, boolean, boolean, boolean]): void {
    const clipped = this.#clip(rect);
    if (clipped === null) return;
    const bytes = [colorByte(rgba[0]), colorByte(rgba[1]), colorByte(rgba[2]), this.opaque ? 255 : colorByte(rgba[3])] as const;
    const color = this.#color;
    const s = this.scale;
    const rowSamples = this.sampleWidth;
    for (let row = clipped.y * s; row < (clipped.y + clipped.height) * s; row += 1) {
      let i = (row * rowSamples + clipped.x * s) * 4;
      for (let col = 0; col < clipped.width * s; col += 1) {
        if (mask[0]) color[i] = bytes[0];
        if (mask[1]) color[i + 1] = bytes[1];
        if (mask[2]) color[i + 2] = bytes[2];
        // Under `alpha: false` the forced channel wins even through the mask,
        // because the buffer has no alpha to write.
        if (mask[3] || this.opaque) color[i + 3] = bytes[3];
        i += 4;
      }
    }
  }

  /** Clears the depth plane over `rect` (device pixels) to `value` (the context clamps it to [0, 1] and gates on depthMask). */
  clearDepthRect(rect: PixelRect, value: number): void {
    const clipped = this.#clip(rect);
    if (clipped === null) return;
    const v = clamp01(value);
    const depth = this.#depth;
    const s = this.scale;
    const rowSamples = this.sampleWidth;
    for (let row = clipped.y * s; row < (clipped.y + clipped.height) * s; row += 1) {
      const start = row * rowSamples + clipped.x * s;
      depth.fill(v, start, start + clipped.width * s);
    }
  }

  /**
   * Copies the rect's RGBA bytes into `dest`, rows bottom-up: dest row 0 is
   * the requested rect's bottom row. Pixels outside the framebuffer leave
   * their `dest` bytes untouched, per the readPixels specification. Rows in
   * `dest` are padded to `packAlignment` (RGBA rows are 4-aligned already, so
   * padding only appears at alignment 8 with odd widths).
   *
   * With `scale` 2 this is the supersample resolve: each pixel is the box
   * filter of its 2×2 subsample quad — channel sums divided by four, then
   * `Math.round` — computed for exactly the requested rect on every call
   * (see the module header for why there is no cached resolved plane). Four
   * agreeing subsamples average to their own byte, which is what keeps flat
   * interiors byte-exact under antialiasing.
   *
   * The caller (the context) has already validated format/type, the dest view
   * type, and that `dest` is large enough — this method only moves bytes.
   */
  readPixels(x: number, y: number, width: number, height: number, dest: Uint8Array, packAlignment: number, destOffset: number): void {
    const rowBytes = width * 4;
    const stride = Math.ceil(rowBytes / packAlignment) * packAlignment;
    // Clip the requested columns once; the same span applies to every row.
    const colStart = Math.max(x, 0);
    const colEnd = Math.min(x + width, this.#width);
    if (colEnd <= colStart) return;
    const color = this.#color;
    if (this.scale === 1) {
      // Single-sample: a straight row copy.
      const spanBytes = (colEnd - colStart) * 4;
      for (let row = 0; row < height; row += 1) {
        const srcRow = y + row;
        if (srcRow < 0 || srcRow >= this.#height) continue;
        const src = (srcRow * this.#width + colStart) * 4;
        const dst = destOffset + row * stride + (colStart - x) * 4;
        dest.set(color.subarray(src, src + spanBytes), dst);
      }
      return;
    }
    const s = this.scale;
    const n = s * s;
    const rowSamples = this.sampleWidth;
    for (let row = 0; row < height; row += 1) {
      const srcRow = y + row;
      if (srcRow < 0 || srcRow >= this.#height) continue;
      for (let col = colStart; col < colEnd; col += 1) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let sy = srcRow * s; sy < (srcRow + 1) * s; sy += 1) {
          let i = (sy * rowSamples + col * s) * 4;
          for (let sx = 0; sx < s; sx += 1) {
            r += color[i] ?? 0;
            g += color[i + 1] ?? 0;
            b += color[i + 2] ?? 0;
            a += color[i + 3] ?? 0;
            i += 4;
          }
        }
        const dst = destOffset + row * stride + (col - x) * 4;
        dest[dst] = Math.round(r / n);
        dest[dst + 1] = Math.round(g / n);
        dest[dst + 2] = Math.round(b / n);
        dest[dst + 3] = Math.round(a / n);
      }
    }
  }

  /**
   * The byte count `readPixels` needs in `dest` for a rect, alignment
   * included: full stride for every row but the last, which needs only its
   * own bytes, per the GL pack arithmetic.
   */
  static requiredBytes(width: number, height: number, packAlignment: number): number {
    if (width <= 0 || height <= 0) return 0;
    const rowBytes = width * 4;
    const stride = Math.ceil(rowBytes / packAlignment) * packAlignment;
    return stride * (height - 1) + rowBytes;
  }
}
