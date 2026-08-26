import { createCanvas } from "@test-cabinet/headless-webgl2";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Actor, Pawn } from "./actors";
import { ColliderComponent } from "./collision";
import {
  Component,
  DrawComponent,
  ShapeComponent,
  type DrawApi,
} from "./components";
import { PlayerController } from "./controllers";
import { ConstantClock, SequenceClock, type Clock } from "./clocks";
import type { SurfaceMetrics } from "./camera";
import {
  assembleEngine,
  createEngine,
  type Engine,
  type EngineHost,
  type EngineOptions,
} from "./engine";
import {
  GameInstance,
  type GameDefinition,
  type InitApi,
} from "./game-instance";
import { GameMode } from "./game-mode";
import type { LevelDefinition, World } from "./worlds";
import * as api from "./index";

/**
 * The engine assembled over the real subsystems, driven the way a validator
 * drives it: a `@test-cabinet/headless-webgl2` canvas, an injected
 * `SurfaceMetrics` over a bare `EventTarget`, a scripted clock, and
 * `engine.advance`. Nothing here is faked that the shipped engine would not
 * also be given — the one injection is the *host loop* (`raf`, `cancel`,
 * `now`), because a suite that raced a real frame callback would assert
 * timing instead of ordering.
 *
 * The boundary this suite keeps: it asserts what the engine module owns — the
 * construction refusals, the `initialize` gate, the eleven-step frame order
 * *as the loop schedules it*, `advance` and `run`, the recorder's engine
 * members, teardown, and the single broadcaster. What each step then does
 * belongs to the module that owns it and is asserted in that module's suite,
 * so a world's twelve-step transition, a collision manifold, or a recorded
 * op's encoding is not re-asserted here.
 */

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/** A small design size: every test renders real triangles, and these are cheap. */
const WIDTH = 64;
const HEIGHT = 36;

/** Every engine a test built, torn down after it whether or not it failed. */
const built: Engine<never>[] = [];

afterEach(() => {
  for (const engine of built) engine.destroy();
  built.length = 0;
});

/**
 * The host loop as a hand-drained queue.
 *
 * `now` advances only when a frame is delivered, so the frame-time samples and
 * the clock stamps a test sees are the ones it asked for rather than whatever
 * the machine was doing.
 */
function fakeHost(): {
  host: EngineHost;
  drain(frames?: number): void;
  pending(): number;
} {
  const queue = new Map<number, (t: number) => void>();
  let next = 1;
  let nowMs = 0;

  return {
    host: {
      raf: (cb) => {
        const handle = next;
        next += 1;
        queue.set(handle, cb);
        return handle;
      },
      cancel: (handle) => {
        queue.delete(handle);
      },
      now: () => nowMs,
    },
    drain(frames = 1): void {
      for (let i = 0; i < frames; i += 1) {
        const entry = queue.entries().next();
        if (entry.done === true) return;
        const [handle, cb] = entry.value;
        queue.delete(handle);
        nowMs += 16;
        cb(nowMs);
      }
    },
    pending: () => queue.size,
  };
}

/** A surface over a bare event target: the position a documentless canvas is in. */
function surfaceOver(target: EventTarget, dpr = 1): SurfaceMetrics {
  return {
    cssWidth: () => WIDTH,
    cssHeight: () => HEIGHT,
    dpr: () => dpr,
    events: () => target,
  };
}

/** A keyboard-shaped event the input registry and the overlay toggle both read. */
function keyEvent(type: string, code: string, repeat = false): Event {
  return Object.assign(new Event(type), { code, repeat });
}

/**
 * An engine over the real subsystems, with the host loop and the surface
 * handed back so a test can drive frames and dispatch keys at them.
 */
function makeEngine<D>(
  game: GameDefinition<D>,
  overrides: Partial<EngineOptions<D>> = {},
  host: EngineHost = fakeHost().host,
): {
  engine: Engine<D>;
  canvas: HTMLCanvasElement;
  target: EventTarget;
} {
  const canvas = createCanvas(WIDTH, HEIGHT) as unknown as HTMLCanvasElement;
  const target = new EventTarget();
  const engine = assembleEngine<D>(
    {
      canvas,
      width: WIDTH,
      height: HEIGHT,
      game,
      clock: new ConstantClock(16),
      surface: surfaceOver(target),
      ...overrides,
    },
    host,
  );
  built.push(engine as unknown as Engine<never>);
  return { engine, canvas, target };
}

/** The smallest game the engine will accept: one level, one bare mode. */
function bareGame(
  levels?: Readonly<Record<string, LevelDefinition>>,
): GameDefinition<null> {
  return {
    levels: levels ?? { title: { mode: GameMode } },
    startLevel: levels ? Object.keys(levels)[0]! : "title",
  };
}

/**
 * A 2D surface for the overlay to draw on.
 *
 * Node has neither a document nor a 2D `OffscreenCanvas`, so the shipped
 * overlay is inert there. Standing an `OffscreenCanvas` up whose context logs
 * its calls is what makes the toggle — engine chrome with no member on the
 * `Engine` interface — observable at all.
 */
