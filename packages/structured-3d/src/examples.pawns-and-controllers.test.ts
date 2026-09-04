import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  Actor,
  AIController,
  ConstantClock,
  createEngine,
  GameInstance,
  GameMode,
  LightComponent,
  MeshComponent,
  Pawn,
  PlayerController,
  QUAT_IDENTITY,
  quatFromEuler,
  TOUCH_LAYOUTS,
  VEC3_ONE,
  vec3,
} from "./index";
import type {
  ActionBinding,
  Controller,
  Engine,
  GameDefinition,
  InitApi,
  SurfaceMetrics,
  Transform,
} from "./index";
import { installCanvasContexts } from "./testing/canvas";
import type { InstalledContexts } from "./testing/canvas";

/**
 * The documentation's "Pawns and Controllers" example, transcribed and run.
 *
 * The sections below are the example's own modules, verbatim except for the
 * import paths — the example imports `@test-cabinet/structured-3d`, which from
 * inside the package is `./index` — and for their order: a single file has to
 * declare a class before the module-level `duel` that names it, so `game.ts`
 * follows the actors, the controllers, and the mode rather than preceding them
 * as the page prints it. Nothing inside a module is changed.
 *
 * The example's `main.ts` is reproduced inside the harness, with only what a
 * headless environment forces. jsdom implements no canvas, so the package's own
 * `installCanvasContexts` makes every canvas in the document answer
 * `getContext` — the one the boot's `querySelector` finds and obtains its
 * `webgl2` context from, and the screen canvas the engine creates for itself
 * because the boot passes no `screen`. jsdom performs no layout either, so a
 * `SurfaceMetrics` supplies the measurements the element would have been laid
 * out at and the target the key listeners attach to. And a `ConstantClock`
 * replaces the wall clock while `engine.advance` replaces `engine.run`, which
 * is the pattern the Validators pages prescribe: the same frames a player
 * drives, stepped synchronously.
 *
 * The assertions are the outcomes the page's prose narrates — what the mode
 * puts on each side of the court and who holds it, the axis the player's two
 * analog actions make and the edge its restart spends, the same `drive` call
 * reached from the world by the opponent, the frame order that lets a direction
 * set this frame move a pawn this frame, the interchangeability the page closes
 * on — the class handed to `addBot`, the controller `addPlayer` is named, and
 * the order the controllers tick in — and the scripted controller that takes
 * the player's paddle and measures the build rather than a path beside it.
 */

/* -------------------------------------------------------------------------- */
/* src/constants.ts                                                           */
/* -------------------------------------------------------------------------- */

const WIDTH = 640;
const HEIGHT = 360;

const COURT_HALF_WIDTH = 8;
const COURT_HALF_HEIGHT = 4;

const PADDLE_WIDTH = 0.4;
const PADDLE_HEIGHT = 2.4;
const PADDLE_DEPTH = 0.4;
const PADDLE_SPEED = 9;
const DEAD_ZONE = 0.1;

const LEVEL = "duel";

const TAGS = {
  paddle: "paddle",
  player: "player-paddle",
  opponent: "opponent-paddle",
} as const;

const ACTIONS = {
  up: "move-up",
  down: "move-down",
  restart: "confirm",
} as const;

const BINDINGS: Record<string, ActionBinding> = {
  [ACTIONS.up]: { keys: ["KeyW", "ArrowUp"], kind: "analog" },
  [ACTIONS.down]: { keys: ["KeyS", "ArrowDown"], kind: "analog" },
  [ACTIONS.restart]: { keys: ["Enter", "Space"] },
};

/* -------------------------------------------------------------------------- */
/* src/actors/lamp.ts                                                         */
/* -------------------------------------------------------------------------- */

class Lamp extends Actor {
  constructor() {
    super();
    this.attach(
      new LightComponent({ light: { kind: "hemisphere", intensity: 0.6 } }),
    );
    const sun = this.attach(
      new LightComponent({ light: { kind: "directional", intensity: 1.2 } }),
    );
    sun.offset.rotation = quatFromEuler(-Math.PI / 4, Math.PI / 4, 0);
  }
}

