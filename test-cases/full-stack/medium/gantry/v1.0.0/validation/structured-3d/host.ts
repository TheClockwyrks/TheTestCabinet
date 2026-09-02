// Gantry — what a browser supplies to the engine and Node does not. CASE-PROVIDED.
//
// WHY THIS FILE EXISTS AT ALL. Every check in this project runs in the same Node
// process as the build, over an engine the harness constructs itself. That is the
// only way these suites CAN run: a validator project has no browser to stand up
// (the seeded toolchain carries `vitest` and `vite` and no `@vitest/browser`), so
// the engine is created here, driven with `engine.advance`, and read back through
// the objects it owns. What the engine expects around it, though, is a browser —
// it takes a `webgl2` context off a canvas at construction, it fetches every
// asset under its root, and it decodes a `.wav` through a Web Audio context — and
// Node supplies none of the three. This module is the whole of that adapter, and
// it is deliberately ONE file: everything in it is "the host, not the case", and
// keeping it together is what stops it leaking into `harness.ts`, which is about
// Gantry.
//
// FOUR THINGS ARE SUPPLIED, and each is as real as it can be:
//
//   1. THE STAGE CANVAS AND ITS WEBGL2 CONTEXT. A stub. It is not a rasterizer
//      and does not pretend to be one — see {@link createEngineSurface}.
//   2. THE SCREEN LAYER. A genuine `@napi-rs/canvas`, so the HUD, the readouts
//      and the menus are really drawn, through a real 2D context, and a still
//      captured for a reviewer carries them.
//   3. `fetch`, over the workspace's own files. The build commits its produced
//      models and sounds under `assets/` (`specs/assets.md`) and loads every one
//      of them through the ENGINE's loader, which resolves `ASSET_ROOT` relative
//      to the page and fetches it. There is no page here, so a shim answers those
//      relative URLs out of the workspace on disk. Without it every produced file
//      would 404, and a build whose `initialize` awaits its loads — which is what
//      `src/game.ts` tells it to write — would fail to initialize at all, taking
//      every item in the run down with it for a fault that is the harness's.
//   4. AN AUDIO CONTEXT, for `decodeAudioData` alone. The engine's cue bus
//      degrades to silence with no context and still announces every cue, which
//      is the whole of what `h.cues()` reads, so nothing here has to make a sound.
//      What it has to do is let `api.audio.load(cue, path)` resolve, for the same
//      reason as (3). The decode really does parse the RIFF/WAVE header the tools
//      write, so a build that committed something that is not a PCM `.wav` fails
//      the item that loads it rather than passing on a fake.
//
// NOTHING HERE IS EVER SEEDED INTO A RUN. It is the case's validator project, and
// the build neither sees it nor is written against it.

import { readFileSync } from "node:fs";
import { join, normalize } from "node:path";

import { createCanvas, type Canvas } from "@napi-rs/canvas";

/* -------------------------------------------------------------------------- */
/* The WebGL2 stub and the two canvases                                       */
/* -------------------------------------------------------------------------- */

/** A GL enum constant reads as an all-caps identifier; a method never does. */
const ENUM_NAME = /^[A-Z][A-Z0-9_]*$/;

/**
 * What `getContextAttributes` reports.
 *
 * Already resolved, as a real context reports them rather than as three asks for
 * them: `antialias` is off because the stub has no multisample buffer to offer,
 * and reporting it on would have three believe in one.
 */
const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
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
 * plausible rather than borrowed from any particular device — three sizes several
 * of its own arrays from them, so zero would be wrong in a way that only showed
 * up as an empty draw much later.
 */
