import { createCanvas } from "@test-cabinet/headless-webgl2";
import { afterEach, describe, expect, it } from "vitest";
import {
  ConstantClock,
  JitterClock,
  SequenceClock,
  createEngine,
  projectPoint,
  quatFromAxisAngle,
} from "./index";
import type {
  CameraState,
  Clock,
  DrawValue,
  Engine,
  Game,
  LightState,
  Quat,
  Recording,
  RenderApi,
  SurfaceMetrics,
  Transform,
  UpdateApi,
  Vec3,
} from "./index";
import type { DeepReadonly } from "ts-essentials";

/**
 * The documentation's worked example "A Minimal Game", transcribed and run.
 *
 * The page promises its code works against the engine verbatim, so `src/game.ts`
 * below — the constants, the camera, the lights, and the `glider` definition —
 * is copied from the page unchanged, and the boot module is followed line for
 * line. Only what a test environment forces is adapted:
 *
 * - The page's `index.html` supplies a canvas out of a document; here the canvas
 *   is `@test-cabinet/headless-webgl2`'s, which serves the WebGL2 context the
 *   engine renders through in Node, and the element size the page leaves to CSS
 *   arrives through an injected `SurfaceMetrics`.
 * - The page's `engine.run()` drives frames off the host's frame callback on a
 *   `WallClock`; a suite steps synchronously instead, with `engine.advance` over
 *   a clock that supplies its own deltas, exactly as the validator docs
 *   prescribe.
 * - The page's canvas fills the window, and the element size a suite reports is
 *   its own choice. The rasterizer's cost is per device pixel, so the checks
 *   that step hundreds of frames report a small element of the design aspect —
 *   which changes only the scale of the fit, never a figure any of them assert —
 *   while the two checks that are about the fit itself state their own size.
 *
 * The assertions are the outcomes the page narrates: that construction runs no
 * game code and `initialize` builds the state whole, that the build registers no
 * action and loads no asset, that the overshoot arithmetic makes the outcome the
 * same whatever step size the clock delivers, that `render` draws the complete
 * picture every frame against a cleared scene, that per-frame `create*` calls
 * share one resource entry, and that the design-aspect frustum puts the box in
 * the same place in the letterboxed picture on every display.
 */

/* -------------------------------------------------------------------------- */
/* src/game.ts — transcribed verbatim                                         */
/* -------------------------------------------------------------------------- */

const LIMIT = 6;
const SPEED = 4;

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const ONE: Vec3 = { x: 1, y: 1, z: 1 };

const CAMERA: CameraState = {
  position: { x: 0, y: 5, z: 14 },
  rotation: quatFromAxisAngle({ x: 1, y: 0, z: 0 }, -0.3),
  fovY: Math.PI / 3,
  near: 0.1,
  far: 100,
};

const LIGHTS: readonly LightState[] = [
  { type: "ambient", color: "#ffffff", intensity: 0.35 },
  {
    type: "directional",
    color: "#ffffff",
    intensity: 0.9,
    direction: { x: -0.5, y: -1, z: -0.5 },
  },
];

interface State {
  readonly x: number;
  readonly vx: number;
}

function at(x: number, y: number, z: number): Transform {
  return { position: { x, y, z }, rotation: IDENTITY, scale: ONE };
}

export const glider: Game<State, null> = {
  initialize(): [State, null] {
    return [{ x: -LIMIT, vx: SPEED }, null];
  },

  update(state: DeepReadonly<State>, _api: UpdateApi, dt: number): State {
    const x = state.x + state.vx * dt;

    if (x < -LIMIT) return { x: -2 * LIMIT - x, vx: SPEED };
    if (x > LIMIT) return { x: 2 * LIMIT - x, vx: -SPEED };
    return { ...state, x };
  },

  render(state: DeepReadonly<State>, api: RenderApi): void {
    const { scene } = api;
    scene.setCamera(CAMERA);
    scene.setLights(LIGHTS);

    scene.drawGeometry(scene.createPlane(16, 8), "#182231", at(0, 0, 0));
    scene.drawGeometry(
      scene.createBox({ x: 1, y: 1, z: 1 }),
      "#7fd1ff",
      at(state.x, 0.5, 0),
    );
  },
};

