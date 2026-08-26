import { createCanvas } from "@test-cabinet/headless-webgl2";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pawn } from "./actors";
import type { SurfaceMetrics } from "./camera";
import { ConstantClock } from "./clocks";
import { ShapeComponent } from "./components";
import { AIController, PlayerController, type Controller } from "./controllers";
import { createEngine, type Engine } from "./engine";
import {
  GameInstance,
  type GameDefinition,
  type InitApi,
} from "./game-instance";
import { GameMode } from "./game-mode";
import { TOUCH_LAYOUTS, type ActionBinding } from "./input";
import { quatFromAxisAngle, type Transform } from "./math";

/**
 * The documentation's worked example "Pawns and Controllers", transcribed and
 * run. The page promises its code works against the engine verbatim, so the
 * constants, the game definition, `Rover`, both controllers, and `DuelMode`
 * are copied from the page unchanged, and so is the scripted-controller
 * fragment the page closes with. Only what a test environment forces is
 * adapted:
 *
 * - The page's boot module finds a canvas in a document; here
 *   `@test-cabinet/headless-webgl2` makes one in process and a
 *   `SurfaceMetrics` over a bare `EventTarget` reports its size and carries
 *   the key events a player's keyboard would deliver. The element is smaller
 *   than the design field because the WebGL2 implementation rasterizes in
 *   software; the design size, and every world figure the page states, is
 *   unchanged.
 * - The page's `engine.run()` drives frames off the host's callback; a suite
 *   steps with `engine.advance` over a `ConstantClock`, so a duration is a
 *   frame count.
 *
 * The assertions are the outcomes the page narrates: the layout attribution,
 * what `addPlayer` and `addBot` build, the whole `Transform` `spawnPoint`
 * returns, the held read and its opposed pairs, the normalized intent, the
 * intent returning to rest, the edge read costing one `restart`, the
 * opponent's chase and its dead zone, and the scripted controller taking the
 * player's rover.
 */

/* -------------------------------------------------------------------------- */
/* src/constants.ts — transcribed verbatim                                    */
/* -------------------------------------------------------------------------- */

const WIDTH = 640;
const HEIGHT = 360;

const ARENA = 8;
const MARGIN = 2;
const ROVER_RADIUS = 0.5;
const ROVER_SPEED = 6;
const DEAD_ZONE = 0.75;

const LEVEL = "duel";

const TAGS = {
  rover: "rover",
  player: "player-rover",
  opponent: "opponent-rover",
} as const;

const BINDINGS: Record<string, ActionBinding> = {
  "move-forward": { keys: ["KeyW", "ArrowUp"], kind: "analog" },
  "move-back": { keys: ["KeyS", "ArrowDown"], kind: "analog" },
  "move-left": { keys: ["KeyA", "ArrowLeft"], kind: "analog" },
  "move-right": { keys: ["KeyD", "ArrowRight"], kind: "analog" },
  confirm: { keys: ["Enter", "Space"] },
};

/* -------------------------------------------------------------------------- */
/* src/actors/rover.ts — transcribed verbatim                                 */
/* -------------------------------------------------------------------------- */

class Rover extends Pawn {
  private dx = 0;
  private dz = 0;

  constructor() {
    super();
    this.addTag(TAGS.rover);
    this.attach(
      new ShapeComponent({
        shape: { kind: "capsule", radius: ROVER_RADIUS, height: 0.6 },
        color: "#e6edf6",
      }),
    );
  }

  drive(x: number, z: number): void {
    const length = Math.hypot(x, z);
    const scale = length > 1 ? 1 / length : 1;
    this.dx = x * scale;
    this.dz = z * scale;
  }

  override possessedBy(controller: Controller): void {
    const side =
      controller instanceof PlayerController ? TAGS.player : TAGS.opponent;
    this.addTag(side);
  }

  override tick(dt: number): void {
    const limit = ARENA - ROVER_RADIUS;
    const p = this.transform.position;
    p.x = Math.min(Math.max(p.x + this.dx * ROVER_SPEED * dt, -limit), limit);
    p.z = Math.min(Math.max(p.z + this.dz * ROVER_SPEED * dt, -limit), limit);
    this.dx = 0;
    this.dz = 0;
  }
}

/* -------------------------------------------------------------------------- */
/* src/controllers/rover-player.ts — transcribed verbatim                     */
/* -------------------------------------------------------------------------- */

