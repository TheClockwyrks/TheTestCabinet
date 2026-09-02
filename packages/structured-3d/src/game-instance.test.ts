import { describe, expect, it, vi } from "vitest";
import type {
  ActionBinding,
  CueSpec,
  DiagnosticValue,
  Model,
  Viewport,
} from "./contract";
import type { Engine } from "./engine";
import type { EngineEvents } from "./events";
import type { LevelDefinition, World } from "./worlds";
import {
  GameInstance,
  bindGameInstance,
  type GameDefinition,
  type GameInstanceClass,
  type InitApi,
} from "./game-instance";

/* -------------------------------------------------------------------------- */
/* Stand-ins                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A world stub carrying only what an instance and a debug surface read off one:
 * the level it was opened under, the game state the mode built, one movable
 * thing, and the world-scoped diagnostic registry.
 *
 * The real `World` is the worlds subsystem's, and nothing here depends on its
 * behaviour — the instance only ever hands the object back out, and a surface
 * operation only ever reads it. Keeping the stub small is what makes the
 * assertions about *which* world an operation reached legible.
 */
interface FakeWorld {
  readonly level: string;
  readonly state: { score: number; phase: string };
  readonly ball: { x: number; y: number; z: number };
  readonly sources: Map<string, () => DiagnosticValue>;
  readonly diagnostics: {
    register(name: string, source: () => DiagnosticValue): void;
  };
}

function makeWorld(level: string): FakeWorld {
  const sources = new Map<string, () => DiagnosticValue>();
  return {
    level,
    state: { score: 0, phase: "waiting" },
    ball: { x: 0, y: 0, z: 0 },
    sources,
    diagnostics: {
      register: (name, source) => {
        sources.set(name, source);
      },
    },
  };
}

const asWorld = (world: FakeWorld): World => world as unknown as World;

/** What {@link makeEngine} hands a test: the engine, its bus, and the dial. */
interface FakeEngine<D> {
  readonly engine: Engine<D>;
  readonly events: EngineEvents;
  /** Replaces the open world, as a transition does. */
  setWorld(world: FakeWorld): void;
}

/**
 * An engine stub whose `world` is a live getter over a mutable slot.
 *
 * That is the whole point of the stub: `engine.world` following a transition is
 * what makes a debug-surface operation written once reach whichever world is
 * open at the call, and a stub that handed back a fixed object could not
 * distinguish an operation that re-reads from one that closed over a world.
 */
function makeEngine<D>(): FakeEngine<D> {
  let current: FakeWorld | null = null;
  const events = { on: () => () => {} } as unknown as EngineEvents;
  const engine = {
    events,
    get world(): World {
      if (current === null) throw new Error("no world is open");
      return asWorld(current);
    },
  } as unknown as Engine<D>;
  return {
    engine,
    events,
    setWorld: (world) => {
      current = world;
    },
  };
}

/** A `Model` stand-in: the loaders' return value is held, never inspected. */
function makeModel(name: string): Model {
  return {
    scene: { name } as unknown as Model["scene"],
    animations: [],
    nodes: [name],
  };
}

/** Everything one {@link InitApi} recorded, beside the api itself. */
interface Recorded {
  readonly api: InitApi;
  readonly actions: { name: string; binding: ActionBinding }[];
  readonly cues: { cue: string; spec: CueSpec }[];
  readonly cueFiles: { cue: string; path: string }[];
  readonly sources: Map<string, () => DiagnosticValue>;
  readonly loaded: string[];
  readonly events: EngineEvents;
  viewports: number;
}

/**
 * An `InitApi` that records every declaration made through it.
 *
 * Everything an instance declares from `initialize` belongs to the whole game
 * and is expected to be declared exactly once, so a recorder — rather than a
 * set of spies read one at a time — is what lets a test assert both *what* was
 * declared and *how many times* across a run that opens several levels.
 */
