import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";

import { Actor, Pawn } from "./actors";
import { WorldCamera } from "./camera";
import { ConstantClock } from "./clocks";
import { ColliderComponent } from "./collision";
import {
  Component,
  LightComponent,
  MeshComponent,
  ShapeComponent,
} from "./components";
import type {
  CameraSnapshot,
  DiagnosticValue,
  EndPlayReason,
  SurfaceMetrics,
  TouchLayout,
} from "./contract";
import { PlayerController } from "./controllers";
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
import type { EngineEventMap } from "./events";
import type { World } from "./worlds";
import {
  createContextlessCanvas,
  createStage,
  createStubCanvas,
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

  /**
   * The screen layer's two refusals, reached through the factory rather than
   * through the pipeline that raises them. The errors table attributes both to
   * `createEngine`, and a build reads that table rather than the module list, so
   * what has to hold is that the refusal survives the engine's own wiring: the
   * pipeline is constructed first, before any argument measured against it, and
   * nothing between the option and the constructor drops or defaults it.
   */
  it("refuses a stage canvas with no owning document when no screen is supplied", () => {
    const stage = createStubCanvas({ width: 640, height: 360 });
    Object.defineProperty(stage.canvas, "ownerDocument", {
      value: null,
      configurable: true,
    });
    expect(() => build({ canvas: stage.canvas, screen: undefined })).toThrow(
      /`screen`/,
    );
  });

  it("refuses a screen canvas that yields no 2D context, naming the option", () => {
    expect(() => build({ screen: createContextlessCanvas() })).toThrow(
      /2D context from the screen canvas/,
    );
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
    // A contextless screen canvas and a bad layout: the screen wins, because
    // the layer drawn over the picture is still part of the surface and comes
    // before the arguments measured against it.
    expect(() =>
      build({ screen: createContextlessCanvas(), layout: "not-a-layout" }),
    ).toThrow(/2D context from the screen canvas/);
    // A contextless stage canvas and a contextless screen: the stage wins, so a
    // build is told about the surface everything else is drawn on first.
    expect(() =>
      build({
        canvas: contextless,
        screen: createContextlessCanvas(),
      }),
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

/* -------------------------------------------------------------------------- */
/* The screen layer the engine draws its HUD on                               */
/* -------------------------------------------------------------------------- */

/**
 * Where the layer comes from, and what a refusal costs.
 *
 * The two refusals themselves are asserted with the rest of the errors table
 * above; what is left is the half of the option that is not a refusal — the
 * canvas the engine makes for itself, and the supplied canvas that makes the
 * question moot — together with the disposal a refusal after the pipeline owes,
 * and the one ordering pair the table's own row for `screen` fixes.
 */
describe("the screen layer the engine draws its HUD on", () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => {
    while (cleanup.length > 0) cleanup.pop()?.();
  });

  /**
   * A surface with no element behind it, for the canvases below that have no
   * document either: the default surface reads the canvas's owning document for
   * its ratio and its listeners, which an orphaned canvas cannot answer.
   */
  const detached: SurfaceMetrics = (() => {
    const target = new EventTarget();
    return {
      cssWidth: (): number => 320,
      cssHeight: (): number => 180,
      dpr: (): number => 1,
      events: (): EventTarget => target,
    };
  })();

  /** `assembleEngine` over fakes with nothing defaulted, for the odd canvases. */
  function assemble(overrides: Partial<EngineOptions>): Engine {
    return assembleEngine(
      {
        canvas: createStubCanvas().canvas,
        width: 640,
        height: 360,
        game: definition(),
        surface: detached,
        ...overrides,
      },
      () => fakes().subsystems,
    );
  }

  it("takes the supplied screen canvas over the document, whatever the document holds", () => {
    const stage = createStubCanvas();
    Object.defineProperty(stage.canvas, "ownerDocument", {
      value: null,
      configurable: true,
    });
    const screen = createStubCanvas();
    expect(() =>
      assemble({ canvas: stage.canvas, screen: screen.canvas }),
    ).not.toThrow();
  });

  it("makes the screen canvas from the stage canvas's own document when none is supplied", async () => {
    const contexts = installCanvasContexts();
    cleanup.push(() => contexts.uninstall());
    const { engine, fixture } = build({ screen: undefined });
    await engine.initialize();
    await engine.advance(1);
    // The overlay draws on the layer, so a frame that got as far as drawing it
    // had a screen context to draw through.
    expect(fixture.log).toContain("diagnostics.draw");
    engine.destroy();
  });

  it("leaves no renderer behind when the screen canvas is refused", () => {
    const stage = createStubCanvas();
    const live = watchContextLoss(stage.canvas);
    expect(() =>
      assemble({ canvas: stage.canvas, screen: createContextlessCanvas() }),
    ).toThrow(/2D context from the screen canvas/);
    // The refusal lands before the renderer is built, so there is nothing to
    // give back and nothing left holding the context: a page that retries
    // construction does not run the browser out of them.
    expect(live()).toBe(0);
  });

  it("refuses the missing document before an argument measured against it", () => {
    const orphan = createStubCanvas();
    Object.defineProperty(orphan.canvas, "ownerDocument", {
      value: null,
      configurable: true,
    });
    expect(() =>
      assemble({
        canvas: orphan.canvas,
        game: { levels: { arena: { mode: GameMode } }, startLevel: "nowhere" },
      }),
    ).toThrow(/no owning document/);
  });
});

/* -------------------------------------------------------------------------- */
/* The options the engine threads through                                     */
/* -------------------------------------------------------------------------- */

/**
 * Each option, asserted where it lands rather than where it was given.
 *
 * An option that is read but never applied is invisible to a type and to a
 * construction test alike, so every one of these is checked through the thing
 * it is supposed to change: the GL calls a frame makes, the state of the screen
 * layer's context, what the game's own `initialize` is handed.
 */
describe("the options the engine threads through", () => {
  it("clears the whole canvas to `background`, and to transparency without one", async () => {
    const opaque = build({ background: "#ff0000" });
    await opaque.engine.initialize();
    opaque.stage.stage.gl.forget();
    await opaque.engine.advance(1);
    const cleared = opaque.stage.stage.gl.callsTo("clearColor");
    expect(cleared.length).toBeGreaterThan(0);
    // Compared as floats: the color travels through three's working color space
    // on its way to the context, and a round trip is not bit-exact.
    const [r, g, b, a] = cleared[0]?.args as [number, number, number, number];
    expect(r).toBeCloseTo(1, 6);
    expect(g).toBeCloseTo(0, 6);
    expect(b).toBeCloseTo(0, 6);
    expect(a).toBe(1);
    opaque.engine.destroy();

    const clear = build();
    await clear.engine.initialize();
    clear.stage.stage.gl.forget();
    await clear.engine.advance(1);
    // No background is transparency rather than black: the alpha is what says
    // so, and the color behind it is never seen.
    expect(clear.stage.stage.gl.callsTo("clearColor")[0]?.args).toEqual([
      0, 0, 0, 0,
    ]);
    expect(clear.stage.stage.gl.callsTo("clear").length).toBeGreaterThan(0);
    clear.engine.destroy();
  });

  it("installs `imageSmoothing` on the screen layer's context every frame", async () => {
    const crisp = build({ imageSmoothing: false });
    await crisp.engine.initialize();
    await crisp.engine.advance(1);
    expect(crisp.stage.screen.context2d.ctx.imageSmoothingEnabled).toBe(false);
    crisp.engine.destroy();

    const smooth = build();
    await smooth.engine.initialize();
    await smooth.engine.advance(1);
    expect(smooth.stage.screen.context2d.ctx.imageSmoothingEnabled).toBe(true);
    smooth.engine.destroy();
  });

  it("enables shadow maps only when `shadows` is set, as an off-screen pass", async () => {
    class Sun extends Actor {
      constructor() {
        super();
        this.attach(
          new LightComponent({
            light: { kind: "directional", castShadow: true },
          }),
        );
      }
    }
    class Ground extends Actor {
      constructor() {
        super();
        const mesh = new MeshComponent({
          geometry: { kind: "box", width: 4, height: 1, depth: 4 },
        });
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.attach(mesh);
      }
    }
    const game: GameDefinition = {
      levels: {
        arena: { mode: GameMode, actors: [{ type: Sun }, { type: Ground }] },
      },
      startLevel: "arena",
    };

    const dark = realEngine(game);
    await dark.engine.initialize();
    dark.stage.stage.gl.forget();
    await dark.engine.advance(1);
    // A shadow pass renders the scene into a depth target first, which is the
    // only thing in the documented pipeline that attaches a texture to a
    // framebuffer of its own.
    expect(dark.stage.stage.gl.callsTo("framebufferTexture2D")).toHaveLength(0);
    dark.engine.destroy();

    const lit = realEngine(game, { shadows: true });
    await lit.engine.initialize();
    lit.stage.stage.gl.forget();
    await lit.engine.advance(1);
    expect(
      lit.stage.stage.gl.callsTo("framebufferTexture2D").length,
    ).toBeGreaterThan(0);
    lit.engine.destroy();
  });

  it("hands the game the layout it was built with, and none without one", async () => {
    const seen: Array<TouchLayout | null> = [];
    class Game extends GameInstance {
      override initialize(api: InitApi): null {
        seen.push(api.input.layout());
        return null;
      }
    }
    const game: GameDefinition = {
      instance: Game,
      levels: { arena: { mode: GameMode } },
      startLevel: "arena",
    };
    const bare = realEngine(game);
    await bare.engine.initialize();
    bare.engine.destroy();
    const dual = realEngine(game, { layout: "dual-stick" });
    await dual.engine.initialize();
    dual.engine.destroy();

    expect(seen[0]).toBeNull();
    expect(seen[1]?.name).toBe("dual-stick");
    expect(seen[1]?.actions.length).toBeGreaterThan(0);
  });

  it("resolves every asset path under `assetRoot`, defaulting to assets/", async () => {
    const seen: string[] = [];
    class Game extends GameInstance {
      override initialize(api: InitApi): null {
        seen.push(api.assets.resolve("sprites/hero.png"));
        return null;
      }
    }
    const game: GameDefinition = {
      instance: Game,
      levels: { arena: { mode: GameMode } },
      startLevel: "arena",
    };
    const fallback = realEngine(game);
    await fallback.engine.initialize();
    fallback.engine.destroy();
    const rooted = realEngine(game, { assetRoot: "content/" });
    await rooted.engine.initialize();
    rooted.engine.destroy();

    expect(seen).toEqual([
      "assets/sprites/hero.png",
      "content/sprites/hero.png",
    ]);
  });

  it("reads the canvas's own document when no surface is supplied", () => {
    // The default surface listens on the canvas's owning document, so the key
    // that toggles the overlay is heard from anywhere on the page rather than
    // only while the canvas itself has focus.
    const { engine, fixture } = build({ surface: undefined });
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "Backquote" }));
    expect(fixture.toggles).toBe(1);
    engine.destroy();
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "Backquote" }));
    expect(fixture.toggles).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* The frame order, from the game's side                                      */