/* -------------------------------------------------------------------------- */
/* index.html + src/main.ts — transcribed, with the forced adaptations        */
/* -------------------------------------------------------------------------- */

/** The element size the stepping checks report: the design aspect, scaled down. */
const CSS_WIDTH = 160;
const CSS_HEIGHT = 90;

/**
 * The element measurements the page's inline CSS would have produced, handed to
 * the engine directly. The engine takes every measurement through this seam, so
 * a suite supplies the figures a browser's layout would have reported and the
 * engine never asks a document for anything.
 */
function pageSurface(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): SurfaceMetrics {
  const target = new EventTarget();
  return {
    cssWidth: (): number => cssWidth,
    cssHeight: (): number => cssHeight,
    dpr: (): number => dpr,
    events: (): EventTarget => target,
  };
}

/** Every engine a test built, destroyed after it whatever the test did. */
const built: Engine<State, null>[] = [];

afterEach(() => {
  for (const engine of built.splice(0)) engine.destroy();
});

/** The page's boot module, adapted only as the header describes. */
function boot({
  clock = new ConstantClock(1000 / 60),
  cssWidth = CSS_WIDTH,
  cssHeight = CSS_HEIGHT,
  dpr = 1,
}: {
  clock?: Clock;
  cssWidth?: number;
  cssHeight?: number;
  dpr?: number;
} = {}): Engine<State, null> {
  const canvas = createCanvas(
    Math.round(cssWidth * dpr),
    Math.round(cssHeight * dpr),
  );

  const engine = createEngine({
    canvas: canvas as unknown as HTMLCanvasElement,
    width: 640,
    height: 360,
    background: "#05060a",
    game: glider,
    clock,
    surface: pageSurface(cssWidth, cssHeight, dpr),
  });
  built.push(engine);
  return engine;
}

/* -------------------------------------------------------------------------- */
/* The narrated outcomes                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Where the glider is after `t` seconds, from the page's own arithmetic:
 * uniform motion at `SPEED` from `x = -LIMIT`, folded back into `[-LIMIT,
 * LIMIT]` at each end. Reflecting the overshoot makes the per-frame stepping
 * agree with this continuous fold whatever the step size, which is the property
 * the page claims for it.
 */
function expectedX(t: number): number {
  const span = 2 * LIMIT;
  const raw = (SPEED * t) % (2 * span);
  return -LIMIT + (raw < span ? raw : 2 * span - raw);
}

/** Steps in whole frames until at least `ms` of simulated time has passed. */
async function advanceMs(
  engine: Engine<State, null>,
  ms: number,
): Promise<void> {
  const until = engine.frame().timeMs + ms;
  while (engine.frame().timeMs < until) await engine.advance(1);
}

/** The `call` operations of one method across a recording, in issue order. */
function callsTo(
  recording: Recording,
  method: string,
): readonly (readonly DrawValue[])[] {
  return recording.frames.flatMap((frame) =>
    frame.ops.flatMap((index) => {
      const op = recording.ops[index];
      return op !== undefined && op.op === "call" && op.method === method
        ? [op.args]
        : [];
    }),
  );
}

/** Arms the recorder, runs exactly `frames` frames, and hands back the document. */
async function record(
  engine: Engine<State, null>,
  frames: number,
): Promise<Recording> {
  engine.startRecording();
  await engine.advance(frames);
  return engine.stopRecording();
}