function makeInitApi(
  options: { layout?: string; events?: EngineEvents } = {},
): Recorded {
  const actions: { name: string; binding: ActionBinding }[] = [];
  const cues: { cue: string; spec: CueSpec }[] = [];
  const cueFiles: { cue: string; path: string }[] = [];
  const sources = new Map<string, () => DiagnosticValue>();
  const loaded: string[] = [];
  const events =
    options.events ?? ({ on: () => () => {} } as unknown as EngineEvents);
  const recorded: Recorded = {
    actions,
    cues,
    cueFiles,
    sources,
    loaded,
    events,
    viewports: 0,
    api: {
      input: {
        register: (name, binding) => {
          actions.push({ name, binding });
        },
        layout: () =>
          options.layout === undefined
            ? null
            : { name: options.layout, actions: ["thrust", "pause"] },
      },
      audio: {
        define: (cue, spec) => {
          cues.push({ cue, spec });
        },
        load: async (cue, path) => {
          cueFiles.push({ cue, path });
        },
      },
      assets: {
        loadImage: async (path) => {
          loaded.push(path);
          return { width: 1, height: 1 } as unknown as ImageBitmap;
        },
        loadTexture: async (path) => {
          loaded.push(path);
          return { name: path } as unknown as Awaited<
            ReturnType<InitApi["assets"]["loadTexture"]>
          >;
        },
        loadModel: async (path) => {
          loaded.push(path);
          return makeModel(path);
        },
        loadAudio: async (path) => {
          loaded.push(path);
          return { duration: 1 } as unknown as AudioBuffer;
        },
        load: async (path) => {
          loaded.push(path);
          return new Blob([path]);
        },
        resolve: (path) => `assets/${path}`,
      },
      diagnostics: {
        register: (name, source) => {
          sources.set(name, source);
        },
      },
      events,
      viewport: (): Viewport => {
        recorded.viewports += 1;
        return { width: 640, height: 360, scale: 2, offsetX: 0, offsetY: 12 };
      },
    },
  };
  return recorded;
}

/* -------------------------------------------------------------------------- */
/* The scripted engine                                                        */
/* -------------------------------------------------------------------------- */

/** What {@link drive} hands back once it has opened every level named. */
interface Driven<D> {
  readonly instance: GameInstance<D>;
  readonly debug: D;
  readonly host: FakeEngine<D>;
  readonly recorded: Recorded;
  readonly worlds: FakeWorld[];
  /** The world currently open, as the scripted engine holds it. */
  open(): FakeWorld;
  /** Opens one more level, closing the one open first. */
  transition(level: string): FakeWorld;
  /** Closes the open world and shuts the instance down, as `destroy` does. */
  destroy(): void;
}

/**
 * The engine's documented calling order, scripted.
 *
 * Construct the instance with no arguments, assign `engine` and `events`, run
 * `initialize` and await it, then open each level: `worldClosing` on the
 * outgoing world before `worldOpened` on the incoming one. `destroy` closes the
 * last world and runs `shutdown`. Every ordering assertion below is an
 * assertion about this sequence, so it lives in one place rather than being
 * re-spelled per test.
 */
