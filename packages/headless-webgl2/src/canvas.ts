/**
 * The canvas: a deliberately minimal stand-in for an HTML canvas element —
 * `width`, `height`, `getContext`, nothing else. No `style`, no
 * `addEventListener`, no `toDataURL`, because the documented harnesses supply
 * `SurfaceMetrics` and an `EventTarget` themselves and the engines bless a
 * canvas that "exposes no style"; adding DOM-ish members would invite the
 * engines to depend on them. The engines receive it through an
 * `as unknown as HTMLCanvasElement` cast and only ever touch these three
 * members.
 */

import {
  HeadlessWebGL2Context,
  type ResolvedContextAttributes,
} from "./context";

/**
 * The context-creation attributes `getContext("webgl2", ...)` accepts.
 * Headless there is no compositor, so `premultipliedAlpha` and
 * `preserveDrawingBuffer` are stored and reported only — buffers always
 * persist and nothing premultiplies on present. `stencil` is accepted but no
 * stencil buffer is allocated (stencil operations are outside the subset and
 * throw).
 */
export interface ContextAttributes {
  /** Whether the drawing buffer has an alpha channel; `false` forces every stored alpha byte to 255. Default `true`. */
  alpha?: boolean;
  /** Whether a depth buffer exists. Default `true`. */
  depth?: boolean;
  /** Accepted, not implemented: no stencil buffer is ever allocated. Default `false`. */
  stencil?: boolean;
  /**
   * 2×2 supersampling: triangle edges blend while a flat interior pixel —
   * four agreeing subsamples — stays byte-exact with the single-sample
   * picture, the engines' documented sampling contract. Default `true`.
   */
  antialias?: boolean;
  /** Stored and reported only — no compositor exists to premultiply for. Default `true`. */
  premultipliedAlpha?: boolean;
  /** Stored and reported only — headless buffers always persist. Default `false`. */
  preserveDrawingBuffer?: boolean;
}

/**
 * What `createCanvas` returns: backing-store size in device pixels plus the
 * context accessor. The docs' harnesses compute the size as
 * `Math.round(cssWidth * dpr)` and hand the canvas to `createEngine` through
 * a cast; the engines' `syncCanvas` then assigns `width`/`height` directly.
 */
export interface Canvas {
  /**
   * Backing-store width in device pixels. Assigning it reallocates the
   * drawing buffer and clears it (color to transparent black, depth to 1),
   * matching the HTML canvas contract the engines' `syncCanvas` relies on —
   * even when the assigned value equals the current one, because assigning an
   * HTML canvas its own width also resets it.
   */
  width: number;

  /** Backing-store height in device pixels; assignment behaves as `width`'s does. */
  height: number;

  /**
   * `"webgl2"` yields the context — the same live object on every call, with
   * later calls ignoring differing attributes, per the WebGL spec. Any other
   * id (`"2d"`, `"webgl"`, `"bitmaprenderer"`) returns `null`, as a browser
   * canvas does once a webgl2 context exists — and by design before one
   * exists too: the diagnostics overlay never draws on the WebGL canvas.
   */
  getContext(
    contextId: "webgl2",
    attributes?: ContextAttributes,
  ): HeadlessWebGL2Context;
  getContext(
    contextId: string,
    attributes?: unknown,
  ): HeadlessWebGL2Context | null;
}

/**
 * Coerces a canvas dimension by the HTML rule — truncate toward zero; NaN,
 * infinities, and negatives fall back to the element defaults (300×150) —
 * rather than refusing with a RangeError, because this canvas stands in for
 * the platform's and must coerce exactly where the platform coerces. The docs
 * always pass positive rounded integers, so the fallback is a compatibility
 * detail, not an expected path.
 */
function coerceSize(value: number, fallback: number): number {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** The HTML canvas element defaults, used wherever a size fails coercion. */
const DEFAULT_WIDTH = 300;
const DEFAULT_HEIGHT = 150;

/** Resolves user attributes against the WebGL defaults; unknown keys are ignored as a browser ignores them. */
function resolveAttributes(
  attributes: ContextAttributes | undefined,
): ResolvedContextAttributes {
  return {
    alpha: attributes?.alpha ?? true,
    depth: attributes?.depth ?? true,
    stencil: attributes?.stencil ?? false,
    antialias: attributes?.antialias ?? true,
    premultipliedAlpha: attributes?.premultipliedAlpha ?? true,
    preserveDrawingBuffer: attributes?.preserveDrawingBuffer ?? false,
  };
}

class HeadlessCanvas implements Canvas {
  #width: number;
  #height: number;
  #context: HeadlessWebGL2Context | null = null;

  constructor(width: number, height: number) {
    this.#width = width;
    this.#height = height;
  }

  get width(): number {
    return this.#width;
  }

  set width(value: number) {
    this.#width = coerceSize(value, DEFAULT_WIDTH);
    // Assignment reallocates and clears even to the same size; the context's
    // viewport and scissor state deliberately do not follow (WebGL rule).
    this.#context?.resizeDrawingBuffer(this.#width, this.#height);
  }

  get height(): number {
    return this.#height;
  }

  set height(value: number) {
    this.#height = coerceSize(value, DEFAULT_HEIGHT);
    this.#context?.resizeDrawingBuffer(this.#width, this.#height);
  }

  getContext(
    contextId: "webgl2",
    attributes?: ContextAttributes,
  ): HeadlessWebGL2Context;
  getContext(
    contextId: string,
    attributes?: unknown,
  ): HeadlessWebGL2Context | null;
  getContext(
    contextId: string,
    attributes?: unknown,
  ): HeadlessWebGL2Context | null {
    if (contextId !== "webgl2") return null;
    if (this.#context === null) {
      // First call fixes the attributes; later calls return the same live
      // object and ignore differing attributes, per the WebGL spec.
      this.#context = new HeadlessWebGL2Context(
        this,
        this.#width,
        this.#height,
        resolveAttributes(attributes as ContextAttributes | undefined),
      );
    }
    return this.#context;
  }
}

/**
 * Creates a headless canvas whose `getContext("webgl2")` yields a working,
 * in-process WebGL2 context. `width` and `height` are device-pixel integers
 * (the documented harnesses pass `Math.round(cssSize * dpr)`), coerced by the
 * HTML rule.
 */
export function createCanvas(width: number, height: number): Canvas {
  return new HeadlessCanvas(
    coerceSize(width, DEFAULT_WIDTH),
    coerceSize(height, DEFAULT_HEIGHT),
  );
}
