import { createCanvas } from "@test-cabinet/headless-webgl2";
import { describe, expect, it } from "vitest";
import { Actor } from "./actors";
import type { SurfaceMetrics } from "./camera";
import {
  ConstantClock,
  JitterClock,
  SequenceClock,
  type Clock,
} from "./clocks";
import { ShapeComponent } from "./components";
import type { DrawOp, Recording } from "./contract";
import { createEngine, type Engine } from "./engine";
import { GameInstance, type GameDefinition } from "./game-instance";
import { GameMode } from "./game-mode";
import { quatFromAxisAngle, quatMultiply } from "./math";

/**
 * The documentation's worked example "A Minimal Game", transcribed and run.
 *
 * The docs promise the example's code works against the engine verbatim, so
 * the game-side modules below — `Drifter`, `DriftMode`, and the `drifter`
 * definition — are copied from the page unchanged, and the boot module is
 * followed line for line. Only what a test environment forces is adapted:
 *
 * - The page's `index.html` becomes a canvas `@test-cabinet/headless-webgl2`
 *   makes in process, since a document is what a suite has no business
 *   needing, and the engine is handed a `SurfaceMetrics` reporting a size the
 *   element would have been laid out to. That element is smaller than the
 *   design field: the WebGL2 implementation rasterizes in software, this suite
 *   steps hundreds of frames to cross both bounds, and the fit is a scale the
 *   picture rides on rather than anything the page's arithmetic names.
 * - The page's `engine.run()` drives frames off the host's callback on a
 *   `WallClock`; a suite steps synchronously instead, with `engine.advance`
 *   over a clock that supplies its own deltas, exactly as the validator docs
 *   prescribe.
 * - The page narrates the picture, and the suite reads it off the engine's own
 *   recorder rather than off pixels, which is the surface the validator docs
 *   put a check on.
 *
 * The assertions are the outcomes the page narrates: what `initialize`
 * resolves having done, the plain `GameInstance` an instance-less definition
 * gets, the identity the spec-less actor begins at, the reflection off both
 * bounds, the spin as a function of accumulated time, the step-size
 * independence both buy, and the pipeline drawing the shape each frame under
 * the default camera and the default light rig.
 */

/* -------------------------------------------------------------------------- */
/* src/actors/drifter.ts — transcribed verbatim                               */
/* -------------------------------------------------------------------------- */

const SIZE = 1.5;
const SPEED = 4;
const LIMIT = 8;
const TURN = Math.PI / 2;
const UP = { x: 0, y: 1, z: 0 };

class Drifter extends Actor {
  private vx = SPEED;

  constructor() {
    super();
    this.attach(
      new ShapeComponent({
        shape: { kind: "box", size: { x: SIZE, y: SIZE, z: SIZE } },
        color: "#7fd1ff",
      }),
    );
  }