const GL_PARAMETERS: Readonly<Record<string, unknown>> = {
  VERSION: "WebGL 2.0 (Gantry validator stub)",
  SHADING_LANGUAGE_VERSION: "WebGL GLSL ES 3.00 (Gantry validator stub)",
  VENDOR: "The Test Cabinet",
  RENDERER: "Gantry validator stub",
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
 * A WebGL2 context a real `THREE.WebGLRenderer` constructs over and renders
 * through, reporting `canvas`'s backing store as its drawing buffer.
 *
 * WHAT THIS IS NOT: a rasterizer. Nothing in this project reads a pixel of the
 * WORLD pass, because nothing in the harness Gantry's contract fixes can — the
 * API is `snapshot`, `check`, `project`, `cues` and the input verbs — and every
 * claim about the picture a validator makes is a claim about the render
 * components the world holds, the objects the pipeline placed in `engine.scene`,
 * and where the camera projects a world point. All of those are engine data that
 * exist whether or not a driver rasterized anything. What the stub buys is the
 * engine standing up at all, so the game's tick, its state, its debug surface and
 * its cues can be driven.
 *
 * The shape is a `Proxy` for the reason the engine's own test stub gives: the
 * WebGL2 surface is some five hundred members, enumerating them by hand would buy
 * nothing, and three feature-tests by reading rather than by `in`.
 */
function createGlStub(canvas: { width: number; height: number }): unknown {
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

  /**
   * The members that must answer with something real. Everything absent is a
   * method that accepts anything and returns `undefined`, which covers the whole
   * state-setting half of the API: three sets the state and nothing reads it
   * back.
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
      return GL_PARAMETERS[name] ?? 0;
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

/** The two canvases and the event target one harness stands its engine on. */
export interface EngineSurface {
  /** The stage canvas: the engine takes its `webgl2` context off this. */
  readonly stage: HTMLCanvasElement;
  /** The screen layer: a real 2D canvas the HUD is genuinely drawn on. */
  readonly screen: HTMLCanvasElement;
  /** The screen layer as `@napi-rs/canvas` sees it, for encoding a still. */
  readonly screenCanvas: Canvas;
  /** Where the engine attaches its key, pointer and wheel listeners. */
  readonly events: EventTarget;
}

/**
 * Build the surface one engine is created over: a stage canvas answering with the
 * WebGL2 stub, a real 2D canvas for the screen layer, and the event target every
 * input this harness delivers is dispatched at.
 *
 * `width` and `height` are DEVICE pixels — the logical stage size times the
 * device pixel ratio the harness chose — because that is what a canvas's backing
 * store holds and what the engine resizes each frame.
 */
export function createEngineSurface(
  width: number,
  height: number,
): EngineSurface {
  defineSelfForThree();

  const screenCanvas = createCanvas(width, height);
  // The recorder is the only thing that asks the STAGE canvas for a 2D context,
  // and this project never arms it — the recorder encodes with WebCodecs, which
  // Node has none of. It is supplied anyway so that a `getContext("2d")` on the
  // stage answers an object rather than `null`, as a real canvas would.
  const stageBacking = createCanvas(width, height);
  const events = new EventTarget();

  let gl: unknown;
  const stage = {
    width,
    height,
    // Read by three when it sizes itself against the element; the engine takes
    // every measurement through its `SurfaceMetrics` instead.
    style: {} as CSSStyleDeclaration,
    clientWidth: width,
    clientHeight: height,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    getContext(id: string): unknown {
      if (id === "webgl2") return (gl ??= createGlStub(stage));
      if (id === "2d") return stageBacking.getContext("2d");
      return null;
    },
  };

  return {
    stage: stage as unknown as HTMLCanvasElement,
    screen: screenCanvas as unknown as HTMLCanvasElement,
    screenCanvas,
    events,
  };
}

/**
 * The `self` three's renderer reaches for, and nothing else.
 *
 * `THREE.WebGLRenderer` hands its animation driver `self` where the host defines
 * one and leaves it `null` where it does not, then calls `cancelAnimationFrame`
 * on whatever it was handed the moment the renderer is disposed. Under Node
 * `self` is undefined, so a renderer built here cannot be disposed — and disposal
 * is `engine.destroy()`, which is every harness's teardown. Defining `self` with
 * the two frame functions is the whole fix, and it belongs here because it is
 * three's requirement rather than the engine's: the engine reads
 * `globalThis.requestAnimationFrame` on its own account, finds none, and drives
 * `engine.run` off a timer instead — which this project never calls, because it
 * drives frames with `engine.advance`.
 */
function defineSelfForThree(): void {
  const host = globalThis as Record<string, unknown>;
  host.self ??= {
    requestAnimationFrame: (): number => 0,
    cancelAnimationFrame: (): void => {},
  };
}

/* -------------------------------------------------------------------------- */
/* Serving the build's own produced files                                     */
/* -------------------------------------------------------------------------- */

/** Where a relative asset URL is looked for, in order, under the workspace. */
const ASSET_SEARCH_PATH: readonly string[] = [".", "public", "dist"];

/**
 * Answer the engine's asset fetches out of the workspace on disk.
 *
 * `specs/assets.md` has the build commit every produced model and sound under
 * `assets/` and load each one through the ENGINE's loader — "No part of the build
 * decodes glTF itself, and nothing else fetches an asset" — and that loader
 * resolves a path to `ASSET_ROOT + path`, a URL relative to the page, and hands it
 * to `globalThis.fetch`. There is no page here and Node's `fetch` refuses a
 * relative URL, so without this every produced file would fail to load.
 *
 * That is not a tolerable default. The build's `src/game.ts` is told to load its
 * models and its cues from the instance's `initialize`, and a rejection escaping
 * `initialize` rejects `engine.initialize` itself, so an unserved asset would not
 * fail the items about assets — it would fail EVERY item in the project, for a
 * fault that belongs to the harness rather than to the build.
 *
 * THREE PLACES ARE SEARCHED, in order, because the specification lets the build
 * arrange its output: the committed tree (`assets/…`), whatever `public/` serves
 * unchanged, and a built `dist/`. A URL that names none of them 404s exactly as it
 * would on a served site, which is the honest answer for a file the build never
 * produced.
 *
 * Installed once per worker and idempotent. Anything that is not a relative URL —
 * anything carrying a scheme — goes to the real `fetch` untouched.
 */
export function serveWorkspaceAssets(workspaceRoot: string): void {
  const host = globalThis as Record<string, unknown>;
  if (host.__gantryAssetFetch === true) return;
  host.__gantryAssetFetch = true;

  const upstream = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : String(input);
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) return upstream(input, init);

    const relative = url.replace(/^\.?\//, "").split(/[?#]/)[0] ?? "";
    // A URL that climbs out of the workspace is refused rather than read: the
    // shim stands in for a static server, and a static server does not serve a
    // caller's whole filesystem.
    if (relative === "" || normalize(relative).startsWith("..")) {
      return new Response(null, { status: 400, statusText: "Bad Request" });
    }

    for (const base of ASSET_SEARCH_PATH) {
      try {
        const bytes = readFileSync(join(workspaceRoot, base, relative));
        return new Response(new Uint8Array(bytes), {
          status: 200,
          statusText: "OK",
        });
      } catch {
        // Not there; try the next place the build may have put it.
      }
    }
    return new Response(null, { status: 404, statusText: "Not Found" });
  }) as typeof globalThis.fetch;
}

