import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConstantClock } from "./clocks";
import type {
  Clock,
  DeepReadonly,
  Engine,
  Game,
  InitApi,
  Projected,
  Recording,
  RenderApi,
  SurfaceMetrics,
  UpdateApi,
  Vec3,
  Viewport,
} from "./contract";
import { createEngine } from "./index";
import type {
  Context2dStub,
  InstalledContexts,
  RecordedOp,
} from "./testing/canvas";
import { installCanvasContexts } from "./testing/canvas";
import type { InstalledCodecs } from "./testing/codecs";
import { installCodecs } from "./testing/codecs";
import type { GlStub } from "./testing/gl";

/**
 * The "Validating a Game" worked example, transcribed from
 * `apps/docs/src/content/docs/engines/simple-3d/examples/validating-a-game.md`
 * and run.
 *
 * The page is one complete validator suite for a small game, written the way a
 * case ships its validators: a harness that builds an engine over two canvases
 * it made in the page, and seven checking suites over it. The page promises the
 * code works against the engine as written, so its constants, its debug
 * surface, its harness and all seven of its suites are carried here as literally
 * as one test module allows, and the assertions are the ones the page's own
 * prose states — the arithmetic each figure follows from, not merely that
 * nothing threw.
 *
 * What the page fixes is the *case*: the table of figures under "The build under
 * test", the module the build exports its game from, and the four-operation
 * debug surface. What it leaves to the model under test is the build itself, so
 * a reference build of that case is written below from the table and from the
 * narration around each check — the court, the ball and its two walls, the
 * paddle and its clamp, the camera, the bounce cue, the two diagnostics, and the
 * HUD.
 *
 * Adaptations, all forced by the environment rather than chosen:
 *
 * - The example is a seeded workspace whose validators run in a browser page
 *   through vitest's Playwright provider; this suite runs under jsdom, which
 *   gives a document and events but neither a GPU nor a 2D rasterizer. Three
 *   readings therefore come from `src/testing/` rather than from real pixels,
 *   each documented where it is defined: `installCanvasContexts` supplies the
 *   WebGL2 context a real `THREE.WebGLRenderer` is built over and the recording
 *   2D context the HUD is drawn through, `harness.pixel` reads the layer's
 *   recorded rectangles instead of its bytes, and `harness.stagePixel` answers a
 *   letterbox sample from the clear the frame issued.
 * - jsdom has no WebCodecs, so `installCodecs` stands in the `VideoEncoder` and
 *   `VideoFrame` the recorder needs. What that costs is the claim that VP9 came
 *   out of the encoder, which is a question for a browser with a real codec; the
 *   frame accounting the page asserts is untouched by it.
 * - Imports name the engine's own modules rather than the published package
 *   `@clockwyrks/simple-3d` (this file *is* that package), and `DeepReadonly`
 *   comes from the contract's re-export rather than from `ts-essentials`
 *   directly, which is the same type.
 * - `validation/replay.ts` reaches the Node side through
 *   `@vitest/browser/context`, which a jsdom run has no counterpart for. The
 *   helper is transcribed with its early return and its base64 conversion
 *   intact, over a stand-in for the browser command that records what it was
 *   handed — so the two claims the page makes about it, that an empty recording
 *   emits nothing and that what is emitted is the video's own bytes, are still
 *   the ones asserted.
 * - This repository compiles with `noUncheckedIndexedAccess`, so the page's
 *   `bounces[0].t` and `texts[0]` become guarded or asserted index reads, and
 *   the page's `screen.getContext = () => recorded` takes a cast, because
 *   `getContext` is an overload set nothing with one signature satisfies. The
 *   values compared and the behaviour driven are unchanged.
 */

/* -------------------------------------------------------------------------- */
/* src/game.ts, as a validator sees it — transcribed verbatim                 */
/* -------------------------------------------------------------------------- */

interface Ball {
  readonly x: number;
  readonly z: number;
  readonly vx: number;
  readonly vz: number;
}

interface State {
  readonly ball: Ball;
  readonly paddle: { readonly z: number };
  readonly score: number;
}

interface Snapshot {
  readonly ball: Ball;
  readonly paddle: { readonly z: number };
  readonly score: number;
}

interface Debug {
  setBallPosition(state: DeepReadonly<State>, x: number, z: number): State;
  setBallVelocity(state: DeepReadonly<State>, vx: number, vz: number): State;
  setPaddle(state: DeepReadonly<State>, z: number): State;
  snapshot(state: DeepReadonly<State>): Snapshot;
}

/* -------------------------------------------------------------------------- */
/* src/debug.ts, as the build writes it — transcribed verbatim                */
/* -------------------------------------------------------------------------- */