/* -------------------------------------------------------------------------- */
/* src/actors/paddle.ts                                                       */
/* -------------------------------------------------------------------------- */

class Paddle extends Pawn {
  private direction = 0;

  constructor() {
    super();
    this.addTag(TAGS.paddle);
    this.attach(
      new MeshComponent({
        geometry: {
          kind: "box",
          width: PADDLE_WIDTH,
          height: PADDLE_HEIGHT,
          depth: PADDLE_DEPTH,
        },
        material: { color: "#e6edf6" },
      }),
    );
  }

  drive(direction: number): void {
    this.direction = Math.min(Math.max(direction, -1), 1);
  }

  override possessedBy(controller: Controller): void {
    const side =
      controller instanceof PlayerController ? TAGS.player : TAGS.opponent;
    this.addTag(side);
  }

  override tick(dt: number): void {
    const limit = COURT_HALF_HEIGHT - PADDLE_HEIGHT / 2;
    const current = this.transform.position;
    const y = current.y + this.direction * PADDLE_SPEED * dt;
    this.transform.position = vec3(
      current.x,
      Math.min(Math.max(y, -limit), limit),
      current.z,
    );
    this.direction = 0;
  }
}

/* -------------------------------------------------------------------------- */
/* src/controllers/paddle-player.ts                                           */
/* -------------------------------------------------------------------------- */