/* -------------------------------------------------------------------------- */

/**
 * The eleven-step order, asserted by its consequences rather than by its calls.
 *
 * The unit half already proves the engine issues the steps in order over the
 * ports; what a build actually depends on is what each position *buys* it — a
 * pawn that sees its controller's drive in the frame the controller wrote it, a
 * timer that observes the world the frame already moved, a mode that decides
 * from a settled world with this frame's overlaps reported, a destroy that no
 * tick observes half-finished, and an edge that every controller got a look at
 * before it was discarded. Each test below breaks if its step moves.
 */
describe("the frame order, from the game's side", () => {
  it("lets a pawn read, in the same frame, the drive its controller wrote", async () => {
    const seen: number[] = [];
    class Hero extends Pawn {
      drive = 0;
      override tick(): void {
        seen.push(this.drive);
      }
    }
    class Driver extends PlayerController {
      override tick(): void {
        const pawn = this.pawn as Hero | null;
        if (pawn !== null) pawn.drive += 1;
      }
    }
    class Mode extends GameMode {
      override pawnClass = Hero;
      override playerControllerClass = Driver;
      override beginPlay(): void {
        this.addPlayer();
      }
    }
    const { engine } = realEngine({
      levels: { arena: { mode: Mode } },
      startLevel: "arena",
    });
    await engine.initialize();
    await engine.advance(2);
    // Step 4 before step 5: the pawn never reads last frame's drive.
    expect(seen).toEqual([1, 2]);
    engine.destroy();
  });

  it("ticks actors in spawn order, each one's components after it in attachment order", async () => {
    const log: string[] = [];
    class Marker extends Component {
      readonly label: string;
      constructor(label: string) {
        super();
        this.label = label;
      }
      override tick(): void {
        log.push(this.label);
      }
    }
    class First extends Actor {
      constructor() {
        super();
        this.attach(new Marker("first.a"));
        this.attach(new Marker("first.b"));
      }
      override tick(): void {
        log.push("first");
      }
    }
    class Second extends Actor {
      constructor() {
        super();
        this.attach(new Marker("second.a"));
      }
      override tick(): void {
        log.push("second");
      }
    }
    const { engine } = realEngine({
      levels: {
        arena: { mode: GameMode, actors: [{ type: First }, { type: Second }] },
      },
      startLevel: "arena",
    });
    await engine.initialize();
    await engine.advance(1);
    expect(log).toEqual(["first", "first.a", "first.b", "second", "second.a"]);
    engine.destroy();
  });

  it("fires a timer due this frame after every tick of that frame", async () => {
    const log: string[] = [];
    class Ticker extends Actor {
      override beginPlay(): void {
        this.world.after(0.01, () => log.push("timer"));
      }
      override tick(): void {
        log.push("tick");
      }
    }
    const { engine } = realEngine({
      levels: { arena: { mode: GameMode, actors: [{ type: Ticker }] } },
      startLevel: "arena",
    });
    await engine.initialize();
    // One 16 ms frame carries world time past the 10 ms the timer waits for.
    await engine.advance(1);
    expect(log).toEqual(["tick", "timer"]);
    engine.destroy();
  });

  it("reports a pair this frame's movement produced, before the mode decides on it", async () => {
    const log: string[] = [];
    class Target extends Actor {
      constructor() {
        super();
        this.attach(
          new ColliderComponent({
            shape: { kind: "box", width: 1, height: 1, depth: 1 },
            responses: { default: "overlap" },
          }),
        );
      }
    }
    class Charger extends Target {
      override tick(): void {
        log.push("charger");
        this.transform.position = { x: 0, y: 0, z: 0 };
      }
    }
    class Mode extends GameMode {
      override tick(): void {
        log.push("mode");
      }
    }
    const { engine } = realEngine({
      levels: {
        arena: {
          mode: Mode,
          actors: [
            { type: Target },
            { type: Charger, transform: { position: { x: 8, y: 0, z: 0 } } },
          ],
        },
      },
      startLevel: "arena",
    });
    engine.events.on("overlap:begin", () => log.push("overlap"));
    await engine.initialize();
    await engine.advance(1);
    // Step 7 after step 5, step 8 after step 7: the pair the charger's own
    // tick produced is reported in that frame, and the mode ticks knowing it.
    expect(log).toEqual(["charger", "overlap", "mode"]);
    engine.destroy();
  });

  it("removes a destroyed actor after every tick and the mode's, not during", async () => {
    const log: string[] = [];
    class Doomed extends Actor {
      override tick(): void {
        log.push("doomed.tick");
        this.destroy();
      }
      override endPlay(reason: EndPlayReason): void {
        log.push(`doomed.endPlay:${reason}`);
      }
    }
    class Later extends Actor {
      override tick(): void {
        log.push("later.tick");
      }
    }
    class Mode extends GameMode {
      override tick(): void {
        log.push("mode.tick");
      }
    }
    const { engine } = realEngine({
      levels: {
        arena: { mode: Mode, actors: [{ type: Doomed }, { type: Later }] },
      },
      startLevel: "arena",
    });
    await engine.initialize();
    await engine.advance(1);
    // Step 9 last of the simulation: a tick never observes a half-removed
    // world, and the actor behind the doomed one still gets its frame.
    expect(log).toEqual([
      "doomed.tick",
      "later.tick",
      "mode.tick",
      "doomed.endPlay:destroyed",
    ]);
    engine.destroy();
  });

  it("closes the input frame after every controller has had the edge", async () => {
    const reads: Array<[number, boolean]> = [];
    class Reader extends PlayerController {
      override tick(): void {
        reads.push([this.index, this.input.pressed("jump")]);
      }
    }
    class Mode extends GameMode {
      override playerControllerClass = Reader;
      override beginPlay(): void {
        this.addPlayer();
        this.addPlayer();
      }
    }
    class Game extends GameInstance {
      override initialize(api: InitApi): null {
        api.input.register("jump", { keys: ["Space"] });
        return null;
      }
    }
    const { engine, stage } = realEngine({
      instance: Game,
      levels: { arena: { mode: Mode } },
      startLevel: "arena",
    });
    await engine.initialize();
    stage.surface.target.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Space" }),
    );
    await engine.advance(1);
    // Step 11 last: both controllers consumed their own copy of the one edge,
    // and it is gone by the next frame.
    expect(reads).toEqual([
      [0, true],
      [1, true],
    ]);
    await engine.advance(1);
    expect(reads.slice(2)).toEqual([
      [0, false],
      [1, false],
    ]);
    engine.destroy();
  });

  it("takes the fit before any tick runs, so a tick reads the frame it renders through", async () => {
    const seen: number[] = [];
    class Watcher extends Actor {
      override tick(): void {
        seen.push(this.world.viewport().scale);
      }
    }
    const stage = createStage({ cssWidth: 320, cssHeight: 180, dpr: 1 });
    let ratio = 1;
    const surface: SurfaceMetrics = {
      cssWidth: (): number => stage.surface.surface.cssWidth(),
      cssHeight: (): number => stage.surface.surface.cssHeight(),
      dpr: (): number => ratio,
      events: (): EventTarget => stage.surface.target,
    };
    const engine = createEngine({
      canvas: stage.stage.canvas,
      screen: stage.screen.canvas,
      width: 640,
      height: 360,
      clock: new ConstantClock(16),
      surface,
      game: {
        levels: { arena: { mode: GameMode, actors: [{ type: Watcher }] } },
        startLevel: "arena",
      },
    });
    await engine.initialize();
    await engine.advance(1);
    ratio = 3;
    await engine.advance(1);
    // Step 3 before step 4: the second frame's tick already reads the ratio
    // that frame renders through rather than the one before it.
    expect(seen[1]).toBe(engine.viewport().scale);
    expect(seen[1]).not.toBe(seen[0]);
    engine.destroy();
  });

  it("skips steps 4 through 8 while paused, except an actor that opted in", async () => {
    const log: string[] = [];
    class Marker extends Component {
      override tick(): void {
        log.push("component");
      }
    }
    class Sleeper extends Actor {
      override tick(): void {
        log.push("sleeper");
      }
    }
    class Menu extends Actor {
      constructor() {
        super();
        this.tickWhenPaused = true;
        this.attach(new Marker());
      }
      override tick(): void {
        log.push("menu");
      }
    }
    class Mode extends GameMode {
      override beginPlay(): void {
        this.world.setPaused(true);
      }
      override tick(): void {
        log.push("mode");
      }
    }
    const { engine } = realEngine({
      levels: {
        arena: { mode: Mode, actors: [{ type: Sleeper }, { type: Menu }] },
      },
      startLevel: "arena",
    });
    await engine.initialize();
    const before = engine.world.time;
    await engine.advance(3);
    // The pause menu drives itself, and its components with it; nothing else
    // moves, and the world's own clock stands still.
    expect(log).toEqual([
      "menu",
      "component",
      "menu",
      "component",
      "menu",
      "component",
    ]);
    expect(engine.world.time).toBe(before);
    // The frame counter belongs to the loop rather than to the world, so it
    // advances regardless.
    expect(engine.frame().count).toBe(3);
    engine.destroy();
  });
});