function withOverlayStub(): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const context = {
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    setTransform: () => calls.push("setTransform"),
    clearRect: () => calls.push("clearRect"),
    fillRect: () => calls.push("fillRect"),
    fillText: (text: string) => calls.push(`fillText(${text})`),
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
  return {
    calls,
    restore: () => {
      (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = previous;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Construction                                                               */
/* -------------------------------------------------------------------------- */

describe("createEngine", () => {
  it("refuses a design size that is not finite and positive, naming the size", () => {
    const canvas = createCanvas(WIDTH, HEIGHT) as unknown as HTMLCanvasElement;
    const options = {
      canvas,
      width: WIDTH,
      height: 0,
      game: bareGame(),
      surface: surfaceOver(new EventTarget()),
    };
    expect(() => createEngine(options)).toThrow(Error);
    expect(() => createEngine(options)).toThrow(/64x0/);
    expect(() =>
      createEngine({ ...options, height: HEIGHT, width: Number.NaN }),
    ).toThrow(/NaNx36/);
  });

  it("refuses a canvas that yields no WebGL2 context", () => {
    const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() =>
      createEngine({
        canvas,
        width: WIDTH,
        height: HEIGHT,
        game: bareGame(),
        surface: surfaceOver(new EventTarget()),
      }),
    ).toThrow(/WebGL2/);
  });

  it("refuses a layout outside TOUCH_LAYOUTS, naming every valid layout", () => {
    const canvas = createCanvas(WIDTH, HEIGHT) as unknown as HTMLCanvasElement;
    const build = (): Engine<null> =>
      createEngine({
        canvas,
        width: WIDTH,
        height: HEIGHT,
        game: bareGame(),
        surface: surfaceOver(new EventTarget()),
        layout: "twin-stick",
      });
    expect(build).toThrow(Error);
    expect(build).toThrow(/"stick-move"/);
    expect(build).toThrow(/"wheel-pedals"/);
  });

  it("accepts a layout the catalogue holds, and hands it to the game", async () => {
    const seen: (string | null)[] = [];

    class Reading extends GameInstance<null> {
      override initialize(init: InitApi): null {
        seen.push(init.input.layout()?.name ?? null);
        return null;
      }
    }

    const { engine } = makeEngine(
      { ...bareGame(), instance: Reading },
      { layout: "stick-move" },
    );
    await engine.initialize();
    expect(seen).toEqual(["stick-move"]);
  });

  it("refuses a game definition whose levels has no entries", () => {
    const canvas = createCanvas(WIDTH, HEIGHT) as unknown as HTMLCanvasElement;
    expect(() =>
      createEngine({
        canvas,
        width: WIDTH,
        height: HEIGHT,
        game: { levels: {}, startLevel: "title" },
        surface: surfaceOver(new EventTarget()),
      }),
    ).toThrow(/at least one level/);
  });

  it("refuses a startLevel naming no entry, naming the registered levels", () => {
    const canvas = createCanvas(WIDTH, HEIGHT) as unknown as HTMLCanvasElement;
    const build = (): Engine<null> =>
      createEngine({
        canvas,
        width: WIDTH,
        height: HEIGHT,
        game: { levels: { title: { mode: GameMode } }, startLevel: "arena" },
        surface: surfaceOver(new EventTarget()),
      });
    expect(build).toThrow(/startLevel "arena"/);
    expect(build).toThrow(/"title"/);
  });

  it("runs no game code and loads nothing", () => {
    const ran: string[] = [];

    class Watching extends GameInstance<null> {
      constructor() {
        super();
        ran.push("constructed");
      }

      override initialize(): null {
        ran.push("initialize");
        return null;
      }
    }

    makeEngine({
      instance: Watching,
      startLevel: "title",
      levels: {
        title: {
          mode: GameMode,
          load: () => {
            ran.push("load");
          },
        },
      },
    });
    expect(ran).toEqual([]);
  });

  it("is subscribable and has its renderer from the moment it exists", () => {
    const { engine } = makeEngine(bareGame());
    expect(typeof engine.events.on).toBe("function");
    expect(engine.renderer.mode()).toBe("standard");
    expect(engine.renderer.collisionOverlay()).toBe(false);
    // The fit is taken once up front, so a caller reads a real one before the
    // first frame rather than a zero one.
    expect(engine.viewport()).toEqual({
      width: WIDTH,
      height: HEIGHT,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* The initialize gate                                                        */
/* -------------------------------------------------------------------------- */

describe("initialize", () => {
  it("refuses every gated read and call before it resolves, naming the ordering", () => {
    const { engine } = makeEngine(bareGame());
    expect(() => engine.world).toThrow(
      /engine\.world was reached before initialize/,
    );
    expect(() => engine.instance).toThrow(
      /engine\.instance was reached before initialize/,
    );
    expect(() => engine.debug).toThrow(
      /engine\.debug was reached before initialize/,
    );
    expect(() => engine.run()).toThrow(
      /engine\.run was reached before initialize/,
    );
    expect(() => engine.advance(1)).toThrow(
      /engine\.advance was reached before initialize/,
    );
  });

  it("resolves to an instance whose start level is open with its play begun", async () => {
    const log: string[] = [];

    class Begun extends Actor {
      override beginPlay(): void {
        log.push("actor.beginPlay");
      }
    }

    class Opening extends GameMode {
      override beginPlay(): void {
        log.push("mode.beginPlay");
      }
    }

    const { engine } = makeEngine({
      startLevel: "arena",
      levels: {
        arena: {
          mode: Opening,
          actors: [{ type: Begun }],
          load: async () => {
            log.push("load");
            await Promise.resolve();
          },
        },
      },
    });

    const instance = await engine.initialize();
    expect(instance).toBeInstanceOf(GameInstance);
    expect(engine.instance).toBe(instance);
    expect(engine.world.level).toBe("arena");
    expect(log).toEqual(["load", "actor.beginPlay", "mode.beginPlay"]);
  });

  it("resolves to the instance already built on a second call, declaring nothing twice", async () => {
    let initializations = 0;

    class Counting extends GameInstance<null> {
      override initialize(): null {
        initializations += 1;
        return null;
      }
    }

    const { engine } = makeEngine({ ...bareGame(), instance: Counting });
    const first = await engine.initialize();
    const second = await engine.initialize();
    expect(second).toBe(first);
    expect(initializations).toBe(1);
  });

  it("rejects with the cause when the instance's initialize throws", async () => {
    class Failing extends GameInstance<null> {
      override initialize(): null {
        throw new Error("no save slot");
      }
    }

    const { engine } = makeEngine({ ...bareGame(), instance: Failing });
    await expect(engine.initialize()).rejects.toThrow("no save slot");
  });

  it("rejects with the cause when a level's load throws", async () => {
    const { engine } = makeEngine({
      startLevel: "arena",
      levels: {
        arena: {
          mode: GameMode,
          load: () => Promise.reject(new Error("mesh missing")),
        },
      },
    });
    await expect(engine.initialize()).rejects.toThrow("mesh missing");
  });

  it("rejects with the cause when an actor's beginPlay throws", async () => {
    class Broken extends Actor {
      override beginPlay(): void {
        throw new Error("bad spawn point");
      }
    }

    const { engine } = makeEngine({
      startLevel: "arena",
      levels: { arena: { mode: GameMode, actors: [{ type: Broken }] } },
    });
    await expect(engine.initialize()).rejects.toThrow("bad spawn point");
  });

  it("rejects naming the debug surface when initialize returns undefined", async () => {
    class Forgetful extends GameInstance<null> {
      override initialize(): null {
        return undefined as unknown as null;
      }
    }

    const { engine } = makeEngine({ ...bareGame(), instance: Forgetful });
    await expect(engine.initialize()).rejects.toThrow(/debug surface/);
  });

  it("holds a null debug surface as the value it is, not as an absence", async () => {
    const { engine } = makeEngine(bareGame());
    await engine.initialize();
    expect(engine.debug).toBeNull();
  });

  it("hands back whatever surface the instance returned, unchanged", async () => {
    const surface = { startMatch: (): string => "versus" };

    class Posed extends GameInstance<typeof surface> {
      override initialize(): typeof surface {
        return surface;
      }
    }

    const { engine } = makeEngine<typeof surface>({
      instance: Posed,
      startLevel: "title",
      levels: { title: { mode: GameMode } },
    });
    await engine.initialize();
    expect(engine.debug).toBe(surface);
    expect(engine.debug.startMatch()).toBe("versus");
  });

  it("awaits a promised debug surface before the start level opens", async () => {
    const log: string[] = [];

    class Slow extends GameInstance<null> {
      override async initialize(): Promise<null> {
        await Promise.resolve();
        log.push("instance.initialize");
        return null;
      }
    }

    const { engine } = makeEngine({
      instance: Slow,
      startLevel: "title",
      levels: {
        title: {
          mode: GameMode,
          load: () => {
            log.push("load");
          },
        },
      },
    });
    await engine.initialize();
    expect(log).toEqual(["instance.initialize", "load"]);
  });

  it("lets a subscription made before it observe the start level being built", async () => {
    const { engine } = makeEngine(bareGame());
    const seen: string[] = [];
    engine.events.on("world:opening", (event) =>
      seen.push(`opening ${String(event.from)}->${event.to}`),
    );
    engine.events.on("world:opened", (event) =>
      seen.push(`opened ${event.level}`),
    );

    await engine.initialize();
    expect(seen).toEqual(["opening null->title", "opened title"]);
  });

  it("runs no frame before it resolves", async () => {
    let duringLoad: number | null = null;
    const { engine } = makeEngine({
      startLevel: "arena",
      levels: {
        arena: {
          mode: GameMode,
          load: async () => {
            duringLoad = engine.frame().count;
            await Promise.resolve();
          },
        },
      },
    });
    await engine.initialize();
    expect(duringLoad).toBe(0);
    expect(engine.frame().count).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* advance                                                                    */
/* -------------------------------------------------------------------------- */

describe("advance", () => {
  it("turns each tick a clock accepts into exactly one frame", async () => {
    const { engine } = makeEngine(bareGame());
    await engine.initialize();
    await engine.advance(3);
    expect(engine.frame()).toEqual({ count: 3, timeMs: 48, lastDeltaMs: 16 });
  });

  it("runs nothing for a count of zero", async () => {
    const { engine } = makeEngine(bareGame());
    await engine.initialize();
    await engine.advance(0);
    expect(engine.frame().count).toBe(0);
  });

  it("refuses a count that is not a whole, non-negative number, naming the value", async () => {
    const { engine } = makeEngine(bareGame());
    await engine.initialize();
    expect(() => engine.advance(-1)).toThrow(RangeError);
    expect(() => engine.advance(-1)).toThrow(/got -1/);
    expect(() => engine.advance(1.5)).toThrow(/got 1.5/);
    expect(() => engine.advance(Number.NaN)).toThrow(/got NaN/);
  });

  it("runs no frame for a tick the clock declines", async () => {
    /** A clock that declines every tick: the pacing case, stripped to its edge. */
    class SilentClock implements Clock {
      delta(): number | null {
        return null;
      }
    }

    const { engine } = makeEngine(bareGame(), { clock: new SilentClock() });
    await engine.initialize();
    await engine.advance(5);
    expect(engine.frame()).toEqual({ count: 0, timeMs: 0, lastDeltaMs: 0 });
  });

  it("steps the deltas the clock supplies, in order", async () => {
    const { engine } = makeEngine(bareGame(), {
      clock: new SequenceClock([10, 20, 30]),
    });
    await engine.initialize();
    await engine.advance(4);
    // The sequence repeats, so the fourth frame is worth the first step again.
    expect(engine.frame()).toEqual({ count: 4, timeMs: 70, lastDeltaMs: 10 });
  });

  it("rejects and abandons the remaining frames when a tick throws", async () => {
    let ticks = 0;

    class Exploding extends GameMode {
      override tick(): void {
        ticks += 1;
        if (ticks === 2) throw new Error("bad rule");
      }
    }

    const { engine } = makeEngine({
      startLevel: "arena",
      levels: { arena: { mode: Exploding } },
    });
    await engine.initialize();
    await expect(engine.advance(5)).rejects.toThrow("bad rule");
    expect(ticks).toBe(2);
    expect(engine.frame().count).toBe(2);
  });

  it("awaits a transition a frame requested before the next frame begins", async () => {
    const log: string[] = [];

    class Leaving extends GameMode {
      override tick(): void {
        log.push(`tick ${this.world.level}`);
        if (this.world.level === "title") this.world.open("arena");
      }
    }

    const { engine } = makeEngine({
      startLevel: "title",
      levels: {
        title: { mode: Leaving },
        arena: {
          mode: Leaving,
          load: async () => {
            log.push("load arena");
            await Promise.resolve();
          },
        },
      },
    });
    await engine.initialize();
    await engine.advance(3);
    expect(log).toEqual([
      "tick title",
      "load arena",
      "tick arena",
      "tick arena",
    ]);
    expect(engine.world.level).toBe("arena");
  });
});

/* -------------------------------------------------------------------------- */
/* The frame                                                                  */
/* -------------------------------------------------------------------------- */

describe("the frame", () => {
  it("runs its eleven steps in the documented order", async () => {
    const log: string[] = [];

    /** The controller step, and the reader the input frame closes behind. */
    class Driver extends PlayerController {
      override tick(): void {
        log.push(`controller(fire=${String(this.input.pressed("fire"))})`);
      }
    }

    class Ticking extends Component {
      override tick(): void {
        log.push("component");
      }
    }

    class Painter extends DrawComponent {
      override draw(_api: DrawApi): void {
        log.push("render");
      }
    }

    class Probe extends Actor {
      override beginPlay(): void {
        this.attach(new Ticking());
        this.attach(new Painter());
      }

      override tick(): void {
        log.push("actor");
      }
    }

    /** Two blocking colliders on top of each other: one `hit` per frame. */
    class Blocker extends Actor {
      override beginPlay(): void {
        this.attach(
          new ColliderComponent({
            shape: { kind: "sphere", radius: 1 },
            responses: { default: "block" },
          }),
        );
      }
    }

    class Ordered extends GameMode {
      override beginPlay(): void {
        this.addPlayer({ controller: Driver, pawn: null });
        this.world.after(0.001, () => log.push("timer"));
      }

      override tick(): void {
        log.push("mode");
      }
    }

    class Fires extends GameInstance<null> {
      override initialize(init: InitApi): null {
        init.input.register("fire", { keys: ["KeyF"] });
        return null;
      }
    }

    const { engine, target } = makeEngine({
      instance: Fires,
      startLevel: "arena",
      levels: {
        arena: {
          mode: Ordered,
          actors: [{ type: Probe }, { type: Blocker }, { type: Blocker }],
        },
      },
    });

    await engine.initialize();
    engine.events.on("hit", () => log.push("collision"));
    target.dispatchEvent(keyEvent("keydown", "KeyF"));

    await engine.advance(1);
    expect(log).toEqual([
      "controller(fire=true)",
      "actor",
      "component",
      "timer",
      "collision",
      "mode",
      "render",
    ]);

    // Step 11 closed the input frame, so the press is news for exactly one
    // frame: the second frame's controller sees it gone.
    log.length = 0;
    await engine.advance(1);
    expect(log[0]).toBe("controller(fire=false)");
  });

  it("skips the simulation steps while the world is paused, and still renders and closes input", async () => {
    const log: string[] = [];

    class Painter extends DrawComponent {
      override draw(): void {
        log.push("render");
      }
    }

    class Sleeper extends Actor {
      override beginPlay(): void {
        this.attach(new Painter());
      }

      override tick(): void {
        log.push("actor");
      }
    }

    class Waking extends Sleeper {
      constructor() {
        super();
        this.tickWhenPaused = true;
      }

      override tick(): void {
        log.push("wakeful");
      }
    }

    class Paused extends GameMode {
      override beginPlay(): void {
        this.world.setPaused(true);
      }

      override tick(): void {
        log.push("mode");
      }
    }

    const { engine } = makeEngine({
      startLevel: "arena",
      levels: {
        arena: { mode: Paused, actors: [{ type: Sleeper }, { type: Waking }] },
      },
    });
    await engine.initialize();
    await engine.advance(1);

    expect(log).toEqual(["wakeful", "render", "render"]);
    // The frame counter belongs to the loop, not to the world, so a paused
    // world still advances it.
    expect(engine.frame().count).toBe(1);
    expect(engine.world.time).toBe(0);
  });

  it("renders the world a transition opened, in the frame that performed it", async () => {
    const drawn: string[] = [];

    class Painter extends DrawComponent {
      constructor(private readonly label: string) {
        super();
      }

      override draw(): void {
        drawn.push(this.label);
      }
    }

    class Marked extends Actor {
      label = "?";

      override beginPlay(): void {
        this.attach(new Painter(this.label));
      }
    }

    class Leaving extends GameMode {
      override tick(): void {
        if (this.world.level === "title") this.world.open("arena");
      }
    }

    const level = (label: string): LevelDefinition => ({
      mode: Leaving,
      actors: [
        {
          type: Marked,
          configure: (actor) => {
            (actor as Marked).label = label;
          },
        },
      ],
    });

    const { engine } = makeEngine({
      startLevel: "title",
      levels: { title: level("title"), arena: level("arena") },
    });
    await engine.initialize();
    await engine.advance(1);
    expect(drawn).toEqual(["arena"]);
  });

  it("recomputes the fit before any game code runs, so a tick reads the frame it renders through", async () => {
    const seen: number[] = [];
    let dpr = 1;
    const canvas = createCanvas(WIDTH, HEIGHT) as unknown as HTMLCanvasElement;
    const target = new EventTarget();

    class Watching extends GameMode {
      override tick(): void {
        seen.push(this.world.viewport().scale);
      }
    }

    const engine = assembleEngine(
      {
        canvas,
        width: WIDTH,
        height: HEIGHT,
        game: { startLevel: "arena", levels: { arena: { mode: Watching } } },
        clock: new ConstantClock(16),
        surface: {
          cssWidth: () => WIDTH,
          cssHeight: () => HEIGHT,
          dpr: () => dpr,
          events: () => target,
        },
      },
      fakeHost().host,
    );
    built.push(engine as unknown as Engine<never>);

    await engine.initialize();
    await engine.advance(1);
    dpr = 2;
    await engine.advance(1);

    expect(seen).toEqual([1, 2]);
    expect(engine.viewport().scale).toBe(2);
    expect(canvas.width).toBe(WIDTH * 2);
  });

  it("hands out the fit as a copy, so holding one observes no later frame", async () => {
    const { engine } = makeEngine(bareGame());
    await engine.initialize();
    const held = engine.viewport();
    held.scale = 99;
    expect(engine.viewport().scale).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* run and the host loop                                                      */
/* -------------------------------------------------------------------------- */

describe("run", () => {
  it("drives one frame per host callback and keeps the loop armed", async () => {
    const loop = fakeHost();
    const { engine } = makeEngine(bareGame(), {}, loop.host);
    await engine.initialize();

    void engine.run();
    expect(loop.pending()).toBe(1);
    loop.drain(3);
    expect(engine.frame().count).toBe(3);
    expect(loop.pending()).toBe(1);
  });

  it("resolves when the signal aborts, and leaves the engine usable", async () => {
    const loop = fakeHost();
    const { engine } = makeEngine(bareGame(), {}, loop.host);
    await engine.initialize();

    const controller = new AbortController();
    const running = engine.run({ signal: controller.signal });
    loop.drain(2);
    controller.abort();
    await expect(running).resolves.toBeUndefined();
    expect(loop.pending()).toBe(0);

    // Aborting halts the loop; it does not tear the engine down.
    await engine.advance(1);
    expect(engine.frame().count).toBe(3);
  });

  it("resolves at once for a signal that has already aborted", async () => {
    const loop = fakeHost();
    const { engine } = makeEngine(bareGame(), {}, loop.host);
    await engine.initialize();
    await expect(
      engine.run({ signal: AbortSignal.abort() }),
    ).resolves.toBeUndefined();
    expect(loop.pending()).toBe(0);
  });

  it("shares one promise and one pump between concurrent calls", async () => {
    const loop = fakeHost();
    const { engine } = makeEngine(bareGame(), {}, loop.host);
    await engine.initialize();

    const first = engine.run();
    const second = engine.run();
    expect(loop.pending()).toBe(1);
    loop.drain(1);
    // One pump, so one frame per callback rather than two.
    expect(engine.frame().count).toBe(1);

    engine.destroy();
    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ]);
  });

  it("runs no frame while a transition is in flight, and keeps the canvas as it was", async () => {
    const loop = fakeHost();
    // Held on an object so the assignment inside the executor is not narrowed
    // away: control-flow analysis cannot see that the executor runs.
    const gate: { release: (() => void) | null } = { release: null };

    class Leaving extends GameMode {
      override tick(): void {
        if (this.world.level === "title") this.world.open("arena");
      }
    }

    const { engine } = makeEngine(
      {
        startLevel: "title",
        levels: {
          title: { mode: Leaving },
          arena: {
            mode: GameMode,
            load: () =>
              new Promise<void>((resolve) => {
                gate.release = resolve;
              }),
          },
        },
      },
      {},
      loop.host,
    );
    await engine.initialize();
    void engine.run();

    loop.drain(1);
    expect(engine.frame().count).toBe(1);
    // The transition has not settled, so the next callbacks re-arm without
    // consulting the clock.
    loop.drain(3);
    expect(engine.frame().count).toBe(1);

    gate.release?.();
    // A macrotask, so every link of the transition's promise chain — the
    // load, the render that follows it, and the loop's own hold — has run.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    loop.drain(1);
    expect(engine.frame().count).toBe(2);
    expect(engine.world.level).toBe("arena");
  });
});

/* -------------------------------------------------------------------------- */
/* setClock                                                                   */
/* -------------------------------------------------------------------------- */

describe("setClock", () => {
  it("takes effect on the next frame and carries the counters over", async () => {
    const { engine } = makeEngine(bareGame());
    await engine.initialize();
    await engine.advance(2);
    engine.setClock(new ConstantClock(4));
    await engine.advance(1);
    expect(engine.frame()).toEqual({ count: 3, timeMs: 36, lastDeltaMs: 4 });
  });
});

/* -------------------------------------------------------------------------- */
/* Recording                                                                  */
/* -------------------------------------------------------------------------- */

describe("the recorder's engine members", () => {
  it("captures whole frames from the one after it was armed", async () => {
    const { engine } = makeEngine(bareGame(), { background: "#101018" });
    await engine.initialize();

    expect(engine.recording()).toBe(false);
    await engine.advance(1);
    engine.startRecording();
    expect(engine.recording()).toBe(true);
    await engine.advance(2);
    const recording = engine.stopRecording();

    expect(engine.recording()).toBe(false);
    expect(recording.format).toBe(api.RECORDING_FORMAT);
    expect(recording.space).toBe("3d");
    // Fixed at arm time from the engine's own options, not read back off the
    // canvas at close.
    expect(recording.width).toBe(WIDTH);
    expect(recording.height).toBe(HEIGHT);
    expect(recording.background).toBe("#101018");
    expect(recording.frames.map((frame) => frame.count)).toEqual([2, 3]);
    expect(recording.frames[0]?.surface).toEqual({
      width: WIDTH,
      height: HEIGHT,
    });
  });

  it("refuses an unbalanced call, naming it", async () => {
    const { engine } = makeEngine(bareGame());
    await engine.initialize();
    expect(() => engine.stopRecording()).toThrow(/stopRecording/);
    engine.startRecording();
    expect(() => engine.startRecording()).toThrow(/startRecording/);
    engine.stopRecording();
  });

  it("carries the frame's own figures exactly", async () => {
    const { engine } = makeEngine(bareGame(), {
      clock: new SequenceClock([10, 20]),
    });
    await engine.initialize();
    engine.startRecording();
    await engine.advance(2);
    const recording = engine.stopRecording();
    expect(
      recording.frames.map((frame) => [frame.timeMs, frame.deltaMs]),
    ).toEqual([
      [10, 10],
      [30, 20],
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* The broadcaster                                                            */
/* -------------------------------------------------------------------------- */

describe("engine.events", () => {
  it("is the same broadcaster the world and the init api hand out", async () => {
    let fromInit: unknown = null;

    class Reading extends GameInstance<null> {
      override initialize(init: InitApi): null {
        fromInit = init.events;
        return null;
      }
    }

    const { engine } = makeEngine({ ...bareGame(), instance: Reading });
    await engine.initialize();
    expect(fromInit).toBe(engine.events);
    expect(engine.world.events).toBe(engine.events);
    expect(engine.instance.events).toBe(engine.events);
  });

  it("delivers synchronously, in subscription order, and returns an idempotent unsubscriber", async () => {
    const { engine } = makeEngine(bareGame());
    const seen: string[] = [];
    const off = engine.events.on("world:opened", () => seen.push("first"));
    engine.events.on("world:opened", () => seen.push("second"));

    await engine.initialize();
    expect(seen).toEqual(["first", "second"]);

    off();
    off();
    seen.length = 0;
    engine.world.open("title");
    await engine.advance(1);
    expect(seen).toEqual(["second"]);
  });

  it("contains a throwing handler and still runs the rest", async () => {
    const reported = vi.spyOn(console, "error").mockImplementation(() => {});
    const { engine } = makeEngine(bareGame());
    const seen: string[] = [];
    engine.events.on("world:opened", () => {
      throw new Error("subscriber bug");
    });
    engine.events.on("world:opened", () => seen.push("still ran"));

    await engine.initialize();
    expect(seen).toEqual(["still ran"]);
    expect(reported).toHaveBeenCalledWith(
      'structured-3d: an "world:opened" handler threw',
      expect.any(Error),
    );
    reported.mockRestore();
  });

  it("carries the subsystems' own events on the same stream", async () => {
    const seen: string[] = [];

    class Sounding extends GameInstance<null> {
      override initialize(init: InitApi): null {
        init.audio.define("score", { freq: 660, durationMs: 90 });
        return null;
      }
    }

    class Scoring extends GameMode {
      override beginPlay(): void {
        this.world.audio.play("score");
      }
    }

    const { engine, target } = makeEngine({
      instance: Sounding,
      startLevel: "arena",
      levels: { arena: { mode: Scoring } },
    });
    engine.events.on("cue:played", (event) =>
      seen.push(`cue ${event.cue} @${event.t}`),
    );
    engine.events.on("audio:unlocked", () => seen.push("unlocked"));

    await engine.initialize();
    // Before any frame ran, so the sum of the deltas — and the cue's `t` — is 0.
    expect(seen).toEqual(["cue score @0"]);

    target.dispatchEvent(keyEvent("keydown", "KeyZ"));
    expect(seen).toContain("unlocked");
  });
});

/* -------------------------------------------------------------------------- */
/* The overlay toggle                                                         */
/* -------------------------------------------------------------------------- */

describe("the diagnostics overlay", () => {
  it("starts hidden, and Backquote shows it and hides it again", async () => {
    const overlay = withOverlayStub();
    try {
      const { engine, target } = makeEngine(bareGame());
      await engine.initialize();

      await engine.advance(1);
      // Hidden: the surface is still synced every frame, so a panel switched
      // off leaves no ghost behind, but nothing is lettered.
      expect(
        overlay.calls.filter((call) => call.startsWith("fillText")),
      ).toEqual([]);

      target.dispatchEvent(keyEvent("keydown", "Backquote"));
      await engine.advance(1);
      expect(
        overlay.calls.some((call) => call.startsWith("fillText(level: title")),
      ).toBe(true);

      overlay.calls.length = 0;
      target.dispatchEvent(keyEvent("keydown", "Backquote"));
      await engine.advance(1);
      expect(
        overlay.calls.filter((call) => call.startsWith("fillText")),
      ).toEqual([]);
    } finally {
      overlay.restore();
    }
  });

  it("ignores an auto-repeat, so holding the key does not strobe the panel", async () => {
    const overlay = withOverlayStub();
    try {
      const { engine, target } = makeEngine(bareGame());
      await engine.initialize();
      target.dispatchEvent(keyEvent("keydown", "Backquote", true));
      await engine.advance(1);
      expect(
        overlay.calls.filter((call) => call.startsWith("fillText")),
      ).toEqual([]);
    } finally {
      overlay.restore();
    }
  });

  it("is inert where no 2D surface can be made, and the frame runs anyway", async () => {
    const { engine, target } = makeEngine(bareGame());
    await engine.initialize();
    target.dispatchEvent(keyEvent("keydown", "Backquote"));
    await expect(engine.advance(2)).resolves.toBeUndefined();
    expect(engine.frame().count).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */
/* destroy                                                                    */
/* -------------------------------------------------------------------------- */

describe("destroy", () => {
  it("closes the world, runs shutdown, and is idempotent", async () => {
    const log: string[] = [];

    class Reporting extends GameInstance<null> {
      override shutdown(): void {
        log.push("shutdown");
      }
    }

    class Ending extends GameMode {
      override endPlay(reason: string): void {
        log.push(`mode.end(${reason})`);
      }
    }

    class Leaving extends Actor {
      override endPlay(reason: string): void {
        log.push(`actor.end(${reason})`);
      }
    }

    const { engine } = makeEngine({
      instance: Reporting,
      startLevel: "arena",
      levels: { arena: { mode: Ending, actors: [{ type: Leaving }] } },
    });
    await engine.initialize();

    engine.destroy();
    engine.destroy();
    expect(log).toEqual([
      "actor.end(level-closed)",
      "mode.end(level-closed)",
      "shutdown",
    ]);
  });

  it("resolves the promise run returned", async () => {
    const loop = fakeHost();
    const { engine } = makeEngine(bareGame(), {}, loop.host);
    await engine.initialize();
    const running = engine.run();
    loop.drain(1);
    engine.destroy();
    await expect(running).resolves.toBeUndefined();
    expect(loop.pending()).toBe(0);
  });

  it("drops the engine's own listeners", async () => {
    const overlay = withOverlayStub();
    try {
      const { engine, target } = makeEngine(bareGame());
      await engine.initialize();
      engine.destroy();
      target.dispatchEvent(keyEvent("keydown", "Backquote"));
      // The engine is gone, so nothing observes the key and nothing throws.
      expect(
        overlay.calls.filter((call) => call.startsWith("fillText")),
      ).toEqual([]);
    } finally {
      overlay.restore();
    }
  });

  it("runs nothing further, and refuses no call, after teardown", async () => {
    const { engine } = makeEngine(bareGame());
    await engine.initialize();
    await engine.advance(1);
    engine.destroy();
    await engine.advance(5);
    await engine.run();
    expect(engine.frame().count).toBe(1);
  });

  it("drops every subscription, so a stale handler observes no successor", async () => {
    const seen: string[] = [];
    const { engine } = makeEngine(bareGame());
    engine.events.on("world:opened", () => seen.push("opened"));
    await engine.initialize();
    expect(seen).toEqual(["opened"]);
    engine.destroy();

    const second = makeEngine(bareGame());
    await second.engine.initialize();
    expect(seen).toEqual(["opened"]);
  });
});

/* -------------------------------------------------------------------------- */
/* The entry point                                                            */
/* -------------------------------------------------------------------------- */

describe("the entry point", () => {
  it("exports every value the API pages' Exports sections name", () => {
    const named = [
      "createEngine",
      "GameInstance",
      "GameMode",
      "GameState",
      "PlayerState",
      "Actor",
      "Pawn",
      "Component",
      "RenderComponent",
      "MeshComponent",
      "ShapeComponent",
      "TextComponent",
      "DrawComponent",
      "CameraComponent",
      "LightComponent",
      "AmbientLightComponent",
      "DirectionalLightComponent",
      "PointLightComponent",
      "ColliderComponent",
      "Controller",
      "PlayerController",
      "AIController",
      "WallClock",
      "PacedClock",
      "ConstantClock",
      "SequenceClock",
      "JitterClock",
      "TOUCH_LAYOUTS",
      "vec3Add",
      "vec3Sub",
      "vec3Scale",
      "vec3Dot",
      "vec3Cross",
      "vec3Length",
      "vec3Normalize",
      "quatFromAxisAngle",
      "quatMultiply",
      "rotateVec3",
      "transformPoint",
      "projectPoint",
      "pointerRay",
      "fitViewport",
      "syncCanvas",
      "RECORDING_FORMAT",
    ];
    const exported = Object.keys(api).sort();
    expect(exported).toEqual([...named].sort());
  });

  it("builds a working engine through the shipped factory", async () => {
    const canvas = createCanvas(WIDTH, HEIGHT) as unknown as HTMLCanvasElement;
    const engine = api.createEngine({
      canvas,
      width: WIDTH,
      height: HEIGHT,
      game: bareGame(),
      surface: surfaceOver(new EventTarget()),
      clock: new api.ConstantClock(16),
    });
    built.push(engine as unknown as Engine<never>);
    await engine.initialize();
    await engine.advance(1);
    expect(engine.frame().count).toBe(1);
    expect(engine.world.level).toBe("title");
  });
});

/* -------------------------------------------------------------------------- */
/* Type-level obligations                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The names the API pages export as *types* have no runtime presence, so they
 * are asserted the only way a type can be: by being named. This block compiles
 * or the surface is wrong.
 */
describe("the entry point's type surface", () => {
  it("names every documented type", () => {
    const shapes: {
      engine?: api.Engine;
      options?: api.EngineOptions;
      run?: api.RunOptions;
      frame?: api.FrameInfo;
      events?: api.EngineEvents;
      map?: api.EngineEventMap;
      surface?: api.SurfaceMetrics;
      definition?: api.GameDefinition;
      instanceClass?: api.GameInstanceClass;
      init?: api.InitApi;
      level?: api.LevelDefinition;
      actorSpec?: api.ActorSpec;
      load?: api.LoadApi;
      world?: api.World;
      spawn?: api.SpawnSpec;
      timer?: api.TimerHandle;
      worldAudio?: api.WorldAudio;
      modeClass?: api.GameModeClass;
      phase?: api.MatchPhase;
      endPlay?: api.EndPlayReason;
      playerOptions?: api.PlayerOptions;
      botOptions?: api.BotOptions;
      actorClass?: api.ActorClass;
      transform?: api.Transform;
      componentClass?: api.ComponentClass;
      meshOptions?: api.MeshOptions;
      shape?: api.Shape3;
      shapeOptions?: api.ShapeOptions;
      textOptions?: api.TextOptions;
      drawApi?: api.DrawApi;
      lightOptions?: api.LightOptions;
      pointLightOptions?: api.PointLightOptions;
      colliderOptions?: api.ColliderOptions;
      controllerClass?: api.ControllerClass;
      reader?: api.InputReader;
      renderer?: api.Renderer;
      mode?: api.RenderMode;
      sceneContext?: api.SceneContext;
      response?: api.CollisionResponse;
      manifold?: api.Manifold;
      overlap?: api.Overlap;
      hit?: api.Hit;
      query?: api.QueryOptions;
      collisionWorld?: api.CollisionWorld;
      vec2?: api.Vec2;
      vec3?: api.Vec3;
      quat?: api.Quat;
      box?: api.Box3;
      ray?: api.Ray;
      cameraState?: api.CameraState;
      camera?: api.Camera;
      viewport?: api.Viewport;
      clock?: api.Clock;
      paced?: api.PacedClockOptions;
      actionKind?: api.ActionKind;
      binding?: api.ActionBinding;
      registered?: api.RegisteredAction;
      layout?: api.TouchLayout;
      sampleType?: api.PointerSampleType;
      sample?: api.PointerSample;
      pointer?: api.PointerSnapshot;
      cue?: api.CueSpec;
      audioState?: api.AudioState;
      meshHandle?: api.MeshHandle;
      textureHandle?: api.TextureHandle;
      materialHandle?: api.MaterialHandle;
      mapSlot?: api.MaterialMapSlot;
      metrics?: api.FrameMetrics;
      recording?: api.Recording;
      recordedFrame?: api.RecordedFrame;
      renderState?: api.RenderState;
      lightState?: api.LightState;
      color?: api.Color;
      op?: api.DrawOp;
      value?: api.DrawValue;
      asset?: api.CapturedAsset;
      resource?: api.Resource;
      resourceOp?: api.ResourceOp;
    } = {};
    expect(shapes).toEqual({});
  });

  it("binds Camera to Actor, as the camera page specifies", async () => {
    const { engine } = makeEngine(bareGame());
    await engine.initialize();
    const camera: api.Camera = engine.world.camera;
    const target: Actor | null = camera.target;
    expect(target).toBeNull();
  });

  it("hands a Pawn-shaped world back through the framework classes", async () => {
    class Hero extends Pawn {}

    class WithHero extends GameMode {
      override pawnClass = Hero;

      override beginPlay(): void {
        this.addPlayer();
      }
    }

    const { engine } = makeEngine({
      startLevel: "arena",
      levels: { arena: { mode: WithHero } },
    });
    await engine.initialize();
    const world: World = engine.world;
    expect(world.controllers()[0]?.pawn).toBeInstanceOf(Hero);
    expect(world.ofType(Hero)).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* The pipeline seam                                                          */
/* -------------------------------------------------------------------------- */

describe("the renderer switches", () => {
  it("are engine state, so they survive a level transition", async () => {
    class Leaving extends GameMode {
      override tick(): void {
        if (this.world.level === "title") this.world.open("arena");
      }
    }

    const { engine } = makeEngine({
      startLevel: "title",
      levels: { title: { mode: Leaving }, arena: { mode: GameMode } },
    });
    await engine.initialize();
    engine.renderer.setMode("wireframe");
    engine.renderer.setCollisionOverlay(true);

    await engine.advance(2);
    expect(engine.world.level).toBe("arena");
    expect(engine.renderer.mode()).toBe("wireframe");
    expect(engine.renderer.collisionOverlay()).toBe(true);
  });

  it("state the mode a recording's frames were drawn under", async () => {
    class Scene extends Actor {
      override beginPlay(): void {
        this.attach(
          new ShapeComponent({ shape: { kind: "sphere", radius: 1 } }),
        );
      }
    }

    const { engine } = makeEngine({
      startLevel: "arena",
      levels: { arena: { mode: GameMode, actors: [{ type: Scene }] } },
    });
    await engine.initialize();
    engine.renderer.setMode("normals");
    engine.startRecording();
    await engine.advance(2);
    const recording = engine.stopRecording();

    // The first captured frame inherited the state it opened with — the
    // renderer state a frame *sets* is among its own operations — so the
    // second frame is the one that inherits the mode the switch chose.
    const first = recording.states[recording.frames[0]?.state ?? 0];
    const second = recording.states[recording.frames[1]?.state ?? 0];
    expect(first?.mode).toBe("standard");
    expect(second?.mode).toBe("normals");
  });
});
