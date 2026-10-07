/**
 * A WebGL2 rendering context that answers rather than draws.
 *
 * The engine owns its rendering pipeline and draws through a real
 * `THREE.WebGLRenderer`, and a renderer needs a context to construct over. jsdom supplies none: `HTMLCanvasElement.getContext`
 * returns `null` for every id, and the `node-canvas` family that fills in the 2D
 * context brings no GL implementation with it. Running the suite against a headless
 * GPU instead would buy the one thing these tests are not about — the pixels — at
 * the cost of a native dependency, a driver, and a result that differs by machine.
 *
 * So the context here is a stub, and the division of labour is deliberate: a case's
 * validators exercise the engine in a real browser against a real GPU, where the
 * picture is the evidence; these suites exist to pin *engine* code — which
 * components the pipeline collected, in what order it drew them, under which render
 * mode, with which viewport, scissor and clear, and what the engine made of what
 * the world did. What the driver would have rasterized is out of scope, and a stub
 * that answers three's queries plausibly is therefore the whole requirement.
 *
 * The shape is a `Proxy` over a small target, because the WebGL2 surface is some
 * five hundred members and enumerating them by hand would be a maintenance burden
 * that bought nothing:
 *
 * - Anything matching `/^[A-Z][A-Z0-9_]*$/` is read as a GL enum constant and gets a
 *   stable unique number, remembered in both directions. The numbers are unique
 *   rather than accurate on purpose — nothing here interprets a real GL value, and
 *   uniqueness is what lets {@link GlStub.constantName} recover the NAME, so
 *   `getParameter` switches on `"MAX_TEXTURE_SIZE"` rather than on `0x0d33`.
 * - Everything else is a method. A handful answer with something three can use; the
 *   rest accept anything and return `undefined`. Each is memoized, so reading
 *   `gl.drawElements` twice yields the same function and a spy installed over one
 *   read is seen by the next.
 *
 * The stub also records the calls that decide a frame's geometry — the viewport,
 * the scissor and its enable, the clear — together with the calls that say which
 * program a draw ran under and which framebuffer it landed in, so a test can assert
 * the pipeline placed the letterboxed picture where the viewport said it would,
 * that a render mode substituted the material every draw ran through, and that the
 * shadow pass drew off-screen before the picture did.
 */

/** One call the stub received, with the arguments it was handed. */
export interface GlCall {
  /** The method's name, as it is spelled on the context. */
  readonly name: string;
  /** The arguments, by reference: a typed array here is the caller's own. */
  readonly args: readonly unknown[];
}

/**
 * The calls recorded unless a caller names others.
 *
 * These are the ones an engine test asks about, and an engine that owns its
 * pipeline asks more of them than one that hands a game a renderer and stands
 * aside: where the picture was placed, what was clipped away, what the surface was
 * cleared to, which framebuffer a pass drew into — the default one for the picture,
 * one of three's own for a shadow map — which program each draw ran under, since a
 * render mode is material substitution and reaches the context as the program in
 * force changing, and the depth, colour and blend state, since the transparent pass
 * and the collision overlay's depth-off pass are both claims about it. Recording
 * everything would mean thousands of uniform uploads per frame for no reader.
 */
export const RECORDED_CALLS: readonly string[] = [
  "viewport",
  "scissor",
  "enable",
  "disable",
  "clearColor",
  "clearDepth",
  "clearStencil",
  "clear",
  "bindFramebuffer",
  "framebufferTexture2D",
  "useProgram",
  "depthMask",
  "depthFunc",
  "colorMask",
  "blendFunc",
  "blendFuncSeparate",
  "blendEquation",
  "blendEquationSeparate",
  "drawArrays",
  "drawElements",
  "drawArraysInstanced",
  "drawElementsInstanced",
];

/** How the stub should answer, where a test wants something other than the default. */
export interface GlStubOptions {
  /**
   * Overrides for the attributes `getContextAttributes` reports. The defaults are
   * what three asks a real context for, already resolved.
   */
  attributes?: Partial<WebGLContextAttributes>;
  /**
   * Overrides for the `getParameter` table, keyed by constant NAME — `{ MAX_SAMPLES:
   * 0 }` to make the stub answer as a context without multisampling would.
   */
  parameters?: Readonly<Record<string, unknown>>;
  /** Which calls to record. `"all"` records every method call. */
  record?: readonly string[] | "all";
  /** How many calls to keep before dropping the rest. Defaults to 4096. */
  maxCalls?: number;
}