const debug: Debug = {
  setBallPosition: (state, x, z) => ({
    ...state,
    ball: { ...state.ball, x, z },
  }),
  setBallVelocity: (state, vx, vz) => ({
    ...state,
    ball: { ...state.ball, vx, vz },
  }),
  setPaddle: (state, z) => ({ ...state, paddle: { z } }),
  snapshot: (state) => ({
    ball: { ...state.ball },
    paddle: { ...state.paddle },
    score: state.score,
  }),
};

/* -------------------------------------------------------------------------- */
/* The build under test: a reference build of the case's table of figures     */
/* -------------------------------------------------------------------------- */

/**
 * The figures the case's specification fixes, as the harness re-declares them
 * below. Repeated here rather than imported from the harness because the build
 * and the validator arrive at them independently — the build from the spec it
 * was given, the suite from the spec it checks against — and a shared constant
 * would let a build that read the spec wrong agree with a check that read it the
 * same way.
 */
const COURT_X = 16;
const COURT_Z = 10;
const BALL_R = 0.4;
const PADDLE_AT_X = -7;
const PADDLE_HEIGHT = 1;
const PADDLE_ALONG_Z = 3;
const PADDLE_SPEED = 6;

/** The wall the ball's *edge* meets, and the travel the paddle's centre has. */
const BALL_LIMIT = COURT_Z / 2 - BALL_R;
const PADDLE_LIMIT = COURT_Z / 2 - PADDLE_ALONG_Z / 2;

/** Keeps `value` inside `[-limit, limit]`. */
function clamp(value: number, limit: number): number {
  return Math.min(limit, Math.max(-limit, value));
}

/**
 * The build's game module.
 *
 * The three functions are written the way the engine's contract asks for them:
 * `initialize` declares the vocabulary and places what the picture always holds,
 * `update` is a transition over the state alone, and `render` writes the scene,
 * the camera and the HUD from the state the update left. Nothing about the
 * picture lives in the state — the meshes are found by the names the case fixes,
 * which is also how a validator finds them.
 */
const game: Game<State, Debug> = {
  initialize(api: InitApi<State>): [State, Debug] {
    api.input.register("up", { keys: ["KeyW", "ArrowUp"] });
    api.input.register("down", { keys: ["KeyS", "ArrowDown"] });

    api.audio.define("bounce", { freq: 660, freqTo: 330, durationMs: 90 });

    api.diagnostics.register(
      "ball",
      (state) => `${state.ball.x.toFixed(1)}, ${state.ball.z.toFixed(1)}`,
    );
    api.diagnostics.register("paddle", (state) => state.paddle.z);

    // Lights, because a standard material lit by nothing is a black picture.
    // They carry no names: a validator finds a case's meshes by name, and
    // naming the lighting would put it in the same namespace.
    api.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1);
    key.position.set(4, 10, 6);
    api.scene.add(key);

    const court = new THREE.Mesh(
      new THREE.PlaneGeometry(COURT_X, COURT_Z),
      new THREE.MeshStandardMaterial({ color: "#20263a" }),
    );
    court.name = "court";
    court.rotation.x = -Math.PI / 2;
    api.scene.add(court);

    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_R, 24, 16),
      new THREE.MeshStandardMaterial({ color: "#f45b69" }),
    );
    ball.name = "ball";
    api.scene.add(ball);

    const paddle = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, PADDLE_HEIGHT, PADDLE_ALONG_Z),
      new THREE.MeshStandardMaterial({ color: "#e8e8e8" }),
    );
    paddle.name = "paddle";
    api.scene.add(paddle);

    const state: State = {
      ball: { x: 0, z: 0, vx: 0, vz: 0 },
      paddle: { z: 0 },
      score: 0,
    };
    return [state, debug];
  },

  update(state: DeepReadonly<State>, api: UpdateApi, dt: number): State {
    // `up` moves the paddle toward `-z`, so the two actions subtract in that
    // order, and the result is clamped to the court rather than to the speed.
    const drive = api.input.value("down") - api.input.value("up");
    const paddleZ = clamp(
      state.paddle.z + drive * PADDLE_SPEED * dt,
      PADDLE_LIMIT,
    );

    const x = state.ball.x + state.ball.vx * dt;
    let z = state.ball.z + state.ball.vz * dt;
    let vz = state.ball.vz;

    // A reflection mirrors the overshoot back across the wall rather than
    // parking the ball on it, so the distance a frame carries is the same
    // whether or not the wall fell inside it and the arithmetic stays
    // independent of the step size.
    if (z > BALL_LIMIT || z < -BALL_LIMIT) {
      const wall = z > 0 ? BALL_LIMIT : -BALL_LIMIT;
      z = 2 * wall - z;
      vz = -vz;
      api.audio.play("bounce", { at: { x, y: BALL_R, z } });
    }

    return {
      ball: { x, z, vx: state.ball.vx, vz },
      paddle: { z: paddleZ },
      score: state.score,
    };
  },

  render(state: DeepReadonly<State>, api: RenderApi): void {
    const ball = api.scene.getObjectByName("ball");
    if (ball) ball.position.set(state.ball.x, BALL_R, state.ball.z);

    const paddle = api.scene.getObjectByName("paddle");
    if (paddle)
      paddle.position.set(PADDLE_AT_X, PADDLE_HEIGHT / 2, state.paddle.z);

    api.camera.position.set(0, 14, 10);
    api.camera.lookAt(0, 0, 0);

    const { screen } = api;
    screen.fillStyle = "#1c2033";
    screen.fillRect(8, 8, 120, 40);
    screen.fillStyle = "#ffffff";
    screen.font = "16px sans-serif";
    screen.fillText(`score ${state.score}`, 16, 32);
  },
};