  override tick(dt: number): void {
    const p = this.transform.position;
    p.x += this.vx * dt;

    if (p.x < -LIMIT) {
      p.x = -2 * LIMIT - p.x;
      this.vx = SPEED;
    } else if (p.x > LIMIT) {
      p.x = 2 * LIMIT - p.x;
      this.vx = -SPEED;
    }

    this.transform.rotation = quatMultiply(
      quatFromAxisAngle(UP, TURN * dt),
      this.transform.rotation,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* src/levels/drift-mode.ts — transcribed verbatim                            */
/* -------------------------------------------------------------------------- */

class DriftMode extends GameMode {}

/* -------------------------------------------------------------------------- */
/* src/game.ts — transcribed verbatim                                         */
/* -------------------------------------------------------------------------- */

const drifter: GameDefinition = {
  levels: {
    drift: {
      mode: DriftMode,
      actors: [{ type: Drifter }],
    },
  },
  startLevel: "drift",
};

/* -------------------------------------------------------------------------- */
/* index.html + src/main.ts — transcribed, with the forced adaptations        */
/* -------------------------------------------------------------------------- */

/** The size the page's `100vw × 100vh` canvas is reported at. */
const CSS_WIDTH = 160;
const CSS_HEIGHT = 90;

/** Nothing lays the element out here, so the surface answers a fixed size. */
function pageSurface(): SurfaceMetrics {
  const target = new EventTarget();
  return {
    cssWidth: (): number => CSS_WIDTH,
    cssHeight: (): number => CSS_HEIGHT,
    dpr: (): number => 1,
    events: (): EventTarget => target,
  };
}

/** The page's markup and boot module, adapted only as the header describes. */
function boot(clock: Clock = new ConstantClock(1000 / 60)): Engine {
  const canvas = createCanvas(
    CSS_WIDTH,
    CSS_HEIGHT,
  ) as unknown as HTMLCanvasElement;

  return createEngine({
    canvas,
    width: 640,
    height: 360,
    background: "#05060a",
    game: drifter,
    clock,
    surface: pageSurface(),
  });
}

/* -------------------------------------------------------------------------- */
/* The narrated outcomes                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Where the drifter is after `t` seconds, from the page's own rule: uniform
 * motion at `SPEED` from the origin, folded back inside `±LIMIT` at each
 * bound. Reflecting the overshoot makes the per-frame stepping agree with this
 * continuous fold whatever the step size, which is the property the page
 * claims for it.
 */
function expectedX(t: number): number {
  const span = 2 * LIMIT;
  const raw = (LIMIT + SPEED * t) % (2 * span);
  return -LIMIT + (raw <= span ? raw : 2 * span - raw);
}

/** Steps in whole frames until at least `ms` of simulated time has passed. */
async function advanceMs(engine: Engine, ms: number): Promise<void> {
  const until = engine.frame().timeMs + ms;
  while (engine.frame().timeMs < until) await engine.advance(1);
}

/** The calls one recorded frame issued, resolved out of the shared table. */
function frameCalls(
  recording: Recording,
  index: number,
): Extract<DrawOp, { op: "call" }>[] {
  const frame = recording.frames[index];
  if (frame === undefined) throw new Error(`no frame ${index}`);
  return frame.ops
    .map((op) => recording.ops[op])
    .filter((op): op is Extract<DrawOp, { op: "call" }> => op?.op === "call");
}

describe("examples/a-minimal-game", () => {
  it("initialize opens the start level with its actor and mode begun", async () => {
    const engine = boot();
    const opened: string[] = [];
    engine.events.on("world:opened", ({ level }) => opened.push(level));

    await engine.initialize();

    // "`initialize` builds the game instance, opens the start level, and
    // resolves once its actors and its mode have begun play."
    expect(opened).toEqual(["drift"]);
    expect(engine.world.level).toBe("drift");
    expect(engine.world.actors()).toHaveLength(1);
    expect(engine.world.actors()[0]).toBeInstanceOf(Drifter);
    expect(engine.world.mode).toBeInstanceOf(DriftMode);
    engine.destroy();
  });

  it("begins the spec-less actor at the identity, at the world origin", async () => {
    const engine = boot();
    await engine.initialize();

    // "The actor's spec names no transform, so it begins at the identity, at
    // the world origin."
    const [actor] = engine.world.actors();
    expect(actor?.transform.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(actor?.transform.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(actor?.transform.scale).toEqual({ x: 1, y: 1, z: 1 });
    engine.destroy();
  });

  it("builds a plain GameInstance for a definition naming no instance class", async () => {
    const engine = boot();
    await engine.initialize();

    // "The definition names no instance class, so the engine builds a plain
    // `GameInstance`" — the base class itself, whose `initialize` returns
    // `null`, which the engine hands back as the debug surface.
    expect(Object.getPrototypeOf(engine.instance)).toBe(GameInstance.prototype);
    expect(engine.debug).toBeNull();
    engine.destroy();
  });

  it("registers no action and loads no asset", async () => {
    const engine = boot();
    const assets: string[] = [];
    engine.events.on("asset:loaded", ({ path }) => assets.push(path));
    engine.events.on("asset:failed", ({ path }) => assets.push(path));

    await engine.initialize();
    await engine.advance(10);

    expect(assets).toEqual([]);
    engine.destroy();
  });

  it("starts the world's camera at its defaults, looking down −Z", async () => {
    const engine = boot();
    await engine.initialize();

    // "The world's camera starts at its defaults, at `(0, 0, 10)` looking
    // down −Z, so the origin the actor drifts through is the center of the
    // picture."
    const { camera } = engine.world;
    expect(camera.position).toEqual({ x: 0, y: 0, z: 10 });
    expect(camera.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(camera.fovY).toBeCloseTo(Math.PI / 3, 12);
    expect(camera.project({ x: 0, y: 0, z: 0 })).toEqual({ x: 320, y: 180 });
    engine.destroy();
  });

  it("drifts at SPEED and reflects the overshoot off both bounds", async () => {
    const engine = boot();
    await engine.initialize();
    const [actor] = engine.world.actors();
    if (actor === undefined) throw new Error("missing drifter");

    // One second from the origin: no bound reached yet.
    await engine.advance(60);
    expect(actor.transform.position.x).toBeCloseTo(SPEED, 6);

    // The +x bound is met at t = 2s; by three seconds the drifter has
    // reflected and is heading back, still inside the bound.
    await engine.advance(120);
    expect(actor.transform.position.x).toBeCloseTo(expectedX(3), 6);
    const atThree = actor.transform.position.x;
    await engine.advance(1);
    expect(actor.transform.position.x).toBeLessThan(atThree);

    // The −x bound is met at t = 6s. Every frame on the way stays inside the
    // bound the game states, and after it the drifter is heading back out.
    for (let frame = 182; frame <= 400; frame += 1) {
      await engine.advance(1);
      expect(actor.transform.position.x).toBeGreaterThanOrEqual(-LIMIT);
      expect(actor.transform.position.x).toBeLessThanOrEqual(LIMIT);
    }
    expect(engine.frame().count).toBe(400);
    expect(actor.transform.position.x).toBeCloseTo(expectedX(400 / 60), 6);
    const atSample = actor.transform.position.x;
    await engine.advance(1);
    expect(actor.transform.position.x).toBeGreaterThan(atSample);
    engine.destroy();
  });

  it("spins by a yaw of TURN a second, as a function of accumulated time", async () => {
    const engine = boot();
    await engine.initialize();
    const [actor] = engine.world.actors();
    if (actor === undefined) throw new Error("missing drifter");

    await engine.advance(30);

    // "each frame composes a yaw increment of `TURN * dt` radians onto the
    // held rotation with `quatMultiply`, so the orientation is a function of
    // accumulated time rather than of the frame count."
    const seconds = engine.frame().timeMs / 1000;
    const expected = quatFromAxisAngle(UP, TURN * seconds);
    const { rotation } = actor.transform;
    expect(rotation.x).toBeCloseTo(expected.x, 9);
    expect(rotation.y).toBeCloseTo(expected.y, 9);
    expect(rotation.z).toBeCloseTo(expected.z, 9);
    expect(rotation.w).toBeCloseTo(expected.w, 9);
    engine.destroy();
  });

  it("keeps the outcome the same whatever step size the clock delivers", async () => {
    // "`tick` multiplies by `dt` in seconds and reflects the overshoot back
    // inside the bound, which keeps the outcome the same whatever step size
    // the clock delivers." An even step, a repeating uneven pattern, and a
    // seeded draw all land on the fold of the same uniform motion, and on the
    // same yaw.
    const clocks: Clock[] = [
      new ConstantClock(1000 / 60),
      new SequenceClock([8, 33, 12, 21]),
      new JitterClock(8, 40, 7),
    ];

    for (const clock of clocks) {
      const engine = boot(clock);
      await engine.initialize();
      const [actor] = engine.world.actors();
      if (actor === undefined) throw new Error("missing drifter");

      // Long enough to cross both bounds, whatever the cadence.
      await advanceMs(engine, 7000);
      const seconds = engine.frame().timeMs / 1000;
      expect(actor.transform.position.x).toBeCloseTo(expectedX(seconds), 6);
      expect(actor.transform.rotation.w).toBeCloseTo(
        quatFromAxisAngle(UP, TURN * seconds).w,
        6,
      );
      engine.destroy();
    }
  });

  it("draws the shape each frame, under the default camera and light rig", async () => {
    const engine = boot();
    await engine.initialize();

    // "Drawing belongs to the `ShapeComponent`, which the pipeline draws each
    // frame through the camera's frustum", and "the world holds no light
    // component, so the engine's default rig lights the box."
    await engine.advance(1);
    engine.startRecording();
    await engine.advance(3);
    const recording = engine.stopRecording();

    expect(recording.background).toBe("#05060a");
    expect(recording.width).toBe(640);
    expect(recording.height).toBe(360);
    expect(recording.frames).toHaveLength(3);

    const state = recording.states[recording.frames[0].state];
    expect(state.mode).toBe("standard");
    expect(state.camera.position).toEqual({ x: 0, y: 0, z: 10 });
    expect(state.lights.map((light) => light.type)).toEqual([
      "ambient",
      "directional",
    ]);

    for (let index = 0; index < 3; index += 1) {
      const draws = frameCalls(recording, index).filter((call) =>
        call.method.startsWith("draw"),
      );
      expect(draws).toHaveLength(1);
      expect(draws[0].method).toBe("drawGeometry");
      expect(draws[0].args[1]).toBe("#7fd1ff");
    }

    // The one geometry is the box the component names, produced once and
    // drawn by every frame that names it.
    expect(recording.resources).toHaveLength(1);
    expect(recording.resources[0].make).toEqual({
      method: "createBox",
      args: [{ x: SIZE, y: SIZE, z: SIZE }],
    });
    engine.destroy();
  });
});
