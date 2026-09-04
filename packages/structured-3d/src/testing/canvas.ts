/**
 * The canvases the engine is driven over, and the measurements it takes through
 * them.
 *
 * jsdom gives a document, an element tree and events, but neither a canvas
 * implementation nor layout: `getContext` returns `null` for every id, and every
 * element it produces reports a client size of zero — which the viewport correctly
 * fits to a scale of zero, and which would make every assertion about the picture
 * vacuous. Both gaps are filled here rather than in each suite, so a test states the
 * size it wants and reads back what was drawn.
 *
 * What stands in for what:
 *
 * - The **stage canvas** hands out the WebGL2 stub from `./gl.ts` for `"webgl2"`,
 *   so a real `THREE.WebGLRenderer` constructs over it, and a recording 2D context
 *   for `"2d"`, so the recorder's capture path has a surface to compose into.
 * - The **screen canvas** hands out a recording 2D context, which is what the
 *   engine's screen layer — its screen-space components, a `DrawComponent`'s own
 *   drawing, and the diagnostics overlay — draws through. It records each operation
 *   *and the transform in force when it happened*, which is how a claim about the
 *   screen pass's layer order, and about the order of a frame's steps, is checked.
 * - The **surface** answers the element size and device pixel ratio with fixed
 *   figures over an event target the test owns, so the fit is arithmetic a test can
 *   predict rather than something jsdom's layout decided.
 *
 * None of this pretends to rasterize. A case's validators check the picture in a
 * real browser against a real GPU; these suites pin engine code, and the questions
 * they ask are which operations were issued, in what order, and under which
 * transform. The world pass — every mesh, model, light, and the collision overlay
 * — reaches the GL stub instead, and is read back through the calls `./gl.ts`
 * records.
 */

import type { GlStub, GlStubOptions } from "./gl";
import { createGlStub } from "./gl";

/* -------------------------------------------------------------------------- */
/* The 2D context                                                             */
/* -------------------------------------------------------------------------- */

/** One recorded context operation, with the state in force when it happened. */
export interface RecordedOp {
  /** The method's name, as it is spelled on the context. */
  readonly op: string;
  /** The arguments, by reference. */
  readonly args: readonly unknown[];
  /** The transform the operation was drawn under, as `setTransform` takes it. */
  readonly transform: readonly number[];
  /** The fill style in force, so a draw's colour is readable after the fact. */
  readonly fill: string;
  /** The text drawn, for `fillText` and `strokeText` alone. */
  readonly text?: string;
}

/** A recording 2D context, and the handles a test reads it back through. */
export interface Context2dStub {
  /** The context itself, to hand to a canvas's `getContext` or to the engine. */
  readonly ctx: CanvasRenderingContext2D;
  /** The recorded operations, oldest first. */
  readonly ops: readonly RecordedOp[];
  /** The operation names alone, oldest first — the shape most order claims read. */
  names(): string[];
  /** Every recorded operation of one kind, oldest first. */
  opsOf(op: string): readonly RecordedOp[];
  /** Discards the recorded operations, leaving the context's state as it is. */
  forget(): void;
}

/**
 * The methods recorded with no answer of their own.
 *
 * A 2D context's drawing half returns nothing, so recording the call *is* the whole
 * behaviour, and listing the names is cheaper than writing thirty identical bodies.
 * The measuring half — `measureText`, `getTransform`, the gradient and pattern
 * constructors — is answered below, because something reads what it returns.
 */
const RECORDED_2D_METHODS: readonly string[] = [
  "arc",
  "arcTo",
  "beginPath",
  "bezierCurveTo",
  "clearRect",
  "clip",
  "closePath",
  "drawImage",
  "ellipse",
  "fill",
  "fillRect",
  "lineTo",
  "moveTo",
  "quadraticCurveTo",
  "rect",
  "resetTransform",
  "restore",
  "rotate",
  "roundRect",
  "save",
  "scale",
  "setLineDash",
  "stroke",
  "strokeRect",
  "transform",
  "translate",
];

