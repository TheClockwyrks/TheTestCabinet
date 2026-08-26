import { createCanvas } from "@test-cabinet/headless-webgl2";
import { afterEach, describe, expect, it } from "vitest";
import { Actor } from "./actors";
import type { SurfaceMetrics } from "./camera";
import { ConstantClock } from "./clocks";
import { ShapeComponent } from "./components";
import { createEngine, type Engine } from "./engine";
import {
  GameInstance,
  type GameDefinition,
  type InitApi,
} from "./game-instance";
import { GameMode } from "./game-mode";

/**
 * The documentation's worked example "Diagnostics and Overlay", transcribed
 * and run. The page's modules below — the instance, the game definition, and
 * `PatrolMode` — are copied from the page unchanged. Only what a test
 * environment forces is adapted:
 *
 * - The page's boot module finds a canvas in a document; here
 *   `@test-cabinet/headless-webgl2` makes one in process and the engine takes
 *   its measurements from an injected `SurfaceMetrics`, whose event target
 *   stands in for the document the toggle key would arrive at.
 * - Node has neither a document nor a 2D `OffscreenCanvas`, so the shipped
 *   overlay is inert there. Standing one up whose context logs its calls is
 *   what makes the panel readable at all; the engine draws exactly what it
 *   would draw in a browser, on its own surface above the rendering canvas.
 * - `engine.run()` becomes `engine.advance` under a `ConstantClock`, so the
 *   mode's six-second timer is a frame count.
 * - The page prints one moment of the panel, including a metrics line of real
 *   wall times. The figures a scenario fixes are asserted exactly; the metrics
 *   line is asserted against the formatting rule the page states for it.
 */

/* -------------------------------------------------------------------------- */
/* src/instance.ts — transcribed verbatim                                     */
/* -------------------------------------------------------------------------- */

const BUILD = "patrol 1.4.0";

class PatrolInstance extends GameInstance<null> {
  opens = 0;

  override initialize(api: InitApi): null {
    api.diagnostics.register("build", () => BUILD);
    api.diagnostics.register("opens", () => this.opens);
    return null;
  }

  override worldOpened(): void {
    this.opens += 1;
  }
}

/* -------------------------------------------------------------------------- */
/* src/levels/patrol-mode.ts — transcribed verbatim                           */
/* -------------------------------------------------------------------------- */

const TAG = "drone";
const EDGE = 12;

class PatrolMode extends GameMode {
  private wave = 1;
  private pace = 3.125;

  override beginPlay(): void {
    this.world.camera.position = { x: 0, y: 6, z: 18 };
    this.world.camera.lookAt({ x: 0, y: 2, z: 0 });

    const diagnostics = this.world.diagnostics;
    diagnostics.register("wave", () => this.wave);
    diagnostics.register("drones", () => this.world.byTag(TAG).length);
    diagnostics.register("lead", () => {
      const lead = this.world.byTag(TAG)[0];
      return lead === undefined ? null : { ...lead.transform.position };
    });
    diagnostics.register("pace", () => this.pace);

    this.world.every(6, () => {
      this.wave += 1;
      this.pace += 0.375;
    });
    this.setPhase("playing");
  }

