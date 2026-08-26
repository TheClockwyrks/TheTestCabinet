import { createCanvas } from "@test-cabinet/headless-webgl2";
import { afterEach, describe, expect, it, test } from "vitest";
import {
  ConstantClock,
  SequenceClock,
  TOUCH_LAYOUTS,
  createEngine,
  quatFromAxisAngle,
  rotateVec3,
  vec3Add,
  vec3Scale,
} from "./index";
import type {
  ActionBinding,
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
 * The documentation's worked example "Input and Actions", transcribed and run.
 *
 * The page prints two complete modules — `src/game.ts` and the case's own
 * `validation/driving.test.ts` — and promises both work against the engine
 * verbatim, so both are carried below unchanged and the page's two tests run as
 * the page wrote them. Only what a test environment forces is adapted:
 *
 * - Imports name this package's own modules instead of the published specifier
 *   `@test-cabinet/simple-3d`, since this file *is* that package.
 * - The page's suite sizes its canvas at the design size. The rasterizer's cost
 *   is per device pixel and neither of its checks reads one, so `TestSurface`
 *   reports a smaller element of the same aspect and the canvas follows it. The
 *   design size handed to `createEngine` is untouched, so every figure the
 *   checks assert — a distance in world units, a jump count — is unchanged.
 *
 * The assertions beyond the page's own two are the outcomes it narrates: that
 * the build binds exactly the layout's vocabulary, that an axis taken as the
 * difference of two opposed actions reads zero when both are held, that the
 * distance and the turn are proportional to what the frame was worth, that the
 * two composed math functions carry the rover the way it faces, that an edge is
 * true exactly once per press, and that the same orientation rotates the box.
 */

/* -------------------------------------------------------------------------- */
/* src/game.ts — transcribed verbatim                                         */
/* -------------------------------------------------------------------------- */

/** Every action `TOUCH_LAYOUTS["stick-look-two-buttons"]` names, with keys. */
const BINDINGS: Record<string, ActionBinding> = {
  "move-forward": { keys: ["KeyW", "ArrowUp"], kind: "analog" },
  "move-back": { keys: ["KeyS", "ArrowDown"], kind: "analog" },
  "move-left": { keys: ["KeyA", "ArrowLeft"], kind: "analog" },
  "move-right": { keys: ["KeyD", "ArrowRight"], kind: "analog" },
  "look-up": { keys: ["KeyI"], kind: "analog" },
  "look-down": { keys: ["KeyK"], kind: "analog" },
  "look-left": { keys: ["KeyJ"], kind: "analog" },
  "look-right": { keys: ["KeyL"], kind: "analog" },
  a: { keys: ["Space"] },
  b: { keys: ["KeyE"] },
  confirm: { keys: ["Enter"] },
  back: { keys: ["Escape"] },
  pause: { keys: ["KeyP"] },
  mute: { keys: ["KeyM"] },
};

const FIELD = 14;
const RUN = 5;
const TURN = 2.5;
const JUMP = 6;
const GRAVITY = 18;

const UP: Vec3 = { x: 0, y: 1, z: 0 };
const FORWARD: Vec3 = { x: 0, y: 0, z: -1 };
const RIGHT: Vec3 = { x: 1, y: 0, z: 0 };
const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const ONE: Vec3 = { x: 1, y: 1, z: 1 };

const CAMERA: CameraState = {
  position: { x: 0, y: 10, z: 20 },
  rotation: quatFromAxisAngle({ x: 1, y: 0, z: 0 }, -0.45),
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

export interface RoverState {
  readonly position: Vec3;
  readonly heading: number;
  readonly vy: number;
  readonly grounded: boolean;
  readonly paused: boolean;
  readonly jumps: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

export const rover: Game<RoverState, null> = {
  initialize(api: InitApi<RoverState>): [RoverState, null] {
    for (const [action, binding] of Object.entries(BINDINGS)) {
      api.input.register(action, binding);
    }

    return [
      {
        position: { x: 0, y: 0, z: 0 },
        heading: 0,
        vy: 0,
        grounded: true,
        paused: false,
        jumps: 0,
      },
      null,
    ];
  },

  update(
    state: DeepReadonly<RoverState>,
    api: UpdateApi,
    dt: number,
  ): RoverState {
    const paused = api.input.pressed("pause") ? !state.paused : state.paused;
    if (paused) return { ...state, paused };

    const turn = api.input.value("look-left") - api.input.value("look-right");
    const heading = state.heading + turn * TURN * dt;
    const facing = quatFromAxisAngle(UP, heading);

    const drive =
      api.input.value("move-forward") - api.input.value("move-back");
    const strafe = api.input.value("move-right") - api.input.value("move-left");
    const step = vec3Add(
      vec3Scale(rotateVec3(facing, FORWARD), drive * RUN * dt),
      vec3Scale(rotateVec3(facing, RIGHT), strafe * RUN * dt),
    );

    const jumping = api.input.pressed("a") && state.grounded;
    const vy = (jumping ? JUMP : state.vy) - GRAVITY * dt;
    const y = state.position.y + vy * dt;
    const grounded = y <= 0;

    return {
      position: {
        x: clamp(state.position.x + step.x, -FIELD, FIELD),
        y: grounded ? 0 : y,
        z: clamp(state.position.z + step.z, -FIELD, FIELD),
      },
      heading,
      vy: grounded ? 0 : vy,
      grounded,
      paused,
      jumps: jumping ? state.jumps + 1 : state.jumps,
    };
  },

  render(state: DeepReadonly<RoverState>, api: RenderApi): void {
    const { scene } = api;
    scene.setCamera(CAMERA);
    scene.setLights(LIGHTS);

    const ground: Transform = {
      position: { x: 0, y: 0, z: 0 },
      rotation: IDENTITY,
      scale: ONE,
    };
    scene.drawGeometry(scene.createPlane(30, 30), "#182231", ground);

    scene.drawGeometry(
      scene.createBox({ x: 0.9, y: 0.6, z: 1.4 }),
      state.grounded ? "#7fd1ff" : "#ffd479",
      {
        position: {
          x: state.position.x,
          y: state.position.y + 0.3,
          z: state.position.z,
        },
        rotation: quatFromAxisAngle(UP, state.heading),
        scale: ONE,
      },
    );

    scene.drawHudText(
      state.paused ? "paused" : `jumps ${state.jumps}`,
      { x: 16, y: 12 },
      { size: 16, color: "#e6edf6" },
    );
  },
};

/* -------------------------------------------------------------------------- */
/* validation/driving.test.ts — transcribed, with the forced adaptations      */
/* -------------------------------------------------------------------------- */

const WIDTH = 640;
const HEIGHT = 360;

/** The element size the suite reports: the design aspect, scaled down. */
const CSS_WIDTH = 160;
const CSS_HEIGHT = 90;

class TestSurface implements SurfaceMetrics {
  readonly target = new EventTarget();

  cssWidth(): number {
    return CSS_WIDTH;
  }

  cssHeight(): number {
    return CSS_HEIGHT;
  }

  dpr(): number {
    return 1;
  }

  events(): EventTarget {
    return this.target;
  }
}

function key(
  target: EventTarget,
  type: "keydown" | "keyup",
  code: string,
): void {
  target.dispatchEvent(Object.assign(new Event(type), { code, repeat: false }));
}

/** Every engine a test built, destroyed after it whatever the test did. */
const built: Engine<RoverState>[] = [];

afterEach(() => {
  for (const engine of built.splice(0)) engine.destroy();
});

function boot(clock: Clock = new ConstantClock(1000 / 60)): {
  engine: Engine<RoverState>;
  surface: TestSurface;
} {
  const surface = new TestSurface();
  const engine = createEngine({
    canvas: createCanvas(CSS_WIDTH, CSS_HEIGHT) as unknown as HTMLCanvasElement,
    width: WIDTH,
    height: HEIGHT,
    layout: "stick-look-two-buttons",
    game: rover,
    clock,
    surface,
  });
  built.push(engine);
  return { engine, surface };
}

test("a held drive moves the rover forward", async () => {
  const { engine, surface } = boot();
  const opening = await engine.initialize();

  key(surface.target, "keydown", "KeyW");
  await engine.advance(60);
  key(surface.target, "keyup", "KeyW");

  expect(engine.state.position.z).toBeLessThan(opening.position.z);
  expect(engine.state.position.x).toBeCloseTo(opening.position.x, 6);
  engine.destroy();
});

test("a held jump button costs one jump", async () => {
  const { engine, surface } = boot();
  await engine.initialize();

  key(surface.target, "keydown", "Space");
  await engine.advance(120);

  expect(engine.state.jumps).toBe(1);
  engine.destroy();
});

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

describe("examples/input-and-actions", () => {
  it("binds exactly the vocabulary the selected layout names", async () => {
    // The build's comment on `BINDINGS` — "every action
    // `TOUCH_LAYOUTS['stick-look-two-buttons']` names, with keys" — is a claim
    // about the catalogue, and the catalogue is what the engine tags against.
    const layout = TOUCH_LAYOUTS["stick-look-two-buttons"];
    expect(layout?.actions).toEqual(Object.keys(BINDINGS));

    // "`layout` selects the touch layout before anything is registered, so
    // every action in that layout's vocabulary is tagged with it as the game
    // registers it." The selection is readable from the game's own
    // initialization onwards, which is what a build reads to lay out its pad.
    let named: readonly string[] | null = null;
    const watched: Game<RoverState, null> = {
      ...rover,
      initialize: (api) => {
        named = api.input.layout()?.actions ?? null;
        return rover.initialize(api);
      },
    };
    const engine = createEngine({
      canvas: createCanvas(
        CSS_WIDTH,
        CSS_HEIGHT,
      ) as unknown as HTMLCanvasElement,
      width: WIDTH,
      height: HEIGHT,
      layout: "stick-look-two-buttons",
      game: watched,
      clock: new ConstantClock(1000 / 60),
      surface: new TestSurface(),
    });
    built.push(engine);

    await engine.initialize();
    expect(named).toEqual(Object.keys(BINDINGS));
  });

  it("reads zero from an axis whose two opposed actions are both held", async () => {
    const { engine, surface } = boot();
    await engine.initialize();

    // "Taking each axis as the difference of its two opposed actions makes
    // holding both report `0`."
    key(surface.target, "keydown", "KeyW");
    key(surface.target, "keydown", "KeyS");
    await engine.advance(60);

    expect(engine.state.position.z).toBe(0);
    expect(engine.state.position.x).toBe(0);
  });

  it("keeps the distance proportional to what the frame was worth", async () => {
    // "multiplying by `dt` keeps the distance and the turn proportional to the
    // time the frame was worth" — an even step and an uneven pattern that add
    // up to the same simulated second travel the same distance.
    const outcomes: number[] = [];
    for (const clock of [
      new ConstantClock(1000 / 60),
      new SequenceClock([8, 33, 12, 21, 26]),
    ]) {
      const { engine, surface } = boot(clock);
      await engine.initialize();
      key(surface.target, "keydown", "KeyW");
      while (engine.frame().timeMs < 1_000) await engine.advance(1);
      outcomes.push(engine.state.position.z / (engine.frame().timeMs / 1000));
    }

    expect(outcomes[0]).toBeCloseTo(-RUN, 6);
    expect(outcomes[1]).toBeCloseTo(-RUN, 6);
  });

  it("carries the rover the way it faces, through the two composed math functions", async () => {
    const { engine, surface } = boot();
    await engine.initialize();

    // One second of the look pad's left, then one second of drive. The heading
    // is the accumulated turn, and `quatFromAxisAngle` + `rotateVec3` carry the
    // local forward into world space.
    key(surface.target, "keydown", "KeyJ");
    await engine.advance(60);
    key(surface.target, "keyup", "KeyJ");
    const heading = engine.state.heading;
    expect(heading).toBeCloseTo(TURN, 6);

    key(surface.target, "keydown", "KeyW");
    await engine.advance(60);

    const facing = rotateVec3(quatFromAxisAngle(UP, heading), FORWARD);
    expect(engine.state.position.x).toBeCloseTo(facing.x * RUN, 6);
    expect(engine.state.position.z).toBeCloseTo(facing.z * RUN, 6);
    // The turn stopped when the key came up, so the heading is where it was.
    expect(engine.state.heading).toBe(heading);
  });

  it("costs one jump per press however long the key is held, and another after landing", async () => {
    const { engine, surface } = boot();
    await engine.initialize();

    // "`pressed` is the edge read, true exactly once per press however long the
    // key is held, and the call consumes the edge."
    key(surface.target, "keydown", "Space");
    await engine.advance(5);
    expect(engine.state.jumps).toBe(1);
    expect(engine.state.grounded).toBe(false);

    // Held all the way down and back to the ground: still one jump.
    while (!engine.state.grounded) await engine.advance(1);
    expect(engine.state.jumps).toBe(1);

    // A fresh press, from the ground, costs the second.
    key(surface.target, "keyup", "Space");
    key(surface.target, "keydown", "Space");
    await engine.advance(1);
    expect(engine.state.jumps).toBe(2);
  });

  it("refuses a jump that is not from the ground", async () => {
    const { engine, surface } = boot();
    await engine.initialize();

    key(surface.target, "keydown", "Space");
    await engine.advance(1);
    key(surface.target, "keyup", "Space");
    expect(engine.state.jumps).toBe(1);
    expect(engine.state.grounded).toBe(false);

    // Mid-air, the press arms the edge and the guard on `state.grounded`
    // spends it on nothing: `jumps` counts jumps, not presses.
    key(surface.target, "keydown", "Space");
    await engine.advance(1);
    expect(engine.state.jumps).toBe(1);
  });

  it("toggles pause on the edge and freezes everything but the pause bit", async () => {
    const { engine, surface } = boot();
    await engine.initialize();

    key(surface.target, "keydown", "KeyW");
    await engine.advance(30);
    const moved = engine.state.position.z;
    expect(moved).toBeLessThan(0);

    key(surface.target, "keydown", "KeyP");
    await engine.advance(30);
    expect(engine.state.paused).toBe(true);
    expect(engine.state.position.z).toBe(moved);

    key(surface.target, "keyup", "KeyP");
    key(surface.target, "keydown", "KeyP");
    await engine.advance(30);
    expect(engine.state.paused).toBe(false);
    expect(engine.state.position.z).toBeLessThan(moved);
  });

  it("draws the rover in the color and the orientation the state carries", async () => {
    const { engine, surface } = boot();
    await engine.initialize();

    key(surface.target, "keydown", "KeyJ");
    await engine.advance(30);
    key(surface.target, "keyup", "KeyJ");

    engine.startRecording();
    await engine.advance(1);
    const grounded = engine.stopRecording();

    // "The same orientation rotates the box in `render`, so the rover faces the
    // way it drives."
    const facing = quatFromAxisAngle(UP, engine.state.heading);
    const box = callsTo(grounded, "drawGeometry").find(
      (args) => args[1] === "#7fd1ff",
    );
    // A recording carries nine significant digits, so the recorded quaternion
    // is compared to that many rather than for identity.
    const rotation = (box?.[2] as { rotation: Record<string, number> })
      .rotation;
    expect(rotation["x"]).toBeCloseTo(facing.x, 8);
    expect(rotation["y"]).toBeCloseTo(facing.y, 8);
    expect(rotation["z"]).toBeCloseTo(facing.z, 8);
    expect(rotation["w"]).toBeCloseTo(facing.w, 8);

    // The HUD line is the jump count while the game runs.
    expect(callsTo(grounded, "drawHudText")[0]).toEqual([
      "jumps 0",
      { x: 16, y: 12 },
      { size: 16, color: "#e6edf6" },
    ]);

    // Airborne, the box is drawn in the other color and lifted by its own half.
    key(surface.target, "keydown", "Space");
    await engine.advance(1);
    key(surface.target, "keyup", "Space");
    engine.startRecording();
    await engine.advance(1);
    const airborne = engine.stopRecording();

    expect(engine.state.grounded).toBe(false);
    const lifted = callsTo(airborne, "drawGeometry").find(
      (args) => args[1] === "#ffd479",
    );
    const position = (lifted?.[2] as { position: Record<string, number> })
      .position;
    expect(position["y"]).toBeCloseTo(engine.state.position.y + 0.3, 8);
    expect(callsTo(airborne, "drawHudText")[0]?.[0]).toBe("jumps 1");
  });

  it("draws the paused notice instead of the jump count", async () => {
    const { engine, surface } = boot();
    await engine.initialize();

    key(surface.target, "keydown", "KeyP");
    engine.startRecording();
    await engine.advance(1);
    const recording = engine.stopRecording();

    expect(engine.state.paused).toBe(true);
    expect(callsTo(recording, "drawHudText")[0]?.[0]).toBe("paused");
  });
});
