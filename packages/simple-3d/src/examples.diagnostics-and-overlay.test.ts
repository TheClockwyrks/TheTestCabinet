import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import type { DeepReadonly } from "ts-essentials";
import type {
  Clock,
  Engine,
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "./index";
import { ConstantClock, SequenceClock, createEngine } from "./index";
import type { Context2dStub, Stage } from "./testing/canvas";
import { createStage } from "./testing/canvas";

/**
 * The documentation's worked example "Diagnostics and Overlay", transcribed from
 * `engines/simple-3d/examples/diagnostics-and-overlay.md` and run against the
 * shipped engine.
 *
 * The page promises its code works verbatim, so `src/game.ts` is copied below
 * unchanged — its constants, its `Ball` and `RallyState`, its `serve` helper, and
 * the three functions of `rally` — and `src/main.ts` is followed line for line.
 * Only what a test environment forces is adapted, and every adaptation is one the
 * engine's own validator harness prescribes:
 *
 * - jsdom lays nothing out and hands out no canvas contexts, so the element the
 *   page's `querySelector` finds is a stub canvas whose `webgl2` context a real
 *   `THREE.WebGLRenderer` constructs over, and a `SurfaceMetrics` reports the size
 *   and the device pixel ratio a browser would have measured.
 * - The screen layer is handed in rather than created by the engine, which is what
 *   `EngineOptions.screen` exists for: the overlay draws through its 2D context,
 *   and a suite that means to read the panel's lines has to hold that context.
 * - The page's `await engine.run()` drives frames off the host's callback on a wall
 *   clock; a check steps synchronously instead, with `engine.advance` over a clock
 *   that supplies its own deltas, exactly as the page's own "Reading the values
 *   back" section does.
 *
 * The assertions are what the page narrates: five sources registered once during
 * initialization and read back in registration order, each evaluated against the
 * state current at the read rather than the one `initialize` returned, `fps`
 * carried in the state from the frame the counter describes, the three display
 * shapes formatted their three ways with the engine's own metrics line beneath
 * them, the backtick key raising the panel without touching the simulation, and the
 * ball's mesh built once and found by name afterwards while the overlay keeps
 * reporting the state's position rather than the mesh's.
 */

/* -------------------------------------------------------------------------- */
/* src/game.ts — transcribed verbatim                                         */
/* -------------------------------------------------------------------------- */

const BALL = 0.4;
const SPEED = 6;
const HALF_WIDTH = 8;
const HALF_DEPTH = 5;

interface Ball {
  readonly x: number;
  readonly z: number;
  readonly vx: number;
  readonly vz: number;
}

export interface RallyState {
  readonly phase: "serve" | "rally";
  readonly serveIn: number;
  readonly ball: Ball;
  readonly score: { readonly left: number; readonly right: number };
  readonly fps: number;
}

function serve(state: DeepReadonly<RallyState>, vx: number): RallyState {
  return {
    ...state,
    phase: "serve",
    serveIn: 1,
    ball: { x: 0, z: 0, vx, vz: SPEED / 2 },
  };
}

export const rally: Game<RallyState, null> = {
  initialize(api: InitApi<RallyState>): [RallyState, null] {
    api.diagnostics.register("phase", (s) => s.phase);
    api.diagnostics.register(
      "score",
      (s) => `${s.score.left} - ${s.score.right}`,
    );
    api.diagnostics.register(
      "ball",
      (s) => `${s.ball.x.toFixed(1)}, ${s.ball.z.toFixed(1)}`,
    );
    api.diagnostics.register("speed", (s) => Math.hypot(s.ball.vx, s.ball.vz));
    api.diagnostics.register("fps", (s) => s.fps);

    return [
      {
        phase: "serve",
        serveIn: 1,
        ball: { x: 0, z: 0, vx: SPEED, vz: SPEED / 2 },
        score: { left: 0, right: 0 },
        fps: 0,
      },
      null,
    ];
  },

  update(
    state: DeepReadonly<RallyState>,
    api: UpdateApi,
    dt: number,
  ): RallyState {
    const fps = Math.round(1000 / Math.max(api.frame().lastDeltaMs, 1));

    if (state.phase === "serve") {
      const serveIn = state.serveIn - dt;
      if (serveIn > 0) return { ...state, fps, serveIn };
    }

    const x = state.ball.x + state.ball.vx * dt;
    const z = state.ball.z + state.ball.vz * dt;
    const vz =
      z < -HALF_DEPTH + BALL || z > HALF_DEPTH - BALL
        ? -state.ball.vz
        : state.ball.vz;
    const moved: RallyState = {
      ...state,
      phase: "rally",
      fps,
      ball: { ...state.ball, x, z, vz },
    };

    if (x < -HALF_WIDTH + BALL) {
      const score = { ...moved.score, right: moved.score.right + 1 };
      return serve({ ...moved, score }, SPEED);
    }
    if (x > HALF_WIDTH - BALL) {
      const score = { ...moved.score, left: moved.score.left + 1 };
      return serve({ ...moved, score }, -SPEED);
    }
    return moved;
  },

  render(state: DeepReadonly<RallyState>, api: RenderApi): void {
    let ball = api.scene.getObjectByName("ball");
    if (ball === undefined) {
      ball = new THREE.Mesh(
        new THREE.SphereGeometry(BALL, 24, 16),
        new THREE.MeshStandardMaterial({ color: "#7fd1ff" }),
      );
      ball.name = "ball";
      api.scene.add(ball);
      api.scene.add(new THREE.HemisphereLight("#ffffff", "#20242e", 2));
    }
    ball.position.set(state.ball.x, BALL, state.ball.z);

    api.camera.position.set(0, 12, 12);
    api.camera.lookAt(0, 0, 0);
  },
};

/* -------------------------------------------------------------------------- */
/* index.html + src/main.ts — transcribed, with the forced adaptations        */
/* -------------------------------------------------------------------------- */

/** The design field the page's boot module declares. */
const DESIGN_WIDTH = 640;
const DESIGN_HEIGHT = 360;

/** Everything the page has, plus the two handles a check reads the panel through. */
interface Rally {
  engine: Engine<RallyState, null>;
  /** The screen layer's recorded operations — where the overlay draws. */
  screen: Context2dStub;
  /** Where the player's keyboard lands, standing in for the document. */
  target: EventTarget;
  stage: Stage;
}

const built: Engine<RallyState, null>[] = [];

afterEach(() => {
  for (const engine of built.splice(0)) engine.destroy();
  document.body.replaceChildren();
});

/**
 * The page's markup and boot module, adapted only as the header describes.
 *
 * The rig is built at a device pixel ratio of one over an element laid out at the
 * design size, which is the validator harness's own default: one device pixel of
 * either canvas on one logical unit, so nothing a check reads back needs undoing
 * first.
 */
function boot(clock: Clock = new ConstantClock(1000 / 60)): Rally {
  const stage = createStage({
    cssWidth: DESIGN_WIDTH,
    cssHeight: DESIGN_HEIGHT,
    dpr: 1,
  });
  stage.stage.canvas.id = "game";
  document.body.append(stage.stage.canvas);

  const canvas = document.querySelector<HTMLCanvasElement>("#game");
  if (canvas === null) throw new Error("missing canvas #game");

  const engine = createEngine({
    canvas,
    width: DESIGN_WIDTH,
    height: DESIGN_HEIGHT,
    background: "#05060a",
    game: rally,
    clock,
    surface: stage.surface.surface,
    screen: stage.screen.canvas,
  });
  built.push(engine);

  return {
    engine,
    screen: stage.screen.context2d,
    target: stage.surface.target,
    stage,
  };
}

/** Every line the overlay drew this frame, in the order it drew them. */
function overlayLines(screen: Context2dStub): string[] {
  return screen.opsOf("fillText").map((op) => String(op.text));
}

/** An unrepeated `Backquote` keydown: the engine's own overlay key, as a player presses it. */
function pressBackquote(target: EventTarget, repeat = false): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { code: "Backquote", repeat }),
  );
}