/** The state properties a test may read back off the stub after a draw. */
const STATE_2D: Readonly<Record<string, unknown>> = {
  fillStyle: "#000000",
  strokeStyle: "#000000",
  lineWidth: 1,
  lineCap: "butt",
  lineJoin: "miter",
  font: "10px sans-serif",
  textAlign: "start",
  textBaseline: "alphabetic",
  globalAlpha: 1,
  globalCompositeOperation: "source-over",
  imageSmoothingEnabled: true,
  shadowBlur: 0,
  shadowColor: "rgba(0, 0, 0, 0)",
};

/**
 * A 2D context that records rather than draws.
 *
 * It answers `measureText` with a width proportional to the text so the overlay's
 * layout arithmetic has real numbers to work with, and it keeps `save` and
 * `restore` in the log so a subsystem that leaks state can be caught.
 */
export function createContext2dStub(canvas: HTMLCanvasElement): Context2dStub {
  const ops: RecordedOp[] = [];
  const state: Record<string, unknown> = { ...STATE_2D };
  let transform: readonly number[] = [1, 0, 0, 1, 0, 0];

  function push(op: string, args: readonly unknown[], text?: string): void {
    const fill = String(state["fillStyle"]);
    ops.push(
      text === undefined
        ? { op, args, transform, fill }
        : { op, args, transform, fill, text },
    );
  }

  const stub: Record<string, unknown> = {
    ...state,
    canvas,
    setTransform(...args: number[]): void {
      // A caller may pass six numbers or one matrix; only the six-number form is
      // used by anything in this package, and a matrix leaves the transform alone
      // rather than pretending to a decomposition nothing would read.
      if (args.length === 6) transform = [...args];
      push("setTransform", args);
    },
    getTransform: (): readonly number[] => transform,
    fillText(text: string, ...rest: unknown[]): void {
      push("fillText", [text, ...rest], text);
    },
    strokeText(text: string, ...rest: unknown[]): void {
      push("strokeText", [text, ...rest], text);
    },
    // Seven pixels an em is close enough to a real measurement for a layout to lay
    // out, and being exactly proportional to the length makes an expected width a
    // test can compute rather than one it has to observe first.
    measureText: (text: string): { width: number } => ({
      width: String(text).length * 7,
    }),
    createLinearGradient: (): { addColorStop: () => void } => ({
      addColorStop: (): void => {},
    }),
    createRadialGradient: (): { addColorStop: () => void } => ({
      addColorStop: (): void => {},
    }),
    createPattern: (): { setTransform: () => void } => ({
      setTransform: (): void => {},
    }),
  };

  for (const name of RECORDED_2D_METHODS) {
    stub[name] = (...args: unknown[]): void => {
      push(name, args);
    };
  }

  // The state properties are accessors so a write lands where `push` reads it: the
  // recorded `fill` of an operation is the style that was in force for it, not the
  // one the last operation of the frame happened to leave behind.
  for (const name of Object.keys(STATE_2D)) {
    Object.defineProperty(stub, name, {
      get: () => state[name],
      set: (value: unknown) => {
        state[name] = value;
      },
      enumerable: true,
      configurable: true,
    });
  }

  return {
    ctx: stub as unknown as CanvasRenderingContext2D,
    ops,
    names: () => ops.map((entry) => entry.op),
    opsOf: (op) => ops.filter((entry) => entry.op === op),
    forget: () => {
      ops.length = 0;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Canvases                                                                   */
/* -------------------------------------------------------------------------- */

/** How a stub canvas is sized and what its contexts should answer. */
export interface CanvasOptions {
  /** The backing store's width in device pixels. Defaults to 800. */
  width?: number;
  /** The backing store's height in device pixels. Defaults to 600. */
  height?: number;
  /** The laid-out width in CSS pixels. Defaults to `width`. */
  cssWidth?: number;
  /** The laid-out height in CSS pixels. Defaults to `height`. */
  cssHeight?: number;
  /** Passed to {@link createGlStub} for this canvas's WebGL2 context. */
  gl?: GlStubOptions;
}

/** A canvas with a pretended laid-out size and a stubbed context of each kind. */
export interface StubCanvas {
  /** The element itself. */
  readonly canvas: HTMLCanvasElement;
  /** The WebGL2 stub `getContext("webgl2")` hands out. */
  readonly gl: GlStub;
  /** The 2D stub `getContext("2d")` hands out. */
  readonly context2d: Context2dStub;
}

/**
 * A canvas whose contexts are the stubs above and whose laid-out size is whatever
 * the test said, since jsdom performs no layout and would otherwise report zero.
 *
 * Both contexts are built eagerly and handed out on request, so a test reads what
 * was drawn without having to intercept the `getContext` call that produced it.
 */
export function createStubCanvas(options: CanvasOptions = {}): StubCanvas {
  const width = options.width ?? 800;
  const height = options.height ?? 600;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  size(canvas, options.cssWidth ?? width, options.cssHeight ?? height);

  const gl = createGlStub(canvas, options.gl);
  const context2d = createContext2dStub(canvas);
  canvas.getContext = ((id: string): unknown => {
    if (id === "webgl2") return gl.gl;
    if (id === "2d") return context2d.ctx;
    return null;
  }) as unknown as HTMLCanvasElement["getContext"];

  return { canvas, gl, context2d };
}

/** A canvas whose context cannot be had — the failure `createEngine` refuses. */
export function createContextlessCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.getContext = ((): null =>
    null) as unknown as HTMLCanvasElement["getContext"];
  return canvas;
}

/** Reports a laid-out size jsdom would otherwise give as zero. */
function size(canvas: HTMLCanvasElement, cssW: number, cssH: number): void {
  Object.defineProperty(canvas, "clientWidth", {
    value: cssW,
    configurable: true,
  });
  Object.defineProperty(canvas, "clientHeight", {
    value: cssH,
    configurable: true,
  });
}

/* -------------------------------------------------------------------------- */
/* Every canvas the code under test creates for itself                        */
/* -------------------------------------------------------------------------- */

/** The handle {@link installCanvasContexts} hands back. */
export interface InstalledContexts {
  /** The WebGL2 stub a given canvas was handed, if it asked for one. */
  glFor(canvas: HTMLCanvasElement): GlStub | undefined;
  /** The 2D stub a given canvas was handed, if it asked for one. */
  context2dFor(canvas: HTMLCanvasElement): Context2dStub | undefined;
  /** Puts jsdom's own `getContext` back. */
  uninstall(): void;
}

/**
 * Makes every canvas in the document answer `getContext`, not just the ones a test
 * built by hand.
 *
 * The engine creates canvases of its own — the screen layer when the caller
 * supplies none, which it makes from the stage canvas's owning document, and the
 * capture canvas the recorder composes each frame into — and those are never handed
 * in. Patching the
 * prototype is what lets a test see through them: each canvas gets its own stub the
 * first time it asks, remembered so a later read finds the same one.
 */
export function installCanvasContexts(
  options: GlStubOptions = {},
): InstalledContexts {
  const gls = new WeakMap<HTMLCanvasElement, GlStub>();
  const contexts = new WeakMap<HTMLCanvasElement, Context2dStub>();
  const original = HTMLCanvasElement.prototype.getContext;

  HTMLCanvasElement.prototype.getContext = function patched(
    this: HTMLCanvasElement,
    id: string,
  ): unknown {
    if (id === "webgl2") {
      const known = gls.get(this) ?? createGlStub(this, options);
      gls.set(this, known);
      return known.gl;
    }
    if (id === "2d") {
      const known = contexts.get(this) ?? createContext2dStub(this);
      contexts.set(this, known);
      return known.ctx;
    }
    return null;
  } as unknown as HTMLCanvasElement["getContext"];

  return {
    glFor: (canvas) => gls.get(canvas),
    context2dFor: (canvas) => contexts.get(canvas),
    uninstall: () => {
      HTMLCanvasElement.prototype.getContext = original;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The surface                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Where the engine reads its element size and device pixel ratio.
 *
 * Declared structurally rather than imported from the engine's contract, so this
 * module stays a leaf the rest of the harness can rest on and a suite that only
 * wants a canvas pulls no engine code in behind it. Structural typing is what makes
 * the object below satisfy the engine's own `SurfaceMetrics` all the same.
 */
export interface SurfaceMetrics {
  cssWidth(): number;
  cssHeight(): number;
  dpr(): number;
  events(): EventTarget;
  origin?(): { x: number; y: number };
  claimGestures?(): () => void;
  capturePointer?(pointerId: number): void;
  releasePointerCapture?(pointerId: number): void;
}

/** What a deterministic surface should report, and what it should record. */
export interface SurfaceOptions {
  /** The laid-out width in CSS pixels. Defaults to 800. */
  cssWidth?: number;
  /** The laid-out height in CSS pixels. Defaults to 600. */
  cssHeight?: number;
  /** The device pixel ratio. Defaults to 2, so a wrong one is visible. */
  dpr?: number;
  /** The canvas's top-left corner in client coordinates. Defaults to the origin. */
  origin?: { x: number; y: number };
  /** The target key and pointer listeners are attached to. Defaults to a fresh one. */
  events?: EventTarget;
}

/** A deterministic surface, and what the engine did with the optional half of it. */
export interface SurfaceStub {
  /** The surface to hand to `createEngine`. */
  readonly surface: SurfaceMetrics;
  /** The target a test dispatches key and pointer events at. */
  readonly target: EventTarget;
  /** How many times the engine claimed the browser's own pointer gestures. */
  claims(): number;
  /** How many times it gave them back. */
  releases(): number;
  /** The pointer ids it captured, in order, and the ones it released. */
  captured(): readonly number[];
  releasedCaptures(): readonly number[];
}

/**
 * A surface reporting fixed figures over a target the test owns.
 *
 * The default device pixel ratio is 2 rather than 1 on purpose: an engine that
 * confused CSS pixels with device pixels would still pass every assertion at 1, and
 * the whole point of routing measurement through this seam is that the two are
 * distinct.
 */
export function createSurface(options: SurfaceOptions = {}): SurfaceStub {
  const target = options.events ?? new EventTarget();
  const origin = options.origin ?? { x: 0, y: 0 };
  let claims = 0;
  let releases = 0;
  const captured: number[] = [];
  const releasedCaptures: number[] = [];

  const surface: SurfaceMetrics = {
    cssWidth: () => options.cssWidth ?? 800,
    cssHeight: () => options.cssHeight ?? 600,
    dpr: () => options.dpr ?? 2,
    events: () => target,
    origin: () => ({ ...origin }),
    claimGestures: () => {
      claims += 1;
      return () => {
        releases += 1;
      };
    },
    capturePointer: (pointerId) => {
      captured.push(pointerId);
    },
    releasePointerCapture: (pointerId) => {
      releasedCaptures.push(pointerId);
    },
  };

  return {
    surface,
    target,
    claims: () => claims,
    releases: () => releases,
    captured: () => captured,
    releasedCaptures: () => releasedCaptures,
  };
}

/* -------------------------------------------------------------------------- */
/* The whole rig                                                              */
/* -------------------------------------------------------------------------- */

/** The three things `createEngine` is given, built to match one another. */
export interface StageOptions extends CanvasOptions {
  /** The device pixel ratio the surface reports. Defaults to 2. */
  dpr?: number;
}

/** A stage canvas, a screen canvas, and the surface that measures them. */
export interface Stage {
  /** The canvas the renderer draws the scene through. */
  readonly stage: StubCanvas;
  /** The canvas the screen layer is drawn on. */
  readonly screen: StubCanvas;
  /** The surface and what the engine asked of it. */
  readonly surface: SurfaceStub;
}

/**
 * Everything an engine test needs to construct an engine, sized consistently.
 *
 * The stage canvas's backing store is the CSS size times the surface's device pixel
 * ratio, which is what the engine's own fit would produce, so a test that never
 * looks at the fit still starts from a rig that is not self-contradictory.
 */
export function createStage(options: StageOptions = {}): Stage {
  const cssWidth = options.cssWidth ?? 800;
  const cssHeight = options.cssHeight ?? 600;
  const dpr = options.dpr ?? 2;
  const shape: CanvasOptions = {
    width: options.width ?? cssWidth * dpr,
    height: options.height ?? cssHeight * dpr,
    cssWidth,
    cssHeight,
    gl: options.gl,
  };
  return {
    stage: createStubCanvas(shape),
    screen: createStubCanvas(shape),
    surface: createSurface({ cssWidth, cssHeight, dpr }),
  };
}