/* -------------------------------------------------------------------------- */
/* Decoding the produced sounds                                               */
/* -------------------------------------------------------------------------- */

/**
 * A `.wav` the tools of `specs/assets.md` write, read as an `AudioBuffer`.
 *
 * The header is genuinely parsed rather than assumed: the RIFF/WAVE magic, the
 * `fmt ` chunk's channel count, sample rate and bit depth, and the `data` chunk's
 * length are what the buffer reports, so a check that loads a cue and reads its
 * duration is reading the file the build produced. A body that is not a PCM
 * `.wav` throws, which is what a browser's `decodeAudioData` does and what the
 * item about that file should see.
 *
 * The SAMPLES are not decoded. Nothing in this project listens, the engine's bus
 * only ever hands the buffer to a source node this host silences, and decoding
 * eleven cues per harness for nobody would be the most expensive thing the
 * project did. The channel data is therefore silence of the right length.
 */
function decodeWav(bytes: Uint8Array): AudioBuffer {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number): string =>
    String.fromCharCode(
      view.getUint8(at),
      view.getUint8(at + 1),
      view.getUint8(at + 2),
      view.getUint8(at + 3),
    );

  if (bytes.byteLength < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }

  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataBytes = -1;

  let at = 12;
  while (at + 8 <= bytes.byteLength) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt " && size >= 16) {
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (id === "data") {
      dataBytes = Math.min(size, bytes.byteLength - body);
    }
    // Chunks are word-aligned, so an odd size carries one pad byte.
    at = body + size + (size % 2);
  }

  if (channels <= 0 || sampleRate <= 0 || bitsPerSample <= 0) {
    throw new Error("no usable `fmt ` chunk");
  }
  if (dataBytes < 0) throw new Error("no `data` chunk");

  const frames = Math.floor(dataBytes / ((bitsPerSample / 8) * channels));
  const silence = new Float32Array(frames);
  return {
    duration: frames / sampleRate,
    length: frames,
    numberOfChannels: channels,
    sampleRate,
    getChannelData: () => silence,
    copyFromChannel: () => undefined,
    copyToChannel: () => undefined,
  } as unknown as AudioBuffer;
}