/* -------------------------------------------------------------------------- */
/* The whole event map, over the shipped wiring                               */
/* -------------------------------------------------------------------------- */

/**
 * Every entry of `EngineEventMap`, reached the way a game reaches it.
 *
 * The broadcaster itself is proved in `events.test.ts`; what is asserted here is
 * that each announcement is actually *made*, by the subsystem the table names,
 * through the one bus `engine.events` hands out — which is the only thing that
 * makes a validator's subscription a complete account of a run.
 */
describe("the whole event map, over the shipped wiring", () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => {
    while (cleanup.length > 0) cleanup.pop()?.();
  });

  /** Every payload of `event`, in the order the engine announced them. */
  function collect<K extends keyof EngineEventMap>(
    engine: Engine,
    event: K,
  ): EngineEventMap[K][] {
    const seen: EngineEventMap[K][] = [];
    engine.events.on(event, (payload) => seen.push(payload));
    return seen;
  }

  it("announces every actor spawned and destroyed, carrying the actor", async () => {
    class Spawner extends GameMode {
      override beginPlay(): void {
        this.world.spawn(Cube);
      }
    }
    const { engine } = realEngine({
      levels: { arena: { mode: Spawner, actors: [{ type: Cube }] } },
      startLevel: "arena",
    });
    const spawned = collect(engine, "actor:spawned");
    const destroyed = collect(engine, "actor:destroyed");
    await engine.initialize();
    // The level's own actor, then the one the mode's `beginPlay` added.
    expect(spawned).toHaveLength(2);
    expect(spawned[0]?.actor).toBeInstanceOf(Cube);
    expect(destroyed).toEqual([]);

    engine.world.actors()[0]?.destroy();
    await engine.advance(1);
    expect(destroyed).toHaveLength(1);
    expect(destroyed[0]?.actor).toBe(spawned[0]?.actor);
    engine.destroy();
  });

  it("announces a phase change with the phase it left, and nothing for a repeat", async () => {
    class Mode extends GameMode {
      override beginPlay(): void {
        this.setPhase("playing");
        this.setPhase("playing");
      }
    }
    const { engine } = realEngine({
      levels: { arena: { mode: Mode } },
      startLevel: "arena",
    });
    const phases = collect(engine, "match:phase");
    await engine.initialize();
    expect(phases).toEqual([{ phase: "playing", previous: "waiting" }]);
    engine.world.mode.setPhase("over");
    expect(phases[1]).toEqual({ phase: "over", previous: "playing" });
    engine.destroy();
  });

  it("announces a cue played, looped, and stopped, stamped with the frame's time", async () => {
    class Game extends GameInstance {
      override initialize(api: InitApi): null {
        api.audio.define("ping", { freq: 440, durationMs: 40 });
        api.audio.define("hum", { freq: 110, durationMs: 200 });
        return null;
      }
    }
    const { engine } = realEngine({
      instance: Game,
      levels: { arena: { mode: GameMode } },
      startLevel: "arena",
    });
    const played = collect(engine, "cue:played");
    const looped = collect(engine, "cue:looped");
    const stopped = collect(engine, "cue:stopped");
    await engine.initialize();
    await engine.advance(2);

    engine.world.audio.play("ping", { at: { x: 1, y: 2, z: 3 } });
    engine.world.audio.loop("hum");
    engine.world.audio.stop("hum");

    // `t` is the frame's simulated time rather than wall time, so a cue lines
    // up with the `frame().timeMs` a check asserts against.
    expect(played[0]?.cue).toBe("ping");
    expect(played[0]?.t).toBe(engine.frame().timeMs);
    expect(played[0]?.at).toEqual({ x: 1, y: 2, z: 3 });
    expect(looped[0]?.cue).toBe("hum");
    expect(looped[0]?.at).toBeNull();
    expect(stopped[0]).toEqual({ cue: "hum", t: engine.frame().timeMs });
    engine.destroy();
  });

  it("announces the audio unlock once, on the first gesture the surface sees", async () => {
    const { engine, stage } = realEngine({
      levels: { arena: { mode: GameMode } },
      startLevel: "arena",
    });
    const unlocked = collect(engine, "audio:unlocked");
    await engine.initialize();
    expect(unlocked).toEqual([]);
    stage.surface.target.dispatchEvent(new Event("pointerdown"));
    stage.surface.target.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyA" }),
    );
    expect(unlocked).toHaveLength(1);
    engine.destroy();
  });

  it("announces an asset the loader refused, with no url to blame", async () => {
    const { engine } = realEngine({
      levels: { arena: { mode: GameMode } },
      startLevel: "arena",
    });
    const failed = collect(engine, "asset:failed");
    await engine.initialize();
    await expect(engine.world.assets.load("../outside.png")).rejects.toThrow();
    // An empty url is the unambiguous signature of a path the engine refused
    // rather than a file that resolved and was missing.
    expect(failed[0]?.path).toBe("../outside.png");
    expect(failed[0]?.url).toBe("");
    expect(failed[0]?.reason).toMatch(/\.\./);
    engine.destroy();
  });

  it("announces an asset that arrived, with the url it resolved under", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (): Promise<Response> =>
      new Response(new Blob(["ok"]))) as typeof globalThis.fetch;
    cleanup.push(() => {
      globalThis.fetch = original;
    });
    const { engine } = realEngine(
      { levels: { arena: { mode: GameMode } }, startLevel: "arena" },
      { assetRoot: "content/" },
    );
    const loaded = collect(engine, "asset:loaded");
    await engine.initialize();
    await engine.world.assets.load("levels/arena.json");
    expect(loaded).toEqual([
      { path: "levels/arena.json", url: "content/levels/arena.json" },
    ]);
    engine.destroy();
  });

  it("ends an overlap when one of its actors is destroyed", async () => {
    const { engine } = realEngine({
      levels: {
        arena: {
          mode: GameMode,
          actors: [{ type: Cube }, { type: Cube }],
        },
      },
      startLevel: "arena",
    });
    const begun = collect(engine, "overlap:begin");
    const ended = collect(engine, "overlap:end");
    await engine.initialize();
    await engine.advance(1);
    expect(begun).toHaveLength(1);
    expect(ended).toEqual([]);

    engine.world.actors()[1]?.destroy();
    await engine.advance(1);
    // The pair ends because one side left, not because the pass stopped finding
    // it: the colliders it names are still the two it began with.
    expect(ended).toHaveLength(1);
    expect(ended[0]?.colliders[0]).toBe(begun[0]?.colliders[0]);
    expect(ended[0]?.colliders[1]).toBe(begun[0]?.colliders[1]);
    engine.destroy();
  });

  it("reports a blocking pair as a hit, with a manifold, on every frame it holds", async () => {
    class Blocker extends Actor {
      constructor() {
        super();
        this.attach(
          new ColliderComponent({
            shape: { kind: "sphere", radius: 1 },
            responses: { default: "block" },
          }),
        );
      }
    }
    const { engine } = realEngine({
      levels: {
        arena: {
          mode: GameMode,
          actors: [
            { type: Blocker },
            { type: Blocker, transform: { position: { x: 1, y: 0, z: 0 } } },
          ],
        },
      },
      startLevel: "arena",
    });
    const hits = collect(engine, "hit");
    await engine.initialize();
    await engine.advance(2);
    // Nothing the engine reports moves anything, so the pair is still blocking
    // on the second frame and is reported again.
    expect(hits).toHaveLength(2);
    expect(hits[0]?.manifold.depth).toBeCloseTo(1, 5);
    expect(hits[0]?.manifold.normal).toEqual({ x: 1, y: 0, z: 0 });
    expect(hits[0]?.manifold.point).toEqual({ x: 0.5, y: 0, z: 0 });
    engine.destroy();
  });

  it("contains a handler that throws, and still runs the ones after it", async () => {
    const seen: string[] = [];
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]): void => {
      errors.push(args[0]);
    };
    cleanup.push(() => {
      console.error = original;
    });
    const { engine } = realEngine({
      levels: { arena: { mode: GameMode } },
      startLevel: "arena",
    });
    engine.events.on("world:opened", () => {
      throw new Error("a subscriber's own mistake");
    });
    engine.events.on("world:opened", ({ level }) => seen.push(level));
    await expect(engine.initialize()).resolves.toBeDefined();
    expect(seen).toEqual(["arena"]);
    expect(errors).toHaveLength(1);
    engine.destroy();
  });

  it("removes a handler through the function `on` returned", async () => {
    const { engine } = realEngine({
      levels: {
        arena: { mode: GameMode, actors: [{ type: Cube }] },
        cavern: { mode: GameMode },
      },
      startLevel: "arena",
    });
    const seen: string[] = [];
    const off = engine.events.on("world:opened", ({ level }) =>
      seen.push(level),
    );
    await engine.initialize();
    off();
    off();
    engine.world.open("cavern");
    await engine.advance(1);
    expect(engine.world.level).toBe("cavern");
    expect(seen).toEqual(["arena"]);
    engine.destroy();
  });
});