/**
 * The engine's own line, as the page describes it: the frame timings, then the
 * most recent frame's draw calls and triangles.
 */
const METRICS_LINE =
  /^frame: \d+\.\d \/ \d+\.\d \/ \d+\.\d ms · (\d+) draws · (\d+) tris$/;

/** What every source reports at a given moment, as a plain record. */
function values(engine: Engine<RallyState, null>): Record<string, unknown> {
  return Object.fromEntries(
    engine.diagnostics().map((reading) => [reading.name, reading.value]),
  );
}

/** The name the page registers `ball` as, computed the way the source computes it. */
function ballLine(state: DeepReadonly<RallyState>): string {
  return `${state.ball.x.toFixed(1)}, ${state.ball.z.toFixed(1)}`;
}

/* -------------------------------------------------------------------------- */
/* What the page narrates                                                     */
/* -------------------------------------------------------------------------- */

describe("examples: diagnostics and overlay", () => {
  it("registers the five sources during initialization and nothing else does", async () => {
    const { engine } = boot();
    await engine.initialize();

    // "Each is registered once during initialization as a function over the
    // state" — and "the boot module registers nothing", so the registry holds
    // the game's five and no more, in the order `initialize` named them.
    expect(engine.diagnostics().map((reading) => reading.name)).toEqual([
      "phase",
      "score",
      "ball",
      "speed",
      "fps",
    ]);

    // Registration happened once: driving frames neither repeats it nor adds to it.
    await engine.advance(200);
    expect(engine.diagnostics()).toHaveLength(5);
  });

  it("reads the values back off the engine, exactly as the page's check does", async () => {
    const { engine } = boot();
    await engine.initialize();

    // The page's own snippet, verbatim. Sixty frames of a sixtieth of a second
    // each spend the serve countdown and leave the rally's first step behind.
    await engine.advance(60);

    const readings = engine.diagnostics();

    expect(readings.map((r) => r.name)).toEqual([
      "phase",
      "score",
      "ball",
      "speed",
      "fps",
    ]);
    expect(readings[0]).toEqual({ name: "phase", value: "rally" });
    expect(readings[1]).toEqual({ name: "score", value: "0 - 0" });
  });

  it("hands each source the state current at the read, not the opening one", async () => {
    const { engine } = boot();
    await engine.initialize();

    // Before a frame has run, every source reports the value `initialize`
    // returned: the serve, a scoreless board, the ball at the origin, the speed
    // the serve was given, and a frame rate no frame has yet supplied.
    expect(values(engine)).toEqual({
      phase: "serve",
      score: "0 - 0",
      ball: "0.0, 0.0",
      speed: Math.hypot(SPEED, SPEED / 2),
      fps: 0,
    });

    // One frame later the same five sources report the state that frame left —
    // "rather than the opening value `initialize` returned".
    await engine.advance(1);
    expect(values(engine)).toEqual({
      phase: "serve",
      score: "0 - 0",
      ball: "0.0, 0.0",
      speed: Math.hypot(SPEED, SPEED / 2),
      fps: 60,
    });

    // The reads follow the state wherever it comes from, with no frame at all:
    // a transition applied from outside is visible to the very next read.
    engine.apply((state) => ({ ...state, score: { left: 3, right: 2 } }));
    expect(values(engine).score).toBe("3 - 2");
  });

  it("carries fps in the state, from the frame the counter describes", async () => {
    // "`fps` comes from the frame counter, so `update` carries it in the state it
    // returns and the source reads the field. `api.frame().lastDeltaMs` belongs to
    // the frame the counter describes" — so an uneven clock is read back one
    // frame at a time and every reading names the step that frame was worth.
    const steps = [16, 33, 8, 50];
    const { engine } = boot(new SequenceClock([...steps]));
    await engine.initialize();

    for (let frame = 0; frame < steps.length * 3; frame += 1) {
      await engine.advance(1);
      const stepMs = steps[frame % steps.length] ?? 0;
      expect(engine.frame().lastDeltaMs).toBe(stepMs);
      expect(values(engine).fps).toBe(Math.round(1000 / stepMs));
    }
  });

  it("draws nothing until the backtick key, then the five lines and the metrics line", async () => {
    const { engine, screen, target } = boot();
    await engine.initialize();

    // "The overlay is what a person reads the sources off" — and it is hidden
    // when the engine is created, so a frame draws no panel at all even though
    // every source is registered and readable.
    screen.forget();
    await engine.advance(60);
    expect(overlayLines(screen)).toEqual([]);
    expect(engine.diagnostics()).toHaveLength(5);

    // "The backtick key brings it up."
    pressBackquote(target);
    screen.forget();
    await engine.advance(1);

    const lines = overlayLines(screen);
    // The five registered lines first, each value formatted the way its shape
    // dictates: a string prints as itself, an integer prints whole, and a
    // non-integer prints to three decimal places.
    expect(lines.slice(0, 5)).toEqual([
      "phase: rally",
      "score: 0 - 0",
      `ball: ${ballLine(engine.state)}`,
      "speed: 6.708",
      "fps: 60",
    ]);

    // "Beneath the registered lines the overlay prints the engine's own metrics
    // line, the frame timings followed by the most recent frame's draw calls and
    // triangles, which come from the renderer." The scene holds one mesh, and a
    // sphere of 24 by 16 segments is 720 triangles.
    expect(lines).toHaveLength(6);
    const metrics = METRICS_LINE.exec(lines[5] ?? "");
    expect(metrics).not.toBeNull();
    expect(metrics?.[1]).toBe("1");
    expect(metrics?.[2]).toBe("720");

    // The key toggles both ways, and an auto-repeat is not a press.
    pressBackquote(target);
    pressBackquote(target, true);
    screen.forget();
    await engine.advance(1);
    expect(overlayLines(screen)).toEqual([]);
  });

  it("leaves the backtick key free of gameplay, so raising the panel changes nothing", async () => {
    // "This build binds no key of its own and leaves that key free of gameplay
    // bindings": the same sixty frames run with the panel raised and lowered
    // part-way through land on exactly the state the untouched run reaches.
    const watched = boot();
    const untouched = boot();
    await watched.engine.initialize();
    await untouched.engine.initialize();

    await watched.engine.advance(30);
    pressBackquote(watched.target);
    await watched.engine.advance(15);
    pressBackquote(watched.target);
    await watched.engine.advance(15);

    await untouched.engine.advance(60);

    expect(values(watched.engine)).toEqual(values(untouched.engine));
    expect(watched.engine.frame()).toEqual(untouched.engine.frame());
  });

  it("reports the state's position rather than the mesh's, whatever the picture does", async () => {
    const { engine } = boot();
    await engine.initialize();

    // Nothing is in the scene until a render runs: the mesh belongs to the
    // picture, and `initialize` builds only the state and the sources.
    expect(engine.scene.children).toHaveLength(0);

    await engine.advance(1);
    const ball = engine.scene.getObjectByName("ball");
    expect(ball).toBeInstanceOf(THREE.Mesh);
    // "built on the first render and found by name on every later one" — the
    // mesh and the light the first render added, and no second copy of either.
    expect(engine.scene.children).toHaveLength(2);

    await engine.advance(200);
    expect(engine.scene.getObjectByName("ball")).toBe(ball);
    expect(engine.scene.children).toHaveLength(2);
    // The transcribed render poses the camera every frame, so the picture is
    // looking at the field from where the page put the eye.
    expect(engine.camera.position.toArray()).toEqual([0, 12, 12]);

    // "The sources read the state alone ... so the overlay describes the
    // simulation whatever the picture is doing." Moving the mesh by hand moves
    // nothing the overlay reports.
    const reported = values(engine).ball;
    ball?.position.set(99, 99, 99);
    expect(values(engine).ball).toBe(reported);
    expect(reported).toBe(ballLine(engine.state));

    // And the next render puts the mesh back where the state says it stands.
    await engine.advance(1);
    expect(ball?.position.x).toBeCloseTo(engine.state.ball.x, 12);
    expect(ball?.position.y).toBe(BALL);
    expect(ball?.position.z).toBeCloseTo(engine.state.ball.z, 12);
  });

  it("names the phase and the score across a point, which is what the panel is for", async () => {
    const { engine, screen, target } = boot();
    await engine.initialize();
    pressBackquote(target);

    // The serve costs a second, and the ball then crosses the field at SPEED:
    // the left player takes the point on frame 136, which returns the game to a
    // serve with the board changed and the ball back at the origin.
    await engine.advance(135);
    expect(values(engine)).toMatchObject({ phase: "rally", score: "0 - 0" });

    screen.forget();
    await engine.advance(1);
    expect(overlayLines(screen).slice(0, 5)).toEqual([
      "phase: serve",
      "score: 1 - 0",
      "ball: 0.0, 0.0",
      // The serve is struck the other way, so the derived speed is unchanged.
      "speed: 6.708",
      "fps: 60",
    ]);
  });
});