/* -------------------------------------------------------------------------- */
/* validation/harness.ts — transcribed, with the environment's adaptations    */
/* -------------------------------------------------------------------------- */

// The figures the case's specification fixes.
const FIELD_WIDTH = 640;
const FIELD_HEIGHT = 360;
const BACKGROUND = "#101018";
const COURT_DEPTH = 10;
const BALL_RADIUS = 0.4;
const BALL_COLOR = "#f45b69";
const PADDLE_X = -7;
const PADDLE_LENGTH = 3;
const PADDLE_COLOR = "#e8e8e8";
const PANEL_COLOR = "#1c2033";
const TEXT_COLOR = "#ffffff";

type DrawCall =
  | { kind: "call"; method: string; args: unknown[] }
  | { kind: "set"; property: string; value: unknown };

interface HarnessOptions {
  clock?: Clock;
  cssWidth?: number;
  cssHeight?: number;
  dpr?: number;
}

interface Harness {
  readonly engine: Engine<State, Debug>;
  readonly stage: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly calls: DrawCall[];
  readonly assetFailures: string[];
  setBallPosition(x: number, z: number): void;
  setBallVelocity(vx: number, vz: number): void;
  setPaddle(z: number): void;
  snapshot(): Snapshot;
  hold(code: string): void;
  release(code: string): void;
  tap(code: string): void;
  device(x: number, y: number): { x: number; y: number };
  pixel(x: number, y: number): [number, number, number, number];
  stagePixel(x: number, y: number): [number, number, number, number];
  project(point: Vec3): Projected;
  dispose(): void;
}

class KeyEvent extends Event {
  readonly code: string;
  readonly repeat: boolean;

  constructor(type: "keydown" | "keyup", code: string, repeat = false) {
    super(type);
    this.code = code;
    this.repeat = repeat;
  }
}

function toDevice(
  view: Viewport,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: Math.round(view.offsetX + x * view.scale),
    y: Math.round(view.offsetY + y * view.scale),
  };
}

function pageCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function recorder(
  target: CanvasRenderingContext2D,
  calls: DrawCall[],
): CanvasRenderingContext2D {
  return new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property, object);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        calls.push({ kind: "call", method: String(property), args });
        return (value as (...rest: unknown[]) => unknown).apply(object, args);
      };
    },
    set(object, property, value) {
      calls.push({ kind: "set", property: String(property), value });
      return Reflect.set(object, property, value, object);
    },
  });
}

function callsTo(calls: readonly DrawCall[], method: string): unknown[][] {
  return calls.flatMap((call) =>
    call.kind === "call" && call.method === method ? [call.args] : [],
  );
}

function setsOf(calls: readonly DrawCall[], property: string): unknown[] {
  return calls.flatMap((call) =>
    call.kind === "set" && call.property === property ? [call.value] : [],
  );
}

/** `#rrggbb` as the four opaque bytes `getImageData` would have reported. */
function rgba(color: string): [number, number, number, number] {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255];
}

/**
 * What the screen layer holds at one device pixel, from the rectangles the frame
 * drew rather than from the bytes a rasterizer would have left.
 *
 * The page's harness reads `ctx.getImageData`; jsdom's 2D context draws nothing,
 * so the reading is reconstructed from the recorded operation stream, which
 * carries the transform in force for each operation and the fill style it was
 * drawn under. Composition is opaque rectangles over transparency — a
 * `clearRect` returns the region to nothing and a `fillRect` covers it with its
 * fill — which is exactly the HUD the case fixes and exactly what its two
 * samples are about: one inside the panel, one where the layer was left clear
 * for the scene to show through. Anything the reconstruction cannot answer is
 * refused rather than guessed, so a build drawing its HUD some other way fails
 * the check loudly instead of quietly reading transparent.
 */
