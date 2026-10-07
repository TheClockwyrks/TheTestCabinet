import { describe, expect, it, vi } from "vitest";
import { Actor, Pawn, actorHasBegunPlay } from "./actors";
import { Component } from "./components";
import type {
  Camera,
  CollisionWorld,
  EngineEventMap,
  EngineEvents,
  InitApi,
  InputReader,
  LevelDefinition,
  WorldAudio,
} from "./contract";
import { PlayerController } from "./controllers";
import { GameMode, GameState } from "./game-mode";
import { EngineWorld, type WorldDeps } from "./worlds";

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
 * `Actor` and `Pawn` — the world speaks only their documented surface, and
 * the actors module is implemented — so nothing needs stubbing.
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

  override endPlay(reason: string): void {
    this.log.push(`${this.name}.end(${reason})`);
  }
}

/** A named seat for the tests that read one; possession is the real thing. */
class TestController extends PlayerController {}

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
    camera: { tag: "camera" } as unknown as Camera,
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

  it("applies a declared actor's transform field by field over the defaults", () => {
    const { world } = makeWorld({
      mode: GameMode,
      actors: [{ type: TestActor, transform: { x: 12, scaleY: 2 } }],
    });
    expect(world.actors()[0]?.transform).toEqual({
      x: 12,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 2,
    });
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
        peers.push(this.world.byTag("peer").length);
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

    makeWorld({
      mode: LoggedMode,
      actors: [
        {
          type: Logged,
          configure: (actor) => {
            const logged = actor as Logged;
            logged.label = "a";
            logged.attach(new LoggedComponent("a.c1", log));
            logged.attach(new LoggedComponent("a.c2", log));
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
    }).world.begin();
    expect(log).toEqual([
      "a.begin",
      "a.c1.begin",
      "a.c2.begin",
      "b.begin",
      "b.c1.begin",
      "mode.begin",
    ]);
  });

  it("begins a component attached during its actor's own beginPlay exactly once", () => {
    const log: string[] = [];

    class LateAttacher extends TestActor {
      override beginPlay(): void {
        log.push("actor.begin");
        this.attach(new LoggedComponent("late", log));
      }
    }

    makeWorld({
      mode: GameMode,
      actors: [{ type: LateAttacher }],
    }).world.begin();
    expect(log).toEqual(["actor.begin", "late.begin"]);
  });

  it("reaches a component attached during another component's beginPlay", () => {
    const log: string[] = [];

    class Chaining extends Component {
      constructor(
        private readonly owner: TestActor,
        private readonly log2: string[],
      ) {
        super();
      }

      override beginPlay(): void {
        this.log2.push("chain.begin");
        this.owner.attach(new LoggedComponent("chained", this.log2));
      }
    }

    class Host extends TestActor {
      constructor() {
        super();
        this.attach(new Chaining(this, log));
      }
    }

    makeWorld({ mode: GameMode, actors: [{ type: Host }] }).world.begin();
    expect(log).toEqual(["chain.begin", "chained.begin"]);
  });

  it("lets the mode's beginPlay spawn into a fully begun world", () => {
    class Prompt extends TestActor {}

    class MenuMode extends GameMode {
      override beginPlay(): void {
        this.world.spawn(Prompt, { transform: { x: 320, y: 180 } });
      }
    }

    const { world } = openWorld({ mode: MenuMode });
    expect(world.find(Prompt)?.transform.x).toBe(320);
  });
});

describe("spawn", () => {
  it("returns a fully live actor: spec applied, beginPlay run, event emitted", () => {
    const log: string[] = [];

    class Ball extends TestActor {
      velocity = { x: 0, y: 0 };

      override beginPlay(): void {
        log.push("ball.begin");
      }
    }

    const { world, emitted } = openWorld({ mode: GameMode });
    const ball = world.spawn(Ball, {
      transform: { x: 320, y: 180 },
      tags: ["ball"],
      configure: (b) => {
        b.velocity = { x: 260, y: 0 };
      },
    });
    expect(ball.transform).toMatchObject({ x: 320, y: 180 });
    expect(ball.hasTag("ball")).toBe(true);
    expect(ball.velocity).toEqual({ x: 260, y: 0 });
    expect(log).toEqual(["ball.begin"]);
    expect(actorHasBegunPlay(ball)).toBe(true);
    expect(emitted.at(-1)).toEqual({
      event: "actor:spawned",
      payload: { actor: ball },
    });
  });

  it("runs each component's beginPlay before returning", () => {
    const log: string[] = [];

    class Assembled extends TestActor {
      constructor() {
        super();
        this.attach(new LoggedComponent("c", log));
      }

      override beginPlay(): void {
        log.push("actor.begin");
      }
    }

    openWorld({ mode: GameMode }).world.spawn(Assembled);
    expect(log).toEqual(["actor.begin", "c.begin"]);
  });

  it("continues the id sequence after the declared actors", () => {
    const { world } = openWorld({
      mode: GameMode,
      actors: [{ type: TestActor }, { type: TestActor }],
    });
    expect(world.spawn(TestActor).id).toBe(3);
    expect(world.spawn(TestActor).id).toBe(4);
  });

  it("runs a late-attached component's beginPlay from attach itself", () => {
    const log: string[] = [];
    const { world } = openWorld({ mode: GameMode });
    const actor = world.spawn(TestActor);
    actor.attach(new LoggedComponent("late", log));
    expect(log).toEqual(["late.begin"]);
  });
});

describe("lookups", () => {
  class Ball extends TestActor {}
  class Wall extends TestActor {}

  it("returns live actors in spawn order, as copies the caller owns", () => {
    const { world } = openWorld({ mode: GameMode });
    const first = world.spawn(Ball);
    const second = world.spawn(Wall);
    const listed = world.actors();
    expect(listed).toEqual([first, second]);
    (listed as Actor[]).length = 0;
    expect(world.actors()).toEqual([first, second]);
  });

  it("drops a destroyed actor from every lookup at once", () => {
    const { world } = openWorld({ mode: GameMode });
    const ball = world.spawn(Ball, { tags: ["ball"] });
    ball.destroy();
    expect(world.actors()).toEqual([]);
    expect(world.byTag("ball")).toEqual([]);
    expect(world.ofType(Ball)).toEqual([]);
    expect(world.find(Ball)).toBeNull();
  });

  it("filters byTag and ofType, and find takes the first or null", () => {
    const { world } = openWorld({ mode: GameMode });
    const first = world.spawn(Ball, { tags: ["ball"] });
    world.spawn(Wall);
    const second = world.spawn(Ball, { tags: ["ball"] });
    expect(world.byTag("ball")).toEqual([first, second]);
    expect(world.byTag("nothing")).toEqual([]);
    expect(world.ofType(Ball)).toEqual([first, second]);
    expect(world.find(Ball)).toBe(first);
    expect(world.find(TestPawn)).toBeNull();
  });
});

describe("controllers and players", () => {
  class SeatedMode extends GameMode {
    override playerControllerClass = TestController;
  }

  it("lists controllers in addition order and players in index order", () => {
    class Seated extends SeatedMode {
      override beginPlay(): void {
        this.addPlayer({ index: 1, name: "right" });
        this.addPlayer({ index: 0, name: "left" });
      }
    }

    const { world } = openWorld({ mode: Seated });
    expect(world.controllers().map((c) => c.playerState.name)).toEqual([
      "right",
      "left",
    ]);
    expect(world.players().map((c) => c.playerState.name)).toEqual([
      "left",
      "right",
    ]);
  });

  it("returns copies of the controller list", () => {
    class Seated extends SeatedMode {
      override beginPlay(): void {
        this.addPlayer();
      }
    }

    const { world } = openWorld({ mode: Seated });
    const listed = world.controllers();
    (listed as unknown[]).length = 0;
    expect(world.controllers()).toHaveLength(1);
  });

  it("runs a controller's beginPlay as it is added", () => {
    const log: string[] = [];

    class Announcing extends TestController {
      override beginPlay(): void {
        log.push(`begin index=${this.index}`);
      }
    }

    class Seated extends GameMode {
      override playerControllerClass = Announcing;

      override beginPlay(): void {
        this.addPlayer();
      }
    }

    openWorld({ mode: Seated });
    expect(log).toEqual(["begin index=0"]);
  });
});

describe("simulate", () => {
  it("advances time before the controllers tick, then actors, then components", () => {
    const log: string[] = [];

    class Watching extends TestController {
      override tick(dt: number): void {
        log.push(`controller.tick(${dt}) t=${this.world.time}`);
      }
    }

    class Mover extends TestActor {
      constructor() {
        super();
        this.attach(new LoggedComponent("c", log));
      }

      override tick(dt: number): void {
        log.push(`actor.tick(${dt})`);
      }
    }

    class Seated extends GameMode {
      override playerControllerClass = Watching;

      override beginPlay(): void {
        this.addPlayer();
      }
    }

    const { world } = openWorld({ mode: Seated, actors: [{ type: Mover }] });
    log.length = 0;
    world.simulate(0.5);
    expect(world.time).toBe(0.5);
    expect(log).toEqual([
      "controller.tick(0.5) t=0.5",
      "actor.tick(0.5)",
      "c.tick(0.5)",
    ]);
  });

  it("ticks actors in spawn order", () => {
    const log: string[] = [];

    class Labeled extends TestActor {
      label = "";

      override tick(): void {
        log.push(this.label);
      }
    }

    const { world } = openWorld({ mode: GameMode });
    world.spawn(Labeled, { configure: (a) => (a.label = "first") });
    world.spawn(Labeled, { configure: (a) => (a.label = "second") });
    world.simulate(1 / 60);
    expect(log).toEqual(["first", "second"]);
  });

  it("skips a tick-disabled actor and its components", () => {
    const log: string[] = [];

    class Sleeper extends TestActor {
      constructor() {
        super();
        this.attach(new LoggedComponent("c", log));
      }

      override tick(): void {
        log.push("actor.tick");
      }
    }

    const { world } = openWorld({ mode: GameMode });
    const sleeper = world.spawn(Sleeper);
    log.length = 0;
    sleeper.tickEnabled = false;
    world.simulate(1 / 60);
    expect(log).toEqual([]);
  });

  it("skips a disabled component but ticks the rest", () => {
    const log: string[] = [];
    const { world } = openWorld({ mode: GameMode });
    const actor = world.spawn(TestActor);
    const off = actor.attach(new LoggedComponent("off", log));
    actor.attach(new LoggedComponent("on", log));
    log.length = 0;
    off.enabled = false;
    world.simulate(1);
    expect(log).toEqual(["on.tick(1)"]);
  });

  it("stops ticking a destroyed actor immediately", () => {
    const log: string[] = [];

    class Assassin extends TestActor {
      target: Actor | null = null;

      override tick(): void {
        log.push("assassin.tick");
        this.target?.destroy();
      }
    }

    class Victim extends TestActor {
      constructor() {
        super();
        this.attach(new LoggedComponent("victim.c", log));
      }

      override tick(): void {
        log.push("victim.tick");
      }
    }

    const { world } = openWorld({ mode: GameMode });
    const assassin = world.spawn(Assassin);
    const victim = world.spawn(Victim);
    log.length = 0;
    assassin.target = victim;
    world.simulate(1 / 60);
    // The victim was marked dead before its turn: neither it nor its
    // components tick again.
    expect(log).toEqual(["assassin.tick"]);
  });

  it("stops an actor's own component walk when its tick destroys it", () => {
    const log: string[] = [];

    class SelfDestruct extends TestActor {
      constructor() {
        super();
        this.attach(new LoggedComponent("c", log));
      }

      override tick(): void {
        log.push("actor.tick");
        this.destroy();
      }
    }

    const { world } = openWorld({ mode: GameMode });
    world.spawn(SelfDestruct);
    log.length = 0;
    world.simulate(1 / 60);
    expect(log).toEqual(["actor.tick"]);
  });

  it("gives a mid-frame spawn its first tick on the next frame", () => {
    const log: string[] = [];

    class Spawned extends TestActor {
      override tick(): void {
        log.push("spawned.tick");
      }
    }

    class Spawner extends TestActor {
      armed = false;

      override tick(): void {
        if (!this.armed) return;
        this.armed = false;
        this.world.spawn(Spawned);
      }
    }

    const { world } = openWorld({ mode: GameMode });
    const spawner = world.spawn(Spawner);
    spawner.armed = true;
    world.simulate(1 / 60);
    expect(log).toEqual([]);
    world.simulate(1 / 60);
    expect(log).toEqual(["spawned.tick"]);
  });

  it("gives an actor a controller's tick spawned its first tick on the next frame", () => {
    const log: string[] = [];

    class Spawned extends TestActor {
      override tick(): void {
        log.push("spawned.tick");
      }
    }

    class Spawning extends TestController {
      armed = false;

      override tick(): void {
        if (!this.armed) return;
        this.armed = false;
        this.world.spawn(Spawned);
      }
    }

    class Seated extends GameMode {
      override playerControllerClass = Spawning;

      override beginPlay(): void {
        this.addPlayer();
      }
    }

    const { world } = openWorld({ mode: Seated });
    const controller = world.controllers()[0] as Spawning;
    controller.armed = true;
    // Controllers tick before the actors, but the spawn still waits a frame.
    world.simulate(1 / 60);
    expect(log).toEqual([]);
    world.simulate(1 / 60);
    expect(log).toEqual(["spawned.tick"]);
  });
});

describe("pausing", () => {
  it("suspends time, controllers, timers, and the mode, but not rendering state", () => {
    const log: string[] = [];

    class Watching extends TestController {
      override tick(): void {
        log.push("controller.tick");
      }
    }

    class Seated extends GameMode {
      override playerControllerClass = Watching;

      override beginPlay(): void {
        this.addPlayer();
      }

      override tick(): void {
        log.push("mode.tick");
      }
    }

    const { world } = openWorld({ mode: Seated });
    world.after(0.5, () => log.push("timer"));
    world.setPaused(true);
    expect(world.paused).toBe(true);
    world.simulate(1);
    world.tickMode(1);
    expect(world.time).toBe(0);
    expect(log).toEqual([]);
    // Resuming picks the simulation back up exactly where it stood.
    world.setPaused(false);
    world.simulate(1);
    world.tickMode(1);
    expect(world.time).toBe(1);
    expect(log).toEqual(["controller.tick", "timer", "mode.tick"]);
  });

  it("still ticks an actor that opted in, with its components", () => {
    const log: string[] = [];

    class Menu extends TestActor {
      constructor() {
        super();
        this.tickWhenPaused = true;
        this.attach(new LoggedComponent("menu.c", log));
      }

      override tick(): void {
        log.push("menu.tick");
      }
    }

    class Still extends TestActor {
      override tick(): void {
        log.push("still.tick");
      }
    }

    const { world } = openWorld({ mode: GameMode });
    world.spawn(Menu);
    world.spawn(Still);
    log.length = 0;
    world.setPaused(true);
    world.simulate(1 / 60);
    expect(log).toEqual(["menu.tick", `menu.c.tick(${1 / 60})`]);
  });
});

describe("timers", () => {
  it("runs an after callback once, at the step that crosses its due time", () => {
    const fired: number[] = [];
    const { world } = openWorld({ mode: GameMode });
    world.after(1.5, () => fired.push(world.time));
    world.simulate(1);
    expect(fired).toEqual([]);
    world.simulate(1);
    expect(fired).toEqual([2]);
    world.simulate(1);
    expect(fired).toEqual([2]);
  });

  it("repeats an every callback each period, catching up over a large delta", () => {
    let count = 0;
    const { world } = openWorld({ mode: GameMode });
    world.every(1, () => (count += 1));
    world.simulate(1);
    expect(count).toBe(1);
    world.simulate(0.5);
    expect(count).toBe(1);
    // A delta stepping over several periods fires once per period crossed.
    world.simulate(3);
    expect(count).toBe(4);
  });

  it("cancels a timer through its handle, even from another callback", () => {
    const fired: string[] = [];
    const { world } = openWorld({ mode: GameMode });
    world.after(1, () => {
      fired.push("first");
      world.clearTimer(second);
    });
    const second = world.after(1, () => fired.push("second"));
    world.simulate(1);
    expect(fired).toEqual(["first"]);
  });

  it("lets a repeating callback clear itself", () => {
    let count = 0;
    const { world } = openWorld({ mode: GameMode });
    const handle = world.every(1, () => {
      count += 1;
      if (count === 2) world.clearTimer(handle);
    });
    world.simulate(5);
    expect(count).toBe(2);
  });

  it("fires due timers earliest first, whatever the scheduling order", () => {
    const fired: string[] = [];
    const { world } = openWorld({ mode: GameMode });
    world.after(2, () => fired.push("later"));
    world.after(1, () => fired.push("sooner"));
    world.simulate(2);
    expect(fired).toEqual(["sooner", "later"]);
  });

  it("defers a timer scheduled by a callback to the next frame", () => {
    const fired: string[] = [];
    const { world } = openWorld({ mode: GameMode });
    world.after(1, () => {
      fired.push("outer");
      world.after(0, () => fired.push("inner"));
    });
    world.simulate(1);
    expect(fired).toEqual(["outer"]);
    world.simulate(1 / 60);
    expect(fired).toEqual(["outer", "inner"]);
  });

  it("treats a degenerate every period as once per frame", () => {
    let count = 0;
    const { world } = openWorld({ mode: GameMode });
    world.every(0, () => (count += 1));
    world.simulate(1 / 60);
    expect(count).toBe(1);
    world.simulate(1 / 60);
    expect(count).toBe(2);
  });

  it("hands out distinct handles and refuses non-finite seconds", () => {
    const { world } = openWorld({ mode: GameMode });
    const a = world.after(1, () => {});
    const b = world.every(1, () => {});
    expect(a).not.toBe(b);
    expect(() => world.after(Number.NaN, () => {})).toThrow(RangeError);
    expect(() => world.every(Number.POSITIVE_INFINITY, () => {})).toThrow(
      /world\.every/,
    );
  });

  it("clears every timer when the world closes", () => {
    const fired: string[] = [];
    const { world } = openWorld({ mode: GameMode });
    world.after(1, () => fired.push("after"));
    world.every(1, () => fired.push("every"));
    world.close();
    world.simulate(5);
    expect(fired).toEqual([]);
  });
});

describe("the match clock", () => {
  it("accumulates elapsed only while the phase is playing", () => {
    class Phased extends GameMode {}

    const { world } = openWorld({ mode: Phased });
    world.simulate(1);
    expect(world.state.elapsed).toBe(0);
    world.mode.setPhase("playing");
    world.simulate(1);
    world.simulate(0.5);
    expect(world.state.elapsed).toBe(1.5);
    world.mode.setPhase("over");
    world.simulate(1);
    expect(world.state.elapsed).toBe(1.5);
    // The world clock kept counting the whole way.
    expect(world.time).toBe(3.5);
  });
});

describe("tickMode", () => {
  it("hands the mode the frame's delta", () => {
    const deltas: number[] = [];

    class Deciding extends GameMode {
      override tick(dt: number): void {
        deltas.push(dt);
      }
    }

    const { world } = openWorld({ mode: Deciding });
    world.tickMode(0.25);
    expect(deltas).toEqual([0.25]);
  });
});

describe("flushDestroyed", () => {
  it("removes a dead actor: components end, actor ends, event emitted", () => {
    const log: string[] = [];

    class Doomed extends TestActor {
      constructor() {
        super();
        this.attach(new LoggedComponent("c1", log));
        this.attach(new LoggedComponent("c2", log));
      }

      override endPlay(reason: string): void {
        log.push(`actor.end(${reason})`);
      }
    }

    const { world, emitted } = openWorld({ mode: GameMode });
    const doomed = world.spawn(Doomed);
    const survivor = world.spawn(TestActor);
    log.length = 0;
    doomed.destroy();
    world.flushDestroyed();
    expect(log).toEqual([
      "c1.end(destroyed)",
      "c2.end(destroyed)",
      "actor.end(destroyed)",
    ]);
    expect(emitted.at(-1)).toEqual({
      event: "actor:destroyed",
      payload: { actor: doomed },
    });
    expect(world.actors()).toEqual([survivor]);
  });

  it("does nothing while every actor is alive", () => {
    const { world, emitted } = openWorld({ mode: GameMode });
    world.spawn(TestActor);
    const before = emitted.length;
    world.flushDestroyed();
    expect(emitted.length).toBe(before);
  });

  it("unpossesses a possessed pawn first, then ends its play, then tells the mode it died", () => {
    const log: string[] = [];

    class Fighter extends TestPawn {
      override endPlay(reason: string): void {
        const seat = this.controller === null ? "null" : "held";
        log.push(`pawn.end(${reason}) controller=${seat}`);
      }
    }

    class Watching extends TestController {
      override unpossess(): void {
        log.push("unpossess");
        super.unpossess();
      }
    }

    class ArenaMode extends GameMode {
      override playerControllerClass = Watching;
      override pawnClass = Fighter;

      override beginPlay(): void {
        this.addPlayer();
      }

      override pawnDied(controller: unknown, pawn: Pawn): void {
        log.push(`pawnDied possessed=${(pawn as Fighter).controller !== null}`);
        void controller;
      }
    }

    const { world } = openWorld({ mode: ArenaMode });
    const pawn = world.find(Fighter);
    expect(pawn).not.toBeNull();
    log.length = 0;
    pawn?.destroy();
    // Destroying a pawn unpossesses it first — at the mark, not at the flush.
    expect(log).toEqual(["unpossess"]);
    world.flushDestroyed();
    expect(log).toEqual([
      "unpossess",
      "pawn.end(destroyed) controller=null",
      "pawnDied possessed=false",
    ]);
  });

  it("emits possession:changed before actor:destroyed for a possessed pawn", () => {
    const order: string[] = [];

    class Fighter extends TestPawn {}

    class ArenaMode extends GameMode {
      override playerControllerClass = TestController;
      override pawnClass = Fighter;

      override beginPlay(): void {
        this.addPlayer();
      }
    }

    const { world } = openWorld(
      { mode: ArenaMode },
      {
        // One log across both halves of the broadcaster: the possession
        // machinery emits through `world.events`, the world itself through
        // the deps' `emit`.
        emit: (event) => {
          order.push(event);
        },
        events: {
          on: () => () => {},
          emit: (event: string) => {
            order.push(event);
          },
        } as unknown as EngineEvents,
      },
    );
    const pawn = world.find(Fighter);
    order.length = 0;
    pawn?.destroy();
    world.flushDestroyed();
    expect(order).toEqual(["possession:changed", "actor:destroyed"]);
  });

  it("fires pawnDied against the controller a mid-frame restart re-seated", () => {
    const died: { controller: unknown; pawn: Pawn }[] = [];

    class Fighter extends TestPawn {}

    class ArenaMode extends GameMode {
      override playerControllerClass = TestController;
      override pawnClass = Fighter;

      override beginPlay(): void {
        this.addPlayer();
      }

      override pawnDied(controller: unknown, pawn: Pawn): void {
        died.push({ controller, pawn });
      }
    }

    const { world } = openWorld({ mode: ArenaMode });
    const controller = world.controllers()[0];
    expect(controller).toBeDefined();
    if (controller === undefined) return;
    const first = controller.pawn;
    const second = world.mode.restart(controller);
    world.flushDestroyed();
    // The old pawn was possessed when it was marked, so the mode hears of
    // its death even though the controller holds the fresh pawn by the flush.
    expect(died).toEqual([{ controller, pawn: first }]);
    expect(controller.pawn).toBe(second);
    expect(world.actors()).toEqual([second]);
  });

  it("tears the frame's destroys down in reverse spawn order", () => {
    const log: string[] = [];

    class Logged extends TestActor {
      label = "";

      override endPlay(reason: string): void {
        log.push(`${this.label}.end(${reason})`);
      }
    }

    const { world } = openWorld({ mode: GameMode });
    const first = world.spawn(Logged, {
      configure: (a) => (a.label = "first"),
    });
    world.spawn(Logged, { configure: (a) => (a.label = "second") });
    const third = world.spawn(Logged, {
      configure: (a) => (a.label = "third"),
    });
    const fourth = world.spawn(Logged, {
      configure: (a) => (a.label = "fourth"),
    });
    log.length = 0;
    // Marked out of spawn order; the sweep ignores the call order.
    first.destroy();
    fourth.destroy();
    third.destroy();
    world.flushDestroyed();
    expect(log).toEqual([
      "fourth.end(destroyed)",
      "third.end(destroyed)",
      "first.end(destroyed)",
    ]);
  });

  it("sweeps destroys a teardown queues as a later batch, reverse spawn order again", () => {
    const log: string[] = [];

    class Logged extends TestActor {
      label = "";
      also: Actor[] = [];

      override endPlay(reason: string): void {
        log.push(`${this.label}.end(${reason})`);
        for (const actor of this.also) actor.destroy();
      }
    }

    const { world } = openWorld({ mode: GameMode });
    const a = world.spawn(Logged, { configure: (x) => (x.label = "a") });
    const b = world.spawn(Logged, { configure: (x) => (x.label = "b") });
    const c = world.spawn(Logged, { configure: (x) => (x.label = "c") });
    const d = world.spawn(Logged, { configure: (x) => (x.label = "d") });
    log.length = 0;
    c.also = [b, d];
    a.destroy();
    c.destroy();
    world.flushDestroyed();
    // First batch: c then a, newest spawn first. c's teardown queued d and
    // b, swept as the next batch under the same order.
    expect(log).toEqual([
      "c.end(destroyed)",
      "a.end(destroyed)",
      "d.end(destroyed)",
      "b.end(destroyed)",
    ]);
  });

  it("leaves an unpossessed pawn's death to the flush alone", () => {
    const died: Pawn[] = [];

    class LonePawn extends TestPawn {}

    class ArenaMode extends GameMode {
      override pawnDied(_controller: unknown, pawn: Pawn): void {
        died.push(pawn);
      }
    }

    const { world } = openWorld({ mode: ArenaMode });
    const pawn = world.spawn(LonePawn);
    pawn.destroy();
    world.flushDestroyed();
    expect(died).toEqual([]);
    expect(world.actors()).toEqual([]);
  });

  it("sweeps what pawnDied itself destroys or spawns, in the same flush", () => {
    class Debris extends TestActor {}
    class Fighter extends TestPawn {}

    class ArenaMode extends GameMode {
      override playerControllerClass = TestController;
      override pawnClass = Fighter;

      override beginPlay(): void {
        this.addPlayer();
      }

      override pawnDied(): void {
        this.world.spawn(Debris);
        this.world.find(TestActor)?.destroy();
      }
    }

    const { world } = openWorld({
      mode: ArenaMode,
      actors: [{ type: TestActor }],
    });
    world.find(Fighter)?.destroy();
    world.flushDestroyed();
    // The declared actor pawnDied destroyed is gone, the debris it spawned
    // stays, and the pawn itself left first.
    expect(world.find(Fighter)).toBeNull();
    expect(world.ofType(Debris)).toHaveLength(1);
    expect(world.ofType(TestActor)).toHaveLength(1);
  });
});

describe("open and takeTransition", () => {
  it("records the request, defaulting the options to an empty object", () => {
    const { world } = openWorld({ mode: GameMode });
    world.open("results");
    expect(world.takeTransition()).toEqual({ level: "results", options: {} });
  });

  it("honors one call per frame, the latest replacing the earlier", () => {
    const { world } = openWorld({ mode: GameMode });
    world.open("results", { score: 3 });
    world.open("menu");
    expect(world.takeTransition()).toEqual({ level: "menu", options: {} });
  });

  it("clears the request once taken", () => {
    const { world } = openWorld({ mode: GameMode });
    world.open("results");
    world.takeTransition();
    expect(world.takeTransition()).toBeNull();
  });

  it("starts with no request pending", () => {
    const { world } = openWorld({ mode: GameMode });
    expect(world.takeTransition()).toBeNull();
  });
});

describe("close", () => {
  it("ends play in the documented order and empties the world", () => {
    const log: string[] = [];

    class Logged extends TestActor {
      label = "";

      override endPlay(reason: string): void {
        log.push(`${this.label}.end(${reason})`);
      }
    }

    class Watching extends TestController {
      override endPlay(reason: string): void {
        log.push(`controller${this.index}.end(${reason})`);
      }
    }

    class ClosingMode extends GameMode {
      override playerControllerClass = Watching;

      override beginPlay(): void {
        this.addPlayer({ index: 0 });
        this.addPlayer({ index: 1 });
      }

      override endPlay(reason: string): void {
        log.push(`mode.end(${reason})`);
      }
    }

    const { world } = openWorld({
      mode: ClosingMode,
      actors: [
        {
          type: Logged,
          configure: (a) => {
            const logged = a as Logged;
            logged.label = "first";
            logged.attach(new LoggedComponent("first.c", log));
          },
        },
        { type: Logged, configure: (a) => ((a as Logged).label = "second") },
      ],
    });
    log.length = 0;
    world.close();
    expect(log).toEqual([
      // Controllers in reverse order of addition…
      "controller1.end(level-closed)",
      "controller0.end(level-closed)",
      // …then actors in reverse spawn order, components before their actor…
      "second.end(level-closed)",
      "first.c.end(level-closed)",
      "first.end(level-closed)",
      // …then the mode.
      "mode.end(level-closed)",
    ]);
    expect(world.actors()).toEqual([]);
    expect(world.controllers()).toEqual([]);
  });
});

describe("accessors", () => {
  it("hands back the engine-supplied collaborators by identity", () => {
    const { world, deps } = openWorld({ mode: GameMode });
    expect(world.camera).toBe(deps.camera);
    expect(world.collision).toBe(deps.collision);
    expect(world.audio).toBe(deps.audio);
    expect(world.assets).toBe(deps.assets);
    expect(world.events).toBe(deps.events);
    expect(world.frame()).toEqual(deps.frame());
    expect(world.viewport()).toEqual(deps.viewport());
  });

  it("forwards diagnostics.register into the world registry", () => {
    const { world, registerDiagnostic } = openWorld({ mode: GameMode });
    const source = () => 3;
    world.diagnostics.register("balls", source);
    expect(registerDiagnostic).toHaveBeenCalledWith("balls", source);
  });
});

describe("a whole match, frame by frame", () => {
  it("plays the docs' match shape: countdown, score, and a deferred exit", () => {
    // The MatchMode idiom from the worlds-and-transitions example, driven the
    // way the engine's loop would drive it: simulate, mode tick, flush.
    const MATCH_SECONDS = 3;

    class MatchMode extends GameMode {
      override playerControllerClass = TestController;

      override beginPlay(): void {
        this.addPlayer({ name: "player" });
        this.setPhase("playing");
        this.world.after(MATCH_SECONDS, () => this.finish());
      }

      override tick(): void {
        if (this.phase !== "playing") return;
        const player = this.state.players[0];
        if (player !== undefined) player.score += 1;
      }

      private finish(): void {
        this.setPhase("over");
        this.world.open("results", {
          score: this.state.players[0]?.score ?? 0,
        });
      }
    }

    const { world, emitted } = openWorld({ mode: MatchMode });
    const transitions: unknown[] = [];
    for (let i = 0; i < 5; i += 1) {
      frame(world, 1);
      const request = world.takeTransition();
      if (request !== null) transitions.push(request);
    }
    // The timer fired on the third frame, before the mode's tick, so the
    // score counts the two playing frames before it.
    expect(transitions).toEqual([{ level: "results", options: { score: 2 } }]);
    expect(world.state.elapsed).toBe(MATCH_SECONDS);
    expect(
      emitted
        .filter((entry) => entry.event === "match:phase")
        .map((entry) => entry.payload),
    ).toEqual([
      { phase: "playing", previous: "waiting" },
      { phase: "over", previous: "playing" },
    ]);
  });
});