/* -------------------------------------------------------------------------- */
/* The lifecycle's remaining edges                                            */
/* -------------------------------------------------------------------------- */

describe("the lifecycle's remaining edges", () => {
  it("rejects initialize with the cause when the start level's load throws", async () => {
    const cause = new Error("the level's manifest is missing");
    const { engine } = realEngine({
      levels: {
        arena: {
          mode: GameMode,
          load: (): never => {
            throw cause;
          },
        },
      },
      startLevel: "arena",
    });
    await expect(engine.initialize()).rejects.toBe(cause);
    // The world never opened, so the gate is still shut.
    expect(() => engine.world).toThrow(/before initialize\(\) resolved/);
    engine.destroy();
  });

  it("rejects initialize with the cause when an actor's beginPlay throws", async () => {
    const cause = new Error("this actor needs a peer that is not here");
    class Fragile extends Actor {
      override beginPlay(): never {
        throw cause;
      }
    }
    const { engine } = realEngine({
      levels: { arena: { mode: GameMode, actors: [{ type: Fragile }] } },
      startLevel: "arena",
    });
    await expect(engine.initialize()).rejects.toBe(cause);
    engine.destroy();
  });

  it("rejects initialize with the cause when the game mode's beginPlay throws", async () => {
    const cause = new Error("the mode cannot seat its players");
    class Fragile extends GameMode {
      override beginPlay(): never {
        throw cause;
      }
    }
    const { engine } = realEngine({
      levels: { arena: { mode: Fragile } },
      startLevel: "arena",
    });
    await expect(engine.initialize()).rejects.toBe(cause);
    engine.destroy();
  });

  it("leaves the start level unopened when a destroy races initialize", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let shutdowns = 0;
    class Slow extends GameInstance {
      override async initialize(): Promise<null> {
        await gate;
        return null;
      }
      override shutdown(): void {
        shutdowns += 1;
      }
    }
    const { engine } = realEngine({
      instance: Slow,
      levels: { arena: { mode: GameMode } },
      startLevel: "arena",
    });
    const opened: string[] = [];
    engine.events.on("world:opened", ({ level }) => opened.push(level));
    const started = engine.initialize();
    engine.destroy();
    release();
    await expect(started).resolves.toBeInstanceOf(Slow);
    // The engine is torn down, so opening the start level into it would
    // resurrect a world nothing will ever close — and the instance whose
    // `initialize` did run is shut down rather than left standing.
    expect(opened).toEqual([]);
    expect(shutdowns).toBe(1);
    expect(() => engine.world).toThrow(/before initialize\(\) resolved/);
  });

  it("runs the instance's shutdown exactly once however destroy is reached", async () => {
    let shutdowns = 0;
    class Game extends GameInstance {
      override shutdown(): void {
        shutdowns += 1;
      }
    }
    const { engine } = realEngine({
      instance: Game,
      levels: { arena: { mode: GameMode } },
      startLevel: "arena",
    });
    await engine.initialize();
    engine.destroy();
    engine.destroy();
    expect(shutdowns).toBe(1);
  });

  it("ends play for the open world's actors and mode when the engine is destroyed", async () => {
    const log: string[] = [];
    class Watched extends Actor {
      override endPlay(reason: EndPlayReason): void {
        log.push(`actor:${reason}`);
      }
    }
    class Mode extends GameMode {
      override endPlay(reason: EndPlayReason): void {
        log.push(`mode:${reason}`);
      }
    }
    const { engine } = realEngine({
      levels: { arena: { mode: Mode, actors: [{ type: Watched }] } },
      startLevel: "arena",
    });
    await engine.initialize();
    engine.destroy();
    expect(log).toEqual(["actor:level-closed", "mode:level-closed"]);
  });

  it("halts a run on an abort and leaves the engine usable, unlike a destroy", async () => {
    const host = scriptedHost();
    const { engine } = build({}, host);
    await engine.initialize();
    const controller = new AbortController();
    const running = engine.run({ signal: controller.signal });
    host.step();
    controller.abort();
    await expect(running).resolves.toBeUndefined();
    // Aborting is a halt rather than a teardown: the engine still runs frames.
    const before = engine.frame().count;
    await engine.advance(2);
    expect(engine.frame().count).toBe(before + 2);
    engine.destroy();
  });
});