/**
 * An inert node of the fake audio graph: every member answers, and none sounds.
 *
 * A `Proxy` rather than a hand-written set of node classes, and for a sharper
 * reason than brevity. The engine's bus builds a real graph the moment it is
 * unlocked — a panner, a gain, a buffer source, an oscillator, a filter,
 * whichever a `CueSpec` asks for — and it wires them together with `connect`,
 * schedules them with `AudioParam` methods, and starts and stops them. Enumerating
 * that by hand would mean a list to keep in step with the engine's synthesizer,
 * and a member this file had missed would surface as a thrown error inside the
 * build's own tick. Answering everything is the property that matters, so
 * everything is answered.
 *
 * Each member is BOTH callable and parameter-shaped, because a name alone does
 * not say which it is: `gain.connect(x)` is a method and `gain.gain.value = 0.3`
 * is an `AudioParam`, and one object serves both without the stub having to know
 * which is which.
 */
function audioNode(): unknown {
  const held: Record<string, unknown> = {};
  return new Proxy(held, {
    get(target, property): unknown {
      if (typeof property !== "string") return Reflect.get(target, property);
      if (property in target) return Reflect.get(target, property);
      const member = ((): unknown => audioNode()) as Record<string, unknown> &
        (() => unknown);
      member.value = 0;
      member.setValueAtTime = (): unknown => member;
      member.linearRampToValueAtTime = (): unknown => member;
      member.exponentialRampToValueAtTime = (): unknown => member;
      member.setTargetAtTime = (): unknown => member;
      member.setValueCurveAtTime = (): unknown => member;
      member.cancelScheduledValues = (): unknown => member;
      target[property] = member;
      return member;
    },
    set(target, property, value): boolean {
      target[property as string] = value;
      return true;
    },
  });
}

/**
 * An `AudioContext` that decodes and never sounds.
 *
 * WHY ONE IS SUPPLIED AT ALL. The engine's bus is written to degrade: with no
 * context it announces `cue:played` and `cue:looped` and returns, which is
 * exactly what `h.cues()` and `h.loopingCues()` read, so a harness that wanted
 * only the cue names would want no context at all. What needs one is
 * `api.audio.load(cue, path)`: the engine decodes each produced `.wav` through
 * `context.decodeAudioData`, and refuses outright on a host with no
 * `AudioContext`. `src/game.ts` tells the build to back all eleven cues with
 * their files from `initialize`, so without this the rejection would escape
 * `initialize`, reject `engine.initialize`, and cost the run every item.
 *
 * Installed once per worker and idempotent, and only where the host has none —
 * so a host that really does have Web Audio keeps it.
 */
export function defineAudioContext(): void {
  const host = globalThis as Record<string, unknown>;
  if (host.AudioContext !== undefined) return;

  class StubAudioContext {
    readonly sampleRate = 48000;
    readonly state = "running";
    readonly currentTime = 0;
    readonly destination = audioNode();
    readonly listener = audioNode();

    resume(): Promise<void> {
      return Promise.resolve();
    }
    suspend(): Promise<void> {
      return Promise.resolve();
    }
    close(): Promise<void> {
      return Promise.resolve();
    }
    decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer> {
      try {
        return Promise.resolve(decodeWav(new Uint8Array(data)));
      } catch (error) {
        return Promise.reject(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
    createBuffer(
      channels: number,
      length: number,
      sampleRate: number,
    ): AudioBuffer {
      const silence = new Float32Array(length);
      return {
        duration: length / sampleRate,
        length,
        numberOfChannels: channels,
        sampleRate,
        getChannelData: () => silence,
      } as unknown as AudioBuffer;
    }
  }

  // Every other member — `createGain`, `createPanner`, `createBufferSource`,
  // `createOscillator`, and whatever the engine's synthesizer reaches for next —
  // comes from the same proxy the nodes do, so nothing the bus asks for is
  // missing and nothing has to be kept in step with it.
  host.AudioContext = new Proxy(StubAudioContext, {
    construct: (target, args): object =>
      new Proxy(Reflect.construct(target, args) as object, {
        get(instance, property): unknown {
          const value = Reflect.get(instance, property) as unknown;
          if (value !== undefined) {
            return typeof value === "function"
              ? (value as (...a: unknown[]) => unknown).bind(instance)
              : value;
          }
          if (typeof property !== "string") return undefined;
          return (): unknown => audioNode();
        },
      }),
  });
}
