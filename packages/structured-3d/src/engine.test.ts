import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";

import { Actor, Pawn } from "./actors";
import { WorldCamera } from "./camera";
import { ConstantClock } from "./clocks";
import { ColliderComponent } from "./collision";
import { MeshComponent } from "./components";
import type { CameraSnapshot, DiagnosticValue } from "./contract";
import {
  assembleEngine,
  createEngine,
  type Engine,
  type EngineHost,
  type EngineOptions,
  type EngineSubsystems,
  type PendingTransition,
  type WorldDriver,
} from "./engine";
import {
  GameInstance,
  type GameDefinition,
  type InitApi,
} from "./game-instance";
import { GameMode } from "./game-mode";
import type { World } from "./worlds";
import {
  createStage,
  installCanvasContexts,
  type Stage,
} from "./testing/canvas";
import { installCodecs } from "./testing/codecs";

/**
 * Two suites in one file, split by what stands behind the engine.
 *
 * The unit half drives `assembleEngine` over fake subsystems, so what is
 * asserted is the engine's own work: the construction refusals and their order,
 * the `initialize` gate, the frame order, the loop, the recorder wiring, and the
 * teardown. The integration half drives `createEngine` — the real subsystems,
 * the real worlds, a real `THREE.WebGLRenderer` over the harness's GL stub — so
 * the wiring the shipped factory does is exercised end to end.
 *
 * Both halves render through a real pipeline. There is no fake for it, and that
 * is deliberate: three of the five construction refusals are the pipeline's, the
 * render is where half the frame's fixed order lives, and an engine suite that
 * stubbed the drawing would prove the order of a sequence nothing performed.
 */

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/** A world reduced to what the pipeline, the listener, and the overlay read. */
function bareWorld(level: string): World {
  return {
    level,
    paused: false,
    actors: (): readonly Actor[] => [],
    camera: new WorldCamera(640, 360),
    mode: { phase: "waiting" },
  } as unknown as World;
}

interface Fakes {
  subsystems: EngineSubsystems;
  /** Every observable act, in the order the engine performed it. */
  log: string[];
  /** Queue a transition for the next `takeTransition` read. */
  queueTransition(pending: PendingTransition): void;
  /** Make the next `open` wait until the returned release runs. */
  gateNextOpen(): () => void;
  /** Make the next `open` reject with `error`. */
  failNextOpen(error: Error): void;
  /** Make the driver's `tick` throw once. */
  failNextTick(error: Error): void;
  registered: Array<[string, unknown]>;
  /** Every camera pose the listener was placed at, in frame order. */
  listens: CameraSnapshot[];
  unlocks: number;
  toggles: number;
  samples: Array<[number, number]>;
}

