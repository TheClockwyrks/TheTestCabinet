/**
 * The WebGL2 context object. Three rules govern every method on it:
 *
 * 1. **Inside the subset, per spec.** A call the 0.1.0 subset covers behaves
 *    as the WebGL 2.0 specification says it behaves, including generating
 *    INVALID_ENUM / INVALID_VALUE / INVALID_OPERATION through the `getError`
 *    latch for the misuse states the engines can plausibly reach.
 * 2. **Outside the subset, loud.** A method (or an enum reaching an
 *    implemented method) that the subset excludes throws an `Error` naming
 *    the call, never a silent no-op and never a silent GL error — a silent
 *    failure would make `readPixels` dishonest about what was issued, and a
 *    throw is a build-time steering signal for the engines' renderer design.
 * 3. **Deterministic.** No clocks, no randomness, no environment reads: the
 *    context is a pure state machine over the operations issued to it, so two
 *    identical operation streams produce byte-identical framebuffers.
 *
 * The full GL constant table is copied onto the prototype (and mixed into the
 * type via declaration merging), so `gl.RGBA`-style reads work exactly as
 * they do on a browser context.
 */

import type { Canvas, ContextAttributes } from "./canvas";
import { GL, type GLConstants } from "./constants";
import {
  BufferObject,
  ProgramObject,
  ShaderObject,
  TextureObject,
  UniformLocationObject,
  VertexArrayObject,
  type TextureImage,
} from "./objects";
import {
  createContextState,
  LIMITS,
  type ContextState,
  type TextureUnit,
} from "./state";
import { DefaultFramebuffer } from "./raster/framebuffer";
import {
  drawArraysImpl,
  drawElementsImpl,
  type DrawIo,
} from "./raster/pipeline";
import { componentCount } from "./glsl/ast";
import type { Type } from "./glsl/ast";
import { compileStage, linkStages } from "./glsl/link";

/** The attribute record `getContextAttributes` answers with: every field resolved. */
export type ResolvedContextAttributes = Required<ContextAttributes>;

/** `shaderSource` and friends accept exactly these two shader types. */
const SHADER_TYPES: readonly number[] = [GL.VERTEX_SHADER, GL.FRAGMENT_SHADER];

/** Every usage hint `bufferData` accepts; hints are stored for `getBufferParameter` and otherwise ignored. */
const BUFFER_USAGES: readonly number[] = [
  GL.STATIC_DRAW,
  GL.DYNAMIC_DRAW,
  GL.STREAM_DRAW,
  GL.STATIC_READ,
  GL.DYNAMIC_READ,
  GL.STREAM_READ,
  GL.STATIC_COPY,
  GL.DYNAMIC_COPY,
  GL.STREAM_COPY,
];

/** The blend factors the state machine stores (the full valid ES 3.0 factor set). */
const BLEND_FACTORS: readonly number[] = [
  GL.ZERO,
  GL.ONE,
  GL.SRC_COLOR,
  GL.ONE_MINUS_SRC_COLOR,
  GL.DST_COLOR,
  GL.ONE_MINUS_DST_COLOR,
  GL.SRC_ALPHA,
  GL.ONE_MINUS_SRC_ALPHA,
  GL.DST_ALPHA,
  GL.ONE_MINUS_DST_ALPHA,
  GL.CONSTANT_COLOR,
  GL.ONE_MINUS_CONSTANT_COLOR,
  GL.CONSTANT_ALPHA,
  GL.ONE_MINUS_CONSTANT_ALPHA,
  GL.SRC_ALPHA_SATURATE,
];

const DEPTH_FUNCS: readonly number[] = [
  GL.NEVER,
  GL.LESS,
  GL.EQUAL,
  GL.LEQUAL,
  GL.GREATER,
  GL.NOTEQUAL,
  GL.GEQUAL,
  GL.ALWAYS,
];

/** Vertex fetch types inside the subset (spec §3.2); the other valid ES types throw by name. */
const ATTRIB_TYPES: readonly number[] = [
  GL.FLOAT,
  GL.BYTE,
  GL.UNSIGNED_BYTE,
  GL.SHORT,
  GL.UNSIGNED_SHORT,
];
const ATTRIB_TYPES_EXCLUDED: readonly number[] = [
  GL.INT,
  GL.UNSIGNED_INT,
  GL.HALF_FLOAT,
  GL.INT_2_10_10_10_REV,
  GL.UNSIGNED_INT_2_10_10_10_REV,
];

const ATTRIB_TYPE_SIZES = new Map<number, number>([
  [GL.FLOAT, 4],
  [GL.BYTE, 1],
  [GL.UNSIGNED_BYTE, 1],
  [GL.SHORT, 2],
  [GL.UNSIGNED_SHORT, 2],
]);

/** Buffer bind targets the subset implements; the remaining valid targets throw by name. */
const BUFFER_TARGETS_EXCLUDED = new Map<number, string>([
  [GL.PIXEL_PACK_BUFFER, "PIXEL_PACK_BUFFER"],
  [GL.PIXEL_UNPACK_BUFFER, "PIXEL_UNPACK_BUFFER"],
  [GL.COPY_READ_BUFFER, "COPY_READ_BUFFER"],
  [GL.COPY_WRITE_BUFFER, "COPY_WRITE_BUFFER"],
  [GL.UNIFORM_BUFFER, "UNIFORM_BUFFER"],
  [GL.TRANSFORM_FEEDBACK_BUFFER, "TRANSFORM_FEEDBACK_BUFFER"],
]);

/** Texture bind targets outside the subset (only TEXTURE_2D is in). */
const TEXTURE_TARGETS_EXCLUDED = new Map<number, string>([
  [GL.TEXTURE_CUBE_MAP, "TEXTURE_CUBE_MAP"],
  [GL.TEXTURE_3D, "TEXTURE_3D"],
  [GL.TEXTURE_2D_ARRAY, "TEXTURE_2D_ARRAY"],
]);

/** Capability enums that are valid ES 3.0 but whose features sit outside the subset. */
const CAPABILITIES_EXCLUDED = new Map<number, string>([
  [GL.SAMPLE_ALPHA_TO_COVERAGE, "SAMPLE_ALPHA_TO_COVERAGE"],
  [GL.SAMPLE_COVERAGE, "SAMPLE_COVERAGE"],
  [GL.RASTERIZER_DISCARD, "RASTERIZER_DISCARD"],
]);

/**
 * The `texImage2D` combinations the subset stores, keyed by internal format:
 * the accepted client format and the packed byte count per pixel. RGBA is the
 * workhorse; RED/R8 serve the glyph atlas and single-channel maps; LUMINANCE,
 * LUMINANCE_ALPHA, and ALPHA are the WebGL1-era compatibility spellings.
 */
const TEXTURE_FORMATS = new Map<number, { format: number; channels: number }>([
  [GL.RGBA, { format: GL.RGBA, channels: 4 }],
  [GL.RGBA8, { format: GL.RGBA, channels: 4 }],
  [GL.RGB, { format: GL.RGB, channels: 3 }],
  [GL.RGB8, { format: GL.RGB, channels: 3 }],
  [GL.RED, { format: GL.RED, channels: 1 }],
  [GL.R8, { format: GL.RED, channels: 1 }],
  [GL.LUMINANCE, { format: GL.LUMINANCE, channels: 1 }],
  [GL.LUMINANCE_ALPHA, { format: GL.LUMINANCE_ALPHA, channels: 2 }],
  [GL.ALPHA, { format: GL.ALPHA, channels: 1 }],
]);

/** Pixel types that are valid ES 3.0 enums; unlisted values are INVALID_ENUM, listed-but-not-UNSIGNED_BYTE throw by name. */
const PIXEL_TYPES_KNOWN: readonly number[] = [
  GL.UNSIGNED_BYTE,
  GL.BYTE,
  GL.UNSIGNED_SHORT,
  GL.SHORT,
  GL.UNSIGNED_INT,
  GL.INT,
  GL.FLOAT,
  GL.HALF_FLOAT,
  GL.UNSIGNED_SHORT_4_4_4_4,
  GL.UNSIGNED_SHORT_5_5_5_1,
  GL.UNSIGNED_SHORT_5_6_5,
  GL.UNSIGNED_INT_2_10_10_10_REV,
  GL.UNSIGNED_INT_10F_11F_11F_REV,
  GL.UNSIGNED_INT_5_9_9_9_REV,
  GL.UNSIGNED_INT_24_8,
  GL.FLOAT_32_UNSIGNED_INT_24_8_REV,
];

/** Truncates toward zero the way GL coerces GLint parameters. */
function toInt(value: number): number {
  return Math.trunc(value) || 0;
}

/** Clamps to [0, 1] with NaN falling to 0, the clamp GL applies to clear values and depth range. */
function clamp01(value: number): number {
  return value > 0 ? (value < 1 ? value : 1) : 0;
}

export class HeadlessWebGL2Context {
  /** The canvas this context draws for, as browser contexts carry it. */
  readonly canvas: Canvas;

  #attributes: ResolvedContextAttributes;
  #state: ContextState;
  #framebuffer: DefaultFramebuffer;

  /**
   * Everything this context created; a buffer or program made by a different
   * context (or forged structurally) is refused with INVALID_OPERATION, the
   * WebGL rule for cross-context objects.
   */
  #owned = new WeakSet<object>();