describe("examples/a-minimal-game", () => {
  it("runs no game code at construction and builds the whole state in initialize", async () => {
    const engine = boot();

    // "`createEngine` runs no game code" — no frame has run, so the counter is
    // still at nothing and reading the state before `initialize` is refused.
    expect(engine.frame()).toEqual({ count: 0, timeMs: 0, lastDeltaMs: 0 });
    expect(() => engine.state).toThrow(/initialize/);

    // "`initialize` runs the game's `initialize` and builds the state." The
    // state is complete: `State` is the whole of what the three functions share.
    const opening = await engine.initialize();
    expect(opening).toEqual({ x: -LIMIT, vx: SPEED });
    expect(engine.state).toEqual({ x: -LIMIT, vx: SPEED });
    expect(engine.frame().count).toBe(0);

    // The game returns `null` beside its state, which the engine hands back
    // unchanged as the debug surface.
    expect(engine.debug).toBeNull();
  });

  it("registers no action, loads no asset, and defines no cue", async () => {
    const engine = boot();
    const events: string[] = [];
    for (const name of [
      "asset:loaded",
      "asset:failed",
      "cue:played",
      "cue:looped",
    ] as const) {
      engine.events.on(name, () => events.push(name));
    }

    await engine.initialize();
    await engine.advance(30);

    // "It registers no action, loads no asset, and defines no cue, so what
    // remains is the whole of what a build must supply."
    expect(events).toEqual([]);
  });

  it("slides at SPEED and reflects the overshoot at both ends of the track", async () => {
    const engine = boot();
    await engine.initialize();

    // One second from the left end: 4 world units along, no end reached yet.
    await engine.advance(60);
    expect(engine.state.x).toBeCloseTo(-LIMIT + SPEED, 6);
    expect(engine.state.vx).toBe(SPEED);

    // The right end is met at t = 3s; by four seconds the glider has reflected
    // and is heading back, still inside the track.
    await engine.advance(180);
    expect(engine.state.vx).toBe(-SPEED);
    expect(engine.state.x).toBeCloseTo(expectedX(4), 6);

    // Every frame on the way back to the left end and out again stays between
    // the bounds the game's own constant fixes.
    for (let frame = 241; frame <= 480; frame += 1) {
      await engine.advance(1);
      expect(engine.state.x).toBeGreaterThanOrEqual(-LIMIT);
      expect(engine.state.x).toBeLessThanOrEqual(LIMIT);
    }
    expect(engine.frame().count).toBe(480);
    expect(engine.state.vx).toBe(SPEED);
    expect(engine.state.x).toBeCloseTo(expectedX(8), 6);
  });

  it("keeps the outcome the same whatever step size the clock delivers", async () => {
    // "`update` multiplies by `dt` in seconds and reflects the overshoot back
    // into the track, which keeps the outcome the same whatever step size the
    // clock delivers." An even step, a repeating uneven pattern, and a seeded
    // draw all land on the fold of the same uniform motion.
    const clocks: Clock[] = [
      new ConstantClock(1000 / 60),
      new SequenceClock([8, 33, 12, 21]),
      new JitterClock(8, 40, 7),
    ];

    for (const clock of clocks) {
      const engine = boot({ clock });
      await engine.initialize();

      // Long enough to cross both ends, whatever the cadence.
      await advanceMs(engine, 7_000);
      expect(engine.state.x).toBeCloseTo(
        expectedX(engine.frame().timeMs / 1000),
        6,
      );
    }
  });

  it("draws the complete picture every frame against a scene that arrives cleared", async () => {
    const engine = boot();
    await engine.initialize();

    const recording = await record(engine, 3);

    // "`render` draws the complete picture every frame against a scene that
    // arrives cleared": three frames, each holding the same four operations —
    // the camera, the lights, the floor, and the box.
    expect(recording.frames).toHaveLength(3);
    for (const frame of recording.frames) expect(frame.ops).toHaveLength(4);

    expect(callsTo(recording, "setCamera")).toHaveLength(3);
    expect(callsTo(recording, "setLights")).toHaveLength(3);

    // "Passing a color as the material draws a standard lit surface in that
    // base color" — the color rides in the draw as the argument the game passed.
    const draws = callsTo(recording, "drawGeometry");
    expect(draws).toHaveLength(6);
    expect(draws.filter((args) => args[1] === "#182231")).toHaveLength(3);
    expect(draws.filter((args) => args[1] === "#7fd1ff")).toHaveLength(3);

    // The floor never moves, so its three draws are one entry in the shared ops
    // table; the box moves every frame, so its three are three.
    const floorOps = new Set(
      recording.frames.flatMap((frame) =>
        frame.ops.filter((index) => {
          const op = recording.ops[index];
          return (
            op?.op === "call" &&
            op.method === "drawGeometry" &&
            op.args[1] === "#182231"
          );
        }),
      ),
    );
    expect(floorOps.size).toBe(1);
  });

  it("shares one resource entry between every frame's identical create* call", async () => {
    const engine = boot();
    await engine.initialize();

    const recording = await record(engine, 5);

    // "A produced geometry is a resource keyed on the call that made it, so
    // identical arguments share one entry in a recording and per-frame creation
    // is the idiomatic pattern." Five frames, ten `create*` calls, two entries.
    expect(recording.resources).toHaveLength(2);
    expect(
      recording.resources.map((resource) => resource.make.method).sort(),
    ).toEqual(["createBox", "createPlane"]);

    const plane = recording.resources.find(
      (r) => r.make.method === "createPlane",
    );
    expect(plane?.make.args).toEqual([16, 8]);
    expect(plane?.then).toEqual([]);

    const box = recording.resources.find((r) => r.make.method === "createBox");
    expect(box?.make.args).toEqual([{ x: 1, y: 1, z: 1 }]);
  });

  it("lands the box in the same place in the letterboxed picture on every display", async () => {
    // "With the frustum's aspect fixed to the design aspect, the box lands in
    // the same place in the letterboxed picture on every display." The three
    // rigs differ in element size and pixel ratio; the logical point does not.
    const rigs = [
      { cssWidth: 160, cssHeight: 90, dpr: 1 },
      { cssWidth: 200, cssHeight: 90, dpr: 2 },
      { cssWidth: 80, cssHeight: 100, dpr: 3 },
    ];

    const projected: (number | undefined)[] = [];
    for (const rig of rigs) {
      const engine = boot(rig);
      await engine.initialize();
      await engine.advance(45);

      const point = projectPoint(CAMERA, engine.viewport(), {
        x: engine.state.x,
        y: 0.5,
        z: 0,
      });
      projected.push(point?.x, point?.y);

      // The fit itself does differ: each rig letterboxes the same logical field
      // into its own backing store, which is what the picture is scaled by.
      const view = engine.viewport();
      expect(view.width).toBe(640);
      expect(view.height).toBe(360);
      expect(view.scale).toBeGreaterThan(0);
    }

    expect(projected.slice(2, 4)).toEqual(projected.slice(0, 2));
    expect(projected.slice(4, 6)).toEqual(projected.slice(0, 2));
  });

  it("clears each frame to the background the boot module named", async () => {
    const cssWidth = 200;
    const cssHeight = 90;
    const dpr = 2;
    const canvas = createCanvas(cssWidth * dpr, cssHeight * dpr);
    const engine = createEngine({
      canvas: canvas as unknown as HTMLCanvasElement,
      width: 640,
      height: 360,
      background: "#05060a",
      game: glider,
      clock: new ConstantClock(1000 / 60),
      surface: pageSurface(cssWidth, cssHeight, dpr),
    });
    built.push(engine);

    await engine.initialize();
    await engine.advance(1);

    const gl = canvas.getContext("webgl2") as unknown as WebGL2RenderingContext;
    const pixel = (x: number, y: number): number[] => {
      const out = new Uint8Array(4);
      gl.readPixels(
        x,
        canvas.height - 1 - y,
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        out,
      );
      return [...out];
    };

    // The fit scales the 640×360 field by 0.5 and centres it in the 400×180
    // backing store, leaving a 40 device pixel bar on each side. Above the
    // floor the frame is the background the page named, and the bars outside
    // the picture are cleared to it too.
    expect(pixel(200, 4)).toEqual([5, 6, 10, 255]);
    expect(pixel(10, 90)).toEqual([5, 6, 10, 255]);
    expect(pixel(395, 90)).toEqual([5, 6, 10, 255]);
  });
});
