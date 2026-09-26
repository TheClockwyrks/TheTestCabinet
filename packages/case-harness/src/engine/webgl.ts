// What a 3D engine's renderer needs and Node does not have. 3D ONLY.
//
// A 3D engine builds a `THREE.WebGLRenderer`, which takes a `webgl2` context off
// a canvas at construction. Node has no such context and no canvas to take one
// off, so a validator project supplies both — and the supply is IDENTICAL in
// every 3D case, because what it satisfies is three's requirements rather than
// any case's.
//
// WHAT THIS IS NOT: A RASTERIZER, and it does not pretend to be one. Nothing a 3D
// case's checks read is a pixel of the WORLD pass: every claim a validator makes
// about the picture is a claim about the render components the world holds, the
// objects the pipeline placed in the scene, and where the camera projects a world
// point — all of them engine data that exist whether or not a driver rasterized
// anything. What the stub buys is the engine STANDING UP AT ALL, so the game's
// tick, its state, its debug surface and its cues can be driven. The HUD and the
// readouts a reviewer sees in a still are drawn on a real 2D canvas beside it.
//
// A `Proxy` RATHER THAN FIVE HUNDRED MEMBERS, for the reason the engines' own
// test stubs give: the WebGL2 surface is some five hundred members, enumerating
// them by hand would buy nothing, and three feature-tests by READING a member
// rather than by `in`. So everything unnamed below is a method that accepts
// anything and answers `undefined`, which covers the whole state-setting half of
// the API — three sets the state and never reads it back — and every all-caps
// identifier is minted as a distinct enum constant on first read.
//
// THIS MODULE IS 3D-ONLY and nothing neutral imports it. A 2D case never builds a
// renderer and has no use for any of it; see `./index` on the layering.

/** A GL enum constant reads as an all-caps identifier; a method never does. */
const ENUM_NAME = /^[A-Z][A-Z0-9_]*$/;

/**
 * What `getContextAttributes` reports.
 *
 * Already resolved, as a real context reports them rather than as three asks for
 * them: `antialias` is off because the stub has no multisample buffer to offer,
 * and reporting it on would have three believe in one.
 */