class PaddlePlayer extends PlayerController {
  override tick(): void {
    const pawn = this.pawn;
    if (!(pawn instanceof Paddle)) return;

    pawn.drive(this.input.value(ACTIONS.up) - this.input.value(ACTIONS.down));

    if (this.input.pressed(ACTIONS.restart)) {
      this.world.mode.restart(this);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* src/controllers/paddle-ai.ts                                               */
/* -------------------------------------------------------------------------- */

class PaddleAI extends AIController {
  override tick(): void {
    const pawn = this.pawn;
    if (!(pawn instanceof Paddle)) return;

    const target = this.world.byTag(TAGS.player)[0];
    if (target === undefined) return;

    const delta = target.transform.position.y - pawn.transform.position.y;
    if (Math.abs(delta) < DEAD_ZONE) return;
    pawn.drive(Math.sign(delta));
  }
}

/* -------------------------------------------------------------------------- */
/* src/levels/duel-mode.ts                                                    */
/* -------------------------------------------------------------------------- */

class DuelMode extends GameMode {
  override playerControllerClass = PaddlePlayer;
  override pawnClass = Paddle;

  override beginPlay(): void {
    this.addPlayer({ name: "Player" });
    this.addBot(PaddleAI, { name: "Opponent" });
    this.setPhase("playing");
  }

  override spawnPoint(controller: Controller): Transform {
    const x =
      controller instanceof PlayerController
        ? -COURT_HALF_WIDTH
        : COURT_HALF_WIDTH;
    return {
      position: vec3(x, 0, 0),
      rotation: QUAT_IDENTITY,
      scale: VEC3_ONE,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* src/game.ts                                                                */
/* -------------------------------------------------------------------------- */

class DuelGame extends GameInstance<null> {
  override initialize(api: InitApi): null {
    for (const [action, binding] of Object.entries(BINDINGS)) {
      api.input.register(action, binding);
    }
    return null;
  }
}

const duel: GameDefinition<null> = {
  instance: DuelGame,
  levels: { [LEVEL]: { mode: DuelMode, actors: [{ type: Lamp }] } },
  startLevel: LEVEL,
};

/* -------------------------------------------------------------------------- */
/* The harness: src/main.ts under a scripted clock                            */
/* -------------------------------------------------------------------------- */

/** The travel one frame of a held direction buys, at this clock and this speed. */
const STEP = PADDLE_SPEED / 60;

/** How far from the court's center a paddle's own rule lets its center reach. */
const LIMIT = COURT_HALF_HEIGHT - PADDLE_HEIGHT / 2;

interface Harness {
  readonly engine: Engine<null>;
  /** Dispatches a `keydown` for `code` at the surface's event target. */
  hold(code: string): void;
  /** Dispatches a `keyup` for `code` at the surface's event target. */
  release(code: string): void;
}

let contexts: InstalledContexts;
const built: Engine<null>[] = [];

/**
 * The example's `main.ts`: the canvas its `querySelector` finds, the same
 * `createEngine` options, and an initialized engine — plus the clock and the
 * surface a check supplies, and `advance` standing in for `run`.
 *
 * The definition is a parameter only so the page's closing claim — that
 * swapping the class handed to `addBot`, or handing `addPlayer` a different
 * `controller`, changes who decides — can boot the same build with one of
 * those swapped. Everything else about the boot, `duel` included, is the
 * page's.
 */
async function createHarness(
  game: GameDefinition<null> = duel,
): Promise<Harness> {
  document.body.innerHTML = '<canvas id="game"></canvas>';

  const target = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => WIDTH,
    cssHeight: () => HEIGHT,
    dpr: () => 2,
    events: () => target,
  };

  const canvas = document.querySelector<HTMLCanvasElement>("#game");
  if (canvas === null) throw new Error("missing canvas #game");

  const engine = createEngine({
    canvas,
    width: WIDTH,
    height: HEIGHT,
    background: "#0b0f16",
    layout: "single-stick",
    game,
    clock: new ConstantClock(1000 / 60),
    surface,
  });
  built.push(engine);

  await engine.initialize();

  return {
    engine,
    hold: (code) => {
      target.dispatchEvent(new KeyboardEvent("keydown", { code }));
    },
    release: (code) => {
      target.dispatchEvent(new KeyboardEvent("keyup", { code }));
    },
  };
}

/** The paddle carrying `tag`, which every assertion below expects to exist. */
function paddle(engine: Engine<null>, tag: string): Paddle {
  const found = engine.world.byTag(tag)[0];
  expect(found).toBeInstanceOf(Paddle);
  return found as Paddle;
}

beforeEach(() => {
  contexts = installCanvasContexts();
});

afterEach(() => {
  for (const engine of built.splice(0)) engine.destroy();
  contexts.uninstall();
  document.body.replaceChildren();
});

/* -------------------------------------------------------------------------- */
/* What the example narrates                                                  */
/* -------------------------------------------------------------------------- */

describe("the duel opens as the mode declares", () => {
  it("spawns one possessed paddle per side, each tagged by its holder", async () => {
    const { engine } = await createHarness();
    const world = engine.world;

    // Both paddles are the same class; the side that differs is the tag
    // `possessedBy` added when each controller took its pawn.
    expect(world.byTag(TAGS.paddle)).toHaveLength(2);
    const player = paddle(engine, TAGS.player);
    const opponent = paddle(engine, TAGS.opponent);
    expect(player).not.toBe(opponent);

    // `spawnPoint` answered per controller: the player's side is `-x` and the
    // bot's `+x`, both on the `z = 0` plane, unrotated and unscaled.
    expect(player.transform.position).toEqual(vec3(-COURT_HALF_WIDTH, 0, 0));
    expect(opponent.transform.position).toEqual(vec3(COURT_HALF_WIDTH, 0, 0));
    expect(player.transform.rotation).toEqual(QUAT_IDENTITY);
    expect(player.transform.scale).toEqual(VEC3_ONE);

    // `addPlayer` built the player state and a `PaddlePlayer`, because the
    // options named no controller, and possessed the paddle it spawned;
    // `addBot` did the same with the `PaddleAI` it was handed.
    const controllers = world.controllers();
    expect(controllers).toHaveLength(2);
    expect(controllers[0]).toBeInstanceOf(PaddlePlayer);
    expect(controllers[1]).toBeInstanceOf(PaddleAI);
    expect(controllers[0]?.pawn).toBe(player);
    expect(controllers[1]?.pawn).toBe(opponent);

    // One player state per participant, the bot's alongside the player's.
    const [first, second] = world.players();
    expect(first).toBe(controllers[0]);
    expect(second).toBeUndefined();
    expect(first?.playerState.name).toBe("Player");
    expect(controllers[1]?.playerState.name).toBe("Opponent");
    expect(world.mode.phase).toBe("playing");
  });

  it("places the level's one declared actor, the lamp that lights the court", async () => {
    const { engine } = await createHarness();

    // The level declares one actor; the mode spawns both paddles itself, so
    // the lamp is the whole of what the level description places.
    const lamp = engine.world.find(Lamp);
    expect(lamp).not.toBeNull();
    expect(engine.world.actors().filter((a) => a instanceof Lamp)).toHaveLength(
      1,
    );

    // The fill light has no direction; the sun is aimed by turning its offset,
    // which is what rotates a directional light in this engine.
    const lights = lamp?.componentsOf(LightComponent) ?? [];
    expect(lights.map((light) => light.light.kind)).toEqual([
      "hemisphere",
      "directional",
    ]);
    expect(lights[0]?.offset.rotation).toEqual(QUAT_IDENTITY);
    expect(lights[1]?.offset.rotation).toEqual(
      quatFromEuler(-Math.PI / 4, Math.PI / 4, 0),
    );
  });

  it("registers three actions the single-stick layout carries", async () => {
    const { engine } = await createHarness();

    // `move-up` and `move-down` belong to the layout's own vocabulary and
    // `confirm` is a menu action, so all three are in the selected layout and
    // are tagged with it as the instance registers them.
    const layout = TOUCH_LAYOUTS["single-stick"];
    expect(layout).toBeDefined();
    for (const action of Object.values(ACTIONS)) {
      expect(layout?.actions).toContain(action);
    }

    // An unregistered name reads as rest, so the axis is the registry's rather
    // than the keyboard's: nothing outside `BINDINGS` moves a paddle.
    const [controller] = engine.world.players();
    expect(controller?.input.value("move-left")).toBe(0);
    expect(controller?.input.pressed("back")).toBe(false);
  });

  it("frames both paddles from the camera the world starts with", async () => {
    const { engine } = await createHarness();
    const camera = engine.world.camera;

    // The world's camera starts at `(0, 0, 10)` looking at the origin, so the
    // mode poses nothing and both paddles, eight units to either side on the
    // `z = 0` plane, are in view.
    expect(camera.position).toEqual(vec3(0, 0, 10));
    expect(camera.rotation).toEqual(QUAT_IDENTITY);

    for (const tag of [TAGS.player, TAGS.opponent]) {
      const seen = camera.worldToLogical(
        paddle(engine, tag).transform.position,
      );
      expect(seen.visible).toBe(true);
      expect(seen.x).toBeGreaterThan(0);
      expect(seen.x).toBeLessThan(WIDTH);
      expect(seen.y).toBeGreaterThan(0);
      expect(seen.y).toBeLessThan(HEIGHT);
    }

    // The court and the paddles are measured in world units, and the design
    // size alone is logical: it is what the projection maps onto, whatever the
    // surface the fit lands on.
    expect(engine.world.viewport().width).toBe(WIDTH);
    expect(engine.world.viewport().height).toBe(HEIGHT);
  });
});

describe("the player controller drives through the action registry", () => {
  it("integrates a held direction and rests when the key is released", async () => {
    const harness = await createHarness();
    const { engine } = harness;
    const player = paddle(engine, TAGS.player);

    // Controllers tick before any actor, so the very first frame under the
    // held key already moves the pawn by the direction set that same frame.
    // Up is `+Y` in the world, so the axis is up minus down.
    harness.hold("KeyW");
    await engine.advance(1);
    expect(player.transform.position.y).toBeCloseTo(STEP, 10);

    // A quarter second at the paddle speed is 2.25 world units of travel.
    await engine.advance(14);
    expect(player.transform.position.y).toBeCloseTo(PADDLE_SPEED / 4, 10);

    // Nothing drives a paddle across the court or through it: the movement
    // rule rewrites `y` alone and carries `x` and `z` through untouched.
    expect(player.transform.position.x).toBe(-COURT_HALF_WIDTH);
    expect(player.transform.position.z).toBe(0);

    // The direction returns to rest each tick, so a paddle stops when its
    // controller stops driving.
    harness.release("KeyW");
    const rested = player.transform.position.y;
    await engine.advance(30);
    expect(player.transform.position.y).toBe(rested);
  });

  it("reports zero while both analog directions are held", async () => {
    const harness = await createHarness();
    const { engine } = harness;
    const player = paddle(engine, TAGS.player);

    // Both directions are analog and a held key reports full deflection, so
    // taking the axis as the difference makes holding both report `0`.
    harness.hold("KeyW");
    harness.hold("KeyS");
    const [controller] = engine.world.players();
    expect(controller?.input.value(ACTIONS.up)).toBe(1);
    expect(controller?.input.value(ACTIONS.down)).toBe(1);

    await engine.advance(30);
    expect(player.transform.position.y).toBe(0);
  });

  it("clamps the paddle against the court from either direction", async () => {
    const harness = await createHarness();
    const { engine } = harness;
    const player = paddle(engine, TAGS.player);

    // Either bound key drives the same action, and the pawn's own rule holds
    // its center inside the court by half the paddle's height.
    harness.hold("ArrowUp");
    await engine.advance(120);
    expect(player.transform.position.y).toBe(LIMIT);

    harness.release("ArrowUp");
    harness.hold("ArrowDown");
    await engine.advance(120);
    expect(player.transform.position.y).toBe(-LIMIT);
  });

  it("spends one restart per press", async () => {
    const harness = await createHarness();
    const { engine } = harness;
    const before = paddle(engine, TAGS.player);

    const destroyed: unknown[] = [];
    engine.events.on("actor:destroyed", ({ actor }) => destroyed.push(actor));

    // Move away from the spawn point so the respawn is observable.
    harness.hold("KeyW");
    await engine.advance(30);
    harness.release("KeyW");
    await engine.advance(1);
    expect(before.transform.position.y).not.toBe(0);

    // `pressed` is the edge read, true once per press and consumed by the
    // call, so holding the key across thirty frames costs one restart: one
    // destroyed pawn, one fresh paddle possessed at the mode's spawn point.
    harness.hold("Enter");
    await engine.advance(30);
    expect(destroyed).toEqual([before]);

    const respawned = paddle(engine, TAGS.player);
    expect(respawned).not.toBe(before);
    expect(respawned.transform.position).toEqual(vec3(-COURT_HALF_WIDTH, 0, 0));
    expect(engine.world.byTag(TAGS.paddle)).toHaveLength(2);
    const [controller] = engine.world.players();
    expect(controller?.pawn).toBe(respawned);

    // A second press arms a second edge and costs a second restart.
    harness.release("Enter");
    await engine.advance(1);
    harness.hold("Enter");
    await engine.advance(1);
    expect(destroyed).toEqual([before, respawned]);
  });

  it("consumes the edge on the read, per controller", async () => {
    const harness = await createHarness();
    const { engine } = harness;

    /**
     * A check-side player controller, added the way the page adds its scripted
     * bot: it possesses nothing and only reports what its own reader said.
     */
    class DoubleRead extends PlayerController {
      readonly reads: boolean[] = [];

      override tick(): void {
        this.reads.push(this.input.pressed(ACTIONS.restart));
        this.reads.push(this.input.pressed(ACTIONS.restart));
      }
    }

    const check = engine.world.mode.addPlayer({
      name: "Check",
      controller: DoubleRead,
      pawn: null,
    }) as DoubleRead;

    const destroyed: unknown[] = [];
    engine.events.on("actor:destroyed", ({ actor }) => destroyed.push(actor));

    // One press, two controllers: each player controller consumes its own copy
    // of the edge, so the paddle's controller still spends its restart while
    // the check sees the press too — and the second read in the same tick is
    // already false, because the call is what consumed it.
    harness.hold("Space");
    await engine.advance(1);
    expect(check.reads).toEqual([true, false]);
    expect(destroyed).toHaveLength(1);

    // The engine closes the input frame after the frame renders, so the press
    // is news for exactly one frame however long the key stays down.
    await engine.advance(5);
    expect(check.reads).toEqual([true, false, ...Array(10).fill(false)]);
    expect(destroyed).toHaveLength(1);
  });
});

describe("the opponent reaches the same drive call from the world", () => {
  it("chases the player's paddle and rests inside the dead zone", async () => {
    const harness = await createHarness();
    const { engine } = harness;
    const player = paddle(engine, TAGS.player);
    const opponent = paddle(engine, TAGS.opponent);

    // Send the player's paddle to the top clamp and let the bot follow it
    // there by tag, through the same `drive` call.
    harness.hold("KeyW");
    await engine.advance(60);
    harness.release("KeyW");
    await engine.advance(60);

    expect(player.transform.position.y).toBe(LIMIT);
    expect(
      Math.abs(opponent.transform.position.y - player.transform.position.y),
    ).toBeLessThan(DEAD_ZONE);

    // The dead zone keeps it still once aligned, and nothing drives it across
    // the court: it holds the side `spawnPoint` gave it.
    const aligned = opponent.transform.position.y;
    await engine.advance(30);
    expect(opponent.transform.position.y).toBe(aligned);
    expect(opponent.transform.position.x).toBe(COURT_HALF_WIDTH);
    expect(opponent.transform.position.z).toBe(0);
  });

  it("moves the pawn on the frame its controller decided", async () => {
    const harness = await createHarness();
    const { engine } = harness;
    const player = paddle(engine, TAGS.player);
    const opponent = paddle(engine, TAGS.opponent);

    // Frame one: the paddles are level, so the bot's delta is inside the dead
    // zone and it drives nothing while the player's key moves its own paddle.
    harness.hold("KeyW");
    await engine.advance(1);
    expect(player.transform.position.y).toBeCloseTo(STEP, 10);
    expect(opponent.transform.position.y).toBe(0);

    // Frame two: the delta the bot reads is now a whole step, past the dead
    // zone. Controllers tick before any actor, so the direction it sets this
    // frame moves its pawn this frame rather than the next one.
    await engine.advance(1);
    expect(opponent.transform.position.y).toBeCloseTo(STEP, 10);
  });

  it("integrates the bot's drive exactly as it integrates the player's", async () => {
    const harness = await createHarness();
    const { engine } = harness;
    const player = paddle(engine, TAGS.player);
    const opponent = paddle(engine, TAGS.opponent);

    // Two frames to open a gap wider than the dead zone, after which the bot
    // is chasing a paddle that is still running for the clamp.
    harness.hold("ArrowUp");
    await engine.advance(2);

    // The pawn holds the movement rule and the controller holds only the
    // decision, so the paddle a bot drives and the paddle a player drives
    // travel the same distance per frame — one full step, both of them.
    let lastPlayer = player.transform.position.y;
    let lastOpponent = opponent.transform.position.y;
    for (let frame = 0; frame < 5; frame += 1) {
      await engine.advance(1);
      const drivenByPlayer = player.transform.position.y - lastPlayer;
      const drivenByBot = opponent.transform.position.y - lastOpponent;
      expect(drivenByPlayer).toBeCloseTo(STEP, 10);
      expect(drivenByBot).toBeCloseTo(drivenByPlayer, 10);
      lastPlayer = player.transform.position.y;
      lastOpponent = opponent.transform.position.y;
    }

    // Neither reached the clamp inside that window, so what was measured is
    // the movement rule rather than its bound.
    expect(player.transform.position.y).toBeLessThan(LIMIT);
  });
});

describe("driving a pawn from a check", () => {
  it("possesses the player's paddle with a scripted controller", async () => {
    const harness = await createHarness();
    const { engine } = harness;
    const world = engine.world;

    // The example's scripted check, verbatim.
    class HoldUp extends AIController {
      override tick(): void {
        (this.pawn as Paddle).drive(1);
      }
    }

    const player = paddle(engine, TAGS.player);
    const scripted = world.mode.addBot(HoldUp, { pawn: null });
    scripted.possess(world.byTag(TAGS.player)[0] as Paddle);

    // `possess` unpossesses whatever controller already held that pawn, and
    // the paddle answers to the scripted controller from the *next* frame:
    // taking it moves nothing by itself.
    expect(scripted.pawn).toBe(player);
    expect(world.players()[0]?.pawn).toBeNull();
    expect(player.transform.position.y).toBe(0);

    // A second of holding up reaches the top clamp through the same movement
    // rule, the same frame order, and the same court a player exercises.
    await engine.advance(60);
    expect(player.transform.position.y).toBe(LIMIT);

    // The player's keys now reach a controller holding nothing, so they move
    // nothing while the scripted controller keeps the paddle pinned.
    harness.hold("KeyS");
    await engine.advance(30);
    expect(player.transform.position.y).toBe(LIMIT);
  });

  it("runs the pawn's own possessedBy when the scripted controller takes it", async () => {
    const harness = await createHarness();
    const { engine } = harness;
    const world = engine.world;

    class HoldUp extends AIController {
      override tick(): void {
        (this.pawn as Paddle).drive(1);
      }
    }

    const player = paddle(engine, TAGS.player);
    const scripted = world.mode.addBot(HoldUp, { pawn: null });
    scripted.possess(world.byTag(TAGS.player)[0] as Paddle);

    // `possessedBy` is where the pawn learns which side it is on, and it runs
    // on every possession: the scripted controller is not a `PlayerController`,
    // so the paddle it took now carries the opponent's tag beside the one it
    // was given when the player controller took it. It stays the first actor
    // spawned, so it is what a `byTag` for either side answers with.
    expect(player.tags).toContain(TAGS.player);
    expect(player.tags).toContain(TAGS.opponent);
    expect(world.byTag(TAGS.opponent)[0]).toBe(player);
    expect(world.byTag(TAGS.opponent)).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------------- */
/* The two controllers are interchangeable                                    */
/* -------------------------------------------------------------------------- */

describe("the two controllers are interchangeable", () => {
  it("gives the controller added last the final word on a shared pawn", async () => {
    const { engine } = await createHarness();
    const world = engine.world;

    // `drive` records an intent that the pawn's own tick integrates, so
    // whichever controller called it last in a frame is the one the paddle
    // obeys. Two scripted controllers driving one paddle in opposite
    // directions therefore report the order the controllers ticked in.
    const held = paddle(engine, TAGS.player);
    class DriveUp extends AIController {
      override tick(): void {
        held.drive(1);
      }
    }
    class DriveDown extends AIController {
      override tick(): void {
        held.drive(-1);
      }
    }

    world.mode.addBot(DriveUp, { pawn: null });
    world.mode.addBot(DriveDown, { pawn: null });
    expect(world.controllers().map((each) => each.constructor)).toEqual([
      PaddlePlayer,
      PaddleAI,
      DriveUp,
      DriveDown,
    ]);

    // Controllers tick before any actor, in the order they were added, so the
    // paddle descends: its own player controller drove it to rest, `DriveUp`
    // overwrote that, and `DriveDown` had the last word before the pawn ticked.
    await engine.advance(1);
    expect(held.transform.position.y).toBeCloseTo(-STEP, 10);

    // Adding a third controller puts it after both, and the paddle answers to
    // that one instead: one frame up undoes the frame down exactly.
    world.mode.addBot(DriveUp, { pawn: null });
    await engine.advance(1);
    expect(held.transform.position.y).toBeCloseTo(0, 10);
  });

  it("lets a different class handed to addBot change who decides", async () => {
    /** The opponent's decision inverted: it flees the paddle it can see. */
    class PaddleFlee extends AIController {
      override tick(): void {
        const pawn = this.pawn;
        if (!(pawn instanceof Paddle)) return;

        const target = this.world.byTag(TAGS.player)[0];
        if (target === undefined) return;

        const delta = target.transform.position.y - pawn.transform.position.y;
        if (Math.abs(delta) < DEAD_ZONE) return;
        pawn.drive(-Math.sign(delta));
      }
    }

    class FleeMode extends DuelMode {
      override beginPlay(): void {
        this.addPlayer({ name: "Player" });
        this.addBot(PaddleFlee, { name: "Opponent" });
        this.setPhase("playing");
      }
    }

    const harness = await createHarness({
      instance: DuelGame,
      levels: { [LEVEL]: { mode: FleeMode, actors: [{ type: Lamp }] } },
      startLevel: LEVEL,
    });
    const { engine } = harness;
    const player = paddle(engine, TAGS.player);
    const opponent = paddle(engine, TAGS.opponent);

    // Only the class handed to `addBot` changed: the same `pawnClass` was
    // spawned at the same `spawnPoint`, and the same `possessedBy` read the
    // holder's kind and tagged it as the opponent's.
    expect(engine.world.controllers()[1]).toBeInstanceOf(PaddleFlee);
    expect(opponent).toBeInstanceOf(Paddle);
    expect(opponent.transform.position).toEqual(vec3(COURT_HALF_WIDTH, 0, 0));

    // A second under a held key, and the pawn behaves the same way under this
    // controller as under the page's: it integrates the number it is handed,
    // which now sends it to the far clamp rather than to the player.
    harness.hold("KeyW");
    await engine.advance(60);
    expect(player.transform.position.y).toBe(LIMIT);
    expect(opponent.transform.position.y).toBe(-LIMIT);
  });

  it("lets addPlayer name a controller of its own", async () => {
    /** A player controller that decides without reading an action. */
    class ClimbPlayer extends PlayerController {
      override tick(): void {
        const pawn = this.pawn;
        if (!(pawn instanceof Paddle)) return;
        pawn.drive(1);
      }
    }

    class ClimbMode extends DuelMode {
      override beginPlay(): void {
        this.addPlayer({ name: "Player", controller: ClimbPlayer });
        this.addBot(PaddleAI, { name: "Opponent" });
        this.setPhase("playing");
      }
    }

    const { engine } = await createHarness({
      instance: DuelGame,
      levels: { [LEVEL]: { mode: ClimbMode, actors: [{ type: Lamp }] } },
      startLevel: LEVEL,
    });
    const player = paddle(engine, TAGS.player);
    const opponent = paddle(engine, TAGS.opponent);

    // `addPlayer` built the class its options named rather than the mode's
    // `playerControllerClass`, and the paddle still learned it was on the
    // player's side, because what `possessedBy` reads is the holder's kind.
    const [controller] = engine.world.players();
    expect(controller).toBeInstanceOf(ClimbPlayer);
    expect(controller).not.toBeInstanceOf(PaddlePlayer);
    expect(player.tags).toContain(TAGS.player);

    // No key is held and the paddle climbs anyway: who decides changed, and
    // the movement rule did not. The untouched `PaddleAI` on the other side
    // chases it exactly as it chases a paddle a player drives.
    await engine.advance(60);
    expect(player.transform.position.y).toBe(LIMIT);
    expect(
      Math.abs(opponent.transform.position.y - player.transform.position.y),
    ).toBeLessThan(DEAD_ZONE);
  });
});