/** The stub, and the handles a test reads it back through. */
export interface GlStub {
  /** The context itself, to hand to `canvas.getContext` or to a renderer. */
  readonly gl: WebGL2RenderingContext;
  /** The recorded calls, oldest first. */
  readonly calls: readonly GlCall[];
  /** The number a given constant NAME reads as on this stub. */
  constant(name: string): number;
  /** The constant NAME a number stands for, or `undefined` for a number nothing named. */
  constantName(value: number): string | undefined;
  /** Every recorded call to one method, oldest first. */
  callsTo(name: string): readonly GlCall[];
  /** The most recent recorded call to one method. */
  lastCall(name: string): GlCall | undefined;
  /** Discards the recorded calls, leaving the constants and the context as they are. */
  forget(): void;
}

/** A GL enum constant reads as an all-caps identifier; a method never does. */
const ENUM_NAME = /^[A-Z][A-Z0-9_]*$/;

/** What `getContextAttributes` reports before a caller overrides any of it. */
const DEFAULT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  antialias: false,
  depth: true,
  stencil: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  powerPreference: "default",
  failIfMajorPerformanceCaveat: false,
  desynchronized: false,
};

/**
 * The limits and strings `getParameter` answers with, keyed by constant NAME.
 *
 * `VERSION` matters more than it looks: three parses `/^WebGL (\d)/` off it and
 * refuses a context whose major version it cannot read. The `MAX_*` figures are
 * plausible rather than borrowed from any particular device — three sizes arrays
 * from several of them, so zero would be wrong in a way that only shows up as an
 * empty draw much later.
 */
const DEFAULT_PARAMETERS: Readonly<Record<string, unknown>> = {
  VERSION: "WebGL 2.0 (Test Cabinet stub)",
  SHADING_LANGUAGE_VERSION: "WebGL GLSL ES 3.00 (Test Cabinet stub)",
  VENDOR: "The Test Cabinet",
  RENDERER: "Structured 3D test stub",
  MAX_TEXTURE_SIZE: 4096,
  MAX_CUBE_MAP_TEXTURE_SIZE: 4096,
  MAX_3D_TEXTURE_SIZE: 2048,
  MAX_ARRAY_TEXTURE_LAYERS: 256,
  MAX_TEXTURE_IMAGE_UNITS: 16,
  MAX_VERTEX_TEXTURE_IMAGE_UNITS: 16,
  MAX_COMBINED_TEXTURE_IMAGE_UNITS: 32,
  MAX_VERTEX_ATTRIBS: 16,
  MAX_VERTEX_UNIFORM_VECTORS: 1024,
  MAX_FRAGMENT_UNIFORM_VECTORS: 1024,
  MAX_VARYING_VECTORS: 30,
  MAX_DRAW_BUFFERS: 8,
  MAX_RENDERBUFFER_SIZE: 4096,
  MAX_UNIFORM_BUFFER_BINDINGS: 24,
  MAX_UNIFORM_BLOCK_SIZE: 65536,
  MAX_SAMPLES: 4,
  SAMPLES: 0,
  UNPACK_ALIGNMENT: 4,
  UNPACK_ROW_LENGTH: 0,
  UNPACK_IMAGE_HEIGHT: 0,
  UNPACK_SKIP_PIXELS: 0,
  UNPACK_SKIP_ROWS: 0,
  UNPACK_SKIP_IMAGES: 0,
};

/**
 * Builds a WebGL2 context a real `THREE.WebGLRenderer` constructs over and renders
 * through.
 *
 * The canvas is the one the context reports as its own, and the drawing buffer
 * follows that canvas's backing store, so a test that resizes the canvas sees the
 * size the renderer would see.
 */