const CONTEXT_ATTRIBUTES: Readonly<Record<string, unknown>> = {
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
 * The limits `getParameter` answers with, keyed by constant NAME.
 *
 * The `MAX_*` figures are plausible rather than borrowed from any particular
 * device — three sizes several of its own arrays from them, so zero would be
 * wrong in a way that only showed up as an empty draw much later. The two version
 * strings are filled in per stub, because `VERSION` matters more than it looks:
 * three parses `/^WebGL (\d)/` off it and refuses a context whose major version
 * it cannot read.
 */
const GL_LIMITS: Readonly<Record<string, unknown>> = {
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

/** The backing store a stub reports as its drawing buffer. */
export interface StubDrawingBuffer {
  width: number;
  height: number;
}

/**
 * A WebGL2 context a real `THREE.WebGLRenderer` constructs over and renders
 * through, reporting `canvas`'s backing store as its drawing buffer.
 *
 * `label` names the stub in the three strings a renderer may log or surface —
 * `VERSION`, `SHADING_LANGUAGE_VERSION` and `RENDERER` — so a stack trace or a
 * capability report says which case's validator produced it rather than implying
 * a real device.
 */
export function createGlStub(
  canvas: StubDrawingBuffer,
  label = "case-harness validator stub",
): unknown {
  const numbers = new Map<string, number>();
  const names = new Map<number, string>();
  const methods = new Map<string, (...args: unknown[]) => unknown>();

  // Above the enum range a real context uses, so a stubbed value is never
  // mistaken for a borrowed one, and never a float, so identity is exact.
  let nextNumber = 0x10000;

  const constant = (name: string): number => {
    const known = numbers.get(name);
    if (known !== undefined) return known;
    const value = nextNumber++;
    numbers.set(name, value);
    names.set(value, name);
    return value;
  };

  const strings: Readonly<Record<string, unknown>> = {
    VERSION: `WebGL 2.0 (${label})`,
    SHADING_LANGUAGE_VERSION: `WebGL GLSL ES 3.00 (${label})`,
    VENDOR: "The Test Cabinet",
    RENDERER: label,
  };

  /**
   * The members that must answer with something real. Everything absent is a
   * method that accepts anything and returns `undefined`.
   */
  const answers: Record<string, (...args: never[]) => unknown> = {
    getContextAttributes: () => ({ ...CONTEXT_ATTRIBUTES }),

    getParameter: ((pname: number): unknown => {
      const name = names.get(pname);
      // Built per read rather than shared: three writes the result into its own
      // state and would otherwise hold a buffer this stub could change under it.
      if (name === "SCISSOR_BOX" || name === "VIEWPORT") {
        return new Int32Array([0, 0, canvas.width, canvas.height]);
      }
      if (name === "MAX_VIEWPORT_DIMS") return new Int32Array([4096, 4096]);
      if (name === undefined) return 0;
      return strings[name] ?? GL_LIMITS[name] ?? 0;
    }) as (...args: never[]) => unknown,

    // Every extension is absent. three treats a null extension as a capability it
    // does not have and falls back, which is the conservative path.
    getExtension: () => null,
    getSupportedExtensions: () => [],

    // The highest precision, so three's shader precision negotiation settles on
    // `highp` and every program it builds is the same one everywhere.
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

    // Compilation and linking always succeed with an empty log. `true` is also
    // what three reads as the active uniform and attribute counts, which yields
    // one of each — enough for the reflection path to run.
    getProgramParameter: () => true,
    getShaderParameter: () => true,
    getProgramInfoLog: () => "",
    getShaderInfoLog: () => "",

    getUniformLocation: () => ({}),
    getAttribLocation: () => 0,
    getActiveUniform: ((_program: unknown, index: number) => ({
      name: `uniform${String(index)}`,
      size: 1,
      type: constant("FLOAT"),
    })) as (...args: never[]) => unknown,
    getActiveAttrib: ((_program: unknown, index: number) => ({
      name: `attribute${String(index)}`,
      size: 1,
      type: constant("FLOAT"),
    })) as (...args: never[]) => unknown,

    getError: () => 0,
    isContextLost: () => false,
  };

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

  return new Proxy(target, {
    get(held, property): unknown {
      if (typeof property !== "string") return Reflect.get(held, property);
      if (property in held) return Reflect.get(held, property);
      if (ENUM_NAME.test(property)) return constant(property);

      const memoized = methods.get(property);
      if (memoized !== undefined) return memoized;
      const answer = answers[property];
      const method = (...args: unknown[]): unknown =>
        answer === undefined
          ? undefined
          : (answer as (...rest: unknown[]) => unknown)(...args);
      methods.set(property, method);
      return method;
    },
    // A GL context reports every member as present, and three feature-tests by
    // reading rather than by `in`. Saying so keeps the two consistent.
    has(held, property): boolean {
      return typeof property === "string" ? true : Reflect.has(held, property);
    },
  });
}

/**
 * The `self` three's renderer reaches for, and nothing else.
 *
 * `THREE.WebGLRenderer` hands its animation driver `self` where the host defines
 * one and leaves it `null` where it does not, then calls `cancelAnimationFrame`
 * on whatever it was handed the moment the renderer is disposed. Under Node
 * `self` is undefined, so a renderer built there CANNOT BE DISPOSED — and
 * disposal is `engine.destroy()`, which is every harness's teardown, so every
 * suite's `afterEach` throws. Defining `self` with the two frame functions is the
 * whole fix.
 *
 * It belongs here rather than in an engine because it is THREE's requirement
 * rather than the engine's: an engine reads `globalThis.requestAnimationFrame` on
 * its own account, finds none, and drives its `run` loop off a timer instead —
 * which a validator never calls, because it drives frames with `advance`.
 *
 * Assigned only where the host defines none, so a real browser-shaped host — or a
 * second call — is left exactly as it was.
 */
export function defineSelfForThree(): void {
  const host = globalThis as Record<string, unknown>;
  host.self ??= {
    requestAnimationFrame: (): number => 0,
    cancelAnimationFrame: (): void => {},
  };
}