function layerPixel(
  ops: readonly RecordedOp[],
  at: { x: number; y: number },
): [number, number, number, number] {
  let color: [number, number, number, number] = [0, 0, 0, 0];
  for (const op of ops) {
    if (op.op !== "fillRect" && op.op !== "clearRect") {
      if (op.op === "fill" || op.op === "drawImage" || op.op === "stroke") {
        throw new Error(
          `the screen layer drew ${op.op}, which this reading cannot compose`,
        );
      }
      continue;
    }
    const [x, y, width, height] = op.args as [number, number, number, number];
    const [a, b, c, d, e, f] = op.transform as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    if (b !== 0 || c !== 0) {
      throw new Error("the screen layer drew under a rotated transform");
    }
    const left = a * x + e;
    const top = d * y + f;
    if (
      at.x < left ||
      at.x >= left + a * width ||
      at.y < top ||
      at.y >= top + d * height
    ) {
      continue;
    }
    color = op.op === "clearRect" ? [0, 0, 0, 0] : rgba(String(op.fill));
  }
  return color;
}

/**
 * What the stage canvas holds at one device pixel *outside* the letterboxed
 * picture, from the clear the frame issued.
 *
 * The page reads the stage back by drawing it into a 2D canvas; under jsdom the
 * renderer draws through a stubbed GL context that rasterizes nothing, so the
 * only stage pixels still honestly readable are the bars, which no draw call
 * ever touches and which carry exactly the colour the frame's whole-canvas clear
 * wrote. That is the one sample the page takes, and the claim it is making — the
 * bars carry `background` — is the claim this answers. A point inside the
 * picture is refused rather than answered with the clear, because inside the
 * viewport the scene is drawn over it.
 */
function barPixel(
  gl: GlStub,
  viewport: Viewport,
  at: { x: number; y: number },
): [number, number, number, number] {
  const insideX =
    at.x >= viewport.offsetX &&
    at.x < viewport.offsetX + viewport.width * viewport.scale;
  const insideY =
    at.y >= viewport.offsetY &&
    at.y < viewport.offsetY + viewport.height * viewport.scale;
  if (insideX && insideY) {
    throw new Error(
      "the stage's picture is drawn by the GPU; only a letterbox sample is readable here",
    );
  }
  const cleared = gl.lastCall("clearColor")?.args as number[] | undefined;
  if (cleared === undefined) throw new Error("no frame has cleared the stage");
  const [r = 0, g = 0, b = 0, alpha = 0] = cleared;
  return [
    Math.round(r * 255),
    Math.round(g * 255),
    Math.round(b * 255),
    Math.round(alpha * 255),
  ];
}

/** What the environment stands in for, installed around every check below. */
let contexts: InstalledContexts;
let codecs: InstalledCodecs;

beforeEach(() => {
  // Installed on the prototype rather than on the canvases the harness makes,
  // because the recorder creates a capture canvas of its own from the document.
  contexts = installCanvasContexts();
  codecs = installCodecs();
});

afterEach(() => {
  codecs.uninstall();
  contexts.uninstall();
});

