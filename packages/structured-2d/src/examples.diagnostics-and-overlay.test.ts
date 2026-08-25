import { afterEach, describe, expect, it } from "vitest";
import type { Engine, GameDefinition, InitApi, SurfaceMetrics } from "./index";
import {
  Actor,
  ConstantClock,
  createEngine,
  GameInstance,
  GameMode,
  ShapeComponent,
} from "./index";

/**
 * The documentation's "Diagnostics and Overlay" example, transcribed from
 * `engines/structured-2d/examples/diagnostics-and-overlay.md` and run against
 * the shipped engine.
 *
 * The example's modules are carried over verbatim below. Only what a test
 * environment forces is adapted, following the documented validation harness:
 * the canvas is a jsdom element whose 2D context is a recording stub, a
 * `SurfaceMetrics` supplies the measurements and the event target a browser
 * would, and frames are driven by `engine.advance` under a `ConstantClock`
 * rather than by `engine.run` off a host frame callback.
 */

/* -------------------------------------------------------------------------- */
/* The example, verbatim                                                      */
/* -------------------------------------------------------------------------- */

// src/instance.ts
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

// src/levels/patrol-mode.ts
const TAG = "drone";

class PatrolMode extends GameMode {
  private wave = 1;
  private pace = 61.75;

  override beginPlay(): void {
    const diagnostics = this.world.diagnostics;
    diagnostics.register("wave", () => this.wave);
    diagnostics.register("drones", () => this.world.byTag(TAG).length);
    diagnostics.register("lead", () => {
      const lead = this.world.byTag(TAG)[0];
      return lead === undefined
        ? null
        : { x: lead.transform.x, y: lead.transform.y };
    });
    diagnostics.register("pace", () => this.pace);

    this.world.every(6, () => {
      this.wave += 1;
      this.pace += 6.5;
    });
    this.setPhase("playing");
  }

  override tick(dt: number): void {
    for (const drone of this.world.byTag(TAG)) {
      drone.transform.x = (drone.transform.x + this.pace * dt) % 640;
    }
  }
}

