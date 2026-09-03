import { describe, expect, it, vi } from "vitest";
import { Actor, Pawn, actorHasBegunPlay } from "./actors";
import { AudioBus } from "./audio";
import { Component } from "./components";
import type { InputReader, Vec3 } from "./contract";
import { AIController, PlayerController, type Controller } from "./controllers";
import { GameMode, GameState } from "./game-mode";
import { UP, quatFromAxisAngle, vec3 } from "./math";
import {
  EngineWorld,
  type LevelDefinition,
  type LoadApi,
  type WorldDeps,
} from "./worlds";

/** One emitted event, as a test reads it back. */
interface Emitted {
  event: string;
  payload: unknown;
}

/** An input reader that answers rest for everything; identity is the point. */
function makeReader(): InputReader {
  return {
    value: () => 0,
    pressed: () => false,
    pointer: () => ({ x: 0, y: 0, down: false, device: "mouse", buttons: [] }),
    pointerPressed: () => false,
    pointerReleased: () => false,
    pointerSamples: () => [],
    pointerContacts: () => [],
    wheel: () => ({ x: 0, y: 0 }),
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

/** The identity transform, as an actor is constructed carrying it. */
const IDENTITY = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
};

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
    camera: { tag: "camera" } as unknown as WorldDeps["camera"],
    collision: { tag: "collision" } as unknown as WorldDeps["collision"],
    audio: { tag: "audio" } as unknown as WorldDeps["audio"],
    assets: { tag: "assets" } as unknown as WorldDeps["assets"],
    events: { on: () => () => {} } as unknown as WorldDeps["events"],
    emit: (event, payload) => {
      emitted.push({ event: String(event), payload });
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

/**
 * Steps 8–11 of a level opening, as the engine's driver performs them: the
 * incoming level's `load` runs and is awaited, and only then is the world
 * built and begun.
 *
 * The driver itself is the engine's, but the ordering is what the worlds page
 * promises a level, so it is stated here as an executable contract: nothing
 * this helper does between the `await` and the `new EngineWorld` may move
 * ahead of the load.
 */
async function openLevel(
  definition: LevelDefinition,
  overrides: Partial<WorldDeps> = {},
  api: Partial<LoadApi> = {},
) {
  const loadApi: LoadApi = {
    assets: { tag: "assets" } as unknown as LoadApi["assets"],
    audio: { load: () => Promise.resolve() },
    events: { on: () => () => {} } as unknown as LoadApi["events"],
    ...api,
  };
  await definition.load?.(loadApi);
  return openWorld(definition, overrides);
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

  it("leaves an actor with no transform spec at the identity", () => {
    const { world } = makeWorld({
      mode: GameMode,
      actors: [{ type: TestActor }],
    });
    expect(world.actors()[0]?.transform).toEqual(IDENTITY);
  });

  it("applies a declared actor's transform field by field over the identity", () => {
    const { world } = makeWorld({
      mode: GameMode,
      actors: [
        { type: TestActor, transform: { position: vec3(-4, 0, 2) } },
        { type: TestActor, transform: { scale: vec3(2, 2, 2) } },
      ],
    });
    // A field absent from the spec is left exactly as the actor built it.
    expect(world.actors()[0]?.transform).toEqual({
      position: { x: -4, y: 0, z: 2 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    });
    expect(world.actors()[1]?.transform).toEqual({
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 2, y: 2, z: 2 },
    });
  });

  it("gives a rotation whole, as the quaternion the spec names", () => {
    const rotation = quatFromAxisAngle(UP, Math.PI / 2);
    const { world } = makeWorld({
      mode: GameMode,
      actors: [{ type: TestActor, transform: { rotation } }],
    });
    expect(world.actors()[0]?.transform.rotation).toEqual(rotation);
  });

  it("copies each field given rather than adopting the spec's own record", () => {
    // A level definition is inert data a game opens as many times as it likes,
    // so an actor that moves must not rewrite the level it was placed from.
    const position = vec3(1, 2, 3);
    const definition: LevelDefinition = {
      mode: GameMode,
      actors: [
        { type: TestActor, transform: { position } },
        { type: TestActor, transform: { position } },
      ],
    };
    const { world } = makeWorld(definition);
    const [first, second] = world.actors();
    expect(first?.transform.position).not.toBe(position);
    // Two actors placed from one shared constant do not share a record either.
    expect(first?.transform.position).not.toBe(second?.transform.position);
    if (first === undefined) throw new Error("expected the placed actor");
    first.transform.position.y += 10;
    expect(position).toEqual({ x: 1, y: 2, z: 3 });
    expect(second?.transform.position).toEqual({ x: 1, y: 2, z: 3 });
    // And the same definition opens again from the description unchanged.
    const reopened = makeWorld(definition).world;
    expect(reopened.actors()[0]?.transform.position).toEqual({
      x: 1,
      y: 2,
      z: 3,
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

  it("runs configure after the transform, so it reads what the spec placed", () => {
    const seen: Vec3[] = [];
    makeWorld({
      mode: GameMode,
      actors: [
        {
          type: TestActor,
          transform: { position: vec3(5, 0, 0) },
          configure: (actor) => {
            seen.push({ ...actor.transform.position });
          },
        },
      ],
    });
    expect(seen).toEqual([{ x: 5, y: 0, z: 0 }]);
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

describe("the level's load", () => {
  it("is awaited before any actor of the level exists", async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    class Placed extends TestActor {
      constructor() {
        super();
        order.push("actor constructed");
      }
    }

    const opening = openLevel({
      mode: GameMode,
      actors: [{ type: Placed }],
      async load() {
        order.push("load started");
        await gate;
        order.push("load resolved");
      },
    });
    // The load is in flight: nothing of the level has been constructed.
    await Promise.resolve();
    expect(order).toEqual(["load started"]);
    release();
    const { world } = await opening;
    expect(order).toEqual([
      "load started",
      "load resolved",
      "actor constructed",
    ]);
    expect(world.actors()).toHaveLength(1);
  });

  it("hands an actor its asset as a plain value, already decoded", async () => {
    let court: string | null = null;

    class Court extends TestActor {
      // The idiom the usage page names: the load writes a module-local, and
      // the constructor reads it as a value rather than awaiting anything.
      readonly texture = court;
    }

    const { world } = await openLevel({
      mode: GameMode,
      actors: [{ type: Court }],
      async load() {
        await Promise.resolve();
        court = "textures/court.png";
      },
    });
    expect(world.find(Court)?.texture).toBe("textures/court.png");
  });

  it("receives the engine's own assets, cue loader, and broadcaster", async () => {
    const seen: LoadApi[] = [];
    const assets = { tag: "engine assets" } as unknown as LoadApi["assets"];
    const events = { on: () => () => {} } as unknown as LoadApi["events"];
    const load = vi.fn(() => Promise.resolve());
    await openLevel(
      {
        mode: GameMode,
        load(api) {
          seen.push(api);
          return api.audio.load("bounce", "audio/bounce.ogg");
        },
      },
      {},
      { assets, events, audio: { load } },
    );
    expect(seen[0]?.assets).toBe(assets);
    expect(seen[0]?.events).toBe(events);
    expect(load).toHaveBeenCalledWith("bounce", "audio/bounce.ogg");
  });

  it("builds a level that declares no load at all", async () => {
    const { world } = await openLevel({
      mode: GameMode,
      actors: [{ type: TestActor }],
    });
    expect(world.actors()).toHaveLength(1);
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
        this.world.spawn(Prompt, { transform: { position: vec3(0, 1.6, 0) } });
      }
    }

    const { world } = openWorld({ mode: MenuMode });
    expect(world.find(Prompt)?.transform.position).toEqual({
      x: 0,
      y: 1.6,
      z: 0,
    });
  });
});

describe("spawn", () => {
  it("returns a fully live actor: spec applied, beginPlay run, event emitted", () => {
    const log: string[] = [];

    class Ball extends TestActor {
      velocity: Vec3 = { x: 0, y: 0, z: 0 };

      override beginPlay(): void {
        log.push("ball.begin");
      }
    }

    const { world, emitted } = openWorld({ mode: GameMode });
    const ball = world.spawn(Ball, {
      transform: { position: vec3(0, 0.5, 0) },
      tags: ["ball"],
      configure: (b) => {
        b.velocity = vec3(6, 0, 0);
      },
    });
    expect(ball.transform.position).toEqual({ x: 0, y: 0.5, z: 0 });
    expect(ball.transform.scale).toEqual({ x: 1, y: 1, z: 1 });
    expect(ball.hasTag("ball")).toBe(true);
    expect(ball.velocity).toEqual({ x: 6, y: 0, z: 0 });
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

  it("spawns at the identity when the spec names no transform", () => {
    const { world } = openWorld({ mode: GameMode });
    expect(world.spawn(TestActor).transform).toEqual(IDENTITY);
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

  it("selects a subclass through its base, as instanceof does", () => {
    class Fast extends Ball {}

    const { world } = openWorld({ mode: GameMode });
    const plain = world.spawn(Ball);
    const fast = world.spawn(Fast);
    expect(world.ofType(Ball)).toEqual([plain, fast]);
    expect(world.ofType(Fast)).toEqual([fast]);
    expect(world.find(Fast)).toBe(fast);
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

  it("hands each player controller its own input reader", () => {
    class Seated extends GameMode {
      override playerControllerClass = TestController;

      override beginPlay(): void {
        this.addPlayer();
        this.addPlayer();
      }
    }

    const { world } = openWorld({ mode: Seated });
    const [first, second] = world.players();
    expect(first?.input).toBeDefined();
    expect(first?.input).not.toBe(second?.input);
  });

  it("lists an AI controller among the controllers but not the players", () => {
    class Bot extends AIController {}

    class Seated extends GameMode {
      override playerControllerClass = TestController;

      override beginPlay(): void {
        this.addPlayer({ name: "human" });
        this.addBot(Bot, { name: "cpu" });
      }
    }

    const { world } = openWorld({ mode: Seated });
    expect(world.controllers().map((c) => c.playerState.name)).toEqual([
      "human",
      "cpu",
    ]);
    // `players()` is the player half alone, which is what a mode reaches the
    // input side of the world through.
    expect(world.players().map((c) => c.playerState.name)).toEqual(["human"]);
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

  it("skips a component a sibling's tick detached", () => {
    const log: string[] = [];

    class Detaching extends Component {
      target: Component | null = null;

      override tick(): void {
        log.push("detacher.tick");
        if (this.target !== null) this.actor.detach(this.target);
      }
    }

    const { world } = openWorld({ mode: GameMode });
    const actor = world.spawn(TestActor);
    const detacher = actor.attach(new Detaching());
    const doomed = actor.attach(new LoggedComponent("doomed", log));
    log.length = 0;
    detacher.target = doomed;
    world.simulate(1);
    // Its endPlay ran from `detach`; its tick does not run afterwards.
    expect(log).toEqual(["detacher.tick", "doomed.end(destroyed)"]);
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

  it("stops the component walk when a component's tick destroys the actor", () => {
    const log: string[] = [];

    class Suicidal extends Component {
      override tick(): void {
        log.push("first.tick");
        this.actor.destroy();
      }
    }

    const { world } = openWorld({ mode: GameMode });
    const actor = world.spawn(TestActor);
    actor.attach(new Suicidal());
    actor.attach(new LoggedComponent("second", log));
    log.length = 0;
    world.simulate(1);
    expect(log).toEqual(["first.tick"]);
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

  it("gives the opted-in actor a clock that stands still", () => {
    const seen: number[] = [];

    class Menu extends TestActor {
      constructor() {
        super();
        this.tickWhenPaused = true;
      }

      override tick(): void {
        seen.push(this.world.time);
      }
    }

    const { world } = openWorld({ mode: GameMode });
    world.spawn(Menu);
    world.simulate(1);
    world.setPaused(true);
    world.simulate(1);
    world.simulate(1);
    expect(seen).toEqual([1, 1, 1]);
    expect(world.state.elapsed).toBe(0);
  });

  it("skips a tick-disabled actor even when it opted into the pause", () => {
    const log: string[] = [];

    class Menu extends TestActor {
      constructor() {
        super();
        this.tickWhenPaused = true;
      }

      override tick(): void {
        log.push("menu.tick");
      }
    }

    const { world } = openWorld({ mode: GameMode });
    const menu = world.spawn(Menu);
    menu.tickEnabled = false;
    world.setPaused(true);
    world.simulate(1);
    expect(log).toEqual([]);
  });

  it("lets a paused world's menu unpause the world it is running in", () => {
    class Menu extends TestActor {
      constructor() {
        super();
        this.tickWhenPaused = true;
      }

      override tick(): void {
        if (this.world.paused) this.world.setPaused(false);
      }
    }

    const { world } = openWorld({ mode: GameMode });
    world.spawn(Menu);
    world.setPaused(true);
    world.simulate(1);
    expect(world.paused).toBe(false);
    // The frame it unpaused in ran no clock; the next one does.
    expect(world.time).toBe(0);
    world.simulate(1);
    expect(world.time).toBe(1);
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

  it("fires due timers in scheduling order, whatever their due times", () => {
    // One frame long enough to make several timers due has already swallowed
    // the gaps between their due times, so the order the game asked for them
    // in is what is left to order them by.
    const fired: string[] = [];
    const { world } = openWorld({ mode: GameMode });
    world.after(2, () => fired.push("later"));
    world.after(1, () => fired.push("sooner"));
    world.every(1.5, () => fired.push("repeating"));
    world.simulate(2);
    expect(fired).toEqual(["later", "sooner", "repeating"]);
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

  it("clearing an unknown handle is a no-op", () => {
    const { world } = openWorld({ mode: GameMode });
    expect(() => world.clearTimer(9001)).not.toThrow();
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

  it("runs the timers after the actors, on the frame that crosses the due time", () => {
    const log: string[] = [];

    class Ticking extends TestActor {
      override tick(): void {
        log.push("actor.tick");
      }
    }

    const { world } = openWorld({ mode: GameMode });
    world.spawn(Ticking);
    world.after(1, () => log.push("timer"));
    log.length = 0;
    world.simulate(1);
    expect(log).toEqual(["actor.tick", "timer"]);
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

  it("runs the mode's tick after every actor's, from a settled world", () => {
    const log: string[] = [];

    class Ticking extends TestActor {
      override tick(): void {
        log.push("actor.tick");
      }
    }

    class Deciding extends GameMode {
      override tick(): void {
        log.push(`mode.tick actors=${this.world.actors().length}`);
      }
    }

    const { world } = openWorld({
      mode: Deciding,
      actors: [{ type: Ticking }],
    });
    log.length = 0;
    frame(world, 1);
    expect(log).toEqual(["actor.tick", "mode.tick actors=1"]);
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

  it("has already removed the actor by the time its endPlay runs", () => {
    const seen: number[] = [];

    class Doomed extends TestActor {
      override endPlay(): void {
        seen.push(this.world.actors().length);
      }
    }

    const { world } = openWorld({ mode: GameMode });
    world.spawn(TestActor);
    const doomed = world.spawn(Doomed);
    doomed.destroy();
    world.flushDestroyed();
    expect(seen).toEqual([1]);
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
          order.push(String(event));
        },
        events: {
          on: () => () => {},
          emit: (event: string) => {
            order.push(event);
          },
        } as unknown as WorldDeps["events"],
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
    world.spawn(Logged, { configure: (x) => (x.label = "a") });
    const b = world.spawn(Logged, { configure: (x) => (x.label = "b") });
    const c = world.spawn(Logged, { configure: (x) => (x.label = "c") });
    const d = world.spawn(Logged, { configure: (x) => (x.label = "d") });
    const a = world.find(Logged);
    log.length = 0;
    c.also = [b, d];
    a?.destroy();
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

  it("destroying an actor twice reports it once", () => {
    const log: string[] = [];

    class Logged extends TestActor {
      override endPlay(reason: string): void {
        log.push(`end(${reason})`);
      }
    }

    const { world, emitted } = openWorld({ mode: GameMode });
    const actor = world.spawn(Logged);
    actor.destroy();
    actor.destroy();
    world.flushDestroyed();
    expect(log).toEqual(["end(destroyed)"]);
    expect(
      emitted.filter((entry) => entry.event === "actor:destroyed"),
    ).toHaveLength(1);
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

  it("carries the options through to the request", () => {
    const options = { round: 2, carried: 5 };
    const { world } = openWorld({ mode: GameMode });
    world.open("arena", options);
    expect(world.takeTransition()).toEqual({ level: "arena", options });
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

  it("leaves the requesting tick reading a whole world", () => {
    const seen: number[] = [];

    class Traveller extends TestActor {
      override tick(): void {
        this.world.open("results");
        seen.push(this.world.actors().length);
      }
    }

    class Peer extends TestActor {
      override tick(): void {
        seen.push(this.world.actors().length);
      }
    }

    const { world } = openWorld({
      mode: GameMode,
      actors: [{ type: Traveller }, { type: Peer }],
    });
    frame(world, 1 / 60);
    // Both the requester and the actor after it saw both actors: the request
    // is honored at the end of the frame, not inside the tick that made it.
    expect(seen).toEqual([2, 2]);
    expect(world.takeTransition()).toEqual({ level: "results", options: {} });
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

  it("ends an actor destroyed earlier in the frame exactly once", () => {
    const log: string[] = [];

    class Logged extends TestActor {
      override endPlay(reason: string): void {
        log.push(`end(${reason})`);
      }
    }

    const { world } = openWorld({ mode: GameMode });
    const actor = world.spawn(Logged);
    actor.destroy();
    world.flushDestroyed();
    world.close();
    expect(log).toEqual(["end(destroyed)"]);
  });

  it("drops a destroy the closing world never swept", () => {
    const log: string[] = [];

    class Logged extends TestActor {
      override endPlay(reason: string): void {
        log.push(`end(${reason})`);
      }
    }

    const { world } = openWorld({ mode: GameMode });
    world.spawn(Logged).destroy();
    world.close();
    // Its teardown ran with the world's, under `level-closed`, and the queue
    // it was sitting on went with the world.
    expect(log).toEqual(["end(level-closed)"]);
    world.flushDestroyed();
    expect(log).toEqual(["end(level-closed)"]);
  });

  it("abandons a transition the closing frame had requested", () => {
    const { world } = openWorld({ mode: GameMode });
    world.open("results");
    world.close();
    expect(world.takeTransition()).toBeNull();
  });

  it("ends play once however many times it is closed", () => {
    const log: string[] = [];

    class Logged extends TestActor {
      override endPlay(reason: string): void {
        log.push(`actor(${reason})`);
      }
    }
    class Watched extends GameMode {
      override endPlay(reason: string): void {
        log.push(`mode(${reason})`);
      }
    }

    const { world } = openWorld({ mode: Watched, actors: [{ type: Logged }] });
    world.close();
    // A transition tears the outgoing world down before it awaits the incoming
    // level's `load`, and a `destroy` that lands in that window reaches the
    // same world again. One `endPlay("level-closed")` apiece is the promise.
    world.close();
    expect(log).toEqual(["actor(level-closed)", "mode(level-closed)"]);
  });

  it("simulates and ticks no mode once it is closed", () => {
    const log: string[] = [];

    class Logged extends TestActor {
      override tick(): void {
        log.push("actor.tick");
      }
    }
    class Watched extends GameMode {
      override tick(): void {
        log.push("mode.tick");
      }
    }

    const { world } = openWorld({ mode: Watched, actors: [{ type: Logged }] });
    world.close();
    // The frame a `destroy` interrupts still has steps behind it. None of them
    // may run: everything they would run has already ended play.
    world.simulate(0.016);
    world.tickMode(0.016);
    expect(log).toEqual([]);
    expect(world.time).toBe(0);
  });

  it("stops the actor pass at the actor whose tick closed the world", () => {
    const log: string[] = [];

    class Logged extends TestActor {
      name = "";
      override tick(): void {
        log.push(this.name);
        if (this.name === "second") this.world.close();
      }
    }

    const { world } = openWorld({
      mode: GameMode,
      actors: [
        { type: Logged, configure: (a: Logged): void => void (a.name = "first") },
        { type: Logged, configure: (a: Logged): void => void (a.name = "second") },
        { type: Logged, configure: (a: Logged): void => void (a.name = "third") },
      ],
    });
    world.simulate(0.016);
    // The pass walks a snapshot taken before it started, so the entries behind
    // the closing tick are actors that have already ended play.
    expect(log).toEqual(["first", "second"]);
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

  it("reads the engine's frame and viewport live, at the moment of the call", () => {
    let count = 0;
    const { world } = openWorld(
      { mode: GameMode },
      {
        frame: () => ({ count, timeMs: count * 16, lastDeltaMs: 16 }),
        viewport: () => ({
          width: 640,
          height: 360,
          scale: count,
          offsetX: 0,
          offsetY: 0,
        }),
      },
    );
    count = 3;
    expect(world.frame()).toEqual({ count: 3, timeMs: 48, lastDeltaMs: 16 });
    expect(world.viewport().scale).toBe(3);
  });

  it("forwards diagnostics.register into the world registry", () => {
    const { world, registerDiagnostic } = openWorld({ mode: GameMode });
    const source = () => 3;
    world.diagnostics.register("balls", source);
    expect(registerDiagnostic).toHaveBeenCalledWith("balls", source);
  });

  it("hands out one stable diagnostics object", () => {
    const { world } = openWorld({ mode: GameMode });
    expect(world.diagnostics).toBe(world.diagnostics);
  });
});

describe("world.audio", () => {
  /** A world over a real cue bus, with the cues a test plays declared. */
  function withAudio(cues: readonly string[] = ["bounce"]) {
    const announced: { event: string; payload: unknown }[] = [];
    const bus = new AudioBus({
      emit: (event: string, payload: unknown) => {
        announced.push({ event, payload });
      },
      // No audio support under jsdom, and none is wanted: the events are the
      // observable half, and they are emitted whether or not anything sounds.
      audioContext: () => null,
    });
    for (const cue of cues) bus.define(cue, { freq: 440, durationMs: 60 });
    const built = openWorld({ mode: GameMode }, { audio: bus });
    return { ...built, bus, announced };
  }

  it("is the engine's bus, so a cue declared before the world is still declared", () => {
    const { world, bus } = withAudio();
    expect(world.audio).toBe(bus);
    expect(() => world.audio.play("bounce")).not.toThrow();
  });

  it("emits cue:played for a play, unpositioned by default", () => {
    const { world, announced } = withAudio();
    world.audio.play("bounce");
    expect(announced).toEqual([
      {
        event: "cue:played",
        payload: { cue: "bounce", t: 0, gain: 0.2, at: null },
      },
    ]);
  });

  it("plays a cue from a world point when the options name one", () => {
    const { world, announced } = withAudio();
    world.audio.play("bounce", { at: vec3(2, 0, -3) });
    expect(announced[0]?.payload).toMatchObject({
      cue: "bounce",
      at: { x: 2, y: 0, z: -3 },
    });
  });

  it("copies the point, so a moving actor does not rewrite what was announced", () => {
    const { world, announced } = withAudio();
    const actor = world.spawn(TestActor, {
      transform: { position: vec3(1, 0, 0) },
    });
    world.audio.play("bounce", { at: actor.transform.position });
    actor.transform.position.x = 99;
    expect((announced[0]?.payload as { at: Vec3 | null }).at).toEqual({
      x: 1,
      y: 0,
      z: 0,
    });
  });

  it("throws for a cue that was never declared, naming it", () => {
    const { world } = withAudio();
    expect(() => world.audio.play("thud")).toThrow(/unknown audio cue "thud"/);
    expect(() => world.audio.loop("thud")).toThrow(/thud/);
    expect(() => world.audio.stop("thud")).toThrow(/thud/);
    expect(world.audio.looping("thud")).toBe(false);
  });

  it("starts a loop once and stops it once", () => {
    const { world, announced } = withAudio(["engine"]);
    world.audio.loop("engine", { at: vec3(0, 0, -5) });
    world.audio.loop("engine");
    expect(world.audio.looping("engine")).toBe(true);
    world.audio.stop("engine");
    world.audio.stop("engine");
    expect(world.audio.looping("engine")).toBe(false);
    expect(announced.map((entry) => entry.event)).toEqual([
      "cue:looped",
      "cue:stopped",
    ]);
  });

  it("places a running loop and announces nothing for the move", () => {
    const { world, announced } = withAudio(["engine"]);
    world.audio.loop("engine");
    announced.length = 0;
    world.audio.place("engine", vec3(4, 0, 0));
    expect(announced).toEqual([]);
    // A cue that is not looping is left alone rather than started.
    world.audio.place("engine", vec3(0, 0, 0));
    world.audio.stop("engine");
    world.audio.place("engine", vec3(9, 0, 0));
    expect(world.audio.looping("engine")).toBe(false);
  });

  it("keeps announcing a muted cue, at gain zero", () => {
    const { world, announced } = withAudio();
    expect(world.audio.muted()).toBe(false);
    world.audio.setMuted(true);
    expect(world.audio.muted()).toBe(true);
    world.audio.play("bounce");
    expect(announced[0]?.payload).toMatchObject({ gain: 0 });
    world.audio.setMuted(false);
    world.audio.play("bounce");
    expect(announced[1]?.payload).toMatchObject({ gain: 0.2 });
  });

  it("is reachable from an actor, which is where a game plays a cue", () => {
    const { world, announced } = withAudio();

    class Noisy extends TestActor {
      override tick(): void {
        this.world.audio.play("bounce", { at: this.transform.position });
      }
    }

    world.spawn(Noisy, { transform: { position: vec3(0, 1, 0) } });
    frame(world, 1 / 60);
    expect(announced).toHaveLength(1);
    expect(announced[0]?.payload).toMatchObject({ at: { x: 0, y: 1, z: 0 } });
  });
});

describe("what crosses a transition", () => {
  /**
   * Steps 3–11 of the sequence, as the engine's driver runs them over one set
   * of engine-level collaborators: the outgoing world closes, the incoming
   * level's `load` is awaited, and only then is the incoming world built and
   * begun. What is shared between the two openings is exactly what the engine
   * owns; everything else is constructed afresh.
   */
  async function travel(
    deps: WorldDeps,
    outgoing: EngineWorld,
    level: string,
    definition: LevelDefinition,
    options: Readonly<Record<string, unknown>> = {},
  ): Promise<EngineWorld> {
    outgoing.close();
    await definition.load?.({
      assets: deps.assets as unknown as LoadApi["assets"],
      audio: { load: () => Promise.resolve() },
      events: deps.events as unknown as LoadApi["events"],
    });
    const incoming = new EngineWorld({ ...deps, level, definition, options });
    incoming.begin();
    return incoming;
  }

  it("closes the outgoing world before the incoming level loads or builds", async () => {
    const order: string[] = [];

    class Outgoing extends TestActor {
      override endPlay(): void {
        order.push("outgoing.end");
      }
    }

    class Incoming extends TestActor {
      constructor() {
        super();
        order.push("incoming constructed");
      }
    }

    const { world, deps } = openWorld({
      mode: GameMode,
      actors: [{ type: Outgoing }],
    });
    await travel(deps, world, "results", {
      mode: GameMode,
      actors: [{ type: Incoming }],
      async load() {
        order.push("load");
        await Promise.resolve();
      },
    });
    expect(order).toEqual(["outgoing.end", "load", "incoming constructed"]);
  });

  it("rebuilds the mode, the state, the player states, and the actors", async () => {
    class Fighter extends TestPawn {}

    class ArenaMode extends GameMode {
      override playerControllerClass = TestController;
      override pawnClass = Fighter;

      override beginPlay(): void {
        this.addPlayer({ name: "P1" });
      }
    }

    const level: LevelDefinition = {
      mode: ArenaMode,
      actors: [{ type: TestActor }],
    };
    const { world, deps } = openWorld(level);
    const before = {
      mode: world.mode,
      state: world.state,
      player: world.state.players[0],
      actor: world.actors()[0],
      controller: world.controllers()[0],
    };
    world.state.players[0]!.score = 9;
    const next = await travel(deps, world, "arena", level);
    expect(next.mode).not.toBe(before.mode);
    expect(next.state).not.toBe(before.state);
    expect(next.state.players[0]).not.toBe(before.player);
    expect(next.actors()[0]).not.toBe(before.actor);
    expect(next.controllers()[0]).not.toBe(before.controller);
    // A score scoped to one match does not travel; the game state is new.
    expect(next.state.players[0]?.score).toBe(0);
    expect(next.state.players[0]?.name).toBe("P1");
  });

  it("restarts world time at zero and drops the outgoing world's timers", async () => {
    const fired: string[] = [];
    const { world, deps } = openWorld({ mode: GameMode });
    world.every(1, () => fired.push("outgoing"));
    world.simulate(2.5);
    expect(world.time).toBe(2.5);
    expect(fired).toEqual(["outgoing", "outgoing"]);

    const next = await travel(deps, world, "results", { mode: GameMode });
    expect(next.time).toBe(0);
    next.simulate(3);
    // The outgoing world's repeating timer went with it.
    expect(fired).toEqual(["outgoing", "outgoing"]);
    expect(next.state.elapsed).toBe(0);
  });

  it("leaves the engine's frame counter and cue definitions standing", async () => {
    const announced: string[] = [];
    const bus = new AudioBus({
      emit: (event: string) => {
        announced.push(event);
      },
      audioContext: () => null,
    });
    bus.define("bounce", { freq: 440, durationMs: 60 });
    const { world, deps } = openWorld({ mode: GameMode }, { audio: bus });
    world.audio.play("bounce");

    const next = await travel(deps, world, "results", { mode: GameMode });
    // The frame counter belongs to the loop, so it carries across…
    expect(next.frame()).toEqual(deps.frame());
    // …and so does a cue bound in any level's load.
    expect(() => next.audio.play("bounce")).not.toThrow();
    expect(announced).toEqual(["cue:played", "cue:played"]);
    expect(next.audio).toBe(world.audio);
  });

  it("hands the incoming mode the options the request carried", async () => {
    class ArenaMode extends GameMode {
      round = 1;

      override beginPlay(): void {
        this.round =
          typeof this.options.round === "number" ? this.options.round : 1;
      }
    }

    const { world, deps } = openWorld({ mode: ArenaMode });
    expect((world.mode as ArenaMode).round).toBe(1);
    world.open("arena", { round: 4 });
    const request = world.takeTransition();
    expect(request).not.toBeNull();
    const next = await travel(
      deps,
      world,
      request?.level ?? "",
      { mode: ArenaMode },
      request?.options ?? {},
    );
    expect((next.mode as ArenaMode).round).toBe(4);
  });
});

describe("a whole match, frame by frame", () => {
  it("plays the docs' match shape: countdown, score, and a deferred exit", () => {
    // The MatchMode idiom from the levels-and-worlds page, driven the way the
    // engine's loop would drive it: simulate, mode tick, flush.
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

  it("runs a level of scenery, pawns, timers, and a death, end to end", () => {
    const log: string[] = [];

    class Goal extends TestActor {
      side = "left";
    }

    class Fighter extends TestPawn {
      override beginPlay(): void {
        log.push(`fighter.begin goals=${this.world.byTag("goal").length}`);
      }
    }

    class ArenaMode extends GameMode {
      override playerControllerClass = TestController;
      override pawnClass = Fighter;
      private killed = false;

      override beginPlay(): void {
        this.addPlayer({ name: "P1" });
        this.setPhase("playing");
        this.world.every(1, () => {
          if (this.killed) return;
          this.killed = true;
          this.world.players()[0]?.pawn?.destroy();
        });
      }

      override pawnDied(controller: Controller): void {
        log.push("pawnDied");
        this.restart(controller);
      }
    }

    const { world } = openWorld({
      mode: ArenaMode,
      actors: [
        { type: Goal, tags: ["goal"], transform: { position: vec3(-4, 0, 0) } },
        {
          type: Goal,
          tags: ["goal"],
          transform: {
            position: vec3(4, 0, 0),
            rotation: quatFromAxisAngle(UP, Math.PI),
          },
          configure: (goal) => ((goal as Goal).side = "right"),
        },
      ],
    });
    // Two placed goals, a pawn possessed by the one player, and the mode's
    // countdown scheduled against world time.
    expect(world.byTag("goal")).toHaveLength(2);
    expect(world.players()[0]?.pawn).toBeInstanceOf(Fighter);
    const first = world.players()[0]?.pawn;

    frame(world, 1);
    // The timer killed the pawn, the mode heard of it, and `restart` seated a
    // fresh one — all inside the one frame.
    expect(log).toEqual([
      "fighter.begin goals=2",
      "pawnDied",
      "fighter.begin goals=2",
    ]);
    const second = world.players()[0]?.pawn;
    expect(second).not.toBe(first);
    expect(world.ofType(Fighter)).toEqual([second]);
    expect(world.actors()).toHaveLength(3);
    expect(world.state.elapsed).toBe(1);
  });
});
