import { describe, expect, it } from "vitest";
import type { Engine, GameDefinition, SurfaceMetrics } from "./index";
import {
  Actor,
  ConstantClock,
  GameInstance,
  GameMode,
  JitterClock,
  SequenceClock,
  ShapeComponent,
  createEngine,
} from "./index";

/**
 * The documentation's worked example "A Minimal Game", transcribed and run.
 *
 * The docs promise the example's code works against the engine verbatim, so
 * the game-side modules below — `Drifter`, `DriftMode`, and the `drifter`
 * definition — are copied from the page unchanged, and the boot module is
 * followed line for line. Only what a test environment forces is adapted:
 *
 * - The page's `index.html` becomes jsdom markup, and jsdom performs no
 *   layout and supplies no 2D context, so the canvas found by the page's own
 *   `querySelector` is grafted a recording context and the engine is handed a
 *   `SurfaceMetrics` reporting the element's declared size.
 * - The page's `engine.run()` drives frames off the host's callback on a
 *   `WallClock`; a suite steps synchronously instead, with `engine.advance`
 *   over a clock that supplies its own deltas, exactly as the validator docs
 *   prescribe.
 *
 * The assertions are the outcomes the page narrates: what `initialize`
 * resolves having done, the plain `GameInstance` an instance-less definition
 * gets, the reflection off both walls, the step-size independence the
 * overshoot arithmetic buys, and the pipeline drawing the shape each frame.
 */

/* -------------------------------------------------------------------------- */
/* src/actors/drifter.ts — transcribed verbatim                               */
/* -------------------------------------------------------------------------- */

const BOX = 48;
const SPEED = 220;

class Drifter extends Actor {
  private vx = SPEED;

  constructor() {
    super();
    this.attach(
      new ShapeComponent({
        shape: { kind: "rect", width: BOX, height: BOX },
        fill: "#7fd1ff",
      }),
    );
  }

  override tick(dt: number): void {
    const half = BOX / 2;
    const limit = this.world.viewport().width - half;
    this.transform.x += this.vx * dt;

    if (this.transform.x < half) {
      this.transform.x = 2 * half - this.transform.x;
      this.vx = SPEED;
    } else if (this.transform.x > limit) {
      this.transform.x = 2 * limit - this.transform.x;
      this.vx = -SPEED;
    }
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
      actors: [{ type: Drifter, transform: { x: 320, y: 180 } }],
    },
  },
  startLevel: "drift",
};

/* -------------------------------------------------------------------------- */
/* index.html + src/main.ts — transcribed, with the forced adaptations        */
/* -------------------------------------------------------------------------- */

/**
 * Grafts a recording 2D context onto a real jsdom canvas element. jsdom's
 * `getContext("2d")` yields `null`, which `createEngine` rightly refuses, so
 * the element the page's markup declares is given the context a browser
 * would have given it. Every method call lands in the returned log.
 */
function graftContext(canvas: HTMLCanvasElement): string[] {
  const log: string[] = [];
  const method =
    (name: string) =>
    (...args: unknown[]): void => {
      log.push(`ctx:${name}(${args.map(String).join(",")})`);
    };
  const ctx: Record<string, unknown> = {
    canvas,
    fillStyle: "#000",
    strokeStyle: "#000",
    globalAlpha: 1,
    lineWidth: 1,
    font: "10px sans-serif",
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    getLineDash: () => [],
  };
  for (const name of [
    "setTransform",
    "translate",
    "scale",
    "rotate",
    "clearRect",
    "fillRect",
    "strokeRect",
    "beginPath",
    "closePath",
    "rect",
    "arc",
    "moveTo",
    "lineTo",
    "fill",
    "stroke",
    "fillText",
    "strokeText",
    "drawImage",
    "save",
    "restore",
  ]) {
    ctx[name] = method(name);
  }
  (canvas as { getContext: (kind: string) => unknown }).getContext = (
    kind: string,
  ): unknown => (kind === "2d" ? ctx : null);
  return log;
}

/** jsdom performs no layout, so the canvas's declared size is reported here. */
function pageSurface(): SurfaceMetrics {
  const target = new EventTarget();
  return {
    cssWidth: (): number => 640,
    cssHeight: (): number => 360,
    dpr: (): number => 1,
    events: (): EventTarget => target,
  };
}

/** The page's markup and boot module, adapted only as the header describes. */
function boot(clock = new ConstantClock(1000 / 60)): {
  engine: Engine;
  log: string[];
} {
  document.body.innerHTML =
    '<canvas id="game" style="display: block; width: 100vw; height: 100vh"></canvas>';

  const canvas = document.querySelector<HTMLCanvasElement>("#game");
  if (canvas === null) throw new Error("missing canvas #game");
  const log = graftContext(canvas);

  const engine = createEngine({
    canvas,
    width: 640,
    height: 360,
    background: "#05060a",
    game: drifter,
    clock,
    surface: pageSurface(),
  });
  return { engine, log };
}

/* -------------------------------------------------------------------------- */
/* The narrated outcomes                                                      */
/* -------------------------------------------------------------------------- */

/** The field bounds the page derives: half a box in from each wall. */
const HALF = BOX / 2;
const LIMIT = 640 - HALF;

/**
 * Where the drifter is after `t` seconds, from the page's own arithmetic:
 * uniform motion at `SPEED` from `x = 320`, folded back into `[HALF, LIMIT]`
 * at each wall. Reflecting the overshoot makes the per-frame stepping agree
 * with this continuous fold whatever the step size, which is the property the
 * page claims for it.
 */