// src/game.ts
const drones = Array.from({ length: 6 }, (_, i) => ({
  type: Actor,
  transform: { x: 40 + i * 96, y: 120 + (i % 3) * 60 },
  tags: [TAG],
  configure: (actor: Actor) => {
    actor.attach(
      new ShapeComponent({
        shape: { kind: "rect", width: 24, height: 12 },
        fill: "#7fd1ff",
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
/* The harness: the example's main.ts, adapted to the test environment        */
/* -------------------------------------------------------------------------- */

interface Example {
  engine: Engine<null>;
  /** The surface's event target, where a player's keyboard lands. */
  target: EventTarget;
  /** Every string `fillText` drew, in draw order. */
  texts: string[];
  /** Every `fillRect`, in draw order: the background, then the overlay's. */
  rects: { x: number; y: number; w: number; h: number }[];
  dispose(): void;
}

/**
 * A 2D context recording the text and rectangles a frame drew, over the
 * members the pipeline and the overlay touch.
 */
function recordingContext(
  canvas: HTMLCanvasElement,
  texts: string[],
  rects: { x: number; y: number; w: number; h: number }[],
): CanvasRenderingContext2D {
  const ctx: Record<string, unknown> = {
    canvas,
    fillStyle: "#000",
    strokeStyle: "#000",
    globalAlpha: 1,
    lineWidth: 1,
    font: "10px sans-serif",
    textBaseline: "",
    textAlign: "",
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    getLineDash: () => [],
    measureText: (text: string) => ({ width: text.length * 7 }) as TextMetrics,
    fillText: (text: string) => {
      texts.push(text);
    },
    fillRect: (x: number, y: number, w: number, h: number) => {
      rects.push({ x, y, w, h });
    },
  };
  for (const name of [
    "setTransform",
    "translate",
    "scale",
    "rotate",
    "clearRect",
    "strokeRect",
    "beginPath",
    "closePath",
    "rect",
    "arc",
    "moveTo",
    "lineTo",
    "fill",
    "stroke",
    "strokeText",
    "drawImage",
    "save",
    "restore",
  ]) {
    ctx[name] = (): void => undefined;
  }
  return ctx as unknown as CanvasRenderingContext2D;
}

const disposers: (() => void)[] = [];

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
});

/** Boots the example: the docs' `src/main.ts`, with the forced adaptations. */
function boot(): Example {
  const texts: string[] = [];
  const rects: { x: number; y: number; w: number; h: number }[] = [];

  const element = document.createElement("canvas");
  element.id = "game";
  element.getContext = ((): CanvasRenderingContext2D =>
    recordingContext(
      element,
      texts,
      rects,
    )) as unknown as typeof element.getContext;
  document.body.append(element);

  const canvas = document.querySelector<HTMLCanvasElement>("#game");
  if (canvas === null) throw new Error("missing canvas #game");

  // jsdom lays nothing out, so the measurements a browser would supply come
  // from an explicit surface, whose event target stands in for the document.
  const target = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => 640,
    cssHeight: () => 360,
    dpr: () => 1,
    events: () => target,
  };

  const engine = createEngine({
    canvas,
    width: 640,
    height: 360,
    background: "#05060a",
    game: patrol,
    clock: new ConstantClock(1000 / 60),
    surface,
  });

  const dispose = (): void => {
    engine.destroy();
    element.remove();
  };
  disposers.push(dispose);
  return { engine, target, texts, rects, dispose };
}

/** An unrepeated Backquote keydown, the documented overlay toggle. */
function pressBackquote(target: EventTarget, repeat = false): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { code: "Backquote", repeat }),
  );
}

/** The documented metrics line: mean / p95 / p99, integers whole and the rest to three places. */
const METRICS_LINE =
  /^frame: \d+(?:\.\d{3})? \/ \d+(?:\.\d{3})? \/ \d+(?:\.\d{3})? ms$/;

/* -------------------------------------------------------------------------- */
/* What the page narrates                                                     */
/* -------------------------------------------------------------------------- */

describe("examples: diagnostics and overlay", () => {
  it("registers every source at boot yet draws nothing while the overlay is hidden", async () => {
    const { engine, texts, rects } = boot();
    const instance = await engine.initialize();

    // The start level opened once before any frame, counted by `worldOpened`.
    expect(instance).toBeInstanceOf(PatrolInstance);
    if (!(instance instanceof PatrolInstance)) throw new Error("unreachable");
    expect(instance.opens).toBe(1);
    expect(engine.world.byTag(TAG)).toHaveLength(6);

    texts.length = 0;
    rects.length = 0;
    await engine.advance(1);

    // The frame drew: the background fill ran. The overlay did not: no text,
    // no panel, though all six sources are registered.
    expect(texts).toEqual([]);
    expect(rects).toHaveLength(1);
  });

  it("toggles on Backquote and draws the documented column, each shape formatted its way", async () => {
    const { engine, target, texts, rects } = boot();
    await engine.initialize();

    // Two firings of the six-second timer: wave 1 → 3, pace 61.75 → 74.75.
    await engine.advance(725);

    pressBackquote(target);
    texts.length = 0;
    rects.length = 0;
    await engine.advance(1);

    // The engine's world line first, the instance's sources, the world's,
    // then the metrics line — and each value formatted the documented way: a
    // string as itself, an integer whole, an object as JSON, a non-integer to
    // three decimal places.
    const [lead] = engine.world.byTag(TAG);
    expect(lead).toBeDefined();
    expect(texts.slice(0, 7)).toEqual([
      "level: patrol  phase: playing  actors: 6",
      "build: patrol 1.4.0",
      "opens: 1",
      "wave: 3",
      "drones: 6",
      `lead: ${JSON.stringify({ x: lead?.transform.x, y: lead?.transform.y })}`,
      "pace: 74.750",
    ]);
    expect(texts).toHaveLength(8);
    expect(texts[7]).toMatch(METRICS_LINE);

    // The frame-time graph sits beside the text: past the background fill and
    // the panel comes a plot area and one column per windowed sample.
    expect(rects.length).toBeGreaterThan(4);

    // Backquote toggles both ways, and a key repeat is not a press: the
    // overlay is engine chrome, not a registered action.
    pressBackquote(target);
    pressBackquote(target, true);
    texts.length = 0;
    await engine.advance(1);
    expect(texts).toEqual([]);
  });

  it("keeps the instance's sources across a transition while the world's are rebuilt", async () => {
    const { engine, target, texts } = boot();
    await engine.initialize();
    await engine.advance(30);
    pressBackquote(target);

    // The transition is honored at the end of the next frame; the frame after
    // it is the reopened world's first, so its overlay reads the fresh state.
    engine.world.open("patrol");
    await engine.advance(1);
    texts.length = 0;
    await engine.advance(1);

    const [lead] = engine.world.byTag(TAG);
    expect(lead).toBeDefined();
    expect(texts.slice(0, 7)).toEqual([
      "level: patrol  phase: playing  actors: 6",
      "build: patrol 1.4.0",
      // The instance's counter persisted and counted the reopen...
      "opens: 2",
      // ...while the mode's sources were dropped with the old world and
      // re-registered by the new one, so the match values start over.
      "wave: 1",
      "drones: 6",
      `lead: ${JSON.stringify({ x: lead?.transform.x, y: lead?.transform.y })}`,
      "pace: 61.750",
    ]);
    expect(texts[7]).toMatch(METRICS_LINE);
  });
});