async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const cssWidth = options.cssWidth ?? FIELD_WIDTH;
  const cssHeight = options.cssHeight ?? FIELD_HEIGHT;
  const dpr = options.dpr ?? 1;
  const width = Math.round(cssWidth * dpr);
  const height = Math.round(cssHeight * dpr);

  const stage = pageCanvas(width, height);

  const screen = pageCanvas(width, height);
  const ctx = screen.getContext("2d")!;
  const calls: DrawCall[] = [];
  const recorded = recorder(ctx, calls);
  // The page writes `screen.getContext = () => recorded`. `getContext` is an
  // overload set on `HTMLCanvasElement`, and a one-signature function is not
  // assignable to it under this repository's `lib.dom`, so the assignment is
  // cast rather than reshaped: what runs is the page's own line.
  screen.getContext = (() =>
    recorded) as unknown as HTMLCanvasElement["getContext"];

  const events = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => cssWidth,
    cssHeight: () => cssHeight,
    dpr: () => dpr,
    events: () => events,
  };

  const engine = createEngine<State, Debug>({
    canvas: stage,
    screen,
    width: FIELD_WIDTH,
    height: FIELD_HEIGHT,
    game,
    background: BACKGROUND,
    clock: options.clock ?? new ConstantClock(1000 / 60),
    surface,
  });

  const assetFailures: string[] = [];
  engine.events.on("asset:failed", ({ path, reason }) => {
    assetFailures.push(`${path}: ${reason}`);
  });

  await engine.initialize();

  const dispatch = (type: "keydown" | "keyup", code: string): void => {
    events.dispatchEvent(new KeyEvent(type, code));
  };

  // The two readings the page takes from pixels, taken from what the harness's
  // stand-ins recorded instead: the layer's operations, and the stage's GL.
  const layer = contexts.context2dFor(screen) as Context2dStub;
  const gl = contexts.glFor(stage) as GlStub;

  return {
    engine,
    stage,
    ctx,
    calls,
    assetFailures,
    setBallPosition: (x, z) =>
      engine.apply((s) => engine.debug.setBallPosition(s, x, z)),
    setBallVelocity: (vx, vz) =>
      engine.apply((s) => engine.debug.setBallVelocity(s, vx, vz)),
    setPaddle: (z) => engine.apply((s) => engine.debug.setPaddle(s, z)),
    snapshot: () => engine.debug.snapshot(engine.state),
    hold: (code) => dispatch("keydown", code),
    release: (code) => dispatch("keyup", code),
    tap: (code) => {
      dispatch("keydown", code);
      dispatch("keyup", code);
    },
    device: (x, y) => toDevice(engine.viewport(), x, y),
    pixel: (x, y) => layerPixel(layer.ops, toDevice(engine.viewport(), x, y)),
    stagePixel: (x, y) =>
      barPixel(gl, engine.viewport(), toDevice(engine.viewport(), x, y)),
    project: (point) => engine.view().project(point),
    dispose: () => engine.destroy(),
  };
}

/* -------------------------------------------------------------------------- */
/* validation/simulation.test.ts                                              */
/* -------------------------------------------------------------------------- */

describe("stepping the simulation", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness({ clock: new ConstantClock(1000 / 60) });
  });

  afterEach(() => {
    harness.dispose();
  });

  it("carries the ball at 4 units per second", async () => {
    const { engine } = harness;
    harness.setBallPosition(0, 0);
    harness.setBallVelocity(4, 0);

    await engine.advance(30);

    const { ball } = harness.snapshot();
    expect(engine.frame().count).toBe(30);
    expect(engine.frame().timeMs).toBeCloseTo(500, 6);
    expect(ball.x).toBeCloseTo(2, 3);
    expect(ball.z).toBeCloseTo(0, 6);
  });

  it("reflects the ball off the far side wall", async () => {
    const { engine } = harness;
    harness.setBallPosition(0, 0);
    harness.setBallVelocity(0, 4);

    await engine.advance(120);

    const { ball } = harness.snapshot();
    expect(ball.vz).toBe(-4);
    expect(ball.z).toBeLessThanOrEqual(COURT_DEPTH / 2 - BALL_RADIUS);
    expect(harness.assetFailures).toEqual([]);
  });

  it("reads the state the advance left rather than the one the pose built", async () => {
    // The page's own note under the two checks above: a snapshot taken after an
    // advance is the state that frame left. Posed and unadvanced, it is the pose.
    const { engine } = harness;
    harness.setBallPosition(0, 0);
    harness.setBallVelocity(4, 0);

    expect(harness.snapshot().ball).toEqual({ x: 0, z: 0, vx: 4, vz: 0 });
    expect(engine.frame().count).toBe(0);

    await engine.advance(1);

    expect(harness.snapshot().ball.x).toBeCloseTo(4 / 60, 12);
  });
});

/* -------------------------------------------------------------------------- */
/* validation/audio.test.ts                                                   */
/* -------------------------------------------------------------------------- */