function expectedX(t: number): number {
  const span = LIMIT - HALF;
  const raw = (320 - HALF + SPEED * t) % (2 * span);
  return HALF + (raw < span ? raw : 2 * span - raw);
}

/** Steps in whole frames until at least `ms` of simulated time has passed. */
async function advanceMs(engine: Engine, ms: number): Promise<void> {
  const until = engine.frame().timeMs + ms;
  while (engine.frame().timeMs < until) await engine.advance(1);
}

describe("examples/a-minimal-game", () => {
  it("initialize opens the start level with its actor and mode begun", async () => {
    const { engine } = boot();
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
    // The level's one actor sits where the definition placed it.
    expect(engine.world.actors()[0]?.transform.x).toBe(320);
    expect(engine.world.actors()[0]?.transform.y).toBe(180);
    engine.destroy();
  });

  it("builds a plain GameInstance for a definition naming no instance class", async () => {
    const { engine } = boot();
    await engine.initialize();

    // "The definition names no instance class, so the engine builds a plain
    // `GameInstance`" — the base class itself, whose `initialize` returns
    // `null`, which the engine hands back as the debug surface.
    expect(Object.getPrototypeOf(engine.instance)).toBe(GameInstance.prototype);
    expect(engine.debug).toBeNull();
    engine.destroy();
  });

  it("registers no action and loads no asset", async () => {
    const { engine } = boot();
    const assets: string[] = [];
    engine.events.on("asset:loaded", ({ path }) => assets.push(path));
    engine.events.on("asset:failed", ({ path }) => assets.push(path));

    await engine.initialize();
    await engine.advance(10);

    expect(assets).toEqual([]);
    engine.destroy();
  });

  it("world coordinates coincide with logical ones, so the bound is the design width", async () => {
    const { engine } = boot();
    await engine.initialize();

    // "The world's camera starts at the center of the design field at zoom 1
    // ... `world.viewport().width` is the design width the bound is measured
    // from."
    expect(engine.world.camera.x).toBe(320);
    expect(engine.world.camera.y).toBe(180);
    expect(engine.world.camera.zoom).toBe(1);
    expect(engine.world.viewport().width).toBe(640);
    engine.destroy();
  });

  it("drifts at SPEED and reflects the overshoot off both walls", async () => {
    const { engine } = boot();
    await engine.initialize();
    const [actor] = engine.world.actors();
    if (actor === undefined) throw new Error("missing drifter");

    // One second from the center: no wall reached yet.
    await engine.advance(60);
    expect(actor.transform.x).toBeCloseTo(320 + SPEED, 6);

    // The right wall is met at t ≈ 1.345s; by two seconds the drifter has
    // reflected and is heading back left, still inside the field.
    await engine.advance(60);
    expect(actor.transform.x).toBeCloseTo(expectedX(2), 6);
    const atTwo = actor.transform.x;
    await engine.advance(1);
    expect(actor.transform.x).toBeLessThan(atTwo);

    // The left wall is met at t ≈ 4.036s; by 4.2 seconds it has reflected
    // again and is heading right. Every frame on the way stays between the
    // bounds the page derives — half a box in from each wall.
    for (let frame = 121; frame < 252; frame += 1) {
      await engine.advance(1);
      expect(actor.transform.x).toBeGreaterThanOrEqual(HALF);
      expect(actor.transform.x).toBeLessThanOrEqual(LIMIT);
    }
    expect(engine.frame().count).toBe(252);
    expect(actor.transform.x).toBeCloseTo(expectedX(252 / 60), 6);
    const atSample = actor.transform.x;
    await engine.advance(1);
    expect(actor.transform.x).toBeGreaterThan(atSample);
    engine.destroy();
  });

  it("keeps the outcome the same whatever step size the clock delivers", async () => {
    // "`tick` multiplies by `dt` in seconds and reflects the overshoot back
    // into the field, which keeps the outcome the same whatever step size the
    // clock delivers." An even step, a repeating uneven pattern, and a seeded
    // draw all land on the fold of the same uniform motion.
    const clocks = [
      new ConstantClock(1000 / 60),
      new SequenceClock([8, 33, 12, 21]),
      new JitterClock(8, 40, 7),
    ];

    for (const clock of clocks) {
      const { engine } = boot(clock);
      await engine.initialize();
      const [actor] = engine.world.actors();
      if (actor === undefined) throw new Error("missing drifter");

      // Long enough to cross both walls, whatever the cadence.
      await advanceMs(engine, 4200);
      expect(actor.transform.x).toBeCloseTo(
        expectedX(engine.frame().timeMs / 1000),
        6,
      );
      engine.destroy();
    }
  });

  it("the pipeline draws the shape each frame over the cleared background", async () => {
    const { engine, log } = boot();
    await engine.initialize();

    // "Drawing belongs to the `ShapeComponent`, which the pipeline draws each
    // frame." A frame fills the background the options named, then traces the
    // rect centered on the component's transform — the position rides in the
    // path's own arguments, in world coordinates — and fills it. The drifter
    // moves each frame, so the count matches on the fixed size alone.
    const drawnRects = (): number =>
      log.filter(
        (entry) =>
          entry.startsWith("ctx:rect(") && entry.endsWith(`,${BOX},${BOX})`),
      ).length;
    log.length = 0;
    await engine.advance(1);
    expect(
      log.filter((entry) => entry.startsWith("ctx:fillRect")).length,
    ).toBeGreaterThanOrEqual(1);
    expect(drawnRects()).toBe(1);
    expect(log.filter((entry) => entry === "ctx:fill()").length).toBe(1);

    log.length = 0;
    await engine.advance(3);
    expect(drawnRects()).toBe(3);
    engine.destroy();
  });
});
