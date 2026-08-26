import { createCanvas } from "@test-cabinet/headless-webgl2";
import { afterEach, describe, expect, it } from "vitest";
import {
  ConstantClock,
  SequenceClock,
  createEngine,
  quatFromAxisAngle,
  vec3Length,
} from "./index";
import type {
  CameraState,
  Clock,
  DrawValue,
  Engine,
  Game,
  InitApi,
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
 * The documentation's worked example "Diagnostics and Overlay", transcribed and
 * run.
 *
 * The page promises its code works against the engine verbatim, so `src/game.ts`
 * below — the constants, the two helpers, and the `chamber` definition — is
 * copied from the page unchanged, and the boot module is followed line for line.
 * Only what a test environment forces is adapted:
 *
 * - The canvas is `@test-cabinet/headless-webgl2`'s and the element size arrives
 *   through an injected `SurfaceMetrics` at a fraction of the design size, since
 *   the rasterizer's cost is per device pixel and nothing here reads one.
 * - Frames are stepped with `engine.advance` over clocks that supply their own
 *   deltas, rather than driven from the host's frame callback.
 * - The sources the game registers are engine-held, and the overlay that reads
 *   them is inert in Node, where no 2D surface can be made. So the page's claim
 *   about *what* a source answers is checked by capturing the functions as the
 *   game hands them over — the game is wrapped, never altered — and calling them
 *   with the state the engine currently holds, which is what the engine does.
 *
 * The assertions are the outcomes the page narrates: sources registered once
 * during initialization, each reading the state current at that moment rather
 * than the opening one, the five shapes the overlay formats, `speed` derived
 * rather than stored, `fps` carried in the state from the frame counter, the
 * chamber's own reflection arithmetic, and the overlay staying out of a
 * recording of the frames beneath it.
 */

/* -------------------------------------------------------------------------- */
/* src/game.ts — transcribed verbatim                                         */
/* -------------------------------------------------------------------------- */

const RADIUS = 0.4;
const BOUNDS: Vec3 = { x: 6, y: 3, z: 4 };

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const ONE: Vec3 = { x: 1, y: 1, z: 1 };

const CAMERA: CameraState = {
  position: { x: 0, y: 2, z: 14 },
  rotation: quatFromAxisAngle({ x: 1, y: 0, z: 0 }, -0.15),
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

export interface ChamberState {
  readonly phase: "serve" | "rally";
  readonly serveIn: number;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly bounces: number;
  readonly fps: number;
}

interface Axis {
  readonly p: number;
  readonly v: number;
  readonly hit: boolean;
}

function bounce(p: number, v: number, limit: number): Axis {
  const edge = limit - RADIUS;
  if (p < -edge) return { p: -2 * edge - p, v: -v, hit: true };
  if (p > edge) return { p: 2 * edge - p, v: -v, hit: true };
  return { p, v, hit: false };
}

function edges(h: Vec3): readonly (readonly Vec3[])[] {
  const c = (sx: number, sy: number, sz: number): Vec3 => ({
    x: sx * h.x,
    y: sy * h.y,
    z: sz * h.z,
  });
  return [
    [c(-1, -1, -1), c(1, -1, -1), c(1, -1, 1), c(-1, -1, 1), c(-1, -1, -1)],
    [c(-1, 1, -1), c(1, 1, -1), c(1, 1, 1), c(-1, 1, 1), c(-1, 1, -1)],
    [c(-1, -1, -1), c(-1, 1, -1)],
    [c(1, -1, -1), c(1, 1, -1)],
    [c(1, -1, 1), c(1, 1, 1)],
    [c(-1, -1, 1), c(-1, 1, 1)],
  ];
}

export const chamber: Game<ChamberState, null> = {
  initialize(api: InitApi<ChamberState>): [ChamberState, null] {
    api.diagnostics.register("phase", (s) => s.phase);
    api.diagnostics.register("bounces", (s) => s.bounces);
    api.diagnostics.register("ball", (s) => ({
      x: s.position.x,
      y: s.position.y,
      z: s.position.z,
    }));
    api.diagnostics.register("speed", (s) => vec3Length(s.velocity));
    api.diagnostics.register("fps", (s) => s.fps);

    return [
      {
        phase: "serve",
        serveIn: 1,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 3.2, y: 2.5, z: 2.1 },
        bounces: 0,
        fps: 0,
      },
      null,
    ];
  },

  update(
    state: DeepReadonly<ChamberState>,
    api: UpdateApi,
    dt: number,
  ): ChamberState {
    const fps = Math.round(1000 / Math.max(api.frame().lastDeltaMs, 1));

    if (state.phase === "serve") {
      const serveIn = state.serveIn - dt;
      if (serveIn > 0) return { ...state, fps, serveIn };
    }

    const x = bounce(
      state.position.x + state.velocity.x * dt,
      state.velocity.x,
      BOUNDS.x,
    );
    const y = bounce(
      state.position.y + state.velocity.y * dt,
      state.velocity.y,
      BOUNDS.y,
    );
    const z = bounce(
      state.position.z + state.velocity.z * dt,
      state.velocity.z,
      BOUNDS.z,
    );
    const hits = [x, y, z].filter((axis) => axis.hit).length;

    return {
      ...state,
      phase: "rally",
      fps,
      position: { x: x.p, y: y.p, z: z.p },
      velocity: { x: x.v, y: y.v, z: z.v },
      bounces: state.bounces + hits,
    };
  },

  render(state: DeepReadonly<ChamberState>, api: RenderApi): void {
    const { scene } = api;
    scene.setCamera(CAMERA);
    scene.setLights(LIGHTS);

    for (const line of edges(BOUNDS)) {
      scene.drawLine(line, "#31405a");
    }

    const ball: Transform = {
      position: {
        x: state.position.x,
        y: state.position.y,
        z: state.position.z,
      },
      rotation: IDENTITY,
      scale: ONE,
    };
    scene.drawGeometry(scene.createSphere(RADIUS), "#7fd1ff", ball);
  },
};

/* -------------------------------------------------------------------------- */
/* index.html + src/main.ts — transcribed, with the forced adaptations        */
/* -------------------------------------------------------------------------- */

/** The element size the suite reports: the design aspect, scaled down. */
const CSS_WIDTH = 160;
const CSS_HEIGHT = 90;

/** One registered source, as the engine receives it. */
type Source = (state: DeepReadonly<ChamberState>) => unknown;

interface Rig {
  readonly engine: Engine<ChamberState, null>;
  /** The sources the game handed the engine, in registration order. */
  readonly sources: [string, Source][];
  /** What a named source answers about the state the engine currently holds. */
  read(name: string): unknown;
  key(code: string): void;
}

/** Every engine a test built, destroyed after it whatever the test did. */
const built: Engine<ChamberState, null>[] = [];

afterEach(() => {
  for (const engine of built.splice(0)) engine.destroy();
});

/**
 * The page's boot module, with the game wrapped rather than altered: the
 * wrapper hands `chamber.initialize` an `InitApi` whose `diagnostics.register`
 * keeps a copy of each source on its way to the engine. Everything else — the
 * registration itself, the state, `update`, and `render` — is the game's own.
 */
function boot(clock: Clock = new ConstantClock(1000 / 60)): Rig {
  const events = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: (): number => CSS_WIDTH,
    cssHeight: (): number => CSS_HEIGHT,
    dpr: (): number => 1,
    events: (): EventTarget => events,
  };

  const sources: [string, Source][] = [];
  const watched: Game<ChamberState, null> = {
    ...chamber,
    initialize: (api) =>
      chamber.initialize({
        ...api,
        diagnostics: {
          register: (name, source): void => {
            sources.push([name, source]);
            api.diagnostics.register(name, source);
          },
        },
      }),
  };

  const engine = createEngine({
    canvas: createCanvas(CSS_WIDTH, CSS_HEIGHT) as unknown as HTMLCanvasElement,
    width: 640,
    height: 360,
    background: "#05060a",
    game: watched,
    clock,
    surface,
  });
  built.push(engine);

  return {
    engine,
    sources,
    read: (name) => {
      const found = sources.find(([registered]) => registered === name);
      if (found === undefined) throw new Error(`no source named ${name}`);
      return found[1](engine.state);
    },
    key: (code) => {
      events.dispatchEvent(
        Object.assign(new Event("keydown"), { code, repeat: false }),
      );
      events.dispatchEvent(
        Object.assign(new Event("keyup"), { code, repeat: false }),
      );
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The narrated outcomes                                                      */
/* -------------------------------------------------------------------------- */

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

/** The magnitude the ball keeps: a reflection flips a sign and nothing else. */
const SPEED = Math.hypot(3.2, 2.5, 2.1);

describe("examples/diagnostics-and-overlay", () => {
  it("registers the five sources once, during initialization, and nowhere else", async () => {
    const rig = boot();

    // "The boot module registers nothing. Sources belong to the game."
    expect(rig.sources).toEqual([]);

    await rig.engine.initialize();
    expect(rig.sources.map(([name]) => name)).toEqual([
      "phase",
      "bounces",
      "ball",
      "speed",
      "fps",
    ]);

    await rig.engine.advance(30);
    expect(rig.sources).toHaveLength(5);
  });

  it("hands each source the state current at that moment, not the opening one", async () => {
    const rig = boot();
    const opening = await rig.engine.initialize();

    // "The engine evaluates the sources on each read, handing each one the
    // state current at that moment, so a line reports what the game holds at
    // that instant rather than the opening value `initialize` returned."
    expect(rig.read("phase")).toBe("serve");
    expect(rig.read("bounces")).toBe(0);
    expect(rig.read("ball")).toEqual({ x: 0, y: 0, z: 0 });

    await rig.engine.advance(30);
    expect(rig.read("phase")).toBe("serve");
    expect(opening.phase).toBe("serve");

    await rig.engine.advance(120);
    expect(rig.read("phase")).toBe("rally");
    expect(rig.read("ball")).not.toEqual({ x: 0, y: 0, z: 0 });
    // The value `initialize` resolved to stays the value it was.
    expect(opening.phase).toBe("serve");
    expect(opening.position).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("covers the shapes the overlay formats, and derives the one that is a function of the rest", async () => {
    const rig = boot();
    await rig.engine.initialize();
    await rig.engine.advance(90);

    // "A string prints as itself, an integer prints whole, a non-integer prints
    // to three decimal places, and a small object prints as JSON."
    expect(typeof rig.read("phase")).toBe("string");
    expect(Number.isInteger(rig.read("bounces"))).toBe(true);
    expect(Number.isInteger(rig.read("fps"))).toBe(true);
    expect(Number.isInteger(rig.read("speed"))).toBe(false);
    expect(Object.keys(rig.read("ball") as object)).toEqual(["x", "y", "z"]);

    // "`speed` derives its value with `vec3Length` rather than storing it,
    // which is the pattern for any figure that is a function of fields the
    // state already holds." No `speed` field exists to have gone stale.
    expect(rig.read("speed")).toBeCloseTo(SPEED, 9);
    expect(vec3Length(rig.engine.state.velocity)).toBeCloseTo(SPEED, 9);
    expect(Object.keys(rig.engine.state)).not.toContain("speed");
  });

  it("carries fps in the state from the frame counter, and follows the clock", async () => {
    // "`fps` comes from the frame counter, so `update` carries it in the state
    // it returns and the source reads the field."
    const even = boot(new ConstantClock(1000 / 60));
    await even.engine.initialize();
    await even.engine.advance(2);
    expect(even.read("fps")).toBe(60);
    expect(even.engine.frame().lastDeltaMs).toBeCloseTo(1000 / 60, 9);

    const uneven = boot(new SequenceClock([10, 40]));
    await uneven.engine.initialize();
    await uneven.engine.advance(1);
    expect(uneven.read("fps")).toBe(100);
    await uneven.engine.advance(1);
    expect(uneven.read("fps")).toBe(25);
  });

  it("holds the serve for its second, then rallies", async () => {
    const rig = boot();
    await rig.engine.initialize();

    await rig.engine.advance(30);
    expect(rig.engine.state.phase).toBe("serve");
    expect(rig.engine.state.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(rig.engine.state.serveIn).toBeCloseTo(0.5, 6);

    await rig.engine.advance(31);
    expect(rig.engine.state.phase).toBe("rally");
    expect(rig.engine.state.position.x).toBeGreaterThan(0);
  });

  it("reflects the ball inside the chamber and counts every hit", async () => {
    const rig = boot();
    await rig.engine.initialize();

    // Each axis reflects the overshoot at its own wall, a hemisphere's radius
    // in from the bound, so the ball's center stays inside `limit - RADIUS` on
    // every axis however long the rally runs.
    for (let frame = 0; frame < 300; frame += 1) {
      await rig.engine.advance(1);
      const { position } = rig.engine.state;
      expect(Math.abs(position.x)).toBeLessThanOrEqual(BOUNDS.x - RADIUS);
      expect(Math.abs(position.y)).toBeLessThanOrEqual(BOUNDS.y - RADIUS);
      expect(Math.abs(position.z)).toBeLessThanOrEqual(BOUNDS.z - RADIUS);
    }

    expect(rig.engine.state.bounces).toBeGreaterThan(0);
    // A reflection flips a sign and nothing else, so the speed is conserved.
    expect(vec3Length(rig.engine.state.velocity)).toBeCloseTo(SPEED, 9);
  });

  it("draws the chamber's twelve edges as six polylines and the ball as one sphere", async () => {
    const rig = boot();
    await rig.engine.initialize();
    await rig.engine.advance(90);

    rig.engine.startRecording();
    await rig.engine.advance(1);
    const recording = rig.engine.stopRecording();

    const lines = callsTo(recording, "drawLine");
    expect(lines).toHaveLength(6);
    expect(
      lines.map((args) => (args[0] as readonly DrawValue[]).length),
    ).toEqual([5, 5, 2, 2, 2, 2]);
    expect(lines.every((args) => args[1] === "#31405a")).toBe(true);

    const spheres = recording.resources.filter(
      (r) => r.make.method === "createSphere",
    );
    expect(spheres).toHaveLength(1);
    expect(spheres[0]?.make.args).toEqual([RADIUS]);
  });

  it("keeps the overlay out of a recording of the frames beneath it", async () => {
    const rig = boot();
    await rig.engine.initialize();

    // "The backtick key brings it up, so this build binds no key of its own and
    // leaves that key free of gameplay bindings." The toggle is engine chrome,
    // not a registered action, so the game's state is untouched by it.
    const before = rig.engine.state;
    rig.key("Backquote");
    await rig.engine.advance(1);
    expect(rig.engine.state).not.toBe(before);

    rig.engine.startRecording();
    await rig.engine.advance(2);
    const recording = rig.engine.stopRecording();

    // "The overlay draws on the engine's own 2D surface composited above the 3D
    // picture, so nothing of it enters a recording of the frames beneath." Each
    // frame holds exactly the game's own eight operations and no more.
    expect(recording.frames).toHaveLength(2);
    for (const frame of recording.frames) expect(frame.ops).toHaveLength(9);
    const methods = new Set(
      recording.ops.flatMap((op) => (op.op === "call" ? [op.method] : [])),
    );
    expect([...methods].sort()).toEqual([
      "drawGeometry",
      "drawLine",
      "setCamera",
      "setLights",
    ]);
  });
});