describe("asserting a cue played", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness({ clock: new ConstantClock(1000 / 60) });
  });

  afterEach(() => {
    harness.dispose();
  });

  it("plays the bounce cue at the ball when it meets a wall", async () => {
    const { engine } = harness;
    const bounces: { t: number; gain: number; at: Vec3 | null }[] = [];
    const off = engine.events.on("cue:played", ({ cue, t, gain, at }) => {
      if (cue === "bounce") bounces.push({ t, gain, at });
    });

    harness.setBallPosition(0, 0);
    harness.setBallVelocity(0, 4);
    await engine.advance(120);
    off();

    expect(bounces).toHaveLength(1);
    const bounce = bounces[0]!;
    expect(Math.abs(bounce.t - 1150)).toBeLessThanOrEqual(1000 / 60);
    expect(bounce.gain).toBeGreaterThan(0);

    const at = bounce.at;
    expect(at).not.toBeNull();
    const wall = COURT_DEPTH / 2 - BALL_RADIUS;
    expect(Math.abs((at as Vec3).z - wall)).toBeLessThanOrEqual(4 / 60);
    expect((at as Vec3).x).toBeCloseTo(0, 6);
  });

  it("stops announcing the cue once the handler is removed", async () => {
    // `engine.events.on` returns the remover, which is what lets the check above
    // bound what it collected to the scenario it posed rather than to the run.
    const { engine } = harness;
    const cues: string[] = [];
    const off = engine.events.on("cue:played", ({ cue }) => cues.push(cue));
    off();

    harness.setBallPosition(0, 4);
    harness.setBallVelocity(0, 4);
    await engine.advance(60);

    expect(harness.snapshot().ball.vz).toBe(-4);
    expect(cues).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* validation/diagnostics.test.ts                                             */
/* -------------------------------------------------------------------------- */

describe("asserting the diagnostics a build registered", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness({ clock: new ConstantClock(1000 / 60) });
  });

  afterEach(() => {
    harness.dispose();
  });

  it("registers the diagnostics the case names", () => {
    const { engine } = harness;
    harness.setBallPosition(3, -2);
    harness.setPaddle(1);

    expect(engine.diagnostics()).toEqual([
      { name: "ball", value: "3.0, -2.0" },
      { name: "paddle", value: 1 },
    ]);
  });

  it("reads the sources at any point in a scenario, with the overlay hidden", async () => {
    // The page's claim under the check above: reading evaluates the sources and
    // changes nothing else, so the readings follow the state through a run and
    // the overlay never appears on the screen layer.
    const { engine, calls } = harness;
    harness.setBallPosition(0, 0);
    harness.setBallVelocity(4, 0);

    calls.length = 0;
    await engine.advance(30);

    expect(engine.diagnostics()).toEqual([
      { name: "ball", value: "2.0, 0.0" },
      { name: "paddle", value: 0 },
    ]);
    expect(engine.diagnostics()).toEqual(engine.diagnostics());
    // Thirty frames of the game's one readout and nothing else: the overlay
    // stays hidden however often the sources are read.
    expect(callsTo(calls, "fillText")).toEqual(
      Array.from({ length: 30 }, () => ["score 0", 16, 32]),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* validation/scene.test.ts                                                   */
/* -------------------------------------------------------------------------- */

describe("asserting on the scene", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(() => {
    harness.dispose();
  });

  type StandardMesh = THREE.Mesh<
    THREE.BufferGeometry,
    THREE.MeshStandardMaterial
  >;

  function mesh(harness: Harness, name: string): StandardMesh {
    const object = harness.engine.scene.getObjectByName(name);
    expect(object).toBeInstanceOf(THREE.Mesh);
    return object as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshStandardMaterial
    >;
  }

  it("places the ball and the paddle where the state says", async () => {
    const { engine } = harness;
    harness.setBallPosition(3, -2);
    harness.setBallVelocity(0, 0);
    harness.setPaddle(1);

    await engine.advance(1);

    const ball = mesh(harness, "ball").getWorldPosition(new THREE.Vector3());
    expect(ball.x).toBeCloseTo(3, 6);
    expect(ball.y).toBeCloseTo(BALL_RADIUS, 6);
    expect(ball.z).toBeCloseTo(-2, 6);

    const paddle = mesh(harness, "paddle").getWorldPosition(
      new THREE.Vector3(),
    );
    expect(paddle.x).toBeCloseTo(PADDLE_X, 6);
    expect(paddle.z).toBeCloseTo(1, 6);
  });

  it("colors the ball and the paddle as the case fixes", async () => {
    await harness.engine.advance(1);

    expect(`#${mesh(harness, "ball").material.color.getHexString()}`).toBe(
      BALL_COLOR,
    );
    expect(`#${mesh(harness, "paddle").material.color.getHexString()}`).toBe(
      PADDLE_COLOR,
    );
    expect(
      mesh(harness, "ball").geometry.getAttribute("position").count,
    ).toBeGreaterThan(0);
  });

  it("looks at the origin from where the case fixes", async () => {
    await harness.engine.advance(1);

    const camera = harness.engine.view().camera();
    expect(camera.projection).toBe("perspective");
    expect(camera.position.x).toBeCloseTo(0, 6);
    expect(camera.position.y).toBeCloseTo(14, 6);
    expect(camera.position.z).toBeCloseTo(10, 6);
  });

  it("leaves the scene alone until a frame renders it", () => {
    // The page's note: the pose alone changes nothing in the scene, which is
    // why every check above reads it after an advance.
    harness.setBallPosition(3, -2);

    const ball = mesh(harness, "ball").getWorldPosition(new THREE.Vector3());
    expect(ball.x).toBeCloseTo(0, 6);
    expect(ball.z).toBeCloseTo(0, 6);
  });
});

/* -------------------------------------------------------------------------- */
/* validation/projection.test.ts                                              */
/* -------------------------------------------------------------------------- */

describe("asserting where something appears", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(() => {
    harness.dispose();
  });

  it("projects the origin to the centre of the stage", async () => {
    await harness.engine.advance(1);

    const origin = harness.project({ x: 0, y: 0, z: 0 });
    expect(origin.visible).toBe(true);
    expect(origin.x).toBeCloseTo(FIELD_WIDTH / 2, 3);
    expect(origin.y).toBeCloseTo(FIELD_HEIGHT / 2, 3);
    expect(origin.depth).toBeGreaterThan(-1);
    expect(origin.depth).toBeLessThan(1);
  });

  it("draws a ball on the right of the court on the right of the stage", async () => {
    const { engine } = harness;
    harness.setBallPosition(3, 0);
    harness.setBallVelocity(0, 0);
    await engine.advance(1);

    const ball = harness.project({ x: 3, y: BALL_RADIUS, z: 0 });
    expect(ball.visible).toBe(true);
    expect(ball.x).toBeGreaterThan(FIELD_WIDTH / 2);

    const behind = harness.project({ x: 0, y: 0, z: 40 });
    expect(behind.visible).toBe(false);
  });

  it("answers from the camera defaults before the first render", () => {
    // The page's closing note: the view answers from the camera the most recent
    // render posed, and before any render from the defaults — which stand at
    // `(0, 0, 10)` looking down `-z`, not at the pose the case fixes.
    const camera = harness.engine.view().camera();
    expect(camera.position).toEqual({ x: 0, y: 0, z: 10 });
    expect(harness.project({ x: 0, y: 0, z: 0 }).visible).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* validation/hud.test.ts                                                     */
/* -------------------------------------------------------------------------- */

describe("asserting what was drawn on the screen layer", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness({ cssWidth: 800, cssHeight: 360, dpr: 2 });
  });

  afterEach(() => {
    harness.dispose();
  });

  it("fills the score panel and leaves the rest of the layer clear", async () => {
    const { engine } = harness;
    harness.setBallVelocity(0, 0);

    await engine.advance(1);

    expect(harness.device(0, 0)).toEqual({ x: 160, y: 0 });
    expect(harness.pixel(12, 12)).toEqual([28, 32, 51, 255]);
    expect(harness.pixel(124, 44)).toEqual([28, 32, 51, 255]);
    expect(harness.pixel(320, 180)).toEqual([0, 0, 0, 0]);
    expect(harness.stagePixel(-40, 180)).toEqual([16, 16, 24, 255]);
  });

  it("draws the panel as one rect and the score as one text", async () => {
    const { engine, calls } = harness;
    harness.setBallVelocity(0, 0);

    calls.length = 0;
    await engine.advance(1);

    expect(callsTo(calls, "fillRect")).toContainEqual([8, 8, 120, 40]);

    const texts = callsTo(calls, "fillText");
    expect(texts).toHaveLength(1);
    expect(texts[0]).toEqual(["score 0", 16, 32]);

    const colors = setsOf(calls, "fillStyle").filter(
      (color) => color === PANEL_COLOR || color === TEXT_COLOR,
    );
    expect(colors).toEqual([PANEL_COLOR, TEXT_COLOR]);
  });

  it("clears the layer at the top of every frame and re-applies the fit", async () => {
    // The two claims the page's prose makes about the stream the game did not
    // write: the engine's own clear of the layer, and the transform the fit puts
    // on it — 640x360 scaled by 2 and centred in a 1600x720 backing store.
    const { engine, calls } = harness;

    calls.length = 0;
    await engine.advance(1);

    expect(callsTo(calls, "clearRect")).toContainEqual([0, 0, 1600, 720]);
    // Identity to clear the whole backing store, the fit for the game's own
    // drawing, and identity again for the overlay's device-space pass.
    expect(callsTo(calls, "setTransform")).toEqual([
      [1, 0, 0, 1, 0, 0],
      [2, 0, 0, 2, 160, 0],
      [1, 0, 0, 1, 0, 0],
    ]);
    expect(engine.viewport()).toEqual({
      width: 640,
      height: 360,
      scale: 2,
      offsetX: 160,
      offsetY: 0,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* validation/input.test.ts                                                   */
/* -------------------------------------------------------------------------- */

describe("asserting an action drives the game", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness({ clock: new ConstantClock(1000 / 60) });
  });

  afterEach(() => {
    harness.dispose();
  });

  it("moves the paddle toward the far wall while the up action is held", async () => {
    const { engine } = harness;
    harness.setPaddle(0);

    harness.hold("KeyW");
    await engine.advance(30);
    expect(engine.state.paddle.z).toBeCloseTo(-3, 3);

    harness.release("KeyW");
    await engine.advance(30);
    expect(engine.state.paddle.z).toBeCloseTo(-3, 3);
  });

  it("clamps the paddle at the far wall", async () => {
    const { engine } = harness;
    harness.setPaddle(0);

    harness.hold("ArrowUp");
    await engine.advance(120);

    expect(engine.state.paddle.z).toBeCloseTo(
      -(COURT_DEPTH / 2 - PADDLE_LENGTH / 2),
      6,
    );
  });

  it("drives the same action from either of the case's two keys", async () => {
    // Both bindings are the same action, so the check that holds `KeyW` and the
    // one that holds `ArrowUp` are checking one requirement through two keys.
    const { engine } = harness;
    harness.setPaddle(0);

    harness.hold("KeyS");
    await engine.advance(30);
    expect(engine.state.paddle.z).toBeCloseTo(3, 3);

    harness.release("KeyS");
    harness.hold("ArrowDown");
    await engine.advance(1);
    harness.release("ArrowDown");
    expect(engine.state.paddle.z).toBeGreaterThan(3);
  });

  it("moves the paddle nowhere on a tapped key", async () => {
    // The page's closing note about `harness.tap`: it presses and releases
    // between frames, so the key is already up when the frame reads it. What a
    // tap arms is the action's edge, which is what an edge-triggered check uses
    // — a held magnitude, which is what this build steers on, reads zero.
    const { engine } = harness;
    harness.setPaddle(0);

    harness.tap("KeyW");
    await engine.advance(1);

    expect(engine.state.paddle.z).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* validation/replay.ts and validation/recording.test.ts                      */
/* -------------------------------------------------------------------------- */

/** What the page's browser command was handed, in the order it was handed it. */
const emitted: { output: string; video: string }[] = [];

async function emitReplay(output: string, recording: Recording): Promise<void> {
  if (recording.frames.length === 0) return;
  emitted.push({ output, video: toBase64(recording.video) });
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

describe("emitting a recording", () => {
  let harness: Harness;

  beforeEach(async () => {
    emitted.length = 0;
    harness = await createHarness({ clock: new ConstantClock(1000 / 60) });
  });

  afterEach(() => {
    harness.dispose();
  });

  it("records the frames around a wall reflection", async () => {
    const { engine } = harness;
    harness.setBallPosition(0, 3);
    harness.setBallVelocity(0, 4);
    await engine.advance(12);

    engine.startRecording();
    await engine.advance(24);
    const recording = await engine.stopRecording();
    await emitReplay("bounce", recording);

    expect(recording.width).toBe(FIELD_WIDTH);
    expect(recording.height).toBe(FIELD_HEIGHT);
    expect(recording.frames).toHaveLength(24);
    expect(recording.frames[0]!.count).toBe(13);
    expect(recording.frames[23]!.timeMs).toBeCloseTo(600, 6);
    expect(recording.ended).toBe(false);
    expect(recording.video.length).toBeGreaterThan(0);
    expect(harness.snapshot().ball.vz).toBe(-4);
  });

  it("emits the video's own bytes under the name the check chose", async () => {
    const { engine } = harness;
    harness.setBallVelocity(0, 4);

    engine.startRecording();
    await engine.advance(4);
    const recording = await engine.stopRecording();
    await emitReplay("bounce", recording);

    expect(emitted).toHaveLength(1);
    const sent = emitted[0]!;
    expect(sent.output).toBe("bounce");
    expect(Uint8Array.from(atob(sent.video), (c) => c.charCodeAt(0))).toEqual(
      recording.video,
    );
  });

  it("emits nothing for a recording that captured no frames", async () => {
    const { engine } = harness;

    engine.startRecording();
    const recording = await engine.stopRecording();
    await emitReplay("bounce", recording);

    expect(recording.frames).toEqual([]);
    expect(emitted).toEqual([]);
  });

  it("refuses an unbalanced stop rather than discarding the frames", async () => {
    // The page's closing instruction — call `stopRecording` on every path that
    // armed the recorder, because the engine refuses an unbalanced call.
    const { engine } = harness;
    expect(engine.recording()).toBe(false);
    expect(() => engine.stopRecording()).toThrow();

    engine.startRecording();
    await engine.advance(2);
    expect(engine.recording()).toBe(true);
    await engine.stopRecording();
    expect(engine.recording()).toBe(false);
  });
});