async function drive<D>(
  type: GameInstanceClass<D>,
  levels: readonly string[] = ["arena"],
  recorded: Recorded = makeInitApi(),
): Promise<Driven<D>> {
  const host = makeEngine<D>();
  const instance = new type();
  bindGameInstance(instance, host.engine, host.events);
  const debug = await instance.initialize(recorded.api);

  const worlds: FakeWorld[] = [];
  let current: FakeWorld | null = null;

  const transition = (level: string): FakeWorld => {
    if (current !== null) instance.worldClosing(asWorld(current));
    const world = makeWorld(level);
    worlds.push(world);
    host.setWorld(world);
    current = world;
    instance.worldOpened(asWorld(world));
    return world;
  };

  for (const level of levels) transition(level);

  return {
    instance,
    debug,
    host,
    recorded,
    worlds,
    open: () => {
      if (current === null) throw new Error("no world is open");
      return current;
    },
    transition,
    destroy: () => {
      if (current !== null) instance.worldClosing(asWorld(current));
      current = null;
      instance.shutdown();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The worked game                                                            */
/* -------------------------------------------------------------------------- */

interface Snapshot {
  readonly level: string;
  readonly score: number;
  readonly ball: { x: number; y: number; z: number };
}

interface Debug {
  setBallPosition(x: number, y: number, z: number): void;
  addScore(points: number): void;
  snapshot(): Snapshot;
}

/**
 * The docs' Arcade, complete: declarations in `initialize`, a debug surface of
 * poses and readings written against the live world, a running total carried
 * across a transition, and an instance-scoped diagnostic source seeded into
 * each world as it opens.
 */
class Arcade extends GameInstance<Debug> {
  best = 0;
  levelsPlayed = 0;

  override initialize(api: InitApi): Debug {
    api.input.register("thrust", { keys: ["KeyW", "ArrowUp"] });
    api.audio.define("score", { freq: 660, durationMs: 90 });

    const world = (): FakeWorld => this.engine.world as unknown as FakeWorld;
    return {
      setBallPosition: (x, y, z) => {
        const ball = world().ball;
        ball.x = x;
        ball.y = y;
        ball.z = z;
      },
      addScore: (points) => {
        world().state.score += points;
      },
      snapshot: () => ({
        level: world().level,
        score: world().state.score,
        ball: { ...world().ball },
      }),
    };
  }

  override worldOpened(world: World): void {
    this.levelsPlayed += 1;
    (world as unknown as FakeWorld).diagnostics.register(
      "best",
      () => this.best,
    );
  }

  override worldClosing(world: World): void {
    const state = (world as unknown as FakeWorld).state;
    this.best = Math.max(this.best, state.score);
  }
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe("GameInstance", () => {
  it("constructs with no arguments and its base initialize returns null", () => {
    const instance = new GameInstance<null>();
    expect(instance.initialize(makeInitApi().api)).toBeNull();
  });

  it("returns the base surface synchronously rather than as a promise", () => {
    // `initialize` *may* return a promise, which the engine awaits; the base
    // must not force that await on a game that overrides nothing.
    expect(
      new GameInstance<null>().initialize(makeInitApi().api),
    ).not.toBeInstanceOf(Promise);
  });

  it("reads nothing off the InitApi it is handed", () => {
    // The base declares no bindings, cues, assets, or sources, so an instance
    // that needs none of them need not override `initialize` at all.
    const api = new Proxy({} as InitApi, {
      get(_target, property) {
        throw new Error(`the base initialize read ${String(property)}`);
      },
    });
    expect(new GameInstance<null>().initialize(api)).toBeNull();
  });

  it("has do-nothing worldOpened, worldClosing, and shutdown", () => {
    const instance = new GameInstance<null>();
    const world = asWorld(makeWorld("arena"));
    // The base implementations are documented no-ops: a subclass overrides only
    // what it needs, so the bases must be safe to call bare.
    expect(instance.worldOpened(world)).toBeUndefined();
    expect(instance.worldClosing(world)).toBeUndefined();
    expect(instance.shutdown()).toBeUndefined();
  });

  it("lets a subclass override only what it needs", async () => {
    const opened: string[] = [];

    class Counting extends GameInstance<null> {
      override worldOpened(world: World): void {
        opened.push((world as unknown as FakeWorld).level);
      }
    }

    const driven = await drive(Counting, ["arena", "cavern"]);
    expect(opened).toEqual(["arena", "cavern"]);
    // The three it did not override still behave as the base does.
    expect(driven.debug).toBeNull();
    expect(() => driven.destroy()).not.toThrow();
  });

  it("lets a constructor set defaults that initialize then reads", async () => {
    class Arcade2 extends GameInstance<null> {
      best = 0;
      ready = false;

      override initialize(api: InitApi): null {
        api.input.register("thrust", { keys: ["KeyW", "ArrowUp"] });
        this.ready = this.best === 0;
        return null;
      }
    }

    const recorded = makeInitApi();
    const driven = await drive(Arcade2, ["arena"], recorded);
    expect((driven.instance as Arcade2).ready).toBe(true);
    expect(recorded.actions.map((entry) => entry.name)).toEqual(["thrust"]);
  });
});

describe("bindGameInstance", () => {
  it("hands engine and events over before initialize runs", () => {
    const host = makeEngine<null>();
    const seen: unknown[] = [];

    class Probing extends GameInstance<null> {
      override initialize(api: InitApi): null {
        void api;
        // `engine` is assigned before `initialize` runs, so an override that
        // reads it here is exactly the documented calling pattern.
        seen.push(this.engine, this.events);
        return null;
      }
    }

    const instance = new Probing();
    expect(
      bindGameInstance(instance, host.engine, host.events),
    ).toBeUndefined();
    instance.initialize(makeInitApi().api);
    expect(seen).toEqual([host.engine, host.events]);
  });

  it("assigns both fields onto the instance itself", () => {
    const host = makeEngine<null>();
    const instance = new GameInstance<null>();
    bindGameInstance(instance, host.engine, host.events);
    expect(instance.engine).toBe(host.engine);
    expect(instance.events).toBe(host.events);
  });

  it("leaves the constructor to run before either field exists", () => {
    // "A constructor sets defaults and nothing more": the engine has no value
    // to hand one, so a field initializer that reached for `engine` would find
    // nothing. Pinning it keeps the ordering from quietly inverting.
    let atConstruction: unknown = "unset";

    class Eager extends GameInstance<null> {
      constructor() {
        super();
        atConstruction = (this as { engine?: unknown }).engine;
      }
    }

    const host = makeEngine<null>();
    const instance = new Eager();
    expect(atConstruction).toBeUndefined();
    bindGameInstance(instance, host.engine, host.events);
    expect(instance.engine).toBe(host.engine);
  });

  it("leaves both fields in place for worldOpened, worldClosing and shutdown", async () => {
    const seen: unknown[] = [];

    class Watching extends GameInstance<null> {
      override worldOpened(): void {
        seen.push(this.engine);
      }
      override worldClosing(): void {
        seen.push(this.engine);
      }
      override shutdown(): void {
        seen.push(this.events);
      }
    }

    const driven = await drive(Watching, ["arena"]);
    driven.destroy();
    expect(seen).toEqual([
      driven.host.engine,
      driven.host.engine,
      driven.host.events,
    ]);
  });

  it("hands over the same broadcaster the InitApi carries", async () => {
    const host = makeEngine<null>();
    const recorded = makeInitApi({ events: host.events });
    const instance = new GameInstance<null>();
    bindGameInstance(instance, host.engine, host.events);
    instance.initialize(recorded.api);
    // One broadcaster is reachable as `engine.events`, as `instance.events`,
    // and as `InitApi.events`, so a subscriber reaches one stream.
    expect(instance.events).toBe(recorded.api.events);
    expect(instance.events).toBe(host.engine.events);
  });
});

describe("the engine's calling order", () => {
  it("runs initialize once, then worldOpened and worldClosing per level, then shutdown", async () => {
    const log: string[] = [];

    class Logging extends GameInstance<null> {
      override initialize(): null {
        log.push("initialize");
        return null;
      }
      override worldOpened(world: World): void {
        log.push(`opened:${(world as unknown as FakeWorld).level}`);
      }
      override worldClosing(world: World): void {
        log.push(`closing:${(world as unknown as FakeWorld).level}`);
      }
      override shutdown(): void {
        log.push("shutdown");
      }
    }

    const driven = await drive(Logging, ["arena", "cavern"]);
    driven.destroy();
    expect(log).toEqual([
      "initialize",
      "opened:arena",
      "closing:arena",
      "opened:cavern",
      "closing:cavern",
      "shutdown",
    ]);
  });

  it("receives the outgoing world at worldClosing and the incoming one at worldOpened", async () => {
    const closing: FakeWorld[] = [];
    const opened: FakeWorld[] = [];

    class Pairing extends GameInstance<null> {
      override worldOpened(world: World): void {
        opened.push(world as unknown as FakeWorld);
      }
      override worldClosing(world: World): void {
        closing.push(world as unknown as FakeWorld);
      }
    }

    const driven = await drive(Pairing, ["arena", "cavern", "vault"]);
    // Identity, not just the name: the objects handed over are the worlds the
    // engine held, so a game may key its own bookkeeping off them.
    expect(opened).toEqual(driven.worlds);
    expect(closing).toEqual(driven.worlds.slice(0, 2));
  });

  it("awaits an async initialize before the start level opens", async () => {
    const log: string[] = [];

    class Slow extends GameInstance<null> {
      override async initialize(api: InitApi): Promise<null> {
        await api.assets.loadModel("models/ship.glb");
        log.push("initialize");
        return null;
      }
      override worldOpened(): void {
        log.push("opened");
      }
    }

    await drive(Slow, ["arena"]);
    expect(log).toEqual(["initialize", "opened"]);
  });
});

describe("what lives on the instance", () => {
  it("declares its bindings and cues once, however many levels open", async () => {
    const recorded = makeInitApi();
    await drive(Arcade, ["arena", "cavern", "vault"], recorded);
    // The declarations belong to the whole game, so they are made in the one
    // place that runs once — not re-made as each world opens.
    expect(recorded.actions).toEqual([
      { name: "thrust", binding: { keys: ["KeyW", "ArrowUp"] } },
    ]);
    expect(recorded.cues).toEqual([
      { cue: "score", spec: { freq: 660, durationMs: 90 } },
    ]);
  });

  it("carries a running total from the outgoing world into the next", async () => {
    const driven = await drive(Arcade, ["arena"]);
    driven.debug.addScore(7);
    driven.transition("cavern");
    // `worldClosing` read the outgoing state into the instance; the incoming
    // world starts at zero and the instance still holds the best.
    expect((driven.instance as Arcade).best).toBe(7);
    expect(driven.debug.snapshot()).toEqual({
      level: "cavern",
      score: 0,
      ball: { x: 0, y: 0, z: 0 },
    });

    driven.debug.addScore(3);
    driven.destroy();
    expect((driven.instance as Arcade).best).toBe(7);
    expect((driven.instance as Arcade).levelsPlayed).toBe(2);
  });

  it("seeds each world's diagnostics with a source reading the live instance", async () => {
    const driven = await drive(Arcade, ["arena"]);
    const source = driven.open().sources.get("best");
    expect(source).toBeDefined();
    expect(source?.()).toBe(0);

    driven.debug.addScore(4);
    driven.transition("cavern");
    // The world-scoped registration is dropped with its world; the new world
    // gets its own, and both read the instance's field at the moment of the
    // read rather than the value it held when the source was registered.
    const next = driven.open().sources.get("best");
    expect(next).toBeDefined();
    expect(next).not.toBe(source);
    expect(next?.()).toBe(4);
  });

  it("registers an engine-scoped diagnostic source through the InitApi", async () => {
    class Counting extends GameInstance<null> {
      levels = 0;

      override initialize(api: InitApi): null {
        api.diagnostics.register("levels", () => this.levels);
        return null;
      }

      override worldOpened(): void {
        this.levels += 1;
      }
    }

    const recorded = makeInitApi();
    await drive(Counting, ["arena", "cavern"], recorded);
    const source = recorded.sources.get("levels");
    expect(source).toBeDefined();
    // Registered once, invoked on each read, and reporting the instance's
    // figure as it stands after two levels have opened.
    expect(recorded.sources.size).toBe(1);
    expect(source?.()).toBe(2);
  });

  it("holds an asset it loaded for the life of the game", async () => {
    class Fleet extends GameInstance<null> {
      ship!: Model;

      override async initialize(api: InitApi): Promise<null> {
        this.ship = await api.assets.loadModel("models/ship.glb");
        return null;
      }
    }

    const recorded = makeInitApi();
    const driven = await drive(Fleet, ["arena", "cavern"], recorded);
    const held = (driven.instance as Fleet).ship;
    expect(recorded.loaded).toEqual(["models/ship.glb"]);
    // Loaded once, before the start level opened, and the same template still
    // in hand two levels later.
    expect(held.nodes).toEqual(["models/ship.glb"]);
    expect((driven.instance as Fleet).ship).toBe(held);
  });
});

describe("InitApi", () => {
  it("passes a binding through to the input registry unchanged", () => {
    const recorded = makeInitApi();
    const binding: ActionBinding = { keys: ["KeyW"], kind: "analog" };
    recorded.api.input.register("thrust", binding);
    // The engine copies `keys` and fills `kind`; the instance's side of that is
    // simply that what it wrote is what arrives.
    expect(recorded.actions).toEqual([{ name: "thrust", binding }]);
    expect(recorded.actions[0]?.binding).toBe(binding);
  });

  it("reports the selected touch layout, or null when none was selected", () => {
    expect(makeInitApi().api.input.layout()).toBeNull();
    expect(makeInitApi({ layout: "twin-stick" }).api.input.layout()).toEqual({
      name: "twin-stick",
      actions: ["thrust", "pause"],
    });
  });

  it("defines a synthesized cue and binds a cue to a file", async () => {
    const recorded = makeInitApi();
    recorded.api.audio.define("blip", { freq: 440, durationMs: 60 });
    await recorded.api.audio.load("music", "audio/theme.ogg");
    expect(recorded.cues).toEqual([
      { cue: "blip", spec: { freq: 440, durationMs: 60 } },
    ]);
    expect(recorded.cueFiles).toEqual([
      { cue: "music", path: "audio/theme.ogg" },
    ]);
  });

  it("exposes the six asset loaders the whole game shares", async () => {
    const recorded = makeInitApi();
    const assets = recorded.api.assets;
    await assets.loadImage("ui/hud.png");
    await assets.loadTexture("textures/hull.png");
    await assets.loadModel("models/ship.glb");
    await assets.loadAudio("audio/hit.wav");
    await assets.load("data/levels.json");
    // `resolve` is the shared first step, and pure: it neither fetches nor
    // announces, so it leaves no trace on the recorder.
    expect(assets.resolve("models/ship.glb")).toBe("assets/models/ship.glb");
    expect(recorded.loaded).toEqual([
      "ui/hud.png",
      "textures/hull.png",
      "models/ship.glb",
      "audio/hit.wav",
      "data/levels.json",
    ]);
  });

  it("hands back a viewport snapshot the caller owns", () => {
    const recorded = makeInitApi();
    const first = recorded.api.viewport();
    const second = recorded.api.viewport();
    expect(first).toEqual({
      width: 640,
      height: 360,
      scale: 2,
      offsetX: 0,
      offsetY: 12,
    });
    expect(second).not.toBe(first);
    expect(recorded.viewports).toBe(2);
  });

  it("carries the engine's broadcaster", () => {
    const events = { on: vi.fn(() => () => {}) } as unknown as EngineEvents;
    const recorded = makeInitApi({ events });
    expect(recorded.api.events).toBe(events);
  });
});

describe("the debug surface", () => {
  it("is whatever initialize returned, by identity", async () => {
    const surface = { poke: vi.fn() };

    class Surfaced extends GameInstance<typeof surface> {
      override initialize(): typeof surface {
        return surface;
      }
    }

    const driven = await drive(Surfaced, ["arena"]);
    expect(driven.debug).toBe(surface);
  });

  it("may be built asynchronously", async () => {
    interface Ping {
      ping(): string;
    }

    class Deferred extends GameInstance<Ping> {
      override async initialize(api: InitApi): Promise<Ping> {
        await api.assets.load("data/rules.json");
        return { ping: () => "pong" };
      }
    }

    const driven = await drive(Deferred, ["arena"]);
    expect(driven.debug.ping()).toBe("pong");
  });

  it("is null for a game with nothing to offer", async () => {
    const driven = await drive(GameInstance<null>, ["arena"]);
    expect(driven.debug).toBeNull();
  });

  it("poses the world open at the moment of the call, not the one open at initialize", async () => {
    const driven = await drive(Arcade, ["arena"]);
    driven.debug.setBallPosition(1, 2, 3);
    expect(driven.open().ball).toEqual({ x: 1, y: 2, z: 3 });

    const arena = driven.open();
    driven.transition("cavern");
    driven.debug.setBallPosition(9, 8, 7);
    // The operation re-read `this.engine.world` and reached the world that is
    // open now; the one it posed before the transition is untouched.
    expect(driven.open().ball).toEqual({ x: 9, y: 8, z: 7 });
    expect(arena.ball).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("reads back the world as it stands at the call", async () => {
    const driven = await drive(Arcade, ["arena"]);
    expect(driven.debug.snapshot()).toEqual({
      level: "arena",
      score: 0,
      ball: { x: 0, y: 0, z: 0 },
    });

    driven.debug.addScore(2);
    driven.debug.setBallPosition(4, 0, -1);
    expect(driven.debug.snapshot()).toEqual({
      level: "arena",
      score: 2,
      ball: { x: 4, y: 0, z: -1 },
    });
  });

  it("holds no state of its own: a reading is rebuilt at each call", async () => {
    const driven = await drive(Arcade, ["arena"]);
    const first = driven.debug.snapshot();
    driven.debug.addScore(5);
    const second = driven.debug.snapshot();
    // Two calls, two plain objects a caller may keep and compare — the first
    // did not move under it when the world changed.
    expect(first.score).toBe(0);
    expect(second.score).toBe(5);
    expect(second).not.toBe(first);
    expect(second.ball).not.toBe(first.ball);
  });

  it("returns nothing from a pose and plain data from a reading", async () => {
    const driven = await drive(Arcade, ["arena"]);
    expect(driven.debug.setBallPosition(1, 1, 1)).toBeUndefined();
    expect(driven.debug.addScore(1)).toBeUndefined();
    const reading = driven.debug.snapshot();
    // Plain data: it survives a round trip through JSON, so a caller compares
    // and serializes it rather than holding a framework object.
    expect(JSON.parse(JSON.stringify(reading))).toEqual(reading);
  });

  it("keeps a plain property plain beside its poses and readings", async () => {
    interface Versioned {
      readonly version: string;
      bump(): void;
      count(): number;
    }

    class Stamped extends GameInstance<Versioned> {
      bumps = 0;

      override initialize(): Versioned {
        // The surface is operations *and* whatever else the game declares:
        // a plain property such as a version stays a plain property.
        return {
          version: "2.1.0",
          bump: () => {
            this.bumps += 1;
          },
          count: () => this.bumps,
        };
      }
    }

    const driven = await drive(Stamped, ["arena"]);
    expect(driven.debug.version).toBe("2.1.0");
    driven.debug.bump();
    expect(driven.debug.count()).toBe(1);
    driven.transition("cavern");
    // Neither the property nor the tally is rebuilt by a transition: the
    // surface is one object the instance returned once.
    expect(driven.debug.version).toBe("2.1.0");
    expect(driven.debug.count()).toBe(1);
  });

  it("survives every level the game opens, as one object", async () => {
    const driven = await drive(Arcade, ["arena"]);
    const surface = driven.debug;
    driven.transition("cavern");
    driven.transition("vault");
    expect(driven.debug).toBe(surface);
    expect(surface.snapshot().level).toBe("vault");
  });

  it("may gather its operations from the instance's own methods", async () => {
    interface Api {
      award(points: number): void;
      total(): number;
    }

    class Gathered extends GameInstance<Api> {
      total = 0;

      award(points: number): void {
        this.total += points;
      }

      override initialize(): Api {
        // The surface's methods may be written inline or gathered from the
        // instance, so long as the value `initialize` returns carries them.
        return {
          award: (points) => this.award(points),
          total: () => this.total,
        };
      }
    }

    const driven = await drive(Gathered, ["arena"]);
    driven.debug.award(3);
    driven.debug.award(4);
    expect(driven.debug.total()).toBe(7);
    expect((driven.instance as Gathered).total).toBe(7);
  });

  it("leaves the refusal of an undefined surface to the engine", () => {
    class Forgetful extends GameInstance<undefined> {
      override initialize(api: InitApi): undefined {
        void api;
        return undefined;
      }
    }

    // This module polices nothing: `initialize` returning `undefined` is what
    // `engine.initialize` rejects over, naming the surface. The instance
    // itself constructs and runs.
    expect(new Forgetful().initialize(makeInitApi().api)).toBeUndefined();
  });
});

describe("GameDefinition", () => {
  const level = { mode: class {} } as unknown as LevelDefinition;

  it("carries the level registry and the start level", () => {
    const definition: GameDefinition<Debug> = {
      instance: Arcade,
      levels: { arena: level, cavern: level },
      startLevel: "arena",
    };
    expect(Object.keys(definition.levels)).toEqual(["arena", "cavern"]);
    expect(definition.startLevel).toBe("arena");
    expect(definition.levels[definition.startLevel]).toBe(level);
  });

  it("falls back to GameInstance itself when no instance class is named", () => {
    const definition: GameDefinition<unknown> = {
      levels: { arena: level },
      startLevel: "arena",
    };
    expect(definition.instance).toBeUndefined();
    // The documented default: the engine constructs `GameInstance` itself,
    // which suits a game whose whole state fits in its worlds.
    const constructed = new (definition.instance ?? GameInstance)();
    expect(constructed).toBeInstanceOf(GameInstance);
    expect(constructed.initialize(makeInitApi().api)).toBeNull();
  });

  it("names a class the engine constructs with no arguments", () => {
    const type: GameInstanceClass<Debug> = Arcade;
    const instance = new type();
    expect(instance).toBeInstanceOf(Arcade);
    expect(instance).toBeInstanceOf(GameInstance);
    expect((instance as Arcade).best).toBe(0);
  });
});