  override tick(dt: number): void {
    for (const drone of this.world.byTag(TAG)) {
      const position = drone.transform.position;
      position.x += this.pace * dt;
      if (position.x > EDGE) position.x -= 2 * EDGE;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* src/game.ts — transcribed verbatim                                         */
/* -------------------------------------------------------------------------- */

const drones = Array.from({ length: 6 }, (_, i) => ({
  type: Actor,
  transform: {
    position: { x: -10 + i * 4, y: 1 + (i % 3) * 1.5, z: -(i % 2) * 3 },
  },
  tags: [TAG],
  configure: (actor: Actor) => {
    actor.attach(
      new ShapeComponent({
        shape: { kind: "box", size: { x: 1.6, y: 0.4, z: 0.8 } },
        color: "#7fd1ff",
      }),
    );
  },
}));

const patrol: GameDefinition<null> = {
  instance: PatrolInstance,
  levels: { patrol: { mode: PatrolMode, actors: drones } },
  startLevel: "patrol",
};

/* -------------------------------------------------------------------------- */
/* src/main.ts — transcribed, with the forced adaptations                     */
/* -------------------------------------------------------------------------- */

/** The size the page's canvas element is reported at; see the header. */
const CSS_WIDTH = 160;
const CSS_HEIGHT = 90;

interface Patrol {
  readonly engine: Engine<null>;
  readonly texts: string[];
  readonly rects: number;
  press(repeat?: boolean): void;
  dispose(): void;
}

const disposers: (() => void)[] = [];

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
});

/**
 * The engine, plus the overlay's own 2D surface as a log.
 *
 * The engine draws the panel on a surface it owns and composites above the
 * rendering canvas, so nothing of it enters the 3D picture or a recording;
 * standing that surface up is what a Node process has to do to read it.
 */
function boot(): Patrol {
  const texts: string[] = [];
  let rects = 0;
  const context = {
    save: () => undefined,
    restore: () => undefined,
    setTransform: () => undefined,
    clearRect: () => undefined,
    fillRect: () => {
      rects += 1;
    },
    fillText: (text: string) => texts.push(text),
    measureText: (text: string) => ({ width: text.length * 6 }),
    fillStyle: "",
    font: "",
    textAlign: "",
    textBaseline: "",
  };
  const previous = (globalThis as { OffscreenCanvas?: unknown })
    .OffscreenCanvas;
  (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class {
    width: number;
    height: number;

    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }

    getContext(): unknown {
      return context;
    }
  };

  const canvas = createCanvas(
    CSS_WIDTH,
    CSS_HEIGHT,
  ) as unknown as HTMLCanvasElement;
  const target = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => CSS_WIDTH,
    cssHeight: () => CSS_HEIGHT,
    dpr: () => 1,
    events: () => target,
  };

  const engine = createEngine<null>({
    canvas,
    width: 640,
    height: 360,
    background: "#05060a",
    game: patrol,
    clock: new ConstantClock(1000 / 60),
    surface,
  });