class RoverPlayer extends PlayerController {
  override tick(): void {
    const pawn = this.pawn;
    if (!(pawn instanceof Rover)) return;

    pawn.drive(
      this.input.value("move-right") - this.input.value("move-left"),
      this.input.value("move-back") - this.input.value("move-forward"),
    );

    if (this.input.pressed("confirm")) {
      this.world.mode.restart(this);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* src/controllers/rover-ai.ts — transcribed verbatim                         */
/* -------------------------------------------------------------------------- */

class RoverAI extends AIController {
  override tick(): void {
    const pawn = this.pawn;
    if (!(pawn instanceof Rover)) return;

    const target = this.world.byTag(TAGS.player)[0];
    if (target === undefined) return;

    const dx = target.transform.position.x - pawn.transform.position.x;
    const dz = target.transform.position.z - pawn.transform.position.z;
    if (Math.hypot(dx, dz) < DEAD_ZONE) return;
    pawn.drive(dx, dz);
  }
}

/* -------------------------------------------------------------------------- */
/* src/levels/duel-mode.ts — transcribed verbatim                             */
/* -------------------------------------------------------------------------- */

const UP = { x: 0, y: 1, z: 0 };

class DuelMode extends GameMode {
  override playerControllerClass = RoverPlayer;
  override pawnClass = Rover;

  override beginPlay(): void {
    this.world.camera.position = { x: 0, y: 12, z: 16 };
    this.world.camera.lookAt({ x: 0, y: 0, z: 0 });
    this.addPlayer({ name: "Player" });
    this.addBot(RoverAI, { name: "Opponent" });
    this.setPhase("playing");
  }

  override spawnPoint(controller: Controller): Transform {
    const player = controller instanceof PlayerController;
    return {
      position: { x: 0, y: 0, z: player ? ARENA - MARGIN : MARGIN - ARENA },
      rotation: quatFromAxisAngle(UP, player ? 0 : Math.PI),
      scale: { x: 1, y: 1, z: 1 },
    };
  }
}

/* -------------------------------------------------------------------------- */
/* src/game.ts — transcribed verbatim                                         */
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
/* index.html + src/main.ts — transcribed, with the forced adaptations        */
/* -------------------------------------------------------------------------- */

/** The size the page's canvas element is reported at; see the header. */
const CSS_WIDTH = 160;
const CSS_HEIGHT = 90;

type ActionName = keyof typeof BINDINGS;

interface Duel {
  readonly engine: Engine<null>;
  hold(action: ActionName): void;
  release(action: ActionName): void;
  tap(action: ActionName): void;
  player(): RoverPlayer;
  opponent(): AIController;
  playerRover(): Rover;
  opponentRover(): Rover;
  dispose(): void;
}

/** A keyboard-shaped event, the seam `SurfaceMetrics.events()` exists for. */
class KeyEvent extends Event {
  readonly code: string;
  readonly repeat: boolean;

  constructor(type: "keydown" | "keyup", code: string, repeat = false) {
    super(type);
    this.code = code;
    this.repeat = repeat;
  }
}

function roverOf(controller: Controller | undefined): Rover {
  const pawn = controller?.pawn ?? null;
  if (!(pawn instanceof Rover))
    throw new Error("the controller holds no rover");
  return pawn;
}

async function boot(): Promise<Duel> {
  const canvas = createCanvas(
    CSS_WIDTH,
    CSS_HEIGHT,
  ) as unknown as HTMLCanvasElement;
  const events = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => CSS_WIDTH,
    cssHeight: () => CSS_HEIGHT,
    dpr: () => 1,
    events: () => events,
  };

  const engine = createEngine<null>({
    canvas,
    width: WIDTH,
    height: HEIGHT,
    background: "#0b0f16",
    layout: "stick-move",
    game: duel,
    clock: new ConstantClock(1000 / 60),
    surface,
  });

  await engine.initialize();

  const dispatch = (type: "keydown" | "keyup", action: ActionName): void => {
    const binding = BINDINGS[action];
    if (binding === undefined) throw new Error(`no binding for ${action}`);
    events.dispatchEvent(new KeyEvent(type, binding.keys[0] ?? ""));
  };

  const player = (): RoverPlayer => {
    const [first] = engine.world.players();
    if (!(first instanceof RoverPlayer))
      throw new Error("no player controller");
    return first;
  };
  const opponent = (): AIController => {
    const found = engine.world
      .controllers()
      .find((controller) => controller instanceof RoverAI);
    if (found === undefined) throw new Error("no opponent controller");
    return found;
  };

  return {
    engine,
    hold: (action) => dispatch("keydown", action),
    release: (action) => dispatch("keyup", action),
    tap: (action) => {
      dispatch("keydown", action);
      dispatch("keyup", action);
    },
    player,
    opponent,
    playerRover: () => roverOf(player()),
    opponentRover: () => roverOf(opponent()),
    dispose: () => engine.destroy(),
  };
}

/* -------------------------------------------------------------------------- */
/* The narrated outcomes                                                      */
/* -------------------------------------------------------------------------- */

describe("examples/pawns-and-controllers", () => {
  let duelGame: Duel;

  beforeEach(async () => {
    duelGame = await boot();
  });

  afterEach(() => {
    duelGame.dispose();
  });

  it("carries the layout the engine was built with over all five actions", () => {
    // "The four move actions are the `stick-move` vocabulary and `confirm` is
    // a menu action, so all five carry the layout once the engine is built
    // with it."
    const layout = TOUCH_LAYOUTS["stick-move"];
    expect(layout?.actions).toEqual([
      "move-forward",
      "move-back",
      "move-left",
      "move-right",
      "confirm",
      "back",
      "pause",
      "mute",
    ]);
    for (const action of Object.keys(BINDINGS)) {
      expect(layout?.actions).toContain(action);
    }
  });

  it("adds a player and a bot, each with its own controller and rover", () => {
    // "`addPlayer` builds the player state, builds a `RoverPlayer` because the
    // options name no controller, spawns a `Rover` at `spawnPoint`, and
    // possesses it. `addBot` does the same with the `RoverAI` it is handed."
    const world = duelGame.engine.world;
    expect(world.level).toBe(LEVEL);
    expect(world.mode.phase).toBe("playing");

    expect(world.controllers()).toHaveLength(2);
    expect(world.controllers()[0]).toBeInstanceOf(RoverPlayer);
    expect(world.controllers()[1]).toBeInstanceOf(RoverAI);
    expect(world.players()).toHaveLength(1);

    expect(world.state.players.map((state) => state.name)).toEqual([
      "Player",
      "Opponent",
    ]);
    expect(world.state.players.map((state) => state.index)).toEqual([0, 1]);

    // The level declares no actors: both rovers exist because the mode added
    // its players.
    expect(world.ofType(Rover)).toHaveLength(2);
    expect(duelGame.playerRover().hasTag(TAGS.rover)).toBe(true);
  });

  it("learns which side each rover is on when it is possessed", () => {
    // "`possessedBy` is where the pawn learns which side it is on."
    expect(duelGame.playerRover().hasTag(TAGS.player)).toBe(true);
    expect(duelGame.playerRover().hasTag(TAGS.opponent)).toBe(false);
    expect(duelGame.opponentRover().hasTag(TAGS.opponent)).toBe(true);
    expect(duelGame.opponentRover().hasTag(TAGS.player)).toBe(false);
  });

  it("places each rover at its own end and turns the opponent to face across", () => {
    // "`spawnPoint` returns a whole `Transform`, all three fields ... putting
    // each rover at its own end and turning the opponent to face across."
    expect(duelGame.playerRover().transform.position).toEqual({
      x: 0,
      y: 0,
      z: ARENA - MARGIN,
    });
    expect(duelGame.playerRover().transform.rotation).toEqual({
      x: 0,
      y: 0,
      z: 0,
      w: 1,
    });
    expect(duelGame.playerRover().transform.scale).toEqual({
      x: 1,
      y: 1,
      z: 1,
    });

    const facing = duelGame.opponentRover().transform.rotation;
    expect(duelGame.opponentRover().transform.position).toEqual({
      x: 0,
      y: 0,
      z: MARGIN - ARENA,
    });
    expect(facing.y).toBeCloseTo(1, 9);
    expect(facing.w).toBeCloseTo(0, 9);
  });

  it("frames the arena from above the player's end", () => {
    // "The camera sits above the player's end looking toward the opponent" —
    // `lookAt` aims −Z at the origin, so the origin is the picture's center.
    const { camera } = duelGame.engine.world;
    expect(camera.position).toEqual({ x: 0, y: 12, z: 16 });
    const center = camera.project({ x: 0, y: 0, z: 0 });
    expect(center?.x).toBeCloseTo(WIDTH / 2, 6);
    expect(center?.y).toBeCloseTo(HEIGHT / 2, 6);
  });

  it("moves the rover on the frame the key is held, at the stated speed", async () => {
    // "Controllers tick before any actor, in the order they were added, so
    // both rovers observe a direction set this frame."
    const { engine } = duelGame;
    const rover = duelGame.playerRover();

    duelGame.hold("move-right");
    await engine.advance(1);
    expect(rover.transform.position.x).toBeCloseTo(ROVER_SPEED / 60, 9);

    await engine.advance(59);
    expect(rover.transform.position.x).toBeCloseTo(ROVER_SPEED, 6);
    expect(rover.transform.position.z).toBeCloseTo(ARENA - MARGIN, 9);
  });

  it("reports zero for an axis whose opposed pair is both held", async () => {
    // "taking each axis as the difference of its opposed pair makes holding
    // both report `0`."
    const { engine } = duelGame;
    const rover = duelGame.playerRover();

    duelGame.hold("move-left");
    duelGame.hold("move-right");
    await engine.advance(30);

    expect(rover.transform.position.x).toBe(0);
    expect(duelGame.player().input.value("move-right")).toBe(1);
    expect(duelGame.player().input.value("move-left")).toBe(1);
  });

  it("keeps a diagonal no faster than a straight line", async () => {
    // "Clamping the intent to unit length keeps a diagonal no faster than a
    // straight line."
    const { engine } = duelGame;
    const rover = duelGame.playerRover();
    const from = { ...rover.transform.position };

    duelGame.hold("move-right");
    duelGame.hold("move-forward");
    await engine.advance(30);

    const dx = rover.transform.position.x - from.x;
    const dz = rover.transform.position.z - from.z;
    expect(Math.hypot(dx, dz)).toBeCloseTo(ROVER_SPEED / 2, 6);
    expect(dx).toBeCloseTo(-dz, 9);
  });

  it("returns the intent to rest each tick, so a rover stops when driving stops", async () => {
    // "The direction returns to rest each tick, so a rover stops when its
    // controller stops driving."
    const { engine } = duelGame;
    const rover = duelGame.playerRover();

    duelGame.hold("move-right");
    await engine.advance(10);
    duelGame.release("move-right");
    await engine.advance(1);
    const settled = rover.transform.position.x;

    await engine.advance(30);
    expect(rover.transform.position.x).toBe(settled);
  });

  it("costs one restart per press of the edge-read action", async () => {
    // "`pressed` is the edge read, true once per press and consumed by the
    // call, so one press costs one `restart`, which respawns the rover at the
    // mode's spawn point and possesses it."
    const { engine } = duelGame;
    const before = duelGame.playerRover();
    before.transform.position = { x: 4, y: 0, z: 0 };

    duelGame.hold("confirm");
    await engine.advance(1);

    const after = duelGame.playerRover();
    expect(after).not.toBe(before);
    expect(before.alive).toBe(false);
    expect(after.transform.position).toEqual({ x: 0, y: 0, z: ARENA - MARGIN });
    expect(after.controller).toBe(duelGame.player());

    // The key is still held, and the edge was spent by the read that took it.
    await engine.advance(30);
    expect(duelGame.playerRover()).toBe(after);
  });

  it("chases the player's rover at one speed however far it sits", async () => {
    // "`drive` normalizes what it is handed, so the chase runs at one speed
    // however far the target sits."
    const { engine } = duelGame;
    const chaser = duelGame.opponentRover();
    duelGame.playerRover().transform.position = { x: 0, y: 0, z: 7 };
    chaser.transform.position = { x: 0, y: 0, z: -7 };

    await engine.advance(30);
    expect(chaser.transform.position.z).toBeCloseTo(-7 + ROVER_SPEED / 2, 6);
    expect(chaser.transform.position.x).toBeCloseTo(0, 9);
  });

  it("keeps the opponent still once it is inside the dead zone", async () => {
    // "the dead zone keeps it still once close."
    const { engine } = duelGame;
    const chaser = duelGame.opponentRover();
    duelGame.playerRover().transform.position = { x: 0, y: 0, z: 0 };
    chaser.transform.position = { x: 0, y: 0, z: DEAD_ZONE / 2 };

    await engine.advance(30);
    expect(chaser.transform.position).toEqual({ x: 0, y: 0, z: DEAD_ZONE / 2 });
  });

  it("hands the player's rover to a controller a check possesses it with", async () => {
    // The page's closing fragment: a check drives the game the way a player
    // does, with a controller of its own. "`possess` unpossesses whatever
    // controller already held that pawn, so the player's rover answers to the
    // scripted controller from the next frame."
    class HoldForward extends AIController {
      override tick(): void {
        (this.pawn as Rover).drive(0, -1);
      }
    }

    const { engine } = duelGame;
    const world = engine.world;
    const displaced = duelGame.player();
    const rover = duelGame.playerRover();

    const changes: { controller: string; pawn: boolean }[] = [];
    engine.events.on("possession:changed", ({ controller, pawn }) => {
      changes.push({
        controller: controller.constructor.name,
        pawn: pawn !== null,
      });
    });

    const scripted = world.mode.addBot(HoldForward, { pawn: null });
    scripted.possess(world.byTag(TAGS.player)[0] as Rover);
    await engine.advance(60);

    expect(scripted.pawn).toBe(rover);
    expect(displaced.pawn).toBeNull();
    expect(changes).toEqual([
      { controller: "RoverPlayer", pawn: false },
      { controller: "HoldForward", pawn: true },
    ]);

    // The movement rule, the frame order, and the clamp against the arena are
    // the ones a player exercises.
    expect(rover.transform.position.z).toBeCloseTo(
      ARENA - MARGIN - ROVER_SPEED,
      6,
    );
  });
});