export function createGlStub(
  canvas: HTMLCanvasElement,
  options: GlStubOptions = {},
): GlStub {
  const attributes: WebGLContextAttributes = {
    ...DEFAULT_ATTRIBUTES,
    ...options.attributes,
  };
  const parameters: Record<string, unknown> = {
    ...DEFAULT_PARAMETERS,
    ...options.parameters,
  };
  const recorded =
    options.record === "all"
      ? "all"
      : new Set(options.record ?? RECORDED_CALLS);
  const maxCalls = options.maxCalls ?? 4096;

  const calls: GlCall[] = [];
  /** Constant NAME to the number it reads as, and the number back to the NAME. */
  const numbers = new Map<string, number>();
  const names = new Map<number, string>();
  /** Methods, memoized so a member's identity is stable across reads. */
  const methods = new Map<string, (...args: unknown[]) => unknown>();
  /**
   * The next constant's number. It starts above the enum range a real context uses
   * so a stubbed value is never mistaken for a borrowed one in a failure message,
   * and it never reaches a float, so identity comparison is exact.
   */
  let nextNumber = 0x10000;

  function constant(name: string): number {
    const known = numbers.get(name);
    if (known !== undefined) return known;
    const value = nextNumber++;
    numbers.set(name, value);
    names.set(value, name);
    return value;
  }

  function record(name: string, args: unknown[]): void {
    if (recorded !== "all" && !recorded.has(name)) return;
    if (calls.length >= maxCalls) return;
    calls.push({ name, args });
  }

  /**
   * The members that must answer with something real.
   *
   * Everything absent here is a method that accepts anything and returns
   * `undefined`, which covers the whole state-setting half of the API: three sets
   * the state, nothing reads it back, and a call that returned a value nobody asked
   * for would only be a second thing to keep true.
   */
  const answers: Record<string, (...args: unknown[]) => unknown> = {
    getContextAttributes: () => ({ ...attributes }),

    getParameter: (pname) => {
      const name = names.get(pname as number);
      // The three array-valued parameters are built per read rather than shared:
      // three writes the result into its own state and would otherwise hold a
      // buffer this stub could change underneath it.
      if (name === "SCISSOR_BOX" || name === "VIEWPORT") {
        return new Int32Array([0, 0, canvas.width, canvas.height]);
      }
      if (name === "MAX_VIEWPORT_DIMS") return new Int32Array([4096, 4096]);
      if (name === undefined) return 0;
      const answer = parameters[name];
      return answer === undefined ? 0 : answer;
    },

    // Every extension is absent. three treats a null extension as a capability it
    // does not have and falls back, so the stub exercises the fallback path — which
    // is the conservative one, and the one every claim here should hold under.
    getExtension: () => null,
    getSupportedExtensions: () => [],

    // Reported as the highest precision, so three's shader precision negotiation
    // settles on `highp` and every program it builds is the same one everywhere.
    getShaderPrecisionFormat: () => ({
      rangeMin: 127,
      rangeMax: 127,
      precision: 23,
    }),

    // Every GL object is an empty object with its own identity. Nothing reads
    // through one; what matters is that two creations are never the same object,
    // because three keys its caches by them.
    createProgram: () => ({}),
    createShader: () => ({}),
    createTexture: () => ({}),
    createBuffer: () => ({}),
    createFramebuffer: () => ({}),
    createRenderbuffer: () => ({}),
    createVertexArray: () => ({}),
    createSampler: () => ({}),
    fenceSync: () => ({}),

    // Compilation and linking always succeed with an empty log. `true` is also what
    // three reads as the active uniform and attribute counts, which yields one of
    // each — enough for the reflection path to run and be exercised.
    getProgramParameter: () => true,
    getShaderParameter: () => true,
    getProgramInfoLog: () => "",
    getShaderInfoLog: () => "",

    getUniformLocation: () => ({}),
    getAttribLocation: () => 0,
    getActiveUniform: (_program, index) => ({
      name: `uniform${String(index)}`,
      size: 1,
      type: constant("FLOAT"),
    }),
    getActiveAttrib: (_program, index) => ({
      name: `attribute${String(index)}`,
      size: 1,
      type: constant("FLOAT"),
    }),

    getError: () => 0,
    isContextLost: () => false,
  };

  /**
   * The properties the context carries as its own rather than as methods. The two
   * buffer sizes are accessors so they track the canvas's backing store: a renderer
   * that resizes the canvas reads the new size back through them on the next frame.
   */
  const target: Record<string, unknown> = { canvas };
  Object.defineProperty(target, "drawingBufferWidth", {
    get: () => canvas.width,
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(target, "drawingBufferHeight", {
    get: () => canvas.height,
    enumerable: true,
    configurable: true,
  });

  const gl = new Proxy(target, {
    get(held, property): unknown {
      if (typeof property !== "string") return Reflect.get(held, property);
      if (property in held) return Reflect.get(held, property);
      if (ENUM_NAME.test(property)) return constant(property);

      const memoized = methods.get(property);
      if (memoized !== undefined) return memoized;
      const answer = answers[property];
      const method = (...args: unknown[]): unknown => {
        record(property, args);
        return answer?.(...args);
      };
      methods.set(property, method);
      return method;
    },
    // A GL context reports every member as present, and three feature-tests by
    // reading rather than by `in`. Saying so keeps the two consistent.
    has(held, property): boolean {
      return typeof property === "string" ? true : Reflect.has(held, property);
    },
  }) as unknown as WebGL2RenderingContext;

  return {
    gl,
    calls,
    constant,
    constantName: (value) => names.get(value),
    callsTo: (name) => calls.filter((call) => call.name === name),
    lastCall: (name) => calls.filter((call) => call.name === name).at(-1),
    forget: () => {
      calls.length = 0;
    },
  };
}