  const patrolGame: Patrol = {
    engine,
    texts,
    get rects(): number {
      return rects;
    },
    press: (repeat = false) => {
      target.dispatchEvent(
        Object.assign(new Event("keydown"), { code: "Backquote", repeat }),
      );
    },
    dispose: () => {
      engine.destroy();
      (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = previous;
    },
  };
  disposers.push(patrolGame.dispose);
  return patrolGame;
}

/** The documented metrics line: mean / p95 / p99, non-integers to three places. */
const METRICS_LINE =
  /^frame: \d+(?:\.\d{3})? \/ \d+(?:\.\d{3})? \/ \d+(?:\.\d{3})? ms$/;

/* -------------------------------------------------------------------------- */
/* The outcomes the page narrates                                             */
/* -------------------------------------------------------------------------- */

describe("examples/diagnostics-and-overlay", () => {
  it("registers every source at boot yet draws nothing while the overlay is hidden", async () => {
    const patrolGame = boot();
    const instance = await patrolGame.engine.initialize();

    // "`opens` counts them because `worldOpened` runs after each world's game
    // mode has begun play" — the start level opened once, before any frame.
    expect(instance).toBeInstanceOf(PatrolInstance);
    expect((instance as PatrolInstance).opens).toBe(1);
    // "Patrol offers no debug surface, so `initialize` returns `null`."
    expect(patrolGame.engine.debug).toBeNull();
    expect(patrolGame.engine.world.byTag(TAG)).toHaveLength(6);

    // "The overlay is hidden when the engine is created."
    patrolGame.texts.length = 0;
    await patrolGame.engine.advance(1);
    expect(patrolGame.texts).toEqual([]);
  });

  it("toggles on Backquote and draws the documented column, each shape formatted its way", async () => {
    const patrolGame = boot();
    const { engine } = patrolGame;
    await engine.initialize();

    // Two firings of the six-second timer: wave 1 → 3, pace 3.125 → 3.875.
    await engine.advance(725);

    patrolGame.press();
    patrolGame.texts.length = 0;
    await engine.advance(1);

    // "It draws the engine's own world line first, then the instance's
    // sources, then the world's, then a metrics line, then the frame-time
    // graph", and "a string prints as itself, an integer prints whole, a
    // non-integer prints to three decimal places, and an object prints as
    // JSON."
    const [lead] = engine.world.byTag(TAG);
    expect(lead).toBeDefined();
    expect(patrolGame.texts.slice(0, 7)).toEqual([
      "level: patrol  phase: playing  actors: 6",
      `build: ${BUILD}`,
      "opens: 1",
      "wave: 3",
      "drones: 6",
      `lead: ${JSON.stringify({ ...lead?.transform.position })}`,
      "pace: 3.875",
    ]);
    expect(patrolGame.texts).toHaveLength(8);
    expect(patrolGame.texts[7]).toMatch(METRICS_LINE);

    // "`lead` copies the position it reports, which keeps the reading plain
    // data rather than a live transform."
    expect(patrolGame.texts[5]).toMatch(/^lead: \{"x":-?\d/);

    // "The overlay is ... toggled by the `Backquote` key, which is engine
    // chrome rather than a registered action" — and a key repeat is not a
    // press.
    patrolGame.press();
    patrolGame.press(true);
    patrolGame.texts.length = 0;
    await engine.advance(1);
    expect(patrolGame.texts).toEqual([]);
  });

  it("reads what the game holds at that instant, every source on each read", async () => {
    const patrolGame = boot();
    const { engine } = patrolGame;
    await engine.initialize();
    patrolGame.press();

    await engine.advance(1);
    const first = patrolGame.texts.filter((line) => line.startsWith("lead: "));
    patrolGame.texts.length = 0;
    await engine.advance(1);
    const second = patrolGame.texts.filter((line) => line.startsWith("lead: "));

    // "Each one closes over the object that holds the value rather than over a
    // copy, and the engine evaluates every source on each read", so the moving
    // drone's line moves too.
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second[0]).not.toBe(first[0]);
    const [lead] = engine.world.byTag(TAG);
    expect(second[0]).toBe(
      `lead: ${JSON.stringify({ ...lead?.transform.position })}`,
    );
  });

  it("draws the frame-time graph beside the column, on its own surface", async () => {
    const patrolGame = boot();
    const { engine } = patrolGame;
    await engine.initialize();
    await engine.advance(4);

    const hidden = patrolGame.rects;
    patrolGame.press();
    await engine.advance(1);

    // "then the frame-time graph" — a plot area and one column per windowed
    // sample, all of it on the overlay's own surface. Nothing of it reaches
    // the recording: a frame the overlay drew over holds the same operations.
    expect(patrolGame.rects).toBeGreaterThan(hidden + 3);

    engine.startRecording();
    await engine.advance(1);
    const recording = engine.stopRecording();
    const methods = recording.frames[0]?.ops
      .map((op) => recording.ops[op])
      .map((op) => (op?.op === "call" ? op.method : "set"));
    expect(methods).not.toContain("drawHudText");
    expect(methods).not.toContain("drawHudRect");
  });

  it("keeps the instance's sources across a transition while the world's are rebuilt", async () => {
    const patrolGame = boot();
    const { engine } = patrolGame;
    await engine.initialize();
    await engine.advance(30);
    patrolGame.press();

    // The transition is honored at the end of the frame that requested it; the
    // frame after it is the reopened world's first, so its overlay reads the
    // fresh state.
    engine.world.open("patrol");
    await engine.advance(1);
    patrolGame.texts.length = 0;
    await engine.advance(1);

    // "these four are dropped when the world closes while the instance's two
    // persist."
    const [lead] = engine.world.byTag(TAG);
    expect(patrolGame.texts.slice(0, 7)).toEqual([
      "level: patrol  phase: playing  actors: 6",
      `build: ${BUILD}`,
      "opens: 2",
      "wave: 1",
      "drones: 6",
      `lead: ${JSON.stringify({ ...lead?.transform.position })}`,
      "pace: 3.125",
    ]);
    expect(patrolGame.texts[7]).toMatch(METRICS_LINE);
  });
});
