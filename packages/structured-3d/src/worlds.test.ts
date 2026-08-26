import { describe, expect, it, vi } from "vitest";
import { Actor, Pawn, type EndPlayReason } from "./actors";
import { Component } from "./components";
import { Controller, PlayerController } from "./controllers";
import type { InitApi } from "./game-instance";
import { GameMode, GameState } from "./game-mode";
import {
  EngineWorld,
  WorldDriver,
  type EngineEventMap,
  type EngineEvents,
  type LevelDefinition,
  type LoadApi,
  type World,
  type WorldDeps,
  type WorldDriverDeps,
} from "./worlds";
import type { WorldAudio } from "./audio";
import type { Camera } from "./camera";
import type { CollisionWorld } from "./collision";
import type { InputReader } from "./input";

/**
 * The world and the transition driver over fakes. The suite drives
 * `EngineWorld` exactly as the engine's loop does — `begin`, then per frame
 * `simulate`, `tickMode`, `flushDestroyed`, `takeTransition` — and drives
 * `WorldDriver` exactly as `initialize` and an honored transition do, so
 * every ordering promise on the Worlds API page is asserted here without an
 * engine, a renderer, or a collision pass behind it. The actors, components,
 * controllers, and game-mode collaborators are the real classes: the world
 * speaks only their documented surfaces, and those modules are implemented.
 */

/** One emitted event, as a test reads it back. */
interface Emitted {
  event: keyof EngineEventMap;
  payload: unknown;
}

/** An input reader that answers rest for everything; identity is the point. */
function makeReader(): InputReader {
  return {
    value: () => 0,
    pressed: () => false,
    pointer: () => ({ x: 0, y: 0, down: false }),
    pointerPressed: () => false,
    pointerReleased: () => false,
    pointerSamples: () => [],
  };
}

/**
 * Distinct classes for the typed lookups. The suite runs over the real
 * `Actor` and `Pawn` — the world speaks only their documented surface — so
 * nothing needs stubbing.
 */
class TestActor extends Actor {}

/** The pawn twin of {@link TestActor}, for possession scenarios. */
class TestPawn extends Pawn {}

/** A component that reports its lifecycle into a shared log. */
class LoggedComponent extends Component {
  constructor(
    private readonly name: string,
    private readonly log: string[],
  ) {
    super();
  }

  override beginPlay(): void {
    this.log.push(`${this.name}.begin`);
  }

  override tick(dt: number): void {
    this.log.push(`${this.name}.tick(${dt})`);
  }

  override endPlay(reason: EndPlayReason): void {
    this.log.push(`${this.name}.end(${reason})`);
  }
}

/** A world over fakes, with everything a test asserts against handed back. */
function makeWorld(
  definition: LevelDefinition,
  overrides: Partial<WorldDeps> = {},
) {
  const emitted: Emitted[] = [];
  const registerDiagnostic = vi.fn();
  const deps: WorldDeps = {
    level: "arena",
    definition,
    options: {},
    camera: { tag: "camera" } as unknown as Camera<Actor>,
    collision: { tag: "collision" } as unknown as CollisionWorld,
    audio: { tag: "audio" } as unknown as WorldAudio,
    assets: { tag: "assets" } as unknown as InitApi["assets"],
    events: { on: () => () => {} } as EngineEvents,
    emit: (event, payload) => {
      emitted.push({ event, payload });
    },
    registerDiagnostic,
    createInputReader: makeReader,
    frame: () => ({ count: 7, timeMs: 116.66, lastDeltaMs: 16.66 }),
    viewport: () => ({
      width: 640,
      height: 360,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    }),
    ...overrides,
  };
  const world = new EngineWorld(deps);
  return { world, deps, emitted, registerDiagnostic };
}

/** A world that has completed its opening, as the engine would leave it. */
function openWorld(
  definition: LevelDefinition,
  overrides: Partial<WorldDeps> = {},
) {
  const built = makeWorld(definition, overrides);
  built.world.begin();
  return built;
}