/* -------------------------------------------------------------------------- */
/* What a validator reaches through the engine                                */
/* -------------------------------------------------------------------------- */

/**
 * The idioms the validator pages are written in, run against the real pipeline.
 *
 * A suite reads a build through four things and no others: `engine.world` for
 * the framework objects, `engine.scene` for what the pipeline did with them,
 * `engine.advance` for stepping, and `engine.debug` for posing the scenario.
 * Every assertion below is one of the documented shapes, so a change that broke
 * a published check breaks here first.
 */
describe("what a validator reaches through the engine", () => {
  /** The validators' own helper, copied from the rendering page verbatim. */
  function meshesAt(
    scene: THREE.Scene,
    point: { x: number; y: number; z: number },
    tolerance = 1e-3,
  ): THREE.Mesh[] {
    const target = new THREE.Vector3(point.x, point.y, point.z);
    const position = new THREE.Vector3();
    const found: THREE.Mesh[] = [];
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object.getWorldPosition(position).distanceTo(target) <= tolerance) {
        found.push(object);
      }
    });
    return found;
  }

  /** A ball the pipeline draws in a color a check can name. */
  class Ball extends Actor {
    constructor() {
      super();
      this.attach(
        new MeshComponent({
          geometry: { kind: "sphere", radius: 0.5 },
          material: { color: "#ff8800" },
        }),
      );
    }
  }

  it("finds the mesh the pipeline placed at an actor, and reads it back", async () => {
    const { engine } = realEngine({
      levels: {
        arena: {
          mode: GameMode,
          actors: [
            {
              type: Ball,
              tags: ["ball"],
              transform: { position: { x: 2, y: 1, z: -3 } },
            },
          ],
        },
      },
      startLevel: "arena",
    });
    await engine.initialize();
    await engine.advance(1);

    const ball = engine.world.byTag("ball")[0];
    expect(ball).toBeDefined();
    const [mesh] = meshesAt(engine.scene, ball!.transform.position);
    expect(mesh).toBeDefined();
    expect(mesh!.visible).toBe(true);
    expect(mesh!.geometry.getAttribute("position").count).toBeGreaterThan(0);
    expect(
      `#${(mesh!.material as THREE.MeshStandardMaterial).color.getHexString()}`,
    ).toBe("#ff8800");
    engine.destroy();
  });

  it("drops a destroyed actor's object on the frame that removed it", async () => {
    const { engine } = realEngine({
      levels: { arena: { mode: GameMode, actors: [{ type: Ball }] } },
      startLevel: "arena",
    });
    await engine.initialize();
    await engine.advance(1);
    const ball = engine.world.actors()[0];
    expect(meshesAt(engine.scene, ball!.transform.position)).toHaveLength(1);

    ball!.destroy();
    await engine.advance(1);
    expect(meshesAt(engine.scene, ball!.transform.position)).toHaveLength(0);
    engine.destroy();
  });

  it("empties the scene of the outgoing world's objects across a transition", async () => {
    const { engine } = realEngine({
      levels: {
        arena: { mode: GameMode, actors: [{ type: Ball }] },
        cavern: { mode: GameMode },
      },
      startLevel: "arena",
    });
    await engine.initialize();
    await engine.advance(1);
    expect(meshesAt(engine.scene, { x: 0, y: 0, z: 0 })).toHaveLength(1);

    engine.world.open("cavern");
    await engine.advance(1);
    expect(engine.world.level).toBe("cavern");
    // The frame that performs the transition renders the world it opened, so
    // nothing of the outgoing one is left standing in the scene.
    expect(meshesAt(engine.scene, { x: 0, y: 0, z: 0 })).toHaveLength(0);
    engine.destroy();
  });

  it("puts a screen component's drawing on the screen layer, in logical units", async () => {
    class Hud extends Actor {
      constructor() {
        super();
        this.attach(
          new ShapeComponent({
            shape: { kind: "rect", width: 40, height: 10 },
            fill: "#00ff00",
          }),
        );
      }
    }
    const { engine, stage } = realEngine({
      levels: { arena: { mode: GameMode, actors: [{ type: Hud }] } },
      startLevel: "arena",
    });
    await engine.initialize();
    stage.screen.context2d.forget();
    await engine.advance(1);
    // A shape is traced and then filled, so its size is on the `rect` and its
    // color on the `fill` that closes it.
    const traced = stage.screen.context2d.opsOf("rect");
    expect(traced).toHaveLength(1);
    expect(traced[0]?.args.slice(2)).toEqual([40, 10]);
    const filled = stage.screen.context2d
      .opsOf("fill")
      .filter((op) => op.fill === "#00ff00");
    expect(filled).toHaveLength(1);
    engine.destroy();
  });

  it("poses the world through the debug surface the instance returned", async () => {
    interface Tools {
      place(x: number): void;
      where(): number;
    }
    class Game extends GameInstance<Tools> {
      override initialize(): Tools {
        return {
          place: (x): void => {
            const ball = this.engine.world.actors()[0];
            if (ball) ball.transform.position = { x, y: 0, z: 0 };
          },
          where: (): number =>
            this.engine.world.actors()[0]?.transform.position.x ?? Number.NaN,
        };
      }
    }
    const { engine } = realEngine({
      instance: Game as never,
      levels: { arena: { mode: GameMode, actors: [{ type: Ball }] } },
      startLevel: "arena",
    });
    await engine.initialize();
    (engine.debug as Tools).place(4);
    await engine.advance(1);
    expect((engine.debug as Tools).where()).toBe(4);
    // The pose reaches the picture, which is what makes the surface a way to
    // drive the build rather than a second copy of its state.
    expect(meshesAt(engine.scene, { x: 4, y: 0, z: 0 })).toHaveLength(1);
    engine.destroy();
  });
});