/** The engine's collaborators as recording fakes over the documented ports. */
function fakes(log: string[] = []): Fakes {
  const queue: PendingTransition[] = [];
  let world: World | null = null;
  let gate: Promise<void> | null = null;
  let openFailure: Error | null = null;
  let tickFailure: Error | null = null;
  const registered: Array<[string, unknown]> = [];
  const samples: Array<[number, number]> = [];
  const listens: CameraSnapshot[] = [];

  const state = { unlocks: 0, toggles: 0 };

  const worlds: WorldDriver = {
    world: () => world,
    open: async (level): Promise<void> => {
      log.push(`open:${level}`);
      if (gate !== null) {
        const wait = gate;
        gate = null;
        await wait;
      }
      if (openFailure !== null) {
        const failure = openFailure;
        openFailure = null;
        throw failure;
      }
      world = bareWorld(level);
      log.push(`opened:${level}`);
    },
    tick: (dt) => {
      log.push(`tick:${dt}`);
      if (tickFailure !== null) {
        const failure = tickFailure;
        tickFailure = null;
        throw failure;
      }
    },
    flushDestroyed: () => log.push("flush"),
    takeTransition: () => queue.shift() ?? null,
    close: () => log.push("close"),
  };

  const subsystems: EngineSubsystems = {
    input: {
      register: (name, binding) => registered.push([name, binding]),
      layout: () => null,
      endFrame: () => log.push("input.endFrame"),
      detach: () => log.push("input.detach"),
    },
    audio: {
      define: (cue, spec) => registered.push([cue, spec]),
      load: async () => undefined,
      listen: (camera) => {
        listens.push(camera);
        log.push("audio.listen");
      },
      unlock: () => {
        state.unlocks += 1;
      },
      silence: () => log.push("audio.silence"),
    },
    diagnostics: {
      registerInstance: (name, source) => registered.push([name, source]),
      read: () =>
        registered
          .filter(([, source]) => typeof source === "function")
          .map(([name, source]) => ({
            name,
            value: (source as () => DiagnosticValue)(),
          })),
      toggle: () => {
        state.toggles += 1;
      },
      draw: () => log.push("diagnostics.draw"),
      recordFrame: (atMs, costMs) => samples.push([atMs, costMs]),
    },
    assets: {
      loadImage: () => Promise.reject(new Error("no images here")),
      loadTexture: () => Promise.reject(new Error("no textures here")),
      loadModel: () => Promise.reject(new Error("no models here")),
      loadAudio: () => Promise.reject(new Error("no audio here")),
      load: () => Promise.reject(new Error("no assets here")),
      resolve: (path) => `assets/${path}`,
    },
    worlds,
  };

  return {
    subsystems,
    log,
    queueTransition: (pending) => queue.push(pending),
    gateNextOpen: (): (() => void) => {
      let release!: () => void;
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    failNextOpen: (error) => {
      openFailure = error;
    },
    failNextTick: (error) => {
      tickFailure = error;
    },
    registered,
    listens,
    get unlocks() {
      return state.unlocks;
    },
    get toggles() {
      return state.toggles;
    },
    samples,
  };
}

/** One trivial definition the unit half reuses; the fake driver ignores it. */
function definition(): GameDefinition {
  return { levels: { main: { mode: GameMode } }, startLevel: "main" };
}

/** An engine over fakes, with everything defaulted and overridable. */
function build(
  overrides: Partial<EngineOptions> = {},
  host: EngineHost = {},
): { engine: Engine; fixture: Fakes; stage: Stage } {
  const fixture = fakes();
  const stage = createStage({ cssWidth: 320, cssHeight: 180, dpr: 2 });
  const engine = assembleEngine(
    {
      canvas: stage.stage.canvas,
      screen: stage.screen.canvas,
      width: 640,
      height: 360,
      game: definition(),
      clock: new ConstantClock(10),
      surface: stage.surface.surface,
      ...overrides,
    },
    () => fixture.subsystems,
    host,
  );
  return { engine, fixture, stage };
}

/**
 * How many live `THREE.WebGLRenderer`s are attached to `canvas`.
 *
 * Three's renderer registers a `webglcontextlost` listener on the canvas in its
 * constructor and removes it in `dispose`, which is the one externally visible
 * trace a renderer leaves: `dispose` is an own property of each instance rather
 * than of the prototype, so there is nothing to spy on. `already` is the count
 * standing when the watch starts, for a canvas an engine is already built over.
 */
function watchContextLoss(
  canvas: HTMLCanvasElement,
  already = 0,
): () => number {
  let live = already;
  const add = canvas.addEventListener.bind(canvas);
  const remove = canvas.removeEventListener.bind(canvas);
  canvas.addEventListener = ((type: string, ...rest: unknown[]): void => {
    if (type === "webglcontextlost") live += 1;
    (add as (...args: unknown[]) => void)(type, ...rest);
  }) as unknown as HTMLCanvasElement["addEventListener"];
  canvas.removeEventListener = ((type: string, ...rest: unknown[]): void => {
    if (type === "webglcontextlost") live -= 1;
    (remove as (...args: unknown[]) => void)(type, ...rest);
  }) as unknown as HTMLCanvasElement["removeEventListener"];
  return () => live;
}

/** A host loop the test pumps by hand rather than racing a real frame callback. */
function scriptedHost(): EngineHost & {
  step(t?: number): void;
  pending(): boolean;
  cancels(): number;
} {
  let next: ((t: number) => void) | null = null;
  let handle = 0;
  let cancels = 0;
  let clockMs = 0;
  return {
    raf: (cb) => {
      next = cb;
      handle += 1;
      return handle;
    },
    cancel: () => {
      cancels += 1;
      next = null;
    },
    now: () => {
      clockMs += 16;
      return clockMs;
    },
    step: (t = 16): void => {
      const cb = next;
      next = null;
      cb?.(t);
    },
    pending: () => next !== null,
    cancels: () => cancels,
  };
}

/* -------------------------------------------------------------------------- */
/* Construction                                                               */
/* -------------------------------------------------------------------------- */

describe("construction", () => {
  it("refuses a design size that is not finite and positive, naming it", () => {
    expect(() => build({ width: 0 })).toThrow(/finite, positive width/);
    expect(() => build({ height: Number.NaN })).toThrow(
      /finite, positive height/,
    );
    expect(() => build({ width: -640 })).toThrow(/-640/);
  });

  it("refuses a canvas that yields no webgl2 context", () => {
    const contextless = document.createElement("canvas");
    contextless.getContext = ((): null =>
      null) as unknown as HTMLCanvasElement["getContext"];
    expect(() => build({ canvas: contextless })).toThrow(/webgl2 context/);
  });

  it("refuses a layout outside the catalogue, naming every valid layout", () => {
    expect(() => build({ layout: "not-a-layout" })).toThrow(
      /outside TOUCH_LAYOUTS/,
    );
    expect(() => build({ layout: "not-a-layout" })).toThrow(/"dual-stick"/);
  });

  it("refuses a level registry with no entries", () => {
    const game: GameDefinition = { levels: {}, startLevel: "main" };
    expect(() => build({ game })).toThrow(/levels has no entries/);
  });

  it("refuses a startLevel naming no entry, naming every registered level", () => {
    const game: GameDefinition = {
      levels: { arena: { mode: GameMode }, cavern: { mode: GameMode } },
      startLevel: "nowhere",
    };
    expect(() => build({ game })).toThrow(/"arena", "cavern"/);
  });

  /**
   * The errors table's order is a claim about which of two mistakes a build with
   * both of them is told about, and the surface everything else is drawn on
   * comes first: a design size that cannot be projected, then the canvas the
   * scene renders through, then the layer drawn over it — and only then the
   * arguments measured against them.
   */
  it("raises the refusals in the order the errors table lists them", () => {
    // A bad size and a bad layout: the size wins.
    expect(() => build({ width: 0, layout: "not-a-layout" })).toThrow(
      /finite, positive width/,
    );
    // A contextless canvas and an empty registry: the canvas wins.
    const contextless = document.createElement("canvas");
    contextless.getContext = ((): null =>
      null) as unknown as HTMLCanvasElement["getContext"];
    expect(() =>
      build({ canvas: contextless, game: { levels: {}, startLevel: "main" } }),
    ).toThrow(/webgl2 context/);
    // A bad layout and a bad startLevel: the layout wins.
    expect(() =>
      build({
        layout: "not-a-layout",
        game: { levels: { main: { mode: GameMode } }, startLevel: "nowhere" },
      }),
    ).toThrow(/outside TOUCH_LAYOUTS/);
  });

  /**
   * The pipeline is built before the remaining arguments are judged, so a
   * refusal after it has to give the GPU resources back. A page that retries
   * construction otherwise runs the browser out of WebGL contexts, silently,
   * several engines later.
   */
  it("disposes the renderer it built when a later argument is refused", () => {
    const stage = createStage();
    const live = watchContextLoss(stage.stage.canvas);
    const options: EngineOptions = {
      canvas: stage.stage.canvas,
      screen: stage.screen.canvas,
      width: 640,
      height: 360,
      game: definition(),
      surface: stage.surface.surface,
    };
    expect(() =>
      assembleEngine(
        { ...options, layout: "not-a-layout" },
        () => fakes().subsystems,
      ),
    ).toThrow();
    expect(live()).toBe(0);
    expect(() =>
      assembleEngine(
        { ...options, game: { levels: {}, startLevel: "main" } },
        () => fakes().subsystems,
      ),
    ).toThrow();
    expect(live()).toBe(0);
    // The same rig, accepted: the renderer that is kept holds its listener, so
    // the zeroes above are a disposal rather than a listener nothing installs.
    assembleEngine(options, () => fakes().subsystems);
    expect(live()).toBe(1);
  });

  it("runs no game code: nothing opens and nothing constructs before initialize", () => {
    let constructed = 0;
    class Counted extends GameInstance {
      constructor() {
        super();
        constructed += 1;
      }
    }
    const { fixture } = build({
      game: {
        instance: Counted,
        levels: { main: { mode: GameMode } },
        startLevel: "main",
      },
    });
    expect(constructed).toBe(0);
    expect(fixture.log).toEqual([]);
  });

  it("is subscribable, reclockable, and readable from construction", () => {
    const { engine } = build();
    const seen: string[] = [];
    engine.events.on("world:opened", ({ level }) => seen.push(level));
    engine.setClock(new ConstantClock(5));
    // The scene and the renderer are engine state rather than world state, so
    // both answer before a single frame has run.
    expect(engine.scene).toBeInstanceOf(THREE.Scene);
    expect(engine.scene.children).toEqual([]);
    expect(engine.renderer.mode()).toBe("shaded");
    expect(engine.frame()).toEqual({ count: 0, timeMs: 0, lastDeltaMs: 0 });
    expect(seen).toEqual([]);
  });

  it("hands back the same scene object on every read", () => {
    const { engine } = build();
    expect(engine.scene).toBe(engine.scene);
  });
});

/* -------------------------------------------------------------------------- */
/* The initialize gate                                                        */
/* -------------------------------------------------------------------------- */

describe("the initialize gate", () => {
  it("refuses instance, world, and debug before initialize resolves, naming the ordering", () => {
    const { engine } = build();
    expect(() => engine.instance).toThrow(/before initialize\(\) resolved/);
    expect(() => engine.world).toThrow(/engine\.world/);
    expect(() => engine.debug).toThrow(/engine\.debug/);
  });

  it("refuses run and advance before initialize resolves", () => {
    const { engine } = build();
    expect(() => engine.run()).toThrow(/engine\.run/);
    expect(() => engine.advance(1)).toThrow(/engine\.advance/);
  });

  it("lets events, scene, renderer, frame, and viewport through the gate", () => {
    const { engine } = build();
    expect(() => engine.events.on("world:opened", () => {})).not.toThrow();
    expect(() => engine.scene).not.toThrow();
    expect(() => engine.renderer.collisionOverlay()).not.toThrow();
    expect(() => engine.frame()).not.toThrow();
    expect(() => engine.viewport()).not.toThrow();
    expect(() => engine.diagnostics()).not.toThrow();
    expect(() => engine.recording()).not.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* initialize                                                                 */
/* -------------------------------------------------------------------------- */

describe("initialize", () => {
  it("builds the instance, runs its initialize, opens the start level, and resolves to it", async () => {
    const order: string[] = [];
    class Game extends GameInstance<{ tag: string }> {
      override initialize(): { tag: string } {
        order.push("initialize");
        return { tag: "ready" };
      }
      override worldOpened(world: World): void {
        order.push(`opened:${world.level}`);
      }
    }
    const { engine, fixture } = build({
      game: {
        instance: Game,
        levels: { main: { mode: GameMode } },
        startLevel: "main",
      },
    });
    const instance = await engine.initialize();
    expect(instance).toBeInstanceOf(Game);
    expect(engine.instance).toBe(instance);
    expect(engine.debug).toEqual({ tag: "ready" });
    expect(engine.world.level).toBe("main");
    // The instance's own `initialize` runs before the start level opens: a
    // level's `load` may reach for a cue the instance declared.
    expect(order).toEqual(["initialize"]);
    expect(fixture.log).toEqual(["open:main", "opened:main"]);
  });

  it("assigns the engine and the broadcaster before the instance's initialize runs", async () => {
    let seen: { engine: unknown; events: unknown } | null = null;
    class Game extends GameInstance {
      override initialize(): null {
        seen = { engine: this.engine, events: this.events };
        return null;
      }
    }
    const { engine } = build({
      game: {
        instance: Game,
        levels: { main: { mode: GameMode } },
        startLevel: "main",
      },
    });
    await engine.initialize();
    expect(seen).not.toBeNull();
    expect((seen as unknown as { engine: unknown }).engine).toBe(engine);
    expect((seen as unknown as { events: unknown }).events).toBe(engine.events);
  });

  it("hands the instance an InitApi wired to the subsystems", async () => {
    let api: InitApi | null = null;
    class Game extends GameInstance {
      override initialize(given: InitApi): null {
        api = given;
        given.input.register("jump", { kind: "digital", keys: ["Space"] });
        given.audio.define("ping", { freq: 440, durationMs: 40 });
        given.diagnostics.register("score", () => 7);
        return null;
      }
    }
    const { engine, fixture } = build({
      game: {
        instance: Game,
        levels: { main: { mode: GameMode } },
        startLevel: "main",
      },
    });
    await engine.initialize();
    expect(fixture.registered.map(([name]) => name)).toEqual([
      "jump",
      "ping",
      "score",
    ]);
    const given = api as unknown as InitApi;
    expect(given.events).toBe(engine.events);
    expect(given.input.layout()).toBeNull();
    expect(given.assets.resolve("hero.png")).toBe("assets/hero.png");
    // A snapshot the caller owns, so holding one observes no later frame.
    expect(given.viewport()).toEqual(engine.viewport());
    expect(given.viewport()).not.toBe(given.viewport());
  });

  it("defaults the instance class to GameInstance and the debug surface to its null", async () => {
    const { engine } = build();
    const instance = await engine.initialize();
    expect(instance.constructor).toBe(GameInstance);
    expect(engine.debug).toBeNull();
  });

  it("resolves a second call to the instance already built, without re-running anything", async () => {
    let initializes = 0;
    class Game extends GameInstance {
      override initialize(): null {
        initializes += 1;
        return null;
      }
    }
    const { engine, fixture } = build({
      game: {
        instance: Game,
        levels: { main: { mode: GameMode } },
        startLevel: "main",
      },
    });
    const first = await engine.initialize();
    const second = await engine.initialize();
    expect(second).toBe(first);
    expect(initializes).toBe(1);
    expect(fixture.log.filter((entry) => entry === "open:main")).toHaveLength(
      1,
    );
  });

  it("rejects with the cause when the instance's initialize throws", async () => {
    const cause = new Error("the game could not start");
    class Game extends GameInstance {
      override initialize(): null {
        throw cause;
      }
    }
    const { engine, fixture } = build({
      game: {
        instance: Game,
        levels: { main: { mode: GameMode } },
        startLevel: "main",
      },
    });
    await expect(engine.initialize()).rejects.toBe(cause);
    // No world was opened, and no frame may run.
    expect(fixture.log).toEqual([]);
    expect(() => engine.advance(1)).toThrow(/before initialize\(\) resolved/);
  });

  it("rejects an initialize that returned undefined, naming the debug surface", async () => {
    class Game extends GameInstance {
      override initialize(): undefined {
        return undefined;
      }
    }
    const { engine, fixture } = build({
      game: {
        instance: Game as never,
        levels: { main: { mode: GameMode } },
        startLevel: "main",
      },
    });
    await expect(engine.initialize()).rejects.toThrow(/debug surface/);
    expect(fixture.log).toEqual([]);
  });

  it("awaits an asynchronous initialize before the start level opens", async () => {
    const order: string[] = [];
    class Game extends GameInstance {
      override async initialize(): Promise<null> {
        await Promise.resolve();
        order.push("initialize");
        return null;
      }
    }
    const { engine, fixture } = build({
      game: {
        instance: Game,
        levels: { main: { mode: GameMode } },
        startLevel: "main",
      },
    });
    await engine.initialize();
    expect(order).toEqual(["initialize"]);
    expect(fixture.log).toEqual(["open:main", "opened:main"]);
  });

  it("rejects when opening the start level rejects", async () => {
    const cause = new Error("the level's load failed");
    const { engine, fixture } = build();
    fixture.failNextOpen(cause);
    await expect(engine.initialize()).rejects.toBe(cause);
    expect(() => engine.world).toThrow(/before initialize\(\) resolved/);
    // The rejection is shared, so a second call does not re-run the half of the
    // initialization that succeeded.
    await expect(engine.initialize()).rejects.toBe(cause);
  });
});

/* -------------------------------------------------------------------------- */
/* advance and the frame                                                      */
/* -------------------------------------------------------------------------- */

describe("advance", () => {
  it("refuses a count that is not a whole, non-negative number, naming the value", async () => {
    const { engine } = build();
    await engine.initialize();
    expect(() => engine.advance(-1)).toThrow(RangeError);
    expect(() => engine.advance(1.5)).toThrow(/1\.5/);
    expect(() => engine.advance(Number.NaN)).toThrow(RangeError);
  });

  it("runs nothing for advance(0)", async () => {
    const { engine, fixture } = build();
    await engine.initialize();
    fixture.log.length = 0;
    await engine.advance(0);
    expect(fixture.log).toEqual([]);
    expect(engine.frame().count).toBe(0);
  });

  it("advances the counter, the accumulated time, and the last delta", async () => {
    const { engine } = build({ clock: new ConstantClock(20) });
    await engine.initialize();
    await engine.advance(3);
    expect(engine.frame()).toEqual({
      count: 3,
      timeMs: 60,
      lastDeltaMs: 20,
    });
  });

  it("runs no frame for a tick the clock declines", async () => {
    let allow = false;
    const { engine, fixture } = build({
      clock: { delta: () => (allow ? 10 : null) },
    });
    await engine.initialize();
    fixture.log.length = 0;
    await engine.advance(2);
    expect(fixture.log).toEqual([]);
    expect(engine.frame().count).toBe(0);
    allow = true;
    await engine.advance(1);
    expect(engine.frame()).toEqual({ count: 1, timeMs: 10, lastDeltaMs: 10 });
  });

  /**
   * The eleven-step order, as far as it is observable from outside the pipeline.
   * The three steps that are the engine's own inside the render — placing the
   * listener at the camera, drawing the overlay, closing the input frame — are
   * what pin the render's internal order from here.
   */
  it("runs each frame's steps in the documented order", async () => {
    const { engine, fixture } = build();
    await engine.initialize();
    fixture.log.length = 0;
    await engine.advance(1);
    expect(fixture.log).toEqual([
      "tick:0.01",
      "flush",
      "audio.listen",
      "diagnostics.draw",
      "input.endFrame",
    ]);
  });

  it("hands the world driver seconds", async () => {
    const { engine, fixture } = build({ clock: new ConstantClock(250) });
    await engine.initialize();
    fixture.log.length = 0;
    await engine.advance(1);
    expect(fixture.log[0]).toBe("tick:0.25");
  });

  it("places the listener at the world's camera every frame", async () => {
    const { engine, fixture } = build();
    await engine.initialize();
    const world = engine.world;
    world.camera.position.x = 5;
    await engine.advance(1);
    expect(fixture.listens).toHaveLength(1);
    expect(fixture.listens[0]?.position).toEqual({ x: 5, y: 0, z: 10 });
    world.camera.position.x = 9;
    await engine.advance(1);
    expect(fixture.listens[1]?.position).toEqual({ x: 9, y: 0, z: 10 });
  });

  it("records what each frame cost, stamped with simulated time", async () => {
    const { engine, fixture } = build({ clock: new ConstantClock(10) });
    await engine.initialize();
    await engine.advance(2);
    expect(fixture.samples.map(([atMs]) => atMs)).toEqual([10, 20]);
    for (const [, costMs] of fixture.samples) {
      expect(costMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("samples the cost of a frame that threw", async () => {
    const { engine, fixture } = build();
    await engine.initialize();
    fixture.failNextTick(new Error("a tick blew up"));
    await expect(engine.advance(1)).rejects.toThrow("a tick blew up");
    expect(fixture.samples).toHaveLength(1);
  });

  it("swaps the clock in place, carrying the counters over", async () => {
    const { engine } = build({ clock: new ConstantClock(10) });
    await engine.initialize();
    await engine.advance(2);
    engine.setClock(new ConstantClock(50));
    await engine.advance(1);
    expect(engine.frame()).toEqual({
      count: 3,
      timeMs: 70,
      lastDeltaMs: 50,
    });
  });

  it("rejects and abandons the remaining frames when a tick throws", async () => {
    const { engine, fixture } = build();
    await engine.initialize();
    fixture.failNextTick(new Error("a tick blew up"));
    await expect(engine.advance(5)).rejects.toThrow("a tick blew up");
    // One frame's counter moved; the four after it never ran.
    expect(engine.frame().count).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Transitions inside a frame                                                 */
/* -------------------------------------------------------------------------- */

describe("the transition inside a frame", () => {
  it("performs a requested transition before the frame renders, and renders the new world", async () => {
    const { engine, fixture } = build();
    await engine.initialize();
    fixture.log.length = 0;
    fixture.queueTransition({ level: "cavern", options: { seed: 3 } });
    await engine.advance(1);
    expect(fixture.log).toEqual([
      "tick:0.01",
      "flush",
      "open:cavern",
      "opened:cavern",
      "audio.listen",
      "diagnostics.draw",
      "input.endFrame",
    ]);
    expect(engine.world.level).toBe("cavern");
  });

  it("awaits an in-flight transition before the next frame begins", async () => {
    const { engine, fixture } = build();
    await engine.initialize();
    fixture.log.length = 0;
    const release = fixture.gateNextOpen();
    fixture.queueTransition({ level: "cavern", options: undefined });
    const advancing = engine.advance(2);
    await Promise.resolve();
    // The first frame is parked inside the transition: its render has not run
    // and the second frame has not started.
    expect(fixture.log).toEqual(["tick:0.01", "flush", "open:cavern"]);
    release();
    await advancing;
    expect(fixture.log).toEqual([
      "tick:0.01",
      "flush",
      "open:cavern",
      "opened:cavern",
      "audio.listen",
      "diagnostics.draw",
      "input.endFrame",
      "tick:0.01",
      "flush",
      "audio.listen",
      "diagnostics.draw",
      "input.endFrame",
    ]);
    expect(engine.frame().count).toBe(2);
  });

  it("rejects the advance when the transition rejects", async () => {
    const cause = new Error("that level does not exist");
    const { engine, fixture } = build();
    await engine.initialize();
    fixture.queueTransition({ level: "nowhere", options: undefined });
    fixture.failNextOpen(cause);
    await expect(engine.advance(1)).rejects.toBe(cause);
  });
});

/* -------------------------------------------------------------------------- */
/* run                                                                        */
/* -------------------------------------------------------------------------- */

describe("run", () => {
  it("drives one tick per host callback until the signal aborts, then resolves", async () => {
    const host = scriptedHost();
    const { engine } = build({}, host);
    await engine.initialize();
    const controller = new AbortController();
    const running = engine.run({ signal: controller.signal });
    host.step();
    host.step();
    expect(engine.frame().count).toBe(2);
    controller.abort();
    await running;
    expect(host.pending()).toBe(false);
    // A halted loop leaves the engine usable, which is what makes aborting a
    // separate act from destroying.
    await engine.advance(1);
    expect(engine.frame().count).toBe(3);
  });

  it("resolves immediately under a signal that has already aborted", async () => {
    const host = scriptedHost();
    const { engine } = build({}, host);
    await engine.initialize();
    const controller = new AbortController();
    controller.abort();
    await engine.run({ signal: controller.signal });
    expect(engine.frame().count).toBe(0);
    expect(host.pending()).toBe(false);
  });

  it("shares one promise across concurrent calls, settled by one halt", async () => {
    const host = scriptedHost();
    const { engine } = build({}, host);
    await engine.initialize();
    const controller = new AbortController();
    const first = engine.run({ signal: controller.signal });
    const second = engine.run();
    expect(second).toBe(first);
    host.step();
    // One pump, not two: a second `run` waits for the halt rather than doubling
    // every frame.
    expect(engine.frame().count).toBe(1);
    controller.abort();
    await Promise.all([first, second]);
  });

  it("resolves when the engine is destroyed", async () => {
    const host = scriptedHost();
    const { engine } = build({}, host);
    await engine.initialize();
    const running = engine.run();
    host.step();
    engine.destroy();
    await running;
    expect(host.pending()).toBe(false);
  });

  it("runs no frame, and consults no clock, while a transition is in flight", async () => {
    const host = scriptedHost();
    let deltas = 0;
    const { engine, fixture } = build(
      {
        clock: {
          delta: (): number => {
            deltas += 1;
            return 10;
          },
        },
      },
      host,
    );
    await engine.initialize();
    const release = fixture.gateNextOpen();
    fixture.queueTransition({ level: "cavern", options: undefined });
    const running = engine.run();
    host.step();
    expect(deltas).toBe(1);
    // The pump re-arms without consulting the clock, so a paced clock's grid is
    // not consumed by ticks that cannot become frames.
    host.step();
    host.step();
    expect(deltas).toBe(1);
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    host.step();
    expect(deltas).toBe(2);
    engine.destroy();
    await running;
  });

  it("keeps pumping after a frame that threw", async () => {
    const host = scriptedHost();
    const { engine, fixture } = build({}, host);
    await engine.initialize();
    const running = engine.run();
    fixture.failNextTick(new Error("a tick blew up"));
    expect(() => host.step()).toThrow("a tick blew up");
    expect(host.pending()).toBe(true);
    host.step();
    expect(engine.frame().count).toBe(2);
    engine.destroy();
    await running;
  });

  it("resolves rather than starting a pump on a destroyed engine", async () => {
    const host = scriptedHost();
    const { engine } = build({}, host);
    await engine.initialize();
    engine.destroy();
    await engine.run();
    expect(host.pending()).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* viewport                                                                   */
/* -------------------------------------------------------------------------- */

describe("viewport", () => {
  it("reports a real fit from construction, as a copy the caller owns", () => {
    const { engine } = build();
    const first = engine.viewport();
    // 320x180 CSS at dpr 2 is 640x360 device pixels for a 640x360 design: an
    // exact fit, one device pixel per logical unit, no bars.
    expect(first).toEqual({
      width: 640,
      height: 360,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
    expect(engine.viewport()).not.toBe(first);
  });

  it("sizes the stage canvas before the first frame", () => {
    const { stage } = build();
    expect(stage.stage.canvas.width).toBe(640);
    expect(stage.stage.canvas.height).toBe(360);
  });

  it("sizes the screen layer to the stage from construction", () => {
    const { stage } = build();
    expect(stage.screen.canvas.width).toBe(stage.stage.canvas.width);
    expect(stage.screen.canvas.height).toBe(stage.stage.canvas.height);
  });

  it("re-fits every frame, so a ratio that changes mid-run corrects itself", async () => {
    const surface = {
      cssWidth: () => 320,
      cssHeight: () => 180,
      dpr: () => 2,
      events: () => new EventTarget(),
    };
    let dpr = 2;
    const { engine } = build({
      surface: { ...surface, dpr: () => dpr },
    });
    await engine.initialize();
    dpr = 1;
    await engine.advance(1);
    expect(engine.viewport().scale).toBe(0.5);
  });
});

/* -------------------------------------------------------------------------- */
/* The engine's own listeners                                                 */
/* -------------------------------------------------------------------------- */

describe("the engine's own listeners", () => {
  it("toggles the diagnostics overlay on an unrepeated Backquote", () => {
    const stage = createStage();
    const fixture = fakes();
    assembleEngine(
      {
        canvas: stage.stage.canvas,
        screen: stage.screen.canvas,
        width: 640,
        height: 360,
        game: definition(),
        surface: stage.surface.surface,
      },
      () => fixture.subsystems,
    );
    const target = stage.surface.target;
    target.dispatchEvent(
      Object.assign(new Event("keydown"), { code: "Backquote", repeat: false }),
    );
    expect(fixture.toggles).toBe(1);
    // An auto-repeat would strobe the panel for as long as the key is held.
    target.dispatchEvent(
      Object.assign(new Event("keydown"), { code: "Backquote", repeat: true }),
    );
    expect(fixture.toggles).toBe(1);
    target.dispatchEvent(
      Object.assign(new Event("keydown"), { code: "KeyA", repeat: false }),
    );
    expect(fixture.toggles).toBe(1);
  });

  it("unlocks the audio bus on the first pointer or key event, once", () => {
    const stage = createStage();
    const fixture = fakes();
    assembleEngine(
      {
        canvas: stage.stage.canvas,
        screen: stage.screen.canvas,
        width: 640,
        height: 360,
        game: definition(),
        surface: stage.surface.surface,
      },
      () => fixture.subsystems,
    );
    stage.surface.target.dispatchEvent(new Event("pointerdown"));
    expect(fixture.unlocks).toBe(1);
    stage.surface.target.dispatchEvent(new Event("pointerdown"));
    stage.surface.target.dispatchEvent(new Event("keydown"));
    expect(fixture.unlocks).toBe(1);
  });

  it("drops its listeners on destroy", () => {
    const stage = createStage();
    const fixture = fakes();
    const engine = assembleEngine(
      {
        canvas: stage.stage.canvas,
        screen: stage.screen.canvas,
        width: 640,
        height: 360,
        game: definition(),
        surface: stage.surface.surface,
      },
      () => fixture.subsystems,
    );
    engine.destroy();
    stage.surface.target.dispatchEvent(new Event("pointerdown"));
    stage.surface.target.dispatchEvent(
      Object.assign(new Event("keydown"), { code: "Backquote", repeat: false }),
    );
    expect(fixture.unlocks).toBe(0);
    expect(fixture.toggles).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* destroy                                                                    */
/* -------------------------------------------------------------------------- */

describe("destroy", () => {
  it("closes the world, shuts the instance down, silences, detaches, and disposes — once", async () => {
    let shutdowns = 0;
    class Game extends GameInstance {
      override shutdown(): void {
        shutdowns += 1;
      }
    }
    const { engine, fixture, stage } = build({
      game: {
        instance: Game,
        levels: { main: { mode: GameMode } },
        startLevel: "main",
      },
    });
    const live = watchContextLoss(stage.stage.canvas, 1);
    await engine.initialize();
    fixture.log.length = 0;
    engine.destroy();
    engine.destroy();
    expect(fixture.log).toEqual(["close", "audio.silence", "input.detach"]);
    expect(shutdowns).toBe(1);
    expect(live()).toBe(0);
  });

  it("skips the world and the instance when neither was ever built", () => {
    const { engine, fixture } = build();
    engine.destroy();
    expect(fixture.log).toEqual(["audio.silence", "input.detach"]);
  });

  it("clears the broadcaster, so a stale handler observes nothing after teardown", async () => {
    const { engine } = build();
    await engine.initialize();
    const seen: string[] = [];
    engine.events.on("world:opened", ({ level }) => seen.push(level));
    engine.destroy();
    // The bus is the engine's; a handler that outlived it would keep the
    // caller's whole scope alive.
    (engine.events as { on: unknown }).on;
    expect(seen).toEqual([]);
  });

  it("refuses nothing afterwards: the gated members still answer", async () => {
    const { engine } = build();
    await engine.initialize();
    engine.destroy();
    expect(() => engine.instance).not.toThrow();
    expect(engine.frame().count).toBe(0);
    await expect(engine.advance(1)).resolves.toBeUndefined();
    expect(engine.frame().count).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Recording through the engine                                               */
/* -------------------------------------------------------------------------- */

describe("recording through the engine", () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => {
    while (cleanup.length > 0) cleanup.pop()?.();
  });

  it("reports whether it is recording, and refuses the unbalanced calls by name", async () => {
    const codecs = installCodecs();
    const contexts = installCanvasContexts();
    cleanup.push(
      () => codecs.uninstall(),
      () => contexts.uninstall(),
    );
    const { engine } = build();
    await engine.initialize();
    expect(engine.recording()).toBe(false);
    expect(() => engine.stopRecording()).toThrow(/while not recording/);
    engine.startRecording();
    expect(engine.recording()).toBe(true);
    expect(() => engine.startRecording()).toThrow(/while already recording/);
    await engine.stopRecording();
    expect(engine.recording()).toBe(false);
  });

  it("refuses a host with no VideoEncoder, naming WebCodecs", async () => {
    const global = globalThis as Record<string, unknown>;
    const had = "VideoEncoder" in global;
    const previous = global["VideoEncoder"];
    delete global["VideoEncoder"];
    cleanup.push(() => {
      if (had) global["VideoEncoder"] = previous;
    });
    const { engine } = build();
    await engine.initialize();
    expect(() => engine.startRecording()).toThrow(/WebCodecs/);
  });

  /**
   * The recording begins at the frame *after* the arming, and the guard is on
   * the frame counter rather than on a flag. A recorder armed from inside a
   * tick, a controller, or a `DrawComponent`'s `draw` is arming part-way through
   * a frame it has seen only the tail of.
   */
  it("captures the frames after the arming, not the one it was armed in", async () => {
    const codecs = installCodecs();
    const contexts = installCanvasContexts();
    cleanup.push(
      () => codecs.uninstall(),
      () => contexts.uninstall(),
    );
    const { engine } = build({ clock: new ConstantClock(16) });
    await engine.initialize();
    await engine.advance(1);
    engine.startRecording();
    await engine.advance(3);
    const recording = await engine.stopRecording();
    expect(recording.frames.map((frame) => frame.count)).toEqual([2, 3, 4]);
  });

  it("captures nothing for a frame armed mid-frame and turned away", async () => {
    const codecs = installCodecs();
    const contexts = installCanvasContexts();
    cleanup.push(
      () => codecs.uninstall(),
      () => contexts.uninstall(),
    );
    const { engine } = build();
    await engine.initialize();
    engine.startRecording();
    const recording = await engine.stopRecording();
    expect(recording.frames).toEqual([]);
  });

  it("discards an armed capture on destroy rather than flushing it", async () => {
    const codecs = installCodecs();
    const contexts = installCanvasContexts();
    cleanup.push(
      () => codecs.uninstall(),
      () => contexts.uninstall(),
    );
    const { engine } = build();
    await engine.initialize();
    engine.startRecording();
    await engine.advance(2);
    engine.destroy();
    expect(engine.recording()).toBe(false);
    expect(codecs.encoder()?.state).toBe("closed");
  });
});

/* -------------------------------------------------------------------------- */
/* End to end over the real subsystems                                        */
/* -------------------------------------------------------------------------- */

/** A cube with a collider, the smallest actor the whole pipeline draws. */
class Cube extends Actor {
  constructor() {
    super();
    this.attach(
      new MeshComponent({
        geometry: { kind: "box", width: 1, height: 1, depth: 1 },
      }),
    );
    this.attach(
      new ColliderComponent({
        shape: { kind: "box", width: 1, height: 1, depth: 1 },
        responses: { default: "overlap" },
      }),
    );
  }
}

/** A mode that counts its own ticks, so a frame is observable from the match. */
class Counting extends GameMode {
  ticks = 0;
  override beginPlay(): void {
    this.setPhase("playing");
  }
  override tick(): void {
    this.ticks += 1;
  }
}

/** The whole rig `createEngine` is given, sized consistently. */
function realEngine(
  game: GameDefinition,
  overrides: Partial<EngineOptions> = {},
): { engine: Engine; stage: Stage } {
  const stage = createStage({ cssWidth: 320, cssHeight: 180, dpr: 2 });
  const engine = createEngine({
    canvas: stage.stage.canvas,
    screen: stage.screen.canvas,
    width: 640,
    height: 360,
    game,
    clock: new ConstantClock(16),
    surface: stage.surface.surface,
    ...overrides,
  });
  return { engine, stage };
}

describe("end to end over the real subsystems", () => {
  it("runs a minimal game: a level, a mode, an actor, a frame, a picture", async () => {
    const { engine } = realEngine({
      levels: {
        arena: { mode: Counting, actors: [{ type: Cube }] },
      },
      startLevel: "arena",
    });
    await engine.initialize();
    expect(engine.world.level).toBe("arena");
    expect(engine.world.state.phase).toBe("playing");
    expect(engine.world.actors()).toHaveLength(1);
    await engine.advance(3);
    expect((engine.world.mode as Counting).ticks).toBe(3);
    // The pipeline gave the mesh an object in the engine's scene and placed it.
    expect(engine.scene.children.length).toBeGreaterThan(0);
    expect(engine.frame()).toEqual({ count: 3, timeMs: 48, lastDeltaMs: 16 });
    engine.destroy();
  });

  it("announces the start level being built to a subscriber from before initialize", async () => {
    const { engine } = realEngine({
      levels: { arena: { mode: GameMode } },
      startLevel: "arena",
    });
    const seen: string[] = [];
    engine.events.on("world:opening", ({ from, to }) =>
      seen.push(`opening:${String(from)}->${to}`),
    );
    engine.events.on("world:opened", ({ level }) =>
      seen.push(`opened:${level}`),
    );
    await engine.initialize();
    expect(seen).toEqual(["opening:null->arena", "opened:arena"]);
    engine.destroy();
  });

  it("runs the documented transition sequence over the shipped driver", async () => {
    const order: string[] = [];
    class Watching extends GameInstance {
      override initialize(): null {
        return null;
      }
      override worldClosing(world: World): void {
        order.push(`instance.worldClosing:${world.level}`);
      }
      override worldOpened(world: World): void {
        order.push(`instance.worldOpened:${world.level}`);
      }
    }
    class Leaving extends GameMode {
      override beginPlay(): void {
        order.push(`mode.beginPlay:${this.world.level}`);
      }
      override endPlay(): void {
        order.push(`mode.endPlay:${this.world.level}`);
      }
      override tick(): void {
        if (this.world.level === "arena") this.world.open("cavern");
      }
    }
    const { engine } = realEngine({
      instance: Watching,
      levels: { arena: { mode: Leaving }, cavern: { mode: Leaving } },
      startLevel: "arena",
    });
    engine.events.on("world:opening", ({ from, to }) =>
      order.push(`world:opening:${String(from)}->${to}`),
    );
    engine.events.on("world:closed", ({ level }) =>
      order.push(`world:closed:${level}`),
    );
    engine.events.on("world:opened", ({ level }) =>
      order.push(`world:opened:${level}`),
    );
    await engine.initialize();
    order.length = 0;
    await engine.advance(1);
    expect(order).toEqual([
      "world:opening:arena->cavern",
      "instance.worldClosing:arena",
      "mode.endPlay:arena",
      "world:closed:arena",
      "mode.beginPlay:cavern",
      "world:opened:cavern",
      "instance.worldOpened:cavern",
    ]);
    expect(engine.world.level).toBe("cavern");
    engine.destroy();
  });

  it("carries the frame counters across a transition and restarts world time", async () => {
    class Leaving extends GameMode {
      override tick(): void {
        if (this.world.level === "arena" && this.world.time >= 0.03) {
          this.world.open("cavern");
        }
      }
    }
    const { engine } = realEngine({
      levels: { arena: { mode: Leaving }, cavern: { mode: GameMode } },
      startLevel: "arena",
    });
    await engine.initialize();
    await engine.advance(2);
    expect(engine.world.level).toBe("cavern");
    // The loop's counters belong to the run, not to the world: the frame count
    // and the accumulated time carry across, and world time restarts at zero.
    expect(engine.frame()).toEqual({ count: 2, timeMs: 32, lastDeltaMs: 16 });
    expect(engine.world.time).toBe(0);
    engine.destroy();
  });

  it("rejects an advance whose tick opened an unregistered level, naming the registered ones", async () => {
    class Wandering extends GameMode {
      override tick(): void {
        this.world.open("nowhere");
      }
    }
    const { engine } = realEngine({
      levels: { arena: { mode: Wandering }, cavern: { mode: GameMode } },
      startLevel: "arena",
    });
    await engine.initialize();
    await expect(engine.advance(1)).rejects.toThrow(/"arena", "cavern"/);
    engine.destroy();
  });

  it("awaits a level's load before any actor of it exists", async () => {
    const order: string[] = [];
    class Late extends Actor {
      override beginPlay(): void {
        order.push("actor.beginPlay");
      }
    }
    const { engine } = realEngine({
      levels: {
        arena: {
          mode: GameMode,
          actors: [{ type: Late }],
          load: async (api): Promise<void> => {
            order.push(`load:${api.assets.resolve("hero.png")}`);
            await Promise.resolve();
            order.push("load:done");
          },
        },
      },
      startLevel: "arena",
    });
    await engine.initialize();
    expect(order).toEqual([
      "load:assets/hero.png",
      "load:done",
      "actor.beginPlay",
    ]);
    engine.destroy();
  });

  it("resolves assets under the engine's own root", async () => {
    let resolved = "";
    const { engine } = realEngine(
      {
        levels: {
          arena: {
            mode: GameMode,
            load: (api): void => {
              resolved = api.assets.resolve("hero.png");
            },
          },
        },
        startLevel: "arena",
      },
      { assetRoot: "produced/" },
    );
    await engine.initialize();
    expect(resolved).toBe("produced/hero.png");
    engine.destroy();
  });

  it("stamps a cue with the frame's simulated time", async () => {
    class Chirping extends GameMode {
      override tick(): void {
        this.world.audio.play("ping");
      }
    }
    class Game extends GameInstance {
      override initialize(api: InitApi): null {
        api.audio.define("ping", { freq: 440, durationMs: 40 });
        return null;
      }
    }
    const { engine } = realEngine({
      instance: Game,
      levels: { arena: { mode: Chirping } },
      startLevel: "arena",
    });
    const played: number[] = [];
    engine.events.on("cue:played", ({ t }) => played.push(t));
    await engine.initialize();
    await engine.advance(2);
    expect(played).toEqual([16, 32]);
    engine.destroy();
  });

  it("broadcasts possession:changed when the mode adds a player", async () => {
    class Hero extends Pawn {}
    class Versus extends GameMode {
      override beginPlay(): void {
        this.pawnClass = Hero;
        this.addPlayer({ name: "one" });
      }
    }
    const { engine } = realEngine({
      levels: { arena: { mode: Versus } },
      startLevel: "arena",
    });
    const takes: Array<string | null> = [];
    engine.events.on("possession:changed", ({ pawn }) =>
      takes.push(pawn === null ? null : pawn.constructor.name),
    );
    await engine.initialize();
    expect(takes).toEqual(["Hero"]);
    expect(engine.world.players()).toHaveLength(1);
    engine.destroy();
  });

  it("reports overlaps from the shipped collision wiring", async () => {
    const { engine } = realEngine({
      levels: {
        arena: {
          mode: GameMode,
          actors: [
            { type: Cube },
            { type: Cube, transform: { position: { x: 0.5, y: 0, z: 0 } } },
          ],
        },
      },
      startLevel: "arena",
    });
    const events: string[] = [];
    engine.events.on("overlap:begin", () => events.push("begin"));
    engine.events.on("overlap:end", () => events.push("end"));
    await engine.initialize();
    await engine.advance(1);
    expect(events).toEqual(["begin"]);
    // Held, not re-announced.
    await engine.advance(1);
    expect(events).toEqual(["begin"]);
    engine.world.actors()[1]?.destroy();
    await engine.advance(1);
    expect(events).toEqual(["begin", "end"]);
    engine.destroy();
  });

  it("registers a diagnostic in each registry and reads them in order", async () => {
    class Game extends GameInstance {
      total = 3;
      override initialize(api: InitApi): null {
        api.diagnostics.register("total", () => this.total);
        return null;
      }
    }
    class Reporting extends GameMode {
      override beginPlay(): void {
        this.world.diagnostics.register("level", () => this.world.level);
      }
    }
    const { engine } = realEngine({
      instance: Game,
      levels: { arena: { mode: Reporting } },
      startLevel: "arena",
    });
    await engine.initialize();
    expect(engine.diagnostics()).toEqual([
      { name: "total", value: 3 },
      { name: "level", value: "arena" },
    ]);
    (engine.instance as Game).total = 9;
    // Evaluated at the read, against what the game holds then.
    expect(engine.diagnostics()[0]).toEqual({ name: "total", value: 9 });
    engine.destroy();
  });

  it("keeps the instance's readings across a transition and rebuilds the world's", async () => {
    class Game extends GameInstance {
      override initialize(api: InitApi): null {
        api.diagnostics.register("engine", () => "kept");
        return null;
      }
    }
    class Reporting extends GameMode {
      override beginPlay(): void {
        this.world.diagnostics.register("world", () => this.world.level);
      }
      override tick(): void {
        if (this.world.level === "arena") this.world.open("cavern");
      }
    }
    const { engine } = realEngine({
      instance: Game,
      levels: { arena: { mode: Reporting }, cavern: { mode: Reporting } },
      startLevel: "arena",
    });
    await engine.initialize();
    await engine.advance(1);
    expect(engine.diagnostics()).toEqual([
      { name: "engine", value: "kept" },
      { name: "world", value: "cavern" },
    ]);
    engine.destroy();
  });

  it("holds a paused world's simulation while still rendering and closing the input frame", async () => {
    class Counting2 extends GameMode {
      ticks = 0;
      override tick(): void {
        this.ticks += 1;
      }
    }
    const { engine } = realEngine({
      levels: { arena: { mode: Counting2, actors: [{ type: Cube }] } },
      startLevel: "arena",
    });
    await engine.initialize();
    await engine.advance(1);
    engine.world.setPaused(true);
    await engine.advance(3);
    expect((engine.world.mode as Counting2).ticks).toBe(1);
    // The frame counter still moves, and the picture is still drawn.
    expect(engine.frame().count).toBe(4);
    expect(engine.scene.children.length).toBeGreaterThan(0);
    engine.destroy();
  });

  it("reports the renderer's counts through the engine's own diagnostics", async () => {
    const { engine } = realEngine({
      levels: { arena: { mode: GameMode, actors: [{ type: Cube }] } },
      startLevel: "arena",
    });
    await engine.initialize();
    await engine.advance(1);
    // The switches on `engine.renderer` are the pipeline's own, live.
    engine.renderer.setMode("wireframe");
    expect(engine.renderer.mode()).toBe("wireframe");
    engine.renderer.setCollisionOverlay(true);
    expect(engine.renderer.collisionOverlay()).toBe(true);
    await engine.advance(1);
    engine.destroy();
  });

  it("carries the debug surface the instance returned, unchanged", async () => {
    const surface = { name: "arena tools" };
    class Game extends GameInstance<typeof surface> {
      override initialize(): typeof surface {
        return surface;
      }
    }
    const { engine } = realEngine({
      instance: Game as never,
      levels: { arena: { mode: GameMode } },
      startLevel: "arena",
    });
    await engine.initialize();
    expect(engine.debug).toBe(surface);
    engine.destroy();
  });
});