/** One whole simulated frame, as the engine's loop drives it. */
function frame(world: EngineWorld, dt: number): void {
  world.simulate(dt);
  world.tickMode(dt);
  world.flushDestroyed();
}

describe("building a world", () => {
  it("constructs the mode, then the state from gameStateClass, and binds them", () => {
    class ArenaState extends GameState {
      rallies = 0;
    }

    class ArenaMode extends GameMode {
      override gameStateClass = ArenaState;
    }

    const { world, deps } = makeWorld({ mode: ArenaMode });
    expect(world.level).toBe("arena");
    expect(world.mode).toBeInstanceOf(ArenaMode);
    expect(world.state).toBeInstanceOf(ArenaState);
    expect(world.mode.world).toBe(world);
    expect(world.mode.state).toBe(world.state);
    expect(world.mode.options).toBe(deps.options);
    expect(world.state.world).toBe(world);
  });

  it("hands the mode the options the transition supplied", () => {
    const options = { round: 3, carried: 7 };
    const { world } = makeWorld({ mode: GameMode }, { options });
    expect(world.mode.options).toBe(options);
  });

  it("constructs the declared actors in order, ids from 1, without beginning play", () => {
    const begun: string[] = [];

    class Declared extends TestActor {
      label = "";

      override beginPlay(): void {
        begun.push(this.label);
      }
    }

    const { world } = makeWorld({
      mode: GameMode,
      actors: [
        { type: Declared, configure: (a) => ((a as Declared).label = "first") },
        {
          type: Declared,
          configure: (a) => ((a as Declared).label = "second"),
        },
      ],
    });
    const actors = world.actors() as readonly Declared[];
    expect(actors.map((actor) => actor.label)).toEqual(["first", "second"]);
    expect(actors.map((actor) => actor.id)).toEqual([1, 2]);
    // Step 9 constructs; the beginPlay calls belong to step 10, `begin()`.
    expect(begun).toEqual([]);
    world.begin();
    expect(begun).toEqual(["first", "second"]);
  });

  it("replaces whole transform fields over the identity, merging nothing", () => {
    const { world } = makeWorld({
      mode: GameMode,
      actors: [
        {
          type: TestActor,
          transform: { position: { x: 2, y: 3, z: 4 } },
        },
        {
          type: TestActor,
          transform: { scale: { x: 2, y: 2, z: 2 } },
        },
      ],
    });
    const [placed, scaled] = world.actors();
    // A present field supplies all of its numbers; absent fields stay at the
    // identity — position (0, 0, 0), identity rotation, scale (1, 1, 1).
    expect(placed?.transform).toEqual({
      position: { x: 2, y: 3, z: 4 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    });
    expect(scaled?.transform).toEqual({
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 2, y: 2, z: 2 },
    });
  });

  it("copies the spec's transform values, keeping the level description inert", () => {
    const position = { x: 1, y: 2, z: 3 };
    const definition: LevelDefinition = {
      mode: GameMode,
      actors: [{ type: TestActor, transform: { position } }],
    };

    const first = makeWorld(definition).world.actors()[0] as Actor;
    first.transform.position.x = 99;
    // The definition is inert data reopened as often as the game asks: an
    // actor mutating its own transform must not reach back into the spec.
    expect(position.x).toBe(1);
    const second = makeWorld(definition).world.actors()[0] as Actor;
    expect(second.transform.position).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("applies tags, then configure, on an actor that already has its world", () => {
    const order: string[] = [];

    class Goal extends TestActor {
      side = "none";
    }

    const { world } = makeWorld({
      mode: GameMode,
      actors: [
        {
          type: Goal,
          tags: ["goal"],
          configure: (actor) => {
            const goal = actor as Goal;
            order.push(`configure tagged=${goal.hasTag("goal")}`);
            order.push(`configure world=${goal.world !== undefined}`);
            goal.side = "left";
          },
        },
      ],
    });
    expect(order).toEqual(["configure tagged=true", "configure world=true"]);
    expect((world.byTag("goal")[0] as Goal).side).toBe("left");
  });

  it("emits actor:spawned for each declared actor as it is attached", () => {
    const { world, emitted } = makeWorld({
      mode: GameMode,
      actors: [{ type: TestActor }, { type: TestActor }],
    });
    const spawnedActors = emitted
      .filter((entry) => entry.event === "actor:spawned")
      .map((entry) => (entry.payload as { actor: Actor }).actor);
    expect(spawnedActors).toEqual([...world.actors()]);
  });
});

describe("begin", () => {
  it("runs every declared actor's beginPlay after all of them exist", () => {
    const peers: number[] = [];

    class Counting extends TestActor {
      constructor() {
        super();
        this.addTag("peer");
      }

      override beginPlay(): void {
        // Every declared actor exists before any beginPlay, so a peer count
        // taken here is already complete.
        peers.push((this.world as unknown as World).byTag("peer").length);
      }
    }

    const { world } = makeWorld({
      mode: GameMode,
      actors: [{ type: Counting }, { type: Counting }, { type: Counting }],
    });
    world.begin();
    expect(peers).toEqual([3, 3, 3]);
  });

  it("begins each actor, then its components, then the mode, in order", () => {
    const log: string[] = [];

    class Logged extends TestActor {
      label = "";

      override beginPlay(): void {
        log.push(`${this.label}.begin`);
      }
    }

    class LoggedMode extends GameMode {
      override beginPlay(): void {
        log.push("mode.begin");
      }
    }

    const { world } = makeWorld({
      mode: LoggedMode,
      actors: [
        {
          type: Logged,
          configure: (actor) => {
            const logged = actor as Logged;
            logged.label = "a";
            logged.attach(new LoggedComponent("a.c1", log));
          },
        },
        {
          type: Logged,
          configure: (actor) => {
            const logged = actor as Logged;
            logged.label = "b";
            logged.attach(new LoggedComponent("b.c1", log));
          },
        },
      ],
    });
    world.begin();
    expect(log).toEqual([
      "a.begin",
      "a.c1.begin",
      "b.begin",
      "b.c1.begin",
      "mode.begin",
    ]);
  });
});

describe("simulate", () => {
  it("advances world time before the controllers tick", () => {
    const seen: number[] = [];

    class ClockReader extends PlayerController {
      override tick(): void {
        seen.push((this.world as unknown as World).time);
      }
    }

    const { world } = openWorld({ mode: GameMode });
    world.mode.addPlayer({ controller: ClockReader });
    world.simulate(0.25);
    // Time moved first, so the controller reads the already-advanced clock.
    expect(seen).toEqual([0.25]);
    expect(world.time).toBe(0.25);
  });

  it("ticks every controller before the first actor", () => {
    const log: string[] = [];

    class LoggedController extends PlayerController {
      override tick(): void {
        log.push("controller");
      }
    }

    class LoggedActor extends TestActor {
      override tick(): void {
        log.push("actor");
      }
    }

    const { world } = openWorld({
      mode: GameMode,
      actors: [{ type: LoggedActor }],
    });
    world.mode.addPlayer({ controller: LoggedController });
    world.simulate(0.1);
    expect(log).toEqual(["controller", "actor"]);
  });

  it("ticks an actor, then its enabled components, skipping disabled ones", () => {
    const log: string[] = [];

    class Logged extends TestActor {
      override tick(dt: number): void {
        log.push(`actor.tick(${dt})`);
      }
    }

    const { world } = openWorld({ mode: GameMode });
    const actor = world.spawn(Logged);
    actor.attach(new LoggedComponent("on", log));
    const off = actor.attach(new LoggedComponent("off", log));
    off.enabled = false;
    log.length = 0;
    world.simulate(0.5);
    expect(log).toEqual(["actor.tick(0.5)", "on.tick(0.5)"]);
  });

  it("gives a spawned actor its first tick on the next frame", () => {
    const ticks: string[] = [];

    class Spawned extends TestActor {
      override tick(): void {
        ticks.push("spawned");
      }
    }

    class Spawner extends TestActor {
      spawned = false;

      override tick(): void {
        ticks.push("spawner");
        if (!this.spawned) {
          this.spawned = true;
          (this.world as unknown as World).spawn(Spawned);
        }
      }
    }

    const { world } = openWorld({
      mode: GameMode,
      actors: [{ type: Spawner }],
    });
    world.simulate(0.1);
    expect(ticks).toEqual(["spawner"]);
    world.simulate(0.1);
    expect(ticks).toEqual(["spawner", "spawner", "spawned"]);
  });

  it("accrues state.elapsed only while the phase is playing", () => {
    const { world } = openWorld({ mode: GameMode });
    world.simulate(1);
    expect(world.state.elapsed).toBe(0);
    world.mode.setPhase("playing");
    world.simulate(1);
    world.simulate(0.5);
    expect(world.state.elapsed).toBe(1.5);
    world.mode.setPhase("over");
    world.simulate(1);
    expect(world.state.elapsed).toBe(1.5);
    // The world clock ran the whole time; elapsed is the match clock.
    expect(world.time).toBe(3.5);
  });

  it("stops ticking a destroyed actor at once", () => {
    const ticks: number[] = [];

    class Doomed extends TestActor {
      override tick(): void {
        ticks.push(this.id);
      }
    }

    const { world } = openWorld({ mode: GameMode });
    const doomed = world.spawn(Doomed);
    world.simulate(0.1);
    doomed.destroy();
    world.simulate(0.1);
    expect(ticks).toEqual([doomed.id]);
  });
});

describe("pausing", () => {
  it("suspends time, ticks, timers, and the mode tick, but keeps opted-in actors", () => {
    const log: string[] = [];

    class Menu extends TestActor {
      constructor() {
        super();
        this.tickWhenPaused = true;
        this.attach(new LoggedComponent("menu.c", log));
      }

      override tick(dt: number): void {
        log.push(`menu.tick(${dt})`);
      }
    }

    class Ordinary extends TestActor {
      override tick(): void {
        log.push("ordinary.tick");
      }
    }

    class LoggedMode extends GameMode {
      override tick(): void {
        log.push("mode.tick");
      }
    }

    const { world } = openWorld({
      mode: LoggedMode,
      actors: [{ type: Ordinary }, { type: Menu }],
    });
    const timer = vi.fn();
    world.after(0.05, timer);
    log.length = 0;

    world.setPaused(true);
    expect(world.paused).toBe(true);
    frame(world, 0.1);
    // The paused world ticks only the opted-in actor and its components,
    // against a clock that stands still.
    expect(log).toEqual(["menu.tick(0.1)", "menu.c.tick(0.1)"]);
    expect(world.time).toBe(0);
    expect(timer).not.toHaveBeenCalled();

    world.setPaused(false);
    frame(world, 0.1);
    expect(world.time).toBe(0.1);
    expect(timer).toHaveBeenCalledTimes(1);
    expect(log).toContain("ordinary.tick");
    expect(log).toContain("mode.tick");
  });
});

describe("timers", () => {
  it("fires after once at its due time and every repeatedly", () => {
    const { world } = openWorld({ mode: GameMode });
    const once = vi.fn();
    const repeat = vi.fn();
    world.after(0.5, once);
    world.every(0.5, repeat);
    world.simulate(0.4);
    expect(once).not.toHaveBeenCalled();
    world.simulate(0.1);
    expect(once).toHaveBeenCalledTimes(1);
    expect(repeat).toHaveBeenCalledTimes(1);
    world.simulate(0.5);
    expect(once).toHaveBeenCalledTimes(1);
    expect(repeat).toHaveBeenCalledTimes(2);
  });

  it("catches a repeating timer up across a delta spanning several periods", () => {
    const { world } = openWorld({ mode: GameMode });
    const repeat = vi.fn();
    world.every(0.25, repeat);
    world.simulate(1);
    // One fire per period crossed, so a counter driven by `every` counts
    // real elapsed time.
    expect(repeat).toHaveBeenCalledTimes(4);
  });

  it("cancels through clearTimer, and lets a one-shot reschedule itself", () => {
    const { world } = openWorld({ mode: GameMode });
    const cleared = vi.fn();
    const handle = world.after(0.1, cleared);
    world.clearTimer(handle);
    world.simulate(1);
    expect(cleared).not.toHaveBeenCalled();

    let fires = 0;
    const again = (): void => {
      fires += 1;
      if (fires === 1) world.after(0.1, again);
    };
    world.after(0.1, again);
    world.simulate(0.1);
    expect(fires).toBe(1);
    // The rescheduled callback was not in the firing pass's snapshot.
    world.simulate(0.1);
    expect(fires).toBe(2);
  });

  it("refuses a non-finite delay, naming the member and the value", () => {
    const { world } = openWorld({ mode: GameMode });
    expect(() => world.after(Number.NaN, () => {})).toThrow(RangeError);
    expect(() => world.after(Number.NaN, () => {})).toThrow(
      /world\.after needs finite seconds, got NaN/,
    );
    expect(() => world.every(Infinity, () => {})).toThrow(
      /world\.every needs finite seconds, got Infinity/,
    );
    // The valid boundary: zero is accepted (and fires once per pass).
    expect(() => world.after(0, () => {})).not.toThrow();
  });

  it("clears every timer when the world closes", () => {
    const { world } = openWorld({ mode: GameMode });
    const fired = vi.fn();
    world.after(0.1, fired);
    world.every(0.1, fired);
    world.close();
    world.simulate(1);
    expect(fired).not.toHaveBeenCalled();
  });
});

describe("lookups", () => {
  it("answers actors, byTag, ofType, and find over live actors in spawn order", () => {
    class Ball extends TestActor {}
    class Wall extends TestActor {}

    const { world } = openWorld({ mode: GameMode });
    const wall = world.spawn(Wall, { tags: ["solid"] });
    const ball = world.spawn(Ball, { tags: ["solid", "round"] });
    const second = world.spawn(Ball);

    expect(world.actors()).toEqual([wall, ball, second]);
    expect(world.byTag("solid")).toEqual([wall, ball]);
    expect(world.ofType(Ball)).toEqual([ball, second]);
    expect(world.find(Ball)).toBe(ball);
    expect(world.find(Pawn)).toBeNull();

    ball.destroy();
    // A destroyed actor leaves every lookup at once, before the flush.
    expect(world.actors()).toEqual([wall, second]);
    expect(world.byTag("round")).toEqual([]);
    expect(world.find(Ball)).toBe(second);
  });

  it("returns copies the caller owns", () => {
    const { world } = openWorld({ mode: GameMode });
    world.spawn(TestActor);
    const copy = world.actors() as Actor[];
    copy.length = 0;
    expect(world.actors()).toHaveLength(1);
  });

  it("lists controllers in addition order and players in index order", () => {
    const { world } = openWorld({ mode: GameMode });
    const right = world.mode.addPlayer({ index: 1 });
    const left = world.mode.addPlayer({ index: 0 });
    expect(world.controllers()).toEqual([right, left]);
    expect(world.players()).toEqual([left, right]);
    expect(world.players()[0]).toBeInstanceOf(PlayerController);
  });
});

describe("destroying", () => {
  it("sweeps marked actors at the flush, newest spawn first, components before actor", () => {
    const log: string[] = [];

    class Logged extends TestActor {
      label = "";

      override endPlay(reason: EndPlayReason): void {
        log.push(`${this.label}.end(${reason})`);
      }
    }

    const { world, emitted } = openWorld({ mode: GameMode });
    const a = world.spawn(Logged, {
      configure: (actor) => {
        actor.label = "a";
        actor.attach(new LoggedComponent("a.c", log));
      },
    });
    world.spawn(Logged, { configure: (actor) => (actor.label = "b") });
    const c = world.spawn(Logged, {
      configure: (actor) => (actor.label = "c"),
    });

    log.length = 0;
    a.destroy();
    c.destroy();
    expect(log).toEqual([]);
    world.flushDestroyed();
    // Reverse spawn order across the batch; each actor's components end
    // before the actor itself.
    expect(log).toEqual([
      "c.end(destroyed)",
      "a.c.end(destroyed)",
      "a.end(destroyed)",
    ]);
    const destroyed = emitted
      .filter((entry) => entry.event === "actor:destroyed")
      .map((entry) => (entry.payload as { actor: Logged }).actor.label);
    expect(destroyed).toEqual(["c", "a"]);
  });

  it("unpossesses a pawn at the mark and runs pawnDied after its endPlay", () => {
    const log: string[] = [];

    class Doomed extends TestPawn {
      override endPlay(reason: EndPlayReason): void {
        log.push(`pawn.end(${reason})`);
      }
    }

    class Reporting extends GameMode {
      override pawnClass = Doomed as typeof Doomed | null;

      override pawnDied(controller: Controller, pawn: Pawn): void {
        log.push(
          `pawnDied(controller=${controller instanceof PlayerController}, ` +
            `unpossessed=${pawn.controller === null})`,
        );
      }
    }

    const { world } = openWorld({ mode: Reporting });
    const controller = world.mode.addPlayer();
    const pawn = controller.pawn as Doomed;
    pawn.destroy();
    // The seat cleared at the mark, well before the end-of-frame teardown.
    expect(controller.pawn).toBeNull();
    expect(pawn.controller).toBeNull();
    world.flushDestroyed();
    expect(log).toEqual([
      "pawn.end(destroyed)",
      "pawnDied(controller=true, unpossessed=true)",
    ]);
  });

  it("routes pawnDied to the controller of the mark, surviving a mid-frame restart", () => {
    const died: Array<{ pawn: Pawn; nowHolds: Pawn | null }> = [];

    class Respawning extends GameMode {
      override pawnClass = TestPawn as typeof TestPawn | null;

      override pawnDied(controller: Controller, pawn: Pawn): void {
        died.push({ pawn, nowHolds: controller.pawn });
      }
    }

    const { world } = openWorld({ mode: Respawning });
    const controller = world.mode.addPlayer();
    const first = controller.pawn as TestPawn;
    // A mid-frame restart: the old pawn is marked, and the controller holds
    // its replacement by the time the flush runs.
    const second = world.mode.restart(controller) as TestPawn;
    world.flushDestroyed();
    expect(died).toHaveLength(1);
    expect(died[0]?.pawn).toBe(first);
    expect(died[0]?.nowHolds).toBe(second);
    expect(world.actors()).toEqual([second]);
  });

  it("sweeps destroys queued by a teardown in the same flush", () => {
    const order: string[] = [];

    class Debris extends TestActor {
      override endPlay(): void {
        order.push("debris.end");
      }
    }

    class Exploding extends TestActor {
      override endPlay(): void {
        order.push("exploding.end");
        (this.world as unknown as World).find(Debris)?.destroy();
      }
    }

    const { world } = openWorld({ mode: GameMode });
    const exploding = world.spawn(Exploding);
    world.spawn(Debris);
    exploding.destroy();
    world.flushDestroyed();
    expect(order).toEqual(["exploding.end", "debris.end"]);
    expect(world.actors()).toEqual([]);
  });
});

describe("transition requests", () => {
  it("defers open, honoring the last request of the frame", () => {
    const { world } = openWorld({ mode: GameMode });
    world.open("title");
    world.open("arena", { round: 2 });
    const taken = world.takeTransition();
    expect(taken).toEqual({ level: "arena", options: { round: 2 } });
    // Taking it clears it, so the next frame starts with none.
    expect(world.takeTransition()).toBeNull();
  });

  it("defaults the options to an empty object", () => {
    const { world } = openWorld({ mode: GameMode });
    world.open("title");
    expect(world.takeTransition()).toEqual({ level: "title", options: {} });
  });
});

/* -------------------------------------------------------------------------- */
/* The driver                                                                 */
/* -------------------------------------------------------------------------- */

/** A driver over fakes, its collaborators logging into one shared order. */
function makeDriver(levels: Readonly<Record<string, LevelDefinition>>) {
  const log: string[] = [];
  const emitted: Emitted[] = [];
  const built: Array<{ level: string; camera: object }> = [];
  const emit: WorldDeps["emit"] = (event, payload) => {
    emitted.push({ event, payload });
    log.push(`emit ${event}`);
  };
  const deps: WorldDriverDeps = {
    levels,
    instance: {
      worldOpened: (world) => log.push(`instance.worldOpened(${world.level})`),
      worldClosing: (world) =>
        log.push(`instance.worldClosing(${world.level})`),
    },
    emit,
    loadApi: { tag: "loadApi" } as unknown as LoadApi,
    buildDeps: (level, definition, options) => {
      const camera = { tag: `camera:${level}` };
      built.push({ level, camera });
      return {
        level,
        definition,
        options,
        camera: camera as unknown as Camera<Actor>,
        collision: { tag: "collision" } as unknown as CollisionWorld,
        audio: { tag: "audio" } as unknown as WorldAudio,
        assets: { tag: "assets" } as unknown as InitApi["assets"],
        events: { on: () => () => {} } as EngineEvents,
        emit,
        registerDiagnostic: () => {},
        createInputReader: makeReader,
        frame: () => ({ count: 0, timeMs: 0, lastDeltaMs: 0 }),
        viewport: () => ({
          width: 640,
          height: 360,
          scale: 1,
          offsetX: 0,
          offsetY: 0,
        }),
      };
    },
    dropWorldDiagnostics: () => log.push("diagnostics.drop"),
    closeCollision: () => log.push("collision.close"),
  };
  const driver = new WorldDriver(deps);
  return { driver, log, emitted, built };
}

describe("WorldDriver", () => {
  it("opens the start level with from: null and no closing half", async () => {
    const { driver, log, emitted } = makeDriver({ title: { mode: GameMode } });
    expect(driver.current()).toBeNull();
    const world = await driver.open("title");
    expect(driver.current()).toBe(world);
    expect(world.level).toBe("title");
    expect(log).toEqual([
      "emit world:opening",
      "emit world:opened",
      "instance.worldOpened(title)",
    ]);
    expect(emitted[0]?.payload).toEqual({ from: null, to: "title" });
  });

  it("runs the fixed twelve-step sequence on a transition", async () => {
    const log: string[] = [];

    class Placed extends TestActor {
      override beginPlay(): void {
        log.push(`actor.begin(${(this.world as unknown as World).level})`);
      }

      override endPlay(reason: EndPlayReason): void {
        log.push(`actor.end(${reason})`);
      }
    }

    class Mode extends GameMode {
      override beginPlay(): void {
        log.push(`mode.begin(${this.world.level})`);
        this.addPlayer();
      }

      override endPlay(reason: EndPlayReason): void {
        log.push(`mode.end(${reason})`);
      }
    }

    class LoggedController extends PlayerController {
      override endPlay(reason: EndPlayReason): void {
        log.push(`controller.end(${reason})`);
      }
    }

    const levels: Record<string, LevelDefinition> = {
      title: {
        mode: class extends Mode {
          override playerControllerClass = LoggedController;
        },
        actors: [{ type: Placed }],
      },
      arena: {
        mode: Mode,
        actors: [{ type: Placed }],
        load: async () => {
          await Promise.resolve();
          log.push("load(arena)");
        },
      },
    };
    const { driver, log: driverLog } = makeDriver(levels);
    // Interleave the two logs by sharing one array.
    driverLog.push = (entry: string) => {
      log.push(entry);
      return log.length;
    };

    await driver.open("title");
    log.length = 0;
    await driver.open("arena", { round: 2 });
    expect(log).toEqual([
      "emit world:opening", // 1
      "instance.worldClosing(title)", // 2
      "diagnostics.drop", // 3
      // Step 3's other half: the held overlap pairs end while the world is
      // still whole, so an `overlap:end` handler reads both actors alive.
      "collision.close",
      "controller.end(level-closed)", // 4
      "actor.end(level-closed)", // 5
      "mode.end(level-closed)", // 6
      "emit world:closed", // 7
      "load(arena)", // 8
      "emit actor:spawned", // 9 — the incoming world's declared actor
      "actor.begin(arena)", // 10
      "mode.begin(arena)", // 11
      "emit world:opened", // 12
      "instance.worldOpened(arena)",
    ]);
  });

  it("hands the transition's options to the incoming mode before beginPlay", async () => {
    const read: unknown[] = [];

    class Reading extends GameMode {
      override beginPlay(): void {
        read.push(this.options);
      }
    }

    const { driver } = makeDriver({
      title: { mode: Reading },
      arena: { mode: Reading },
    });
    await driver.open("title");
    await driver.open("arena", { round: 3 });
    // The start level receives an empty object; a transition its options.
    expect(read).toEqual([{}, { round: 3 }]);
  });

  it("rebuilds the world's collaborators and restarts its clock per opening", async () => {
    const { driver, built } = makeDriver({
      title: { mode: GameMode },
      arena: { mode: GameMode },
    });
    const title = await driver.open("title");
    title.simulate(2.5);
    expect(title.time).toBe(2.5);
    const stale = vi.fn();
    title.after(0.1, stale);

    const arena = await driver.open("arena");
    expect(arena).not.toBe(title);
    expect(arena.time).toBe(0);
    // The deps factory ran once per opening, so the camera is this world's
    // own, at its defaults.
    expect(built.map((entry) => entry.level)).toEqual(["title", "arena"]);
    expect(arena.camera).toBe(built[1]?.camera);
    // The outgoing world's timers were cleared at its close.
    arena.simulate(1);
    expect(stale).not.toHaveBeenCalled();
  });

  it("awaits the incoming level's load before any of its actors exist", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const constructed: string[] = [];

    class Gated extends TestActor {
      constructor() {
        super();
        constructed.push("gated");
      }
    }

    const { driver } = makeDriver({
      title: { mode: GameMode },
      arena: {
        mode: GameMode,
        actors: [{ type: Gated }],
        load: () => gate,
      },
    });
    await driver.open("title");
    const opening = driver.open("arena");
    await Promise.resolve();
    // The old world is closed, the new one not yet built: the loop runs no
    // frame while a transition is in flight.
    expect(driver.current()).toBeNull();
    expect(constructed).toEqual([]);
    release();
    const arena = await opening;
    expect(constructed).toEqual(["gated"]);
    expect(driver.current()).toBe(arena);
  });

  it("refuses an unregistered level, leaving the running world standing", async () => {
    const { driver, emitted } = makeDriver({
      title: { mode: GameMode },
      arena: { mode: GameMode },
    });
    const title = await driver.open("title");
    const before = emitted.length;
    await expect(driver.open("lobby")).rejects.toThrow(
      /"lobby" is not a registered level/,
    );
    await expect(driver.open("lobby")).rejects.toThrow(
      /registers: title, arena/,
    );
    // Refused before anything closed: no events, same world.
    expect(emitted.length).toBe(before);
    expect(driver.current()).toBe(title);
  });
});