  constructor(
    canvas: Canvas,
    width: number,
    height: number,
    attributes: ResolvedContextAttributes,
  ) {
    this.canvas = canvas;
    this.#attributes = attributes;
    const defaultVao = new VertexArrayObject(LIMITS.maxVertexAttribs, true);
    this.#owned.add(defaultVao);
    this.#state = createContextState(width, height, defaultVao);
    // `antialias` is 2×2 supersampling: the planes hold four samples per
    // pixel and readPixels box-filters them, so edges blend while a flat
    // interior — four agreeing subsamples — stays byte-exact.
    this.#framebuffer = new DefaultFramebuffer(
      width,
      height,
      !attributes.alpha,
      attributes.antialias ? 2 : 1,
    );
  }

  /* ------------------------------------------------------------------ */
  /* Context identity                                                    */
  /* ------------------------------------------------------------------ */

  get drawingBufferWidth(): number {
    return this.#framebuffer.width;
  }

  get drawingBufferHeight(): number {
    return this.#framebuffer.height;
  }

  /** The attributes the context actually has — a fresh copy per call, so a caller cannot mutate them. */
  getContextAttributes(): ResolvedContextAttributes {
    return { ...this.#attributes };
  }

  /** Never: a headless context has no compositor to lose it to. */
  isContextLost(): boolean {
    return false;
  }

  /** WebGL2 core covers the engines' needs; no extensions exist, honestly reported. */
  getSupportedExtensions(): string[] {
    return [];
  }

  getExtension(_name: string): null {
    return null;
  }

  /** No-ops: every operation completes synchronously, so there is nothing to flush or wait for. */
  flush(): void {}

  finish(): void {}

  /**
   * Reallocates the drawing buffer for a canvas size assignment and clears it
   * (color to transparent black, depth to 1). Canvas-internal — the WebGL API
   * has no resize call; assigning `canvas.width`/`canvas.height` is the one
   * documented route here. Viewport and scissor state deliberately do not
   * follow, per the WebGL spec.
   */
  resizeDrawingBuffer(width: number, height: number): void {
    this.#framebuffer.resize(width, height);
  }

  /* ------------------------------------------------------------------ */
  /* Errors                                                              */
  /* ------------------------------------------------------------------ */

  #recordError(code: number): void {
    // Latched-flag model: the first unread error of each code is retained;
    // later duplicates are dropped until it is read.
    if (!this.#state.errors.includes(code)) this.#state.errors.push(code);
  }

  /** Returns and clears one latched error per call, oldest first; NO_ERROR when none are latched. */
  getError(): number {
    return this.#state.errors.shift() ?? GL.NO_ERROR;
  }

  /** Throws for a call (or enum) the 0.1.0 subset excludes: loud, per the package's governing rule. */
  #notImplemented(what: string): never {
    throw new Error(
      `headless-webgl2: ${what} is not implemented: it is outside the 0.1.0 WebGL2 subset, so restructure the caller to stay inside the subset rather than relying on a silent no-op`,
    );
  }

  /* ------------------------------------------------------------------ */
  /* Capabilities                                                        */
  /* ------------------------------------------------------------------ */

  #setCapability(cap: number, value: boolean, call: string): void {
    if (this.#state.capabilities.has(cap)) {
      this.#state.capabilities.set(cap, value);
      return;
    }
    const excluded = CAPABILITIES_EXCLUDED.get(cap);
    if (excluded !== undefined) this.#notImplemented(`${call}(${excluded})`);
    this.#recordError(GL.INVALID_ENUM);
  }

  enable(cap: number): void {
    this.#setCapability(cap, true, "enable");
  }

  disable(cap: number): void {
    this.#setCapability(cap, false, "disable");
  }

  isEnabled(cap: number): boolean {
    const value = this.#state.capabilities.get(cap);
    if (value === undefined) {
      const excluded = CAPABILITIES_EXCLUDED.get(cap);
      if (excluded !== undefined)
        this.#notImplemented(`isEnabled(${excluded})`);
      this.#recordError(GL.INVALID_ENUM);
      return false;
    }
    return value;
  }

  /* ------------------------------------------------------------------ */
  /* Fixed-function state setters                                        */
  /* ------------------------------------------------------------------ */

  /** Stores clamped values, because GL clamps clear colors on set and queries answer the clamped form. */
  clearColor(red: number, green: number, blue: number, alpha: number): void {
    this.#state.clearColor = [
      clamp01(red),
      clamp01(green),
      clamp01(blue),
      clamp01(alpha),
    ];
  }

  clearDepth(depth: number): void {
    this.#state.clearDepth = clamp01(depth);
  }

  colorMask(red: boolean, green: boolean, blue: boolean, alpha: boolean): void {
    this.#state.colorMask = [!!red, !!green, !!blue, !!alpha];
  }

  depthMask(flag: boolean): void {
    this.#state.depthMask = !!flag;
  }

  depthFunc(func: number): void {
    if (!DEPTH_FUNCS.includes(func)) {
      this.#recordError(GL.INVALID_ENUM);
      return;
    }
    this.#state.depthFunc = func;
  }

  depthRange(zNear: number, zFar: number): void {
    this.#state.depthRange = [clamp01(zNear), clamp01(zFar)];
  }

  blendFunc(sfactor: number, dfactor: number): void {
    this.blendFuncSeparate(sfactor, dfactor, sfactor, dfactor);
  }

  blendFuncSeparate(
    srcRGB: number,
    dstRGB: number,
    srcAlpha: number,
    dstAlpha: number,
  ): void {
    for (const factor of [srcRGB, dstRGB, srcAlpha, dstAlpha]) {
      if (!BLEND_FACTORS.includes(factor)) {
        this.#recordError(GL.INVALID_ENUM);
        return;
      }
    }
    this.#state.blendSrcRgb = srcRGB;
    this.#state.blendDstRgb = dstRGB;
    this.#state.blendSrcAlpha = srcAlpha;
    this.#state.blendDstAlpha = dstAlpha;
  }

  blendEquation(mode: number): void {
    this.blendEquationSeparate(mode, mode);
  }

  blendEquationSeparate(modeRGB: number, modeAlpha: number): void {
    for (const mode of [modeRGB, modeAlpha]) {
      if (mode === GL.MIN || mode === GL.MAX)
        this.#notImplemented("blendEquation(MIN | MAX)");
      if (
        mode !== GL.FUNC_ADD &&
        mode !== GL.FUNC_SUBTRACT &&
        mode !== GL.FUNC_REVERSE_SUBTRACT
      ) {
        this.#recordError(GL.INVALID_ENUM);
        return;
      }
    }
    this.#state.blendEquationRgb = modeRGB;
    this.#state.blendEquationAlpha = modeAlpha;
  }

  blendColor(red: number, green: number, blue: number, alpha: number): void {
    this.#state.blendColor = [
      clamp01(red),
      clamp01(green),
      clamp01(blue),
      clamp01(alpha),
    ];
  }

  cullFace(mode: number): void {
    if (mode !== GL.FRONT && mode !== GL.BACK && mode !== GL.FRONT_AND_BACK) {
      this.#recordError(GL.INVALID_ENUM);
      return;
    }
    this.#state.cullFaceMode = mode;
  }

  frontFace(mode: number): void {
    if (mode !== GL.CW && mode !== GL.CCW) {
      this.#recordError(GL.INVALID_ENUM);
      return;
    }
    this.#state.frontFace = mode;
  }

  /** Accepted and stored; only width 1 is ever rasterized, which is all WebGL2 itself guarantees. */
  lineWidth(width: number): void {
    // Written as a negated comparison so NaN also refuses, keeping state deterministic.
    if (!(width > 0)) {
      this.#recordError(GL.INVALID_VALUE);
      return;
    }
    this.#state.lineWidth = width;
  }

  polygonOffset(factor: number, units: number): void {
    this.#state.polygonOffsetFactor = factor;
    this.#state.polygonOffsetUnits = units;
  }

  /** Hints are validated and ignored — this rasterizer has no quality knobs to trade. */
  hint(target: number, mode: number): void {
    if (
      target !== GL.GENERATE_MIPMAP_HINT &&
      target !== GL.FRAGMENT_SHADER_DERIVATIVE_HINT
    ) {
      this.#recordError(GL.INVALID_ENUM);
      return;
    }
    if (mode !== GL.DONT_CARE && mode !== GL.FASTEST && mode !== GL.NICEST) {
      this.#recordError(GL.INVALID_ENUM);
    }
  }

  viewport(x: number, y: number, width: number, height: number): void {
    if (width < 0 || height < 0) {
      this.#recordError(GL.INVALID_VALUE);
      return;
    }
    this.#state.viewport = [toInt(x), toInt(y), toInt(width), toInt(height)];
  }

  scissor(x: number, y: number, width: number, height: number): void {
    if (width < 0 || height < 0) {
      this.#recordError(GL.INVALID_VALUE);
      return;
    }
    this.#state.scissor = [toInt(x), toInt(y), toInt(width), toInt(height)];
  }

  /* ------------------------------------------------------------------ */
  /* Pixel store                                                         */
  /* ------------------------------------------------------------------ */

  pixelStorei(pname: number, param: number | boolean): void {
    switch (pname) {
      case GL.UNPACK_ALIGNMENT:
      case GL.PACK_ALIGNMENT: {
        const value = Number(param);
        if (value !== 1 && value !== 2 && value !== 4 && value !== 8) {
          this.#recordError(GL.INVALID_VALUE);
          return;
        }
        if (pname === GL.UNPACK_ALIGNMENT) this.#state.unpackAlignment = value;
        else this.#state.packAlignment = value;
        return;
      }
      case GL.UNPACK_FLIP_Y_WEBGL:
        this.#state.unpackFlipY = !!param;
        return;
      case GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL:
        this.#state.unpackPremultiplyAlpha = !!param;
        return;
      case GL.UNPACK_COLORSPACE_CONVERSION_WEBGL: {
        const value = Number(param);
        if (value !== GL.BROWSER_DEFAULT_WEBGL && value !== GL.NONE) {
          this.#recordError(GL.INVALID_VALUE);
          return;
        }
        this.#state.unpackColorspaceConversion = value;
        return;
      }
      case GL.UNPACK_ROW_LENGTH:
      case GL.UNPACK_SKIP_ROWS:
      case GL.UNPACK_SKIP_PIXELS:
      case GL.UNPACK_SKIP_IMAGES:
      case GL.UNPACK_IMAGE_HEIGHT:
      case GL.PACK_ROW_LENGTH:
      case GL.PACK_SKIP_ROWS:
      case GL.PACK_SKIP_PIXELS:
        this.#notImplemented(
          "pixelStorei with the WebGL2 row-length/skip parameters",
        );
        return;
      default:
        this.#recordError(GL.INVALID_ENUM);
    }
  }

  /* ------------------------------------------------------------------ */
  /* getParameter                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Typed `any` to match the DOM contract validator code is written against —
   * `gl.getParameter(gl.MAX_TEXTURE_SIZE) >= 2048` must typecheck the way it
   * does in a browser. Array-valued answers are fresh copies per call, so a
   * caller cannot mutate context state through them.
   */
  getParameter(pname: number): any {
    const s = this.#state;
    switch (pname) {
      case GL.ACTIVE_TEXTURE:
        return GL.TEXTURE0 + s.activeTextureUnit;
      case GL.ALIASED_LINE_WIDTH_RANGE:
        return new Float32Array([1, 1]);
      case GL.ALIASED_POINT_SIZE_RANGE:
        return new Float32Array([1, 1]);
      case GL.ARRAY_BUFFER_BINDING:
        return s.arrayBuffer;
      case GL.ELEMENT_ARRAY_BUFFER_BINDING:
        return s.vertexArray.elementArrayBuffer;
      case GL.VERTEX_ARRAY_BINDING:
        return s.vertexArray.isDefault ? null : s.vertexArray;
      case GL.CURRENT_PROGRAM:
        return s.program;
      case GL.TEXTURE_BINDING_2D:
        return this.#activeUnit().texture2d;
      case GL.FRAMEBUFFER_BINDING: // === DRAW_FRAMEBUFFER_BINDING
      case GL.READ_FRAMEBUFFER_BINDING:
      case GL.RENDERBUFFER_BINDING:
        return null;
      case GL.BLEND:
      case GL.CULL_FACE:
      case GL.DEPTH_TEST:
      case GL.DITHER:
      case GL.POLYGON_OFFSET_FILL:
      case GL.SCISSOR_TEST:
      case GL.STENCIL_TEST:
        return s.capabilities.get(pname) === true;
      case GL.BLEND_SRC_RGB:
        return s.blendSrcRgb;
      case GL.BLEND_DST_RGB:
        return s.blendDstRgb;
      case GL.BLEND_SRC_ALPHA:
        return s.blendSrcAlpha;
      case GL.BLEND_DST_ALPHA:
        return s.blendDstAlpha;
      case GL.BLEND_EQUATION_RGB: // === BLEND_EQUATION
        return s.blendEquationRgb;
      case GL.BLEND_EQUATION_ALPHA:
        return s.blendEquationAlpha;
      case GL.BLEND_COLOR:
        return new Float32Array(s.blendColor);
      case GL.COLOR_CLEAR_VALUE:
        return new Float32Array(s.clearColor);
      case GL.COLOR_WRITEMASK:
        return [...s.colorMask];
      case GL.DEPTH_CLEAR_VALUE:
        return s.clearDepth;
      case GL.DEPTH_FUNC:
        return s.depthFunc;
      case GL.DEPTH_RANGE:
        return new Float32Array(s.depthRange);
      case GL.DEPTH_WRITEMASK:
        return s.depthMask;
      case GL.CULL_FACE_MODE:
        return s.cullFaceMode;
      case GL.FRONT_FACE:
        return s.frontFace;
      case GL.LINE_WIDTH:
        return s.lineWidth;
      case GL.POLYGON_OFFSET_FACTOR:
        return s.polygonOffsetFactor;
      case GL.POLYGON_OFFSET_UNITS:
        return s.polygonOffsetUnits;
      case GL.VIEWPORT:
        return new Int32Array(s.viewport);
      case GL.SCISSOR_BOX:
        return new Int32Array(s.scissor);
      case GL.MAX_TEXTURE_SIZE:
        return LIMITS.maxTextureSize;
      case GL.MAX_TEXTURE_IMAGE_UNITS:
        return LIMITS.maxTextureImageUnits;
      case GL.MAX_COMBINED_TEXTURE_IMAGE_UNITS:
        return LIMITS.maxCombinedTextureImageUnits;
      case GL.MAX_VERTEX_TEXTURE_IMAGE_UNITS:
        return LIMITS.maxVertexTextureImageUnits;
      case GL.MAX_VERTEX_ATTRIBS:
        return LIMITS.maxVertexAttribs;
      case GL.MAX_VARYING_VECTORS:
        return LIMITS.maxVaryingVectors;
      case GL.MAX_VERTEX_UNIFORM_VECTORS:
        return LIMITS.maxVertexUniformVectors;
      case GL.MAX_FRAGMENT_UNIFORM_VECTORS:
        return LIMITS.maxFragmentUniformVectors;
      case GL.MAX_VIEWPORT_DIMS:
        return new Int32Array([LIMITS.maxViewportDims, LIMITS.maxViewportDims]);
      case GL.PACK_ALIGNMENT:
        return s.packAlignment;
      case GL.UNPACK_ALIGNMENT:
        return s.unpackAlignment;
      case GL.UNPACK_FLIP_Y_WEBGL:
        return s.unpackFlipY;
      case GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL:
        return s.unpackPremultiplyAlpha;
      case GL.UNPACK_COLORSPACE_CONVERSION_WEBGL:
        return s.unpackColorspaceConversion;
      case GL.VENDOR:
        return "test-cabinet";
      case GL.RENDERER:
        return "headless-webgl2 software";
      case GL.VERSION:
        return "WebGL 2.0 (headless-webgl2)";
      case GL.SHADING_LANGUAGE_VERSION:
        return "WebGL GLSL ES 3.00 (headless-webgl2)";
      // The antialias attribute is 2×2 supersampling — four samples per
      // pixel resolved at readPixels — reported through the multisample
      // queries because they are the API's one vocabulary for "this buffer
      // has more than one sample per pixel".
      case GL.SAMPLES:
        return this.#attributes.antialias ? 4 : 0;
      case GL.SAMPLE_BUFFERS:
        return this.#attributes.antialias ? 1 : 0;
      case GL.RED_BITS:
      case GL.GREEN_BITS:
      case GL.BLUE_BITS:
        return 8;
      case GL.ALPHA_BITS:
        return this.#attributes.alpha ? 8 : 0;
      case GL.DEPTH_BITS:
        return this.#attributes.depth ? 24 : 0;
      case GL.STENCIL_BITS:
        return 0;
      case GL.SUBPIXEL_BITS:
        return 4;
      case GL.IMPLEMENTATION_COLOR_READ_FORMAT:
        return GL.RGBA;
      case GL.IMPLEMENTATION_COLOR_READ_TYPE:
        return GL.UNSIGNED_BYTE;
      case GL.COMPRESSED_TEXTURE_FORMATS:
        return new Uint32Array(0);
      default:
        this.#recordError(GL.INVALID_ENUM);
        return null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Clearing                                                            */
  /* ------------------------------------------------------------------ */

  clear(mask: number): void {
    if (
      (mask &
        ~(
          GL.COLOR_BUFFER_BIT |
          GL.DEPTH_BUFFER_BIT |
          GL.STENCIL_BUFFER_BIT
        )) !==
      0
    ) {
      this.#recordError(GL.INVALID_VALUE);
      return;
    }
    if ((mask & GL.STENCIL_BUFFER_BIT) !== 0)
      this.#notImplemented(
        "clear(STENCIL_BUFFER_BIT) — no stencil buffer is allocated",
      );
    const s = this.#state;
    // The scissor box bounds a clear exactly as it bounds a draw; letterbox
    // bars depend on this (scissored clears are a documented engine idiom).
    const rect =
      s.capabilities.get(GL.SCISSOR_TEST) === true
        ? {
            x: s.scissor[0],
            y: s.scissor[1],
            width: s.scissor[2],
            height: s.scissor[3],
          }
        : {
            x: 0,
            y: 0,
            width: this.#framebuffer.width,
            height: this.#framebuffer.height,
          };
    if ((mask & GL.COLOR_BUFFER_BIT) !== 0) {
      this.#framebuffer.clearColorRect(rect, s.clearColor, s.colorMask);
    }
    if ((mask & GL.DEPTH_BUFFER_BIT) !== 0 && s.depthMask) {
      // depthMask gates the clear per the GL spec, exactly as colorMask gates
      // the color channels above.
      this.#framebuffer.clearDepthRect(rect, s.clearDepth);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Buffers                                                             */
  /* ------------------------------------------------------------------ */

  createBuffer(): BufferObject {
    const buffer = new BufferObject();
    this.#owned.add(buffer);
    return buffer;
  }

  isBuffer(buffer: unknown): boolean {
    return (
      buffer instanceof BufferObject &&
      this.#owned.has(buffer) &&
      buffer.everBound &&
      !buffer.deleted
    );
  }

  /** Resolves a bind target to its binding slot, or null after latching the right error/throw. */
  #bufferBindingFor(target: number, call: string): "array" | "element" | null {
    if (target === GL.ARRAY_BUFFER) return "array";
    if (target === GL.ELEMENT_ARRAY_BUFFER) return "element";
    const excluded = BUFFER_TARGETS_EXCLUDED.get(target);
    if (excluded !== undefined) this.#notImplemented(`${call}(${excluded})`);
    this.#recordError(GL.INVALID_ENUM);
    return null;
  }

  bindBuffer(target: number, buffer: BufferObject | null): void {
    const slot = this.#bufferBindingFor(target, "bindBuffer");
    if (slot === null) return;
    if (buffer !== null) {
      if (!(buffer instanceof BufferObject) || !this.#owned.has(buffer)) {
        this.#recordError(GL.INVALID_OPERATION);
        return;
      }
      if (buffer.deleted) {
        this.#recordError(GL.INVALID_OPERATION);
        return;
      }
      buffer.everBound = true;
    }
    if (slot === "array") this.#state.arrayBuffer = buffer;
    // The index-buffer binding lives on the vertex array object, per spec.
    else this.#state.vertexArray.elementArrayBuffer = buffer;
  }

  #boundBuffer(target: number, call: string): BufferObject | null {
    const slot = this.#bufferBindingFor(target, call);
    if (slot === null) return null;
    const buffer =
      slot === "array"
        ? this.#state.arrayBuffer
        : this.#state.vertexArray.elementArrayBuffer;
    if (buffer === null) this.#recordError(GL.INVALID_OPERATION);
    return buffer;
  }

  bufferData(target: number, size: number, usage: number): void;
  bufferData(
    target: number,
    data: ArrayBufferView | ArrayBuffer,
    usage: number,
  ): void;
  bufferData(
    target: number,
    srcData: ArrayBufferView,
    usage: number,
    srcOffset: number,
    length?: number,
  ): void;
  bufferData(
    target: number,
    sizeOrData: number | ArrayBufferView | ArrayBuffer | null,
    usage: number,
    srcOffset = 0,
    length?: number,
  ): void {
    const buffer = this.#boundBuffer(target, "bufferData");
    if (buffer === null) return;
    if (!BUFFER_USAGES.includes(usage)) {
      this.#recordError(GL.INVALID_ENUM);
      return;
    }
    if (typeof sizeOrData === "number") {
      if (sizeOrData < 0) {
        this.#recordError(GL.INVALID_VALUE);
        return;
      }
      buffer.data = new Uint8Array(toInt(sizeOrData));
    } else if (sizeOrData instanceof ArrayBuffer) {
      // Sliced into a fresh copy: GL buffer stores are copies, so mutating
      // the source afterwards must not change what a draw reads.
      buffer.data = new Uint8Array(sizeOrData.slice(0));
    } else if (sizeOrData !== null && ArrayBuffer.isView(sizeOrData)) {
      const view = sizeOrData;
      // A DataView has no BYTES_PER_ELEMENT; GL treats it as bytes.
      const elementSize =
        (view as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT ?? 1;
      const elementCount = view.byteLength / elementSize;
      const takeElements = length ?? elementCount - srcOffset;
      if (
        srcOffset < 0 ||
        takeElements < 0 ||
        srcOffset + takeElements > elementCount
      ) {
        this.#recordError(GL.INVALID_VALUE);
        return;
      }
      const byteStart = view.byteOffset + srcOffset * elementSize;
      const byteLength = takeElements * elementSize;
      buffer.data = new Uint8Array(
        view.buffer.slice(byteStart, byteStart + byteLength),
      );
    } else {
      // WebGL generates INVALID_VALUE for a null data argument.
      this.#recordError(GL.INVALID_VALUE);
      return;
    }
    buffer.usage = usage;
  }

  bufferSubData(
    target: number,
    dstByteOffset: number,
    srcData: ArrayBufferView | ArrayBuffer,
    srcOffset = 0,
    length?: number,
  ): void {
    const buffer = this.#boundBuffer(target, "bufferSubData");
    if (buffer === null) return;
    if (buffer.data === null) {
      this.#recordError(GL.INVALID_OPERATION);
      return;
    }
    let bytes: Uint8Array;
    if (srcData instanceof ArrayBuffer) {
      bytes = new Uint8Array(srcData);
    } else if (ArrayBuffer.isView(srcData)) {
      // A DataView has no BYTES_PER_ELEMENT; GL treats it as bytes.
      const elementSize =
        (srcData as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT ?? 1;
      const elementCount = srcData.byteLength / elementSize;
      const takeElements = length ?? elementCount - srcOffset;
      if (
        srcOffset < 0 ||
        takeElements < 0 ||
        srcOffset + takeElements > elementCount
      ) {
        this.#recordError(GL.INVALID_VALUE);
        return;
      }
      bytes = new Uint8Array(
        srcData.buffer,
        srcData.byteOffset + srcOffset * elementSize,
        takeElements * elementSize,
      );
    } else {
      this.#recordError(GL.INVALID_VALUE);
      return;
    }
    if (
      dstByteOffset < 0 ||
      dstByteOffset + bytes.length > buffer.data.length
    ) {
      this.#recordError(GL.INVALID_VALUE);
      return;
    }
    buffer.data.set(bytes, dstByteOffset);
  }

  getBufferParameter(target: number, pname: number): any {
    const buffer = this.#boundBuffer(target, "getBufferParameter");
    if (buffer === null) return null;
    if (pname === GL.BUFFER_SIZE) return buffer.data?.length ?? 0;
    if (pname === GL.BUFFER_USAGE) return buffer.usage;
    this.#recordError(GL.INVALID_ENUM);
    return null;
  }

  deleteBuffer(buffer: BufferObject | null): void {
    if (
      buffer === null ||
      !(buffer instanceof BufferObject) ||
      !this.#owned.has(buffer) ||
      buffer.deleted
    )
      return;
    buffer.deleted = true;
    // Deleting detaches the buffer from the context's bindings and from the
    // attachment points of the currently bound VAO, per ES 3.0 §5.1.2. Other
    // VAOs keep their (now dangling) references, also per spec.
    if (this.#state.arrayBuffer === buffer) this.#state.arrayBuffer = null;
    const vao = this.#state.vertexArray;
    if (vao.elementArrayBuffer === buffer) vao.elementArrayBuffer = null;
    for (const attrib of vao.attribs) {
      if (attrib.buffer === buffer) attrib.buffer = null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Vertex arrays and attributes                                        */
  /* ------------------------------------------------------------------ */

  createVertexArray(): VertexArrayObject {
    const vao = new VertexArrayObject(LIMITS.maxVertexAttribs);
    this.#owned.add(vao);
    return vao;
  }

  isVertexArray(vao: unknown): boolean {
    return (
      vao instanceof VertexArrayObject &&
      this.#owned.has(vao) &&
      vao.everBound &&
      !vao.deleted &&
      !vao.isDefault
    );
  }

  bindVertexArray(vao: VertexArrayObject | null): void {
    if (vao === null) {
      this.#state.vertexArray = this.#state.defaultVertexArray;
      return;
    }
    if (
      !(vao instanceof VertexArrayObject) ||
      !this.#owned.has(vao) ||
      vao.deleted ||
      vao.isDefault
    ) {
      this.#recordError(GL.INVALID_OPERATION);
      return;
    }
    vao.everBound = true;
    this.#state.vertexArray = vao;
  }

  deleteVertexArray(vao: VertexArrayObject | null): void {
    if (
      vao === null ||
      !(vao instanceof VertexArrayObject) ||
      !this.#owned.has(vao) ||
      vao.deleted ||
      vao.isDefault
    )
      return;
    vao.deleted = true;
    // Deleting the bound VAO rebinds the default one, per spec.
    if (this.#state.vertexArray === vao)
      this.#state.vertexArray = this.#state.defaultVertexArray;
  }

  /** Validates an attribute index, latching INVALID_VALUE for one out of range. */
  #checkAttribIndex(index: number): boolean {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= LIMITS.maxVertexAttribs
    ) {
      this.#recordError(GL.INVALID_VALUE);
      return false;
    }
    return true;
  }

  enableVertexAttribArray(index: number): void {
    if (!this.#checkAttribIndex(index)) return;
    const attrib = this.#state.vertexArray.attribs[index];
    if (attrib) attrib.enabled = true;
  }

  disableVertexAttribArray(index: number): void {
    if (!this.#checkAttribIndex(index)) return;
    const attrib = this.#state.vertexArray.attribs[index];
    if (attrib) attrib.enabled = false;
  }

  vertexAttribPointer(
    index: number,
    size: number,
    type: number,
    normalized: boolean,
    stride: number,
    offset: number,
  ): void {
    if (!this.#checkAttribIndex(index)) return;
    if (size < 1 || size > 4 || !Number.isInteger(size)) {
      this.#recordError(GL.INVALID_VALUE);
      return;
    }
    if (!ATTRIB_TYPES.includes(type)) {
      if (ATTRIB_TYPES_EXCLUDED.includes(type))
        this.#notImplemented(
          "vertexAttribPointer with INT/UNSIGNED_INT/HALF_FLOAT/packed fetch types",
        );
      this.#recordError(GL.INVALID_ENUM);
      return;
    }
    if (stride < 0 || stride > 255 || offset < 0) {
      this.#recordError(GL.INVALID_VALUE);
      return;
    }
    const typeSize = ATTRIB_TYPE_SIZES.get(type) ?? 1;
    // Stride and offset must be type-size multiples, a WebGL-specific rule.
    if (stride % typeSize !== 0 || offset % typeSize !== 0) {
      this.#recordError(GL.INVALID_OPERATION);
      return;
    }
    const buffer = this.#state.arrayBuffer;
    // WebGL refuses client-side arrays outright: no bound ARRAY_BUFFER means
    // there is nothing for the pointer to point into.
    if (buffer === null) {
      this.#recordError(GL.INVALID_OPERATION);
      return;
    }
    const attrib = this.#state.vertexArray.attribs[index];
    if (!attrib) return;
    attrib.buffer = buffer;
    attrib.size = size;
    attrib.type = type;
    attrib.normalized = !!normalized;
    attrib.stride = toInt(stride);
    attrib.offset = toInt(offset);
  }

  /** Writes a generic attribute value; the constant fed to a disabled array, context state per GL. */
  #setGenericAttrib(
    index: number,
    x: number,
    y: number,
    z: number,
    w: number,
  ): void {
    if (!this.#checkAttribIndex(index)) return;
    const slot = this.#state.genericAttribs[index];
    if (!slot) return;
    slot[0] = x;
    slot[1] = y;
    slot[2] = z;
    slot[3] = w;
  }

  vertexAttrib1f(index: number, x: number): void {
    this.#setGenericAttrib(index, x, 0, 0, 1);
  }

  vertexAttrib2f(index: number, x: number, y: number): void {
    this.#setGenericAttrib(index, x, y, 0, 1);
  }

  vertexAttrib3f(index: number, x: number, y: number, z: number): void {
    this.#setGenericAttrib(index, x, y, z, 1);
  }

  vertexAttrib4f(
    index: number,
    x: number,
    y: number,
    z: number,
    w: number,
  ): void {
    this.#setGenericAttrib(index, x, y, z, w);
  }

  #genericAttribFromList(
    index: number,
    values: Float32Array | number[],
    count: number,
  ): void {
    if (values.length < count) {
      this.#recordError(GL.INVALID_VALUE);
      return;
    }
    const v = (i: number): number =>
      i < count ? Number(values[i]) : i === 3 ? 1 : 0;
    this.#setGenericAttrib(index, v(0), v(1), v(2), v(3));
  }

  vertexAttrib1fv(index: number, values: Float32Array | number[]): void {
    this.#genericAttribFromList(index, values, 1);
  }

  vertexAttrib2fv(index: number, values: Float32Array | number[]): void {
    this.#genericAttribFromList(index, values, 2);
  }

  vertexAttrib3fv(index: number, values: Float32Array | number[]): void {
    this.#genericAttribFromList(index, values, 3);
  }

  vertexAttrib4fv(index: number, values: Float32Array | number[]): void {
    this.#genericAttribFromList(index, values, 4);
  }

  getVertexAttrib(index: number, pname: number): any {
    if (!this.#checkAttribIndex(index)) return null;
    const attrib = this.#state.vertexArray.attribs[index];
    const generic = this.#state.genericAttribs[index];
    if (!attrib || !generic) return null;
    switch (pname) {
      case GL.VERTEX_ATTRIB_ARRAY_ENABLED:
        return attrib.enabled;
      case GL.VERTEX_ATTRIB_ARRAY_SIZE:
        return attrib.size;
      case GL.VERTEX_ATTRIB_ARRAY_STRIDE:
        return attrib.stride;
      case GL.VERTEX_ATTRIB_ARRAY_TYPE:
        return attrib.type;
      case GL.VERTEX_ATTRIB_ARRAY_NORMALIZED:
        return attrib.normalized;
      case GL.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING:
        return attrib.buffer;
      case GL.VERTEX_ATTRIB_ARRAY_INTEGER:
        return false;
      case GL.VERTEX_ATTRIB_ARRAY_DIVISOR:
        return 0;
      case GL.CURRENT_VERTEX_ATTRIB:
        return new Float32Array(generic);
      default:
        this.#recordError(GL.INVALID_ENUM);
        return null;
    }
  }

  getVertexAttribOffset(index: number, pname: number): number {
    if (!this.#checkAttribIndex(index)) return 0;
    if (pname !== GL.VERTEX_ATTRIB_ARRAY_POINTER) {
      this.#recordError(GL.INVALID_ENUM);
      return 0;
    }
    return this.#state.vertexArray.attribs[index]?.offset ?? 0;
  }

  /* ------------------------------------------------------------------ */
  /* Textures                                                            */
  /* ------------------------------------------------------------------ */

  #activeUnit(): TextureUnit {
    const unit = this.#state.textureUnits[this.#state.activeTextureUnit];
    if (!unit)
      throw new Error(
        "headless-webgl2: internal invariant broken: the active texture unit is out of range",
      );
    return unit;
  }

  createTexture(): TextureObject {
    const texture = new TextureObject();
    this.#owned.add(texture);
    return texture;
  }

  isTexture(texture: unknown): boolean {
    return (
      texture instanceof TextureObject &&
      this.#owned.has(texture) &&
      texture.everBound &&
      !texture.deleted
    );
  }

  activeTexture(unit: number): void {
    if (unit < GL.TEXTURE0 || unit >= GL.TEXTURE0 + LIMITS.textureUnits) {
      this.#recordError(GL.INVALID_ENUM);
      return;
    }
    this.#state.activeTextureUnit = unit - GL.TEXTURE0;
  }

  #checkTexture2dTarget(target: number, call: string): boolean {
    if (target === GL.TEXTURE_2D) return true;
    const excluded = TEXTURE_TARGETS_EXCLUDED.get(target);
    if (excluded !== undefined) this.#notImplemented(`${call}(${excluded})`);
    this.#recordError(GL.INVALID_ENUM);
    return false;
  }

  bindTexture(target: number, texture: TextureObject | null): void {
    if (!this.#checkTexture2dTarget(target, "bindTexture")) return;
    if (texture !== null) {
      if (
        !(texture instanceof TextureObject) ||
        !this.#owned.has(texture) ||
        texture.deleted
      ) {
        this.#recordError(GL.INVALID_OPERATION);
        return;
      }
      texture.everBound = true;
    }
    this.#activeUnit().texture2d = texture;
  }

  deleteTexture(texture: TextureObject | null): void {
    if (
      texture === null ||
      !(texture instanceof TextureObject) ||
      !this.#owned.has(texture) ||
      texture.deleted
    )
      return;
    texture.deleted = true;
    for (const unit of this.#state.textureUnits) {
      if (unit.texture2d === texture) unit.texture2d = null;
    }
  }

  texImage2D(
    target: number,
    level: number,
    internalformat: number,
    width: number,
    height: number,
    border: number,
    format: number,
    type: number,
    pixels: ArrayBufferView | null,
  ): void;
  texImage2D(
    target: number,
    level: number,
    internalformat: number,
    format: number,
    type: number,
    source: unknown,
  ): void;
  texImage2D(
    target: number,
    level: number,
    internalformat: number,
    a: number,
    b: number,
    c: unknown,
    d?: number,
    e?: number,
    f?: ArrayBufferView | null,
  ): void {
    if (d === undefined || e === undefined) {
      // The six-argument DOM-source overload. It cannot exist in Node — there
      // is no ImageBitmap/HTMLImageElement — so the engines decode images
      // themselves and upload bytes (binding decision 8).
      throw new Error(
        "headless-webgl2: the DOM-source overload of texImage2D is not implemented: Node has no image elements, so decode the image to RGBA bytes and upload through the ArrayBufferView overload",
      );
    }
    const width = a;
    const height = b;
    const border = Number(c);
    const format = d;
    const type = e;
    const pixels = f ?? null;
    if (!this.#checkTexture2dTarget(target, "texImage2D")) return;
    const texture = this.#activeUnit().texture2d;
    if (texture === null) {
      this.#recordError(GL.INVALID_OPERATION);
      return;
    }
    if (texture.immutable) {
      // texStorage2D storage cannot be reallocated, per ES 3.0; update it
      // through texSubImage2D instead.
      this.#recordError(GL.INVALID_OPERATION);
      return;
    }
    if (level < 0 || width < 0 || height < 0 || border !== 0) {
      this.#recordError(GL.INVALID_VALUE);
      return;
    }
    if (level > 0)
      this.#notImplemented(
        "texImage2D at a mip level above 0 (mipmaps are outside 0.1.0; use base-level NEAREST/LINEAR filtering)",
      );
    if (width > LIMITS.maxTextureSize || height > LIMITS.maxTextureSize) {
      this.#recordError(GL.INVALID_VALUE);
      return;
    }
    if (type !== GL.UNSIGNED_BYTE) {
      if (PIXEL_TYPES_KNOWN.includes(type))
        this.#notImplemented(
          "texImage2D with a pixel type other than UNSIGNED_BYTE (float and packed texture types are outside 0.1.0)",
        );
      this.#recordError(GL.INVALID_ENUM);
      return;
    }
    const layout = TEXTURE_FORMATS.get(internalformat);
    if (layout === undefined)
      this.#notImplemented(
        "texImage2D with an internal format outside RGBA/RGBA8, RGB/RGB8, RED/R8, LUMINANCE, LUMINANCE_ALPHA, and ALPHA",
      );
    if (format !== layout.format) {
      this.#recordError(GL.INVALID_OPERATION);
      return;
    }
    const channels = layout.channels;
    let data: Uint8Array;
    if (pixels === null) {
      // A null upload allocates zeroed storage, per GL.
      data = new Uint8Array(width * height * channels);
    } else {
      const unpacked = this.#unpackPixels(pixels, width, height, channels, 0);
      if (unpacked === null) return;
      data = unpacked;
    }
    const image: TextureImage = {
      width,
      height,
      internalFormat: internalformat,
      format,
      type,
      channels,
      data,
    };
    texture.image = image;
  }

  /**
   * Unpacks an uploaded pixel rectangle into a tightly packed copy, applying
   * the pixel storage parameters exactly once for both upload entry points:
   * UNPACK_ALIGNMENT row padding, UNPACK_FLIP_Y row reversal (the store
   * always holds rows in GL order), and UNPACK_PREMULTIPLY_ALPHA on RGBA
   * data. Returns null after latching the right error for a wrong view type
   * or a source too small for the rectangle.
   */
  #unpackPixels(
    pixels: ArrayBufferView,
    width: number,
    height: number,
    channels: number,
    srcOffset: number,
  ): Uint8Array | null {
    if (
      !(pixels instanceof Uint8Array) &&
      !(pixels instanceof Uint8ClampedArray)
    ) {
      // The view type must match the pixel type, per WebGL.
      this.#recordError(GL.INVALID_OPERATION);
      return null;
    }
    if (srcOffset < 0 || srcOffset > pixels.length) {
      this.#recordError(GL.INVALID_VALUE);
      return null;
    }
    const rowBytes = width * channels;
    const srcStride =
      Math.ceil(rowBytes / this.#state.unpackAlignment) *
      this.#state.unpackAlignment;
    const needed = height === 0 ? 0 : srcStride * (height - 1) + rowBytes;
    if (pixels.byteLength - srcOffset < needed) {
      this.#recordError(GL.INVALID_OPERATION);
      return null;
    }
    const data = new Uint8Array(width * height * channels);
    const src =
      pixels instanceof Uint8Array
        ? pixels
        : new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
    for (let row = 0; row < height; row += 1) {
      const srcRow = this.#state.unpackFlipY ? height - 1 - row : row;
      const start = srcOffset + srcRow * srcStride;
      data.set(src.subarray(start, start + rowBytes), row * rowBytes);
    }
    if (this.#state.unpackPremultiplyAlpha && channels === 4) {
      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3] ?? 0;
        data[i] = Math.round(((data[i] ?? 0) * alpha) / 255);
        data[i + 1] = Math.round(((data[i + 1] ?? 0) * alpha) / 255);
        data[i + 2] = Math.round(((data[i + 2] ?? 0) * alpha) / 255);
      }
    }
    return data;
  }

  /**
   * Updates a sub-rectangle of the bound texture's base image. Only the
   * ArrayBufferView overload exists (the DOM-source forms cannot exist in
   * Node — the engines decode images themselves, binding decision 8), the
   * rect must lie inside the existing image, and the client format must
   * match the stored one, per ES 3.0. The pixel storage parameters apply to
   * the uploaded rectangle exactly as they apply to a whole-image upload —
   * UNPACK_FLIP_Y reverses the source rows within the rect while the
   * destination offsets stand.
   */
  texSubImage2D(
    target: number,
    level: number,
    xoffset: number,
    yoffset: number,
    width: number,
    height: number,
    format: number,
    type: number,
    pixels: ArrayBufferView | null,
    srcOffset?: number,
  ): void;
  texSubImage2D(
    target: number,
    level: number,
    xoffset: number,
    yoffset: number,
    format: number,
    type: number,
    source: unknown,
  ): void;
  texSubImage2D(
    target: number,
    level: number,
    xoffset: number,
    yoffset: number,
    a: number,
    b: number,
    c: number | unknown,
    d?: number,
    e?: ArrayBufferView | null | unknown,
    f?: number,
  ): void {
    if (
      d === undefined ||
      (e !== null && e !== undefined && !ArrayBuffer.isView(e))
    ) {
      // Either the seven-argument DOM-source overload or the nine-argument
      // form with a TexImageSource where the view belongs.
      throw new Error(
        "headless-webgl2: the DOM-source overload of texSubImage2D is not implemented: Node has no image elements, so decode the image to RGBA bytes and upload through the ArrayBufferView overload",
      );
    }
    const width = Number(a);
    const height = Number(b);
    const format = Number(c);
    const type = d;
    const pixels = (e ?? null) as ArrayBufferView | null;
    const srcOffset = toInt(f ?? 0);
    if (!this.#checkTexture2dTarget(target, "texSubImage2D")) return;
    const texture = this.#activeUnit().texture2d;
    if (texture === null || texture.image === null) {
      this.#recordError(GL.INVALID_OPERATION);
      return;
    }
    if (level < 0 || xoffset < 0 || yoffset < 0 || width < 0 || height < 0) {
      this.#recordError(GL.INVALID_VALUE);
      return;
    }
    if (level > 0)
      this.#notImplemented(
        "texSubImage2D at a mip level above 0 (mipmaps are outside 0.1.0; use base-level NEAREST/LINEAR filtering)",
      );
    const image = texture.image;
    if (xoffset + width > image.width || yoffset + height > image.height) {
      this.#recordError(GL.INVALID_VALUE);
      return;
    }
    if (type !== GL.UNSIGNED_BYTE) {
      if (PIXEL_TYPES_KNOWN.includes(type))
        this.#notImplemented(
          "texSubImage2D with a pixel type other than UNSIGNED_BYTE (float and packed texture types are outside 0.1.0)",
        );
      this.#recordError(GL.INVALID_ENUM);
      return;
    }
    if (format !== image.format) {
      this.#recordError(GL.INVALID_OPERATION);
      return;
    }
    if (pixels === null) {
      // The ArrayBufferView overload refuses null, per WebGL2.
      this.#recordError(GL.INVALID_VALUE);
      return;
    }
    const channels = image.channels;
    const packed = this.#unpackPixels(
      pixels,
      width,
      height,
      channels,
      srcOffset,
    );
    if (packed === null) return;
    for (let row = 0; row < height; row += 1) {
      const dst = ((yoffset + row) * image.width + xoffset) * channels;
      image.data.set(
        packed.subarray(row * width * channels, (row + 1) * width * channels),
        dst,
      );
    }
  }

  /**
   * Allocates immutable storage for the bound texture. With mipmaps outside
   * 0.1.0 (binding decision 9) only `levels === 1` exists — more levels
   * throw by name — and the sized color formats the subset stores (RGBA8,
   * RGB8, R8) are accepted; the unsized spellings are INVALID_ENUM here, per
   * ES 3.0, because texStorage2D is the sized-format entry point.
   */
  texStorage2D(
    target: number,
    levels: number,
    internalformat: number,
    width: number,
    height: number,
  ): void {
    if (!this.#checkTexture2dTarget(target, "texStorage2D")) return;
    const texture = this.#activeUnit().texture2d;
    if (texture === null) {
      this.#recordError(GL.INVALID_OPERATION);
      return;
    }
    if (texture.immutable) {
      // Immutable storage is allocated exactly once, per ES 3.0.
      this.#recordError(GL.INVALID_OPERATION);
      return;
    }
    if (
      levels < 1 ||
      width < 1 ||
      height < 1 ||
      width > LIMITS.maxTextureSize ||
      height > LIMITS.maxTextureSize
    ) {
      this.#recordError(GL.INVALID_VALUE);
      return;
    }
    if (levels > 1)
      this.#notImplemented(
        "texStorage2D with more than one level (mipmaps are outside 0.1.0; allocate a single level)",
      );
    if (
      internalformat !== GL.RGBA8 &&
      internalformat !== GL.RGB8 &&
      internalformat !== GL.R8
    ) {
      if (TEXTURE_FORMATS.has(internalformat)) {
        // An unsized internal format is invalid here, per ES 3.0 §3.8.4 —
        // texStorage2D is the sized-format entry point.
        this.#recordError(GL.INVALID_ENUM);
        return;
      }
      this.#notImplemented(
        "texStorage2D with a sized internal format outside RGBA8, RGB8, and R8",
      );
    }
    const layout = TEXTURE_FORMATS.get(internalformat);
    if (layout === undefined) return;
    texture.image = {
      width,
      height,
      internalFormat: internalformat,
      format: layout.format,
      type: GL.UNSIGNED_BYTE,
      channels: layout.channels,
      data: new Uint8Array(width * height * layout.channels),
    };
    texture.immutable = true;
  }

  texParameteri(target: number, pname: number, param: number): void {
    if (!this.#checkTexture2dTarget(target, "texParameteri")) return;
    const texture = this.#activeUnit().texture2d;
    if (texture === null) {
      this.#recordError(GL.INVALID_OPERATION);
      return;
    }
    switch (pname) {
      case GL.TEXTURE_MAG_FILTER:
        if (param !== GL.NEAREST && param !== GL.LINEAR) {
          this.#recordError(GL.INVALID_ENUM);
          return;
        }
        texture.magFilter = param;
        return;
      case GL.TEXTURE_MIN_FILTER:
        if (param === GL.NEAREST || param === GL.LINEAR) {
          texture.minFilter = param;
          return;
        }
        if (
          param === GL.NEAREST_MIPMAP_NEAREST ||
          param === GL.NEAREST_MIPMAP_LINEAR ||
          param === GL.LINEAR_MIPMAP_NEAREST ||
          param === GL.LINEAR_MIPMAP_LINEAR
        ) {
          // Binding decision 9: no mipmaps in 0.1.0 — the engines set
          // base-level filters on every texture, and a mip filter here throws
          // rather than sampling a chain that does not exist.
          this.#notImplemented(
            "texParameteri with a mipmapped TEXTURE_MIN_FILTER (mipmaps are outside 0.1.0; use NEAREST or LINEAR)",
          );
        }
        this.#recordError(GL.INVALID_ENUM);
        return;
      case GL.TEXTURE_WRAP_S:
      case GL.TEXTURE_WRAP_T:
        if (
          param !== GL.CLAMP_TO_EDGE &&
          param !== GL.REPEAT &&
          param !== GL.MIRRORED_REPEAT
        ) {
          this.#recordError(GL.INVALID_ENUM);
          return;
        }
        if (pname === GL.TEXTURE_WRAP_S) texture.wrapS = param;
        else texture.wrapT = param;
        return;
      case GL.TEXTURE_WRAP_R:
      case GL.TEXTURE_MIN_LOD:
      case GL.TEXTURE_MAX_LOD:
      case GL.TEXTURE_BASE_LEVEL:
      case GL.TEXTURE_MAX_LEVEL:
      case GL.TEXTURE_COMPARE_MODE:
      case GL.TEXTURE_COMPARE_FUNC:
        this.#notImplemented(
          "texParameteri with the 3D-wrap/LOD/compare parameters",
        );
        return;
      default:
        this.#recordError(GL.INVALID_ENUM);
    }
  }

  texParameterf(target: number, pname: number, param: number): void {
    this.texParameteri(target, pname, param);
  }

  getTexParameter(target: number, pname: number): any {
    if (!this.#checkTexture2dTarget(target, "getTexParameter")) return null;
    const texture = this.#activeUnit().texture2d;
    if (texture === null) {
      this.#recordError(GL.INVALID_OPERATION);
      return null;
    }
    switch (pname) {
      case GL.TEXTURE_MAG_FILTER:
        return texture.magFilter;
      case GL.TEXTURE_MIN_FILTER:
        return texture.minFilter;
      case GL.TEXTURE_WRAP_S:
        return texture.wrapS;
      case GL.TEXTURE_WRAP_T:
        return texture.wrapT;
      default:
        this.#recordError(GL.INVALID_ENUM);
        return null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Shaders                                                             */
  /* ------------------------------------------------------------------ */

  createShader(type: number): ShaderObject | null {
    if (!SHADER_TYPES.includes(type)) {
      this.#recordError(GL.INVALID_ENUM);
      return null;
    }
    const shader = new ShaderObject(type);
    this.#owned.add(shader);
    return shader;
  }

  isShader(shader: unknown): boolean {
    return (
      shader instanceof ShaderObject &&
      this.#owned.has(shader) &&
      !shader.deleted
    );
  }

  /** Validates a shader argument, latching INVALID_OPERATION for foreign or deleted ones. */
  #checkShader(shader: unknown): shader is ShaderObject {
    if (
      !(shader instanceof ShaderObject) ||
      !this.#owned.has(shader) ||
      shader.deleted
    ) {
      this.#recordError(GL.INVALID_OPERATION);
      return false;
    }
    return true;
  }

  shaderSource(shader: ShaderObject, source: string): void {
    if (!this.#checkShader(shader)) return;
    shader.source = String(source);
  }

  getShaderSource(shader: ShaderObject): string | null {
    if (!this.#checkShader(shader)) return null;
    return shader.source;
  }

  /**
   * Runs the GLSL ES 3.00 subset front end (`src/glsl/`) over a snapshot of
   * the source: parse, type-check, and the subset's named refusals. Success
   * stores the checked shader for `linkProgram`; failure sets COMPILE_STATUS
   * false with a browser-shaped, line-numbered info log — never a throw,
   * because a broken shader is an ordinary outcome the engine's construction
   * error surfaces, exactly as in a browser. The grammar the front end
   * accepts is documented in `docs/glsl-subset.md`, binding for the engines'
   * shaders (binding decision 15).
   */
  compileShader(shader: ShaderObject): void {
    if (!this.#checkShader(shader)) return;
    // GL compiles a snapshot: `shaderSource` after this call must not change
    // what the program links against.
    shader.compiledSource = shader.source;
    const stage = shader.type === GL.VERTEX_SHADER ? "vertex" : "fragment";
    const result = compileStage(shader.compiledSource, stage);
    if (result.ok) {
      shader.compiled = result.shader;
      shader.compileStatus = true;
      shader.infoLog = "";
    } else {
      shader.compiled = null;
      shader.compileStatus = false;
      shader.infoLog = result.log;
    }
  }

  getShaderParameter(shader: ShaderObject, pname: number): any {
    if (!(shader instanceof ShaderObject) || !this.#owned.has(shader)) {
      this.#recordError(GL.INVALID_OPERATION);
      return null;
    }
    switch (pname) {
      case GL.COMPILE_STATUS:
        return shader.compileStatus;
      case GL.DELETE_STATUS:
        return shader.deleted;
      case GL.SHADER_TYPE:
        return shader.type;
      default:
        this.#recordError(GL.INVALID_ENUM);
        return null;
    }
  }

  getShaderInfoLog(shader: ShaderObject): string | null {
    if (!(shader instanceof ShaderObject) || !this.#owned.has(shader)) {
      this.#recordError(GL.INVALID_OPERATION);
      return null;
    }
    return shader.infoLog;
  }

  /**
   * Answers highp-float-ish figures because some engine boilerplate queries
   * precision before choosing shader precision qualifiers; all real math here
   * is f64, so these are lower bounds, not lies.
   */
  getShaderPrecisionFormat(
    shaderType: number,
    precisionType: number,
  ): { rangeMin: number; rangeMax: number; precision: number } | null {
    if (!SHADER_TYPES.includes(shaderType)) {
      this.#recordError(GL.INVALID_ENUM);
      return null;
    }
    switch (precisionType) {
      case GL.LOW_FLOAT:
      case GL.MEDIUM_FLOAT:
      case GL.HIGH_FLOAT:
        return { rangeMin: 127, rangeMax: 127, precision: 23 };
      case GL.LOW_INT:
      case GL.MEDIUM_INT:
      case GL.HIGH_INT:
        return { rangeMin: 31, rangeMax: 30, precision: 0 };
      default:
        this.#recordError(GL.INVALID_ENUM);
        return null;
    }
  }

  deleteShader(shader: ShaderObject | null): void {
    if (
      shader === null ||
      !(shader instanceof ShaderObject) ||
      !this.#owned.has(shader) ||
      shader.deleted
    )
      return;
    // GL defers destruction while the shader is attached; the flag is enough
    // here because records are garbage-collected, not freed.
    shader.deleted = true;
  }

  /* ------------------------------------------------------------------ */
  /* Programs                                                            */
  /* ------------------------------------------------------------------ */

  createProgram(): ProgramObject {
    const program = new ProgramObject();
    this.#owned.add(program);
    return program;
  }

  isProgram(program: unknown): boolean {
    return (
      program instanceof ProgramObject &&
      this.#owned.has(program) &&
      !program.deleted
    );
  }

  #checkProgram(program: unknown): program is ProgramObject {
    if (
      !(program instanceof ProgramObject) ||
      !this.#owned.has(program) ||
      program.deleted
    ) {
      this.#recordError(GL.INVALID_OPERATION);
      return false;
    }
    return true;
  }

  attachShader(program: ProgramObject, shader: ShaderObject): void {
    if (!this.#checkProgram(program) || !this.#checkShader(shader)) return;
    // One shader per type, and never the same shader twice, per GL.
    if (
      program.attached.includes(shader) ||
      program.attached.some((s) => s.type === shader.type)
    ) {
      this.#recordError(GL.INVALID_OPERATION);
      return;
    }
    program.attached.push(shader);
  }

  detachShader(program: ProgramObject, shader: ShaderObject): void {
    if (!this.#checkProgram(program)) return;
    const index = program.attached.indexOf(shader);
    if (index === -1) {
      this.#recordError(GL.INVALID_OPERATION);
      return;
    }
    program.attached.splice(index, 1);
  }

  getAttachedShaders(program: ProgramObject): ShaderObject[] | null {
    if (!this.#checkProgram(program)) return null;
    return [...program.attached];
  }

  /**
   * Links the two attached shaders through `src/glsl/link.ts`: attribute
   * locations (layout qualifiers, then `bindAttribLocation` requests, then
   * lowest free), varying matching by name and type, merged uniform slots,
   * and JS codegen for both stages. Success fills the location maps, mints a
   * zeroed uniform store (linking resets uniforms, per GL), and bumps the
   * link generation so locations from an older link are refused; failure sets
   * LINK_STATUS false with an info log naming the mismatch.
   */
  linkProgram(program: ProgramObject): void {
    if (!this.#checkProgram(program)) return;
    program.linkStatus = false;
    program.validateStatus = false;
    program.executable = null;
    program.uniformStore = null;
    program.attribLocations.clear();
    program.uniformLocations.clear();
    const vertex = program.attached.find((s) => s.type === GL.VERTEX_SHADER);
    const fragment = program.attached.find(
      (s) => s.type === GL.FRAGMENT_SHADER,
    );
    if (vertex === undefined || fragment === undefined) {
      program.infoLog =
        "headless-webgl2: linkProgram needs exactly one vertex and one fragment shader attached; attach both before linking";
      return;
    }
    if (vertex.compiled === null || fragment.compiled === null) {
      const failed = vertex.compiled === null ? "vertex" : "fragment";
      program.infoLog = `headless-webgl2: the attached ${failed} shader has not been successfully compiled; fix its compile errors and compileShader it before linking`;
      return;
    }
    const result = linkStages(
      vertex.compiled,
      fragment.compiled,
      program.boundAttribLocations,
    );
    if (!result.ok) {
      program.infoLog = result.log;
      return;
    }
    const linked = result.program;
    program.executable = linked;
    program.uniformStore = new Float64Array(linked.uniformSlotCount);
    program.linkGeneration += 1;
    program.infoLog = "";
    program.linkStatus = true;

    for (const attribute of linked.attributes) {
      program.attribLocations.set(attribute.name, attribute.location);
    }
    for (const uniform of linked.uniforms) {
      const stride = componentCount(uniform.type);
      if (uniform.size === 1) {
        const location = new UniformLocationObject(
          program,
          uniform.slot,
          uniform.type,
          1,
          false,
          program.linkGeneration,
        );
        program.uniformLocations.set(uniform.baseName, location);
        continue;
      }
      // Arrays answer under `name`, `name[0]`, and every `name[k]`, per the
      // GL lookup rules; each element location knows how much array remains
      // so the *v setters can fill from any starting element.
      for (let k = 0; k < uniform.size; k += 1) {
        const location = new UniformLocationObject(
          program,
          uniform.slot + k * stride,
          uniform.type,
          uniform.size - k,
          true,
          program.linkGeneration,
        );
        program.uniformLocations.set(`${uniform.baseName}[${k}]`, location);
        if (k === 0) program.uniformLocations.set(uniform.baseName, location);
      }
    }
  }

  getProgramParameter(program: ProgramObject, pname: number): any {
    if (!(program instanceof ProgramObject) || !this.#owned.has(program)) {
      this.#recordError(GL.INVALID_OPERATION);
      return null;
    }
    switch (pname) {
      case GL.LINK_STATUS:
        return program.linkStatus;
      case GL.DELETE_STATUS:
        return program.deleted;
      case GL.VALIDATE_STATUS:
        return program.validateStatus;
      case GL.ATTACHED_SHADERS:
        return program.attached.length;
      case GL.ACTIVE_UNIFORMS:
        return program.executable?.uniforms.length ?? 0;
      case GL.ACTIVE_ATTRIBUTES:
        return program.executable?.attributes.length ?? 0;
      default:
        this.#recordError(GL.INVALID_ENUM);
        return null;
    }
  }

  getProgramInfoLog(program: ProgramObject): string | null {
    if (!(program instanceof ProgramObject) || !this.#owned.has(program)) {
      this.#recordError(GL.INVALID_OPERATION);
      return null;
    }
    return program.infoLog;
  }

  validateProgram(program: ProgramObject): void {
    if (!this.#checkProgram(program)) return;
    // Validation asks "could this program run in the current state" — with no
    // draws yet, a linked program could and an unlinked one could not.
    program.validateStatus = program.linkStatus;
  }

  useProgram(program: ProgramObject | null): void {
    if (program === null) {
      this.#state.program = null;
      return;
    }
    if (!this.#checkProgram(program)) return;
    if (!program.linkStatus) {
      this.#recordError(GL.INVALID_OPERATION);
      return;
    }
    this.#state.program = program;
  }

  deleteProgram(program: ProgramObject | null): void {
    if (
      program === null ||
      !(program instanceof ProgramObject) ||
      !this.#owned.has(program) ||
      program.deleted
    )
      return;
    program.deleted = true;
    if (this.#state.program === program) this.#state.program = null;
  }

  bindAttribLocation(
    program: ProgramObject,
    index: number,
    name: string,
  ): void {
    if (!this.#checkProgram(program)) return;
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= LIMITS.maxVertexAttribs
    ) {
      this.#recordError(GL.INVALID_VALUE);
      return;
    }
    if (name.startsWith("gl_")) {
      this.#recordError(GL.INVALID_OPERATION);
      return;
    }
    // Takes effect at the next link, per GL; the stage-2 linker consults it.
    program.boundAttribLocations.set(name, index);
  }

  getAttribLocation(program: ProgramObject, name: string): number {
    if (!this.#checkProgram(program)) return -1;
    if (!program.linkStatus) {
      this.#recordError(GL.INVALID_OPERATION);
      return -1;
    }
    return program.attribLocations.get(name) ?? -1;
  }

  getUniformLocation(
    program: ProgramObject,
    name: string,
  ): UniformLocationObject | null {
    if (!this.#checkProgram(program)) return null;
    if (!program.linkStatus) {
      this.#recordError(GL.INVALID_OPERATION);
      return null;
    }
    return program.uniformLocations.get(name) ?? null;
  }

  /* ------------------------------------------------------------------ */
  /* Program introspection                                               */
  /* ------------------------------------------------------------------ */

  /** WebGLActiveInfo-shaped: a fresh `{name, size, type}` record per call, as browsers hand back. */
  getActiveUniform(
    program: ProgramObject,
    index: number,
  ): { name: string; size: number; type: number } | null {
    if (!(program instanceof ProgramObject) || !this.#owned.has(program)) {
      this.#recordError(GL.INVALID_OPERATION);
      return null;
    }
    const uniform = program.executable?.uniforms[index];
    if (uniform === undefined) {
      this.#recordError(GL.INVALID_VALUE);
      return null;
    }
    return { name: uniform.name, size: uniform.size, type: uniform.glType };
  }

  getActiveAttrib(
    program: ProgramObject,
    index: number,
  ): { name: string; size: number; type: number } | null {
    if (!(program instanceof ProgramObject) || !this.#owned.has(program)) {
      this.#recordError(GL.INVALID_OPERATION);
      return null;
    }
    const attribute = program.executable?.attributes[index];
    if (attribute === undefined) {
      this.#recordError(GL.INVALID_VALUE);
      return null;
    }
    return { name: attribute.name, size: 1, type: attribute.glType };
  }

  /**
   * Reads one element's value back, in the DOM contract's shapes: a number
   * for scalars, a boolean for bool, Float32Array / Int32Array / boolean[]
   * for vectors, Float32Array for matrices — fresh per call.
   */
  getUniform(program: ProgramObject, location: UniformLocationObject): any {
    if (!this.#checkProgram(program)) return null;
    if (
      !(location instanceof UniformLocationObject) ||
      location.program !== program ||
      location.generation !== program.linkGeneration ||
      program.uniformStore === null
    ) {
      this.#recordError(GL.INVALID_OPERATION);
      return null;
    }
    const store = program.uniformStore;
    const type = location.type;
    const at = (offset: number): number => store[location.slot + offset] ?? 0;
    switch (type.kind) {
      case "scalar":
        return type.scalar === "bool" ? at(0) !== 0 : at(0);
      case "sampler2D":
        return at(0);
      case "vector": {
        if (type.scalar === "float")
          return Float32Array.from({ length: type.size }, (_, i) => at(i));
        if (type.scalar === "int")
          return Int32Array.from({ length: type.size }, (_, i) => at(i));
        return Array.from({ length: type.size }, (_, i) => at(i) !== 0);
      }
      case "matrix":
        return Float32Array.from({ length: type.size * type.size }, (_, i) =>
          at(i),
        );
      default:
        this.#recordError(GL.INVALID_OPERATION);
        return null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Uniform setters                                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Validates a location against the current program, per the WebGL rules: a
   * null location is a silent no-op (returns null with no error); no current
   * program, a foreign program's location, or a location minted by an older
   * link is INVALID_OPERATION. Returns the location when a write may proceed.
   */
  #uniformTarget(
    location: UniformLocationObject | null,
  ): UniformLocationObject | null {
    if (location === null) return null;
    const program = this.#state.program;
    if (
      program === null ||
      !(location instanceof UniformLocationObject) ||
      location.program !== program ||
      location.generation !== program.linkGeneration ||
      program.uniformStore === null
    ) {
      this.#recordError(GL.INVALID_OPERATION);
      return null;
    }
    return location;
  }

  /**
   * Whether a `uniform{N}{f|i}`-family call may write a location of `type`.
   * Bool uniforms accept both families, samplers only the 1i family, and the
   * component count must match exactly — the GL type-matching rules.
   */
  #uniformTypeMatches(
    type: Type,
    family: "f" | "i",
    components: number,
  ): boolean {
    if (type.kind === "sampler2D") return family === "i" && components === 1;
    if (type.kind === "scalar") {
      if (components !== 1) return false;
      if (type.scalar === "bool") return true;
      return type.scalar === (family === "f" ? "float" : "int");
    }
    if (type.kind === "vector") {
      if (components !== type.size) return false;
      if (type.scalar === "bool") return true;
      return type.scalar === (family === "f" ? "float" : "int");
    }
    return false;
  }

  /** Writes one element's components, normalizing bools to 0/1 so the store is canonical. */
  #writeUniform(
    location: UniformLocationObject,
    elementIndex: number,
    values: readonly number[],
  ): void {
    const store = location.program.uniformStore;
    if (store === null) return;
    const isBool =
      (location.type.kind === "scalar" || location.type.kind === "vector") &&
      location.type.scalar === "bool";
    const base = location.slot + elementIndex * values.length;
    for (let i = 0; i < values.length; i += 1) {
      const value = Number(values[i]);
      store[base + i] = isBool ? (value !== 0 ? 1 : 0) : value;
    }
  }

  /** The direct (non-v) setters: exactly one element's components. */
  #setUniform(
    location: UniformLocationObject | null,
    family: "f" | "i",
    values: readonly number[],
  ): void {
    const target = this.#uniformTarget(location);
    if (target === null) return;
    if (!this.#uniformTypeMatches(target.type, family, values.length)) {
      this.#recordError(GL.INVALID_OPERATION);
      return;
    }
    this.#writeUniform(target, 0, values);
  }

  /** Resolves a *v call's source view honoring the WebGL2 srcOffset/srcLength arguments. */
  #uniformVectorData(
    data: Float32Array | Int32Array | number[],
    srcOffset: number,
    srcLength: number | undefined,
  ): number[] | null {
    const length = data.length;
    const take =
      srcLength === undefined || srcLength === 0
        ? length - srcOffset
        : srcLength;
    if (srcOffset < 0 || take < 0 || srcOffset + take > length) {
      this.#recordError(GL.INVALID_VALUE);
      return null;
    }
    const out: number[] = [];
    for (let i = 0; i < take; i += 1) out.push(Number(data[srcOffset + i]));
    return out;
  }

  /**
   * The *v setters: whole elements, possibly several for an array location.
   * The data length must be a positive multiple of the element's component
   * count; more than one element for a non-array location is
   * INVALID_OPERATION, and elements beyond the array's end are ignored, per
   * the GL rules.
   */
  #setUniformV(
    location: UniformLocationObject | null,
    family: "f" | "i",
    components: number,
    data: Float32Array | Int32Array | number[],
    srcOffset: number,
    srcLength: number | undefined,
  ): void {
    const target = this.#uniformTarget(location);
    if (target === null) return;
    if (!this.#uniformTypeMatches(target.type, family, components)) {
      this.#recordError(GL.INVALID_OPERATION);
      return;
    }
    const values = this.#uniformVectorData(data, srcOffset, srcLength);
    if (values === null) return;
    if (values.length === 0 || values.length % components !== 0) {
      this.#recordError(GL.INVALID_VALUE);
      return;
    }
    const elements = values.length / components;
    // More than one element for a non-array location is a type mismatch;
    // extra elements past an ARRAY's end are ignored — both per GL.
    if (elements > 1 && !target.partOfArray) {
      this.#recordError(GL.INVALID_OPERATION);
      return;
    }
    const write = Math.min(elements, target.elementsRemaining);
    for (let e = 0; e < write; e += 1) {
      this.#writeUniform(
        target,
        e,
        values.slice(e * components, (e + 1) * components),
      );
    }
  }

  uniform1f(location: UniformLocationObject | null, x: number): void {
    this.#setUniform(location, "f", [x]);
  }

  uniform2f(
    location: UniformLocationObject | null,
    x: number,
    y: number,
  ): void {
    this.#setUniform(location, "f", [x, y]);
  }

  uniform3f(
    location: UniformLocationObject | null,
    x: number,
    y: number,
    z: number,
  ): void {
    this.#setUniform(location, "f", [x, y, z]);
  }

  uniform4f(
    location: UniformLocationObject | null,
    x: number,
    y: number,
    z: number,
    w: number,
  ): void {
    this.#setUniform(location, "f", [x, y, z, w]);
  }

  uniform1i(location: UniformLocationObject | null, x: number): void {
    this.#setUniform(location, "i", [toInt(x)]);
  }

  uniform2i(
    location: UniformLocationObject | null,
    x: number,
    y: number,
  ): void {
    this.#setUniform(location, "i", [toInt(x), toInt(y)]);
  }

  uniform3i(
    location: UniformLocationObject | null,
    x: number,
    y: number,
    z: number,
  ): void {
    this.#setUniform(location, "i", [toInt(x), toInt(y), toInt(z)]);
  }

  uniform4i(
    location: UniformLocationObject | null,
    x: number,
    y: number,
    z: number,
    w: number,
  ): void {
    this.#setUniform(location, "i", [toInt(x), toInt(y), toInt(z), toInt(w)]);
  }

  uniform1fv(
    location: UniformLocationObject | null,
    data: Float32Array | number[],
    srcOffset = 0,
    srcLength?: number,
  ): void {
    this.#setUniformV(location, "f", 1, data, srcOffset, srcLength);
  }

  uniform2fv(
    location: UniformLocationObject | null,
    data: Float32Array | number[],
    srcOffset = 0,
    srcLength?: number,
  ): void {
    this.#setUniformV(location, "f", 2, data, srcOffset, srcLength);
  }

  uniform3fv(
    location: UniformLocationObject | null,
    data: Float32Array | number[],
    srcOffset = 0,
    srcLength?: number,
  ): void {
    this.#setUniformV(location, "f", 3, data, srcOffset, srcLength);
  }

  uniform4fv(
    location: UniformLocationObject | null,
    data: Float32Array | number[],
    srcOffset = 0,
    srcLength?: number,
  ): void {
    this.#setUniformV(location, "f", 4, data, srcOffset, srcLength);
  }

  uniform1iv(
    location: UniformLocationObject | null,
    data: Int32Array | number[],
    srcOffset = 0,
    srcLength?: number,
  ): void {
    this.#setUniformV(location, "i", 1, data, srcOffset, srcLength);
  }

  uniform2iv(
    location: UniformLocationObject | null,
    data: Int32Array | number[],
    srcOffset = 0,
    srcLength?: number,
  ): void {
    this.#setUniformV(location, "i", 2, data, srcOffset, srcLength);
  }

  uniform3iv(
    location: UniformLocationObject | null,
    data: Int32Array | number[],
    srcOffset = 0,
    srcLength?: number,
  ): void {
    this.#setUniformV(location, "i", 3, data, srcOffset, srcLength);
  }

  uniform4iv(
    location: UniformLocationObject | null,
    data: Int32Array | number[],
    srcOffset = 0,
    srcLength?: number,
  ): void {
    this.#setUniformV(location, "i", 4, data, srcOffset, srcLength);
  }

  /** Shared by the two matrix setters: validates, honors `transpose`, writes column-major. */
  #setUniformMatrix(
    location: UniformLocationObject | null,
    size: 3 | 4,
    transpose: boolean,
    data: Float32Array | number[],
    srcOffset: number,
    srcLength: number | undefined,
  ): void {
    const target = this.#uniformTarget(location);
    if (target === null) return;
    if (!(target.type.kind === "matrix" && target.type.size === size)) {
      this.#recordError(GL.INVALID_OPERATION);
      return;
    }
    const values = this.#uniformVectorData(data, srcOffset, srcLength);
    if (values === null) return;
    const stride = size * size;
    if (values.length === 0 || values.length % stride !== 0) {
      this.#recordError(GL.INVALID_VALUE);
      return;
    }
    const elements = values.length / stride;
    if (elements > 1 && !target.partOfArray) {
      this.#recordError(GL.INVALID_OPERATION);
      return;
    }
    const write = Math.min(elements, target.elementsRemaining);
    for (let e = 0; e < write; e += 1) {
      const element = values.slice(e * stride, (e + 1) * stride);
      // The store is column-major (the shader's constructor/upload order);
      // transpose=true means the data arrived row-major and is reordered here.
      const ordered = transpose
        ? Array.from(
            { length: stride },
            (_, i) => element[(i % size) * size + Math.floor(i / size)] ?? 0,
          )
        : element;
      this.#writeUniform(target, e, ordered);
    }
  }

  uniformMatrix3fv(
    location: UniformLocationObject | null,
    transpose: boolean,
    data: Float32Array | number[],
    srcOffset = 0,
    srcLength?: number,
  ): void {
    this.#setUniformMatrix(
      location,
      3,
      !!transpose,
      data,
      srcOffset,
      srcLength,
    );
  }

  uniformMatrix4fv(
    location: UniformLocationObject | null,
    transpose: boolean,
    data: Float32Array | number[],
    srcOffset = 0,
    srcLength?: number,
  ): void {
    this.#setUniformMatrix(
      location,
      4,
      !!transpose,
      data,
      srcOffset,
      srcLength,
    );
  }

  /* ------------------------------------------------------------------ */
  /* Draws                                                               */
  /* ------------------------------------------------------------------ */

  /** The pipeline's view of this context, built once: state, target, and the error latch. */
  #io: DrawIo | null = null;

  #drawIo(): DrawIo {
    // Both referenced objects live as long as the context (the framebuffer
    // resizes in place), so the bundle can be built once and reused.
    this.#io ??= {
      state: this.#state,
      framebuffer: this.#framebuffer,
      recordError: (code: number) => this.#recordError(code),
    };
    return this.#io;
  }

  /**
   * Draws `count` vertices starting at `first` from the bound VAO's
   * attribute arrays through the current program — the full stage-3
   * pipeline: vertex shading, near-plane clipping, the viewport transform,
   * face culling, the top-left fill rule, perspective-correct varyings,
   * depth test, scissor, blending, and fragment shading with texture
   * sampling (`src/raster/`). Misuse latches GL errors and leaves the
   * framebuffer untouched, per the WebGL contract.
   */
  drawArrays(mode: number, first: number, count: number): void {
    drawArraysImpl(this.#drawIo(), mode, toInt(first), toInt(count));
  }

  /**
   * Draws `count` indices read from the VAO's ELEMENT_ARRAY_BUFFER at byte
   * `offset`, index-deduplicating vertex shading, with the WebGL2 always-on
   * primitive restart (an all-ones index splits assembly). Same pipeline and
   * same refusal rules as {@link drawArrays}.
   */
  drawElements(
    mode: number,
    count: number,
    type: number,
    offset: number,
  ): void {
    drawElementsImpl(this.#drawIo(), mode, toInt(count), type, toInt(offset));
  }

  /* ------------------------------------------------------------------ */
  /* Readback                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Returns the framebuffer's real bytes, rows bottom-up: dest row 0 is the
   * bottom of the requested rect, matching the documented validator contract
   * `gl.readPixels(x, canvas.height - 1 - y, 1, 1, ...)`. Only the
   * RGBA/UNSIGNED_BYTE combination exists for the default framebuffer, which
   * is exactly what WebGL2 guarantees.
   */
  readPixels(
    x: number,
    y: number,
    width: number,
    height: number,
    format: number,
    type: number,
    pixels: ArrayBufferView | null,
    dstOffset = 0,
  ): void {
    if (width < 0 || height < 0) {
      this.#recordError(GL.INVALID_VALUE);
      return;
    }
    if (format !== GL.RGBA || type !== GL.UNSIGNED_BYTE) {
      this.#recordError(GL.INVALID_ENUM);
      return;
    }
    if (pixels === null) {
      this.#recordError(GL.INVALID_VALUE);
      return;
    }
    if (
      !(pixels instanceof Uint8Array) &&
      !(pixels instanceof Uint8ClampedArray)
    ) {
      // The dest view type must match UNSIGNED_BYTE, per WebGL.
      this.#recordError(GL.INVALID_OPERATION);
      return;
    }
    if (dstOffset < 0 || dstOffset > pixels.length) {
      this.#recordError(GL.INVALID_VALUE);
      return;
    }
    const needed = DefaultFramebuffer.requiredBytes(
      width,
      height,
      this.#state.packAlignment,
    );
    if (pixels.length - dstOffset < needed) {
      this.#recordError(GL.INVALID_OPERATION);
      return;
    }
    const dest =
      pixels instanceof Uint8Array
        ? pixels
        : new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
    this.#framebuffer.readPixels(
      toInt(x),
      toInt(y),
      toInt(width),
      toInt(height),
      dest,
      this.#state.packAlignment,
      dstOffset,
    );
  }

  /** White-box seam for this package's own tests (depth planes are unreadable through the GL API). */
  get framebufferForTesting(): DefaultFramebuffer {
    return this.#framebuffer;
  }
}

/**
 * The GL constant table lives on the prototype: one copy for every context,
 * and the merged interface below makes `gl.RGBA` typecheck.
 */
export interface HeadlessWebGL2Context extends GLConstants {}
Object.assign(HeadlessWebGL2Context.prototype, GL);

/* ---------------------------------------------------------------------- */
/* The not-implemented surface                                            */
/* ---------------------------------------------------------------------- */

/**
 * Methods that arrive with a later stage of 0.1.0. Empty since stage 3
 * landed the draw pipeline (stage 4 — SSAA — adds no methods); the mechanism
 * stays so a future stage plan has somewhere honest to park a name.
 */
const LATER_STAGE_METHODS: readonly string[] = [];

/**
 * Methods outside the 0.1.0 subset altogether (spec §3.8): framebuffer
 * objects, stencil, instancing, transform feedback, queries/sync, 3D/array/
 * compressed/float textures, samplers, UBOs, MRT. Each exists and throws by
 * name so nothing silently no-ops.
 */
const OUT_OF_SUBSET_METHODS: readonly string[] = [
  // Framebuffer and renderbuffer objects.
  "bindFramebuffer",
  "bindRenderbuffer",
  "checkFramebufferStatus",
  "createFramebuffer",
  "createRenderbuffer",
  "deleteFramebuffer",
  "deleteRenderbuffer",
  "framebufferRenderbuffer",
  "framebufferTexture2D",
  "framebufferTextureLayer",
  "getFramebufferAttachmentParameter",
  "getRenderbufferParameter",
  "isFramebuffer",
  "isRenderbuffer",
  "renderbufferStorage",
  "renderbufferStorageMultisample",
  "blitFramebuffer",
  "invalidateFramebuffer",
  "invalidateSubFramebuffer",
  "readBuffer",
  "drawBuffers",
  "clearBufferfv",
  "clearBufferiv",
  "clearBufferuiv",
  "clearBufferfi",
  "getInternalformatParameter",
  // Stencil.
  "clearStencil",
  "stencilFunc",
  "stencilFuncSeparate",
  "stencilMask",
  "stencilMaskSeparate",
  "stencilOp",
  "stencilOpSeparate",
  // Multisample coverage.
  "sampleCoverage",
  // Mipmaps (binding decision 9: none in 0.1.0).
  "generateMipmap",
  // Copies and 3D/compressed texture uploads.
  "copyBufferSubData",
  "getBufferSubData",
  "copyTexImage2D",
  "copyTexSubImage2D",
  "copyTexSubImage3D",
  "compressedTexImage2D",
  "compressedTexSubImage2D",
  "compressedTexImage3D",
  "compressedTexSubImage3D",
  "texImage3D",
  "texSubImage3D",
  "texStorage3D",
  // Samplers.
  "createSampler",
  "deleteSampler",
  "isSampler",
  "bindSampler",
  "samplerParameteri",
  "samplerParameterf",
  "getSamplerParameter",
  // Instancing and extended draws.
  "vertexAttribDivisor",
  "drawArraysInstanced",
  "drawElementsInstanced",
  "drawRangeElements",
  // Integer vertex attributes.
  "vertexAttribIPointer",
  "vertexAttribI4i",
  "vertexAttribI4iv",
  "vertexAttribI4ui",
  "vertexAttribI4uiv",
  // Unsigned-integer and non-square-matrix uniforms.
  "uniform1ui",
  "uniform2ui",
  "uniform3ui",
  "uniform4ui",
  "uniform1uiv",
  "uniform2uiv",
  "uniform3uiv",
  "uniform4uiv",
  "uniformMatrix2fv",
  "uniformMatrix2x3fv",
  "uniformMatrix2x4fv",
  "uniformMatrix3x2fv",
  "uniformMatrix3x4fv",
  "uniformMatrix4x2fv",
  "uniformMatrix4x3fv",
  // Uniform blocks.
  "bindBufferBase",
  "bindBufferRange",
  "getIndexedParameter",
  "getUniformIndices",
  "getActiveUniforms",
  "getUniformBlockIndex",
  "getActiveUniformBlockParameter",
  "getActiveUniformBlockName",
  "uniformBlockBinding",
  // Queries.
  "createQuery",
  "deleteQuery",
  "isQuery",
  "beginQuery",
  "endQuery",
  "getQuery",
  "getQueryParameter",
  // Sync.
  "fenceSync",
  "isSync",
  "deleteSync",
  "clientWaitSync",
  "waitSync",
  "getSyncParameter",
  // Transform feedback.
  "createTransformFeedback",
  "deleteTransformFeedback",
  "isTransformFeedback",
  "bindTransformFeedback",
  "beginTransformFeedback",
  "endTransformFeedback",
  "pauseTransformFeedback",
  "resumeTransformFeedback",
  "transformFeedbackVaryings",
  "getTransformFeedbackVarying",
  // MRT.
  "getFragDataLocation",
];

function defineThrowingMethod(name: string, message: string): void {
  const proto = HeadlessWebGL2Context.prototype as unknown as Record<
    string,
    unknown
  >;
  // A stub must never shadow a real implementation: a name that already
  // exists on the prototype is a drift bug caught at module load.
  if (Object.prototype.hasOwnProperty.call(proto, name)) {
    throw new Error(
      `headless-webgl2: internal: the stub table names ${name}, which is already implemented`,
    );
  }
  Object.defineProperty(HeadlessWebGL2Context.prototype, name, {
    value: function notImplementedStub(): never {
      throw new Error(message);
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

for (const name of LATER_STAGE_METHODS) {
  defineThrowingMethod(
    name,
    `headless-webgl2: ${name} is not implemented yet: it arrives in a later stage of 0.1.0 (the GLSL front end and the raster pipeline); until then the context can be created and cleared but cannot draw`,
  );
}

for (const name of OUT_OF_SUBSET_METHODS) {
  defineThrowingMethod(
    name,
    `headless-webgl2: ${name} is not implemented: it is outside the 0.1.0 WebGL2 subset, so restructure the caller to stay inside the subset rather than relying on a silent no-op`,
  );
}
