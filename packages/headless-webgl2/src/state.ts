/**
 * The context's mutable fixed-function state, gathered into one record rather
 * than scattered across the context class, because the rasterizer (stage 3)
 * reads this state wholesale per draw and a single record keeps "what a draw
 * depends on" enumerable at a glance. Every field starts at the initial value
 * the GL specification assigns it.
 */

import { GL } from "./constants";
import type {
  BufferObject,
  ProgramObject,
  TextureObject,
  VertexArrayObject,
} from "./objects";

/** The limits this implementation reports; fixed, not configurable, so every context answers alike. */
export const LIMITS = {
  maxTextureSize: 4096,
  maxTextureImageUnits: 16,
  maxCombinedTextureImageUnits: 32,
  maxVertexTextureImageUnits: 16,
  maxVertexAttribs: 16,
  maxVaryingVectors: 15,
  maxVertexUniformVectors: 1024,
  maxFragmentUniformVectors: 1024,
  maxViewportDims: 4096,
  /** activeTexture accepts TEXTURE0..TEXTURE31 (the IDL names 32 units even where fewer are usable). */
  textureUnits: 32,
} as const;

/** One texture unit's bindings (only TEXTURE_2D exists in the subset). */
export interface TextureUnit {
  texture2d: TextureObject | null;
}

/** The whole fixed-function state machine. */
export interface ContextState {
  /* -- error latch ----------------------------------------------------- */
  /**
   * Unread error codes in the order they were generated, deduplicated: the
   * first unread error of each code is retained and `getError` returns and
   * clears one per call, matching observable driver behavior.
   */
  errors: number[];

  /* -- clear values ---------------------------------------------------- */
  clearColor: [number, number, number, number];
  clearDepth: number;

  /* -- masks ----------------------------------------------------------- */
  colorMask: [boolean, boolean, boolean, boolean];
  depthMask: boolean;

  /* -- capabilities ---------------------------------------------------- */
  /** Capability enum → enabled; holds exactly the toggles `enable` accepts. */
  capabilities: Map<number, boolean>;

  /* -- depth ----------------------------------------------------------- */
  depthFunc: number;
  depthRange: [number, number];

  /* -- blending -------------------------------------------------------- */
  blendSrcRgb: number;
  blendDstRgb: number;
  blendSrcAlpha: number;
  blendDstAlpha: number;
  blendEquationRgb: number;
  blendEquationAlpha: number;
  blendColor: [number, number, number, number];

  /* -- culling --------------------------------------------------------- */
  cullFaceMode: number;
  frontFace: number;

  /* -- rectangles ------------------------------------------------------ */
  viewport: [number, number, number, number];
  scissor: [number, number, number, number];

  /* -- other raster state ---------------------------------------------- */
  lineWidth: number;
  polygonOffsetFactor: number;
  polygonOffsetUnits: number;

  /* -- pixel store ----------------------------------------------------- */
  unpackAlignment: number;
  packAlignment: number;
  unpackFlipY: boolean;
  unpackPremultiplyAlpha: boolean;
  unpackColorspaceConversion: number;

  /* -- bindings -------------------------------------------------------- */
  arrayBuffer: BufferObject | null;
  /** The bound VAO; the default VAO stands in when the caller bound `null`. */
  vertexArray: VertexArrayObject;
  /** The context's default VAO, reachable via `bindVertexArray(null)`. */
  defaultVertexArray: VertexArrayObject;
  program: ProgramObject | null;
  activeTextureUnit: number;
  textureUnits: TextureUnit[];

  /**
   * The generic vertex attribute values `vertexAttrib{1..4}f[v]` set — context
   * state, not VAO state, per GL. Each is (x, y, z, w) defaulting to
   * (0, 0, 0, 1).
   */
  genericAttribs: Float64Array[];
}

/**
 * The state machine in its just-created form. The viewport and scissor box
 * start at the full drawing buffer, per the WebGL specification's context
 * creation step — and deliberately do NOT track later canvas resizes, also
 * per spec.
 */
export function createContextState(
  width: number,
  height: number,
  defaultVertexArray: VertexArrayObject,
): ContextState {
  return {
    errors: [],
    clearColor: [0, 0, 0, 0],
    clearDepth: 1,
    colorMask: [true, true, true, true],
    depthMask: true,
    capabilities: new Map<number, boolean>([
      [GL.BLEND, false],
      [GL.CULL_FACE, false],
      [GL.DEPTH_TEST, false],
      [GL.DITHER, true],
      [GL.POLYGON_OFFSET_FILL, false],
      [GL.SCISSOR_TEST, false],
      [GL.STENCIL_TEST, false],
    ]),
    depthFunc: GL.LESS,
    depthRange: [0, 1],
    blendSrcRgb: GL.ONE,
    blendDstRgb: GL.ZERO,
    blendSrcAlpha: GL.ONE,
    blendDstAlpha: GL.ZERO,
    blendEquationRgb: GL.FUNC_ADD,
    blendEquationAlpha: GL.FUNC_ADD,
    blendColor: [0, 0, 0, 0],
    cullFaceMode: GL.BACK,
    frontFace: GL.CCW,
    viewport: [0, 0, width, height],
    scissor: [0, 0, width, height],
    lineWidth: 1,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: 0,
    unpackAlignment: 4,
    packAlignment: 4,
    unpackFlipY: false,
    unpackPremultiplyAlpha: false,
    unpackColorspaceConversion: GL.BROWSER_DEFAULT_WEBGL,
    arrayBuffer: null,
    vertexArray: defaultVertexArray,
    defaultVertexArray,
    program: null,
    activeTextureUnit: 0,
    textureUnits: Array.from({ length: LIMITS.textureUnits }, () => ({
      texture2d: null,
    })),
    genericAttribs: Array.from({ length: LIMITS.maxVertexAttribs }, () =>
      Float64Array.from([0, 0, 0, 1]),
    ),
  };
}
