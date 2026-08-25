import { describe, expect, it } from "vitest";
import {
  AIController,
  ConstantClock,
  createEngine,
  GameInstance,
  GameMode,
  Pawn,
  PlayerController,
  ShapeComponent,
  TOUCH_LAYOUTS,
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

/**
 * The documentation's "Pawns and Controllers" example, transcribed and run.
 *
 * The sections below are the example's own modules, verbatim except for the
 * import paths (the example imports `@test-cabinet/structured-2d`; here that is
 * `./index`). The example's `main.ts` is reproduced inside the harness, with
 * only what a test environment forces: the canvas comes from jsdom with a
 * stubbed 2D context, a `SurfaceMetrics` supplies the measurements and the key
 * event target, a `ConstantClock` replaces the wall clock, and frames are
 * driven by `engine.advance` rather than `engine.run` — the pattern the
 * Scripted Clocks and Validating a Game pages establish. The assertions state
 * what the example's prose narrates.
 */

/* -------------------------------------------------------------------------- */
/* src/constants.ts                                                           */
/* -------------------------------------------------------------------------- */

const WIDTH = 640;
const HEIGHT = 360;
const MARGIN = 48;

const PADDLE_WIDTH = 12;
const PADDLE_HEIGHT = 72;
const PADDLE_SPEED = 320;
const DEAD_ZONE = 4;

const LEVEL = "duel";

const TAGS = {
  paddle: "paddle",
  player: "player-paddle",
  opponent: "opponent-paddle",
} as const;

const ACTIONS = {
  up: "p1-up",
  down: "p1-down",
  restart: "confirm",
} as const;

const BINDINGS: Record<string, ActionBinding> = {
  [ACTIONS.up]: { keys: ["KeyW", "ArrowUp"], kind: "analog" },
  [ACTIONS.down]: { keys: ["KeyS", "ArrowDown"], kind: "analog" },
  [ACTIONS.restart]: { keys: ["Enter", "Space"] },
};

/* -------------------------------------------------------------------------- */
/* src/actors/paddle.ts                                                       */
/* -------------------------------------------------------------------------- */

class Paddle extends Pawn {
  private direction = 0;

  constructor() {
    super();
    this.addTag(TAGS.paddle);
    this.attach(
      new ShapeComponent({
        shape: { kind: "rect", width: PADDLE_WIDTH, height: PADDLE_HEIGHT },
        fill: "#e6edf6",
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
    const half = PADDLE_HEIGHT / 2;
    const y = this.transform.y + this.direction * PADDLE_SPEED * dt;
    this.transform.y = Math.min(Math.max(y, half), HEIGHT - half);
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

    pawn.drive(this.input.value(ACTIONS.down) - this.input.value(ACTIONS.up));

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

    const delta = target.transform.y - pawn.transform.y;
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
    const x = controller instanceof PlayerController ? MARGIN : WIDTH - MARGIN;
    return { x, y: HEIGHT / 2, rotation: 0, scaleX: 1, scaleY: 1 };
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
  levels: { [LEVEL]: { mode: DuelMode } },
  startLevel: LEVEL,
};

/* -------------------------------------------------------------------------- */
/* The harness: src/main.ts under a scripted clock                            */
/* -------------------------------------------------------------------------- */

/** A 2D context reduced to what the pipeline calls — jsdom supplies none. */
function stubContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
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
    ctx[name] = () => undefined;
  }
  return ctx as unknown as CanvasRenderingContext2D;
}

interface Harness {
  readonly engine: Engine<null>;
  /** Dispatches a `keydown` for `code` at the surface's event target. */
  hold(code: string): void;
  /** Dispatches a `keyup` for `code` at the surface's event target. */
  release(code: string): void;
  dispose(): void;
}

/**
 * The example's `main.ts`: a canvas found by `#game`, the same `createEngine`
 * options, and an initialized engine — plus the clock and the surface a test
 * supplies, and `advance` standing in for `run`.
 */
async function createHarness(): Promise<Harness> {
  const element = document.createElement("canvas");
  element.id = "game";
  Object.assign(element, { getContext: () => stubContext(element) });
  document.body.append(element);

  const target = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => WIDTH,
    cssHeight: () => HEIGHT,
    dpr: () => 1,
    events: () => target,
  };

  const canvas = document.querySelector<HTMLCanvasElement>("#game");
  if (canvas === null) throw new Error("missing canvas #game");

  const engine = createEngine({
    canvas,
    width: WIDTH,
    height: HEIGHT,
    background: "#0b0f16",
    layout: "dual-vertical",
    game: duel,
    clock: new ConstantClock(1000 / 60),
    surface,
  });

  await engine.initialize();

  return {
    engine,
    hold: (code) => {
      target.dispatchEvent(new KeyboardEvent("keydown", { code }));
    },
    release: (code) => {
      target.dispatchEvent(new KeyboardEvent("keyup", { code }));
    },
    dispose: () => {
      engine.destroy();
      element.remove();
    },
  };
}

/** The paddle carrying `tag`, which the assertions below always expect. */
function paddle(engine: Engine<null>, tag: string): Paddle {
  const found = engine.world.byTag(tag)[0];
  expect(found).toBeInstanceOf(Paddle);
  return found as Paddle;
}

/* -------------------------------------------------------------------------- */
/* What the example narrates                                                  */
/* -------------------------------------------------------------------------- */

describe("the duel opens as the mode declares", () => {
  it("spawns one possessed paddle per side, each tagged by its holder", async () => {
    const harness = await createHarness();
    const { engine } = harness;
    const world = engine.world;

    // Both paddles are the same class; the side that differs is the tag
    // `possessedBy` added when each controller took its pawn.
    expect(world.byTag(TAGS.paddle)).toHaveLength(2);
    const player = paddle(engine, TAGS.player);
    const opponent = paddle(engine, TAGS.opponent);
    expect(player).not.toBe(opponent);

    // `spawnPoint` answered per controller: the player's side is the left
    // margin and the bot's the right, both centered vertically.
    expect(player.transform.x).toBe(MARGIN);
    expect(player.transform.y).toBe(HEIGHT / 2);
    expect(opponent.transform.x).toBe(WIDTH - MARGIN);
    expect(opponent.transform.y).toBe(HEIGHT / 2);

    // `addPlayer` built the player state and possessed the player's paddle;
    // `beginPlay` moved the match to `playing`.
    const [controller] = world.players();
    expect(controller).toBeInstanceOf(PaddlePlayer);
    expect(controller?.playerState.name).toBe("Player");
    expect(controller?.pawn).toBe(player);
    expect(world.mode.phase).toBe("playing");

    harness.dispose();
  });

  it("registers actions the dual-vertical vocabulary carries", async () => {
    const harness = await createHarness();

    // `p1-up` and `p1-down` belong to the layout's own vocabulary and
    // `confirm` is a menu action, so all three are in the selected layout.
    const layout = TOUCH_LAYOUTS["dual-vertical"];
    expect(layout).toBeDefined();
    for (const action of Object.values(ACTIONS)) {
      expect(layout?.actions).toContain(action);
    }

    harness.dispose();
  });
});

describe("the player controller drives through the action registry", () => {
  it("integrates a held direction and rests when the key is released", async () => {
    const harness = await createHarness();
    const { engine } = harness;
    const player = paddle(engine, TAGS.player);

    // Controllers tick before any actor, so the very first frame under the
    // held key already observes the direction set this frame.
    harness.hold("KeyW");
    await engine.advance(1);
    expect(player.transform.y).toBeCloseTo(HEIGHT / 2 - PADDLE_SPEED / 60, 6);

    // A quarter second at the paddle speed is 80 units of travel.
    await engine.advance(14);
    expect(player.transform.y).toBeCloseTo(HEIGHT / 2 - PADDLE_SPEED / 4, 6);

    // The direction returns to rest each tick, so a paddle stops when its
    // controller stops driving.
    harness.release("KeyW");
    const rested = player.transform.y;
    await engine.advance(30);
    expect(player.transform.y).toBe(rested);

    harness.dispose();
  });

  it("reports zero while both analog directions are held", async () => {
    const harness = await createHarness();
    const { engine } = harness;
    const player = paddle(engine, TAGS.player);

    // Both directions are analog and a held key reports full deflection, so
    // taking the axis as the difference makes holding both report `0`.
    harness.hold("KeyW");
    harness.hold("KeyS");
    await engine.advance(30);
    expect(player.transform.y).toBe(HEIGHT / 2);

    harness.dispose();
  });

  it("clamps the paddle against the field", async () => {
    const harness = await createHarness();
    const { engine } = harness;
    const player = paddle(engine, TAGS.player);

    // The second bound key drives the same action, and the pawn's movement
    // rule holds the center inside the field by half the paddle's height.
    harness.hold("ArrowUp");
    await engine.advance(120);
    expect(player.transform.y).toBe(PADDLE_HEIGHT / 2);

    harness.dispose();
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
    expect(before.transform.y).not.toBe(HEIGHT / 2);

    // `pressed` is the edge read, true once per press and consumed by the
    // call, so holding the key across thirty frames costs one restart:
    // one destroyed pawn, one fresh paddle possessed at the spawn point.
    harness.hold("Enter");
    await engine.advance(30);
    expect(destroyed).toEqual([before]);

    const respawned = paddle(engine, TAGS.player);
    expect(respawned).not.toBe(before);
    expect(respawned.transform.x).toBe(MARGIN);
    expect(respawned.transform.y).toBe(HEIGHT / 2);
    const [controller] = engine.world.players();
    expect(controller?.pawn).toBe(respawned);

    // A second press arms a second edge and costs a second restart.
    harness.release("Enter");
    await engine.advance(1);
    harness.hold("Enter");
    await engine.advance(1);
    expect(destroyed).toEqual([before, respawned]);

    harness.dispose();
  });
});

describe("the opponent reaches the same drive call from the world", () => {
  it("chases the player's paddle and rests inside the dead zone", async () => {
    const harness = await createHarness();
    const { engine } = harness;
    const player = paddle(engine, TAGS.player);
    const opponent = paddle(engine, TAGS.opponent);

    // Send the player's paddle to the bottom clamp and let the bot follow.
    harness.hold("KeyS");
    await engine.advance(60);
    harness.release("KeyS");
    await engine.advance(60);

    expect(player.transform.y).toBe(HEIGHT - PADDLE_HEIGHT / 2);
    expect(Math.abs(opponent.transform.y - player.transform.y)).toBeLessThan(
      DEAD_ZONE,
    );

    // The dead zone keeps it still once aligned, and nothing drives it
    // horizontally: it holds the side `spawnPoint` gave it.
    const aligned = opponent.transform.y;
    await engine.advance(30);
    expect(opponent.transform.y).toBe(aligned);
    expect(opponent.transform.x).toBe(WIDTH - MARGIN);

    harness.dispose();
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
        (this.pawn as Paddle).drive(-1);
      }
    }

    const scripted = world.mode.addBot(HoldUp, { pawn: null });
    scripted.possess(world.byTag(TAGS.player)[0] as Paddle);
    await engine.advance(60);

    // `possess` unpossessed the player controller, so the paddle answers to
    // the scripted controller: a second of holding up reaches the top clamp
    // through the same movement rule and frame order a player exercises.
    const player = paddle(engine, TAGS.player);
    expect(scripted.pawn).toBe(player);
    expect(world.players()[0]?.pawn).toBeNull();
    expect(player.transform.y).toBe(PADDLE_HEIGHT / 2);

    // The player's keys reach a controller holding nothing, so they move
    // nothing while the scripted controller keeps the paddle pinned.
    harness.hold("KeyS");
    await engine.advance(30);
    expect(player.transform.y).toBe(PADDLE_HEIGHT / 2);

    harness.dispose();
  });
});
