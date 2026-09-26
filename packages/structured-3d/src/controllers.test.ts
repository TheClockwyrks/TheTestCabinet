import { describe, expect, it } from "vitest";
import { Pawn } from "./actors";
import type { SurfaceMetrics, Vec2, Viewport } from "./contract";
import { AIController, Controller, PlayerController } from "./controllers";
import { InputSystem } from "./input";
import type { World } from "./worlds";

/**
 * The `possession:changed` payload, restated here as the suite asserts it. The
 * engine's event map is not reachable from this module, and pinning the three
 * fields by hand is the point of these assertions anyway.
 */
interface PossessionEvent {
  controller: Controller;
  pawn: Pawn | null;
  previous: Pawn | null;
}

/**
 * A stand-in world whose broadcaster records every `possession:changed` into
 * the shared log the pawn doubles also write, so a test asserts the relative
 * order of notifications and events with one array.
 */
function fakeWorld(log: string[]): {
  world: World;
  emitted: PossessionEvent[];
} {
  const emitted: PossessionEvent[] = [];
  const events = {
    on: () => () => {},
    emit: (event: string, payload: PossessionEvent) => {
      if (event === "possession:changed") {
        emitted.push(payload);
        log.push(
          `event:${payload.pawn ? "possess" : "unpossess"}:` +
            `${name(payload.controller)}`,
        );
      }
    },
  };
  return { world: { events } as unknown as World, emitted };
}

/** Test names for controllers, so a log line reads as prose. */
const names = new WeakMap<Controller, string>();
function name(controller: Controller): string {
  return names.get(controller) ?? "controller";
}

/** A controller seated in `world` under `label`, for the log's benefit. */
function controllerIn(world: World, label: string): Controller {
  const controller = new Controller();
  (controller as { world: World }).world = world;
  names.set(controller, label);
  return controller;
}

/** A pawn that writes its two possession notifications into the log. */
class LogPawn extends Pawn {
  constructor(
    private readonly log: string[],
    private readonly label: string,
  ) {
    super();
  }

  override possessedBy(controller: Controller): void {
    this.log.push(`${this.label}:possessedBy:${name(controller)}`);
  }

  override unpossessed(): void {
    this.log.push(`${this.label}:unpossessed`);
  }
}

describe("Controller defaults", () => {
  it("holds no pawn", () => {
    expect(new Controller().pawn).toBeNull();
  });

  it("has do-nothing base lifecycle methods", () => {
    const controller = new Controller();

    expect(() => controller.beginPlay()).not.toThrow();
    expect(() => controller.tick(1 / 60)).not.toThrow();
    expect(() => controller.endPlay("level-closed")).not.toThrow();
  });
});

describe("Controller.possess", () => {
  it("sets the pawn, seats itself on it, and notifies through possessedBy", () => {
    const log: string[] = [];
    const { world } = fakeWorld(log);
    const controller = controllerIn(world, "c");
    const pawn = new LogPawn(log, "p");

    controller.possess(pawn);

    expect(controller.pawn).toBe(pawn);
    expect(pawn.controller).toBe(controller);
    expect(log).toEqual(["p:possessedBy:c", "event:possess:c"]);
  });

  it("emits possession:changed with a null previous for a first take", () => {
    const log: string[] = [];
    const { world, emitted } = fakeWorld(log);
    const controller = controllerIn(world, "c");
    const pawn = new Pawn();

    controller.possess(pawn);

    expect(emitted).toEqual([{ controller, pawn, previous: null }]);
  });

  it("has already seated itself when possessedBy runs", () => {
    const { world } = fakeWorld([]);
    const controller = controllerIn(world, "c");
    let seatedDuringNotify: Controller | null | undefined;

    class Watcher extends Pawn {
      override possessedBy(): void {
        seatedDuringNotify = this.controller;
      }
    }

    controller.possess(new Watcher());

    expect(seatedDuringNotify).toBe(controller);
  });

  it("releases what it held, carrying it as previous on the take's one event", () => {
    const log: string[] = [];
    const { world, emitted } = fakeWorld(log);
    const controller = controllerIn(world, "c");
    const first = new LogPawn(log, "first");
    const second = new LogPawn(log, "second");
    controller.possess(first);
    log.length = 0;
    emitted.length = 0;

    controller.possess(second);

    expect(controller.pawn).toBe(second);
    expect(first.controller).toBeNull();
    expect(second.controller).toBe(controller);
    // One event for the one controller whose possession changed; the released
    // pawn rides in `previous` rather than in an event of its own.
    expect(emitted).toEqual([{ controller, pawn: second, previous: first }]);
    expect(log).toEqual([
      "first:unpossessed",
      "second:possessedBy:c",
      "event:possess:c",
    ]);
  });

  it("unpossesses the controller already holding the pawn first", () => {
    const log: string[] = [];
    const { world, emitted } = fakeWorld(log);
    const holder = controllerIn(world, "holder");
    const thief = controllerIn(world, "thief");
    const pawn = new LogPawn(log, "p");
    holder.possess(pawn);
    log.length = 0;
    emitted.length = 0;

    thief.possess(pawn);

    expect(holder.pawn).toBeNull();
    expect(thief.pawn).toBe(pawn);
    expect(pawn.controller).toBe(thief);
    // The robbed controller announces its own unpossession before the take.
    expect(emitted).toEqual([
      { controller: holder, pawn: null, previous: pawn },
      { controller: thief, pawn, previous: null },
    ]);
    expect(log).toEqual([
      "p:unpossessed",
      "event:unpossess:holder",
      "p:possessedBy:thief",
      "event:possess:thief",
    ]);
  });

  it("keeps possession exclusive in both directions on a steal while holding", () => {
    const log: string[] = [];
    const { world, emitted } = fakeWorld(log);
    const holder = controllerIn(world, "holder");
    const thief = controllerIn(world, "thief");
    const held = new LogPawn(log, "held");
    const stolen = new LogPawn(log, "stolen");
    holder.possess(stolen);
    thief.possess(held);
    log.length = 0;
    emitted.length = 0;

    thief.possess(stolen);

    expect(thief.pawn).toBe(stolen);
    expect(stolen.controller).toBe(thief);
    expect(holder.pawn).toBeNull();
    expect(held.controller).toBeNull();
    expect(emitted).toEqual([
      { controller: holder, pawn: null, previous: stolen },
      { controller: thief, pawn: stolen, previous: held },
    ]);
  });

  it("re-taking the pawn it already holds releases and takes it again", () => {
    const log: string[] = [];
    const { world, emitted } = fakeWorld(log);
    const controller = controllerIn(world, "c");
    const pawn = new LogPawn(log, "p");
    controller.possess(pawn);
    log.length = 0;
    emitted.length = 0;

    controller.possess(pawn);

    expect(controller.pawn).toBe(pawn);
    expect(pawn.controller).toBe(controller);
    expect(emitted).toEqual([{ controller, pawn, previous: pawn }]);
    expect(log).toEqual([
      "p:unpossessed",
      "p:possessedBy:c",
      "event:possess:c",
    ]);
  });

  it("works on a bare controller outside any world, without a bus to announce on", () => {
    const controller = new Controller();
    const pawn = new Pawn();

    expect(() => controller.possess(pawn)).not.toThrow();
    expect(controller.pawn).toBe(pawn);
    expect(pawn.controller).toBe(controller);
  });

  it("tolerates a world whose broadcaster exposes only the public half", () => {
    const controller = new Controller();
    (controller as { world: World }).world = {
      events: { on: () => () => {} },
    } as unknown as World;

    expect(() => controller.possess(new Pawn())).not.toThrow();
  });
});

describe("Controller.unpossess", () => {
  it("clears the pawn, notifies it, and emits with a null pawn", () => {
    const log: string[] = [];
    const { world, emitted } = fakeWorld(log);
    const controller = controllerIn(world, "c");
    const pawn = new LogPawn(log, "p");
    controller.possess(pawn);
    log.length = 0;
    emitted.length = 0;

    controller.unpossess();

    expect(controller.pawn).toBeNull();
    expect(pawn.controller).toBeNull();
    expect(emitted).toEqual([{ controller, pawn: null, previous: pawn }]);
    expect(log).toEqual(["p:unpossessed", "event:unpossess:c"]);
  });

  it("leaves the released pawn in the world, alive and where it stood", () => {
    const { world } = fakeWorld([]);
    const controller = controllerIn(world, "c");
    const pawn = new Pawn();
    pawn.transform.position = { x: 1, y: 2, z: 3 };
    controller.possess(pawn);

    controller.unpossess();

    expect(pawn.alive).toBe(true);
    expect(pawn.transform.position).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("has cleared the seat by the time unpossessed runs", () => {
    const { world } = fakeWorld([]);
    const controller = controllerIn(world, "c");
    let seatedDuringNotify: Controller | null | undefined;

    class Watcher extends Pawn {
      override unpossessed(): void {
        seatedDuringNotify = this.controller;
      }
    }

    controller.possess(new Watcher());
    controller.unpossess();

    expect(seatedDuringNotify).toBeNull();
  });

  it("does nothing, and emits nothing, while holding no pawn", () => {
    const log: string[] = [];
    const { world, emitted } = fakeWorld(log);
    const controller = controllerIn(world, "c");

    expect(() => controller.unpossess()).not.toThrow();
    expect(emitted).toEqual([]);
    expect(log).toEqual([]);
  });
});

describe("PlayerController and AIController", () => {
  it("are controllers", () => {
    expect(new PlayerController()).toBeInstanceOf(Controller);
    expect(new AIController()).toBeInstanceOf(Controller);
  });

  it("possess through the same machinery", () => {
    const log: string[] = [];
    const { world, emitted } = fakeWorld(log);
    const player = new PlayerController();
    (player as { world: World }).world = world;
    const pawn = new Pawn();

    player.possess(pawn);

    expect(pawn.controller).toBe(player);
    expect(emitted).toEqual([{ controller: player, pawn, previous: null }]);
  });
});

/* -------------------------------------------------------------------------- */
/* Reading input                                                              */
/* -------------------------------------------------------------------------- */

/** A surface over a bare target, so a dispatched key event reaches the system. */
function inputSystem(): { system: InputSystem; target: EventTarget } {
  const target = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => 640,
    cssHeight: () => 360,
    dpr: () => 1,
    events: () => target,
  };
  const viewport = (): Viewport => ({
    width: 640,
    height: 360,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  });
  return { system: new InputSystem({ surface, viewport }), target };
}

/** A key event of the shape the system narrows structurally. */
function key(
  target: EventTarget,
  type: "keydown" | "keyup",
  code: string,
  repeat = false,
): void {
  target.dispatchEvent(Object.assign(new Event(type), { code, repeat }));
}

/** A player controller seated on `system`'s reader, as the game mode builds one. */
function playerOn(system: InputSystem, index: number): PlayerController {
  const controller = new PlayerController();
  Object.assign(controller, { index, input: system.createReader() });
  return controller;
}

describe("PlayerController.input", () => {
  it("reports a digital action as 0 or 1 and an unregistered name as 0", () => {
    const { system, target } = inputSystem();
    system.register("thrust", { keys: ["KeyW"] });
    const player = playerOn(system, 0);

    expect(player.input.value("thrust")).toBe(0);
    expect(player.input.value("nothing-bound-here")).toBe(0);

    key(target, "keydown", "KeyW");

    expect(player.input.value("thrust")).toBe(1);
  });

  it("gives a held key full deflection on an analog action, and a drive its magnitude", () => {
    const { system, target } = inputSystem();
    system.register("look-right", { keys: ["ArrowRight"], kind: "analog" });
    const player = playerOn(system, 0);

    key(target, "keydown", "ArrowRight");
    expect(player.input.value("look-right")).toBe(1);

    key(target, "keyup", "ArrowRight");
    system.drive("look-right", 0.5);
    expect(player.input.value("look-right")).toBeCloseTo(0.5, 9);
  });

  it("consumes an edge once per controller, and each controller keeps its own copy", () => {
    const { system, target } = inputSystem();
    system.register("confirm", { keys: ["Enter"] });
    const one = playerOn(system, 0);
    const two = playerOn(system, 1);

    key(target, "keydown", "Enter");

    // Two controllers bound to one action each see the press...
    expect(one.input.pressed("confirm")).toBe(true);
    expect(two.input.pressed("confirm")).toBe(true);
    // ...and within one controller the first read took it.
    expect(one.input.pressed("confirm")).toBe(false);
    expect(two.input.pressed("confirm")).toBe(false);
  });

  it("keeps the magnitude readable after the edge is consumed", () => {
    const { system, target } = inputSystem();
    system.register("thrust", { keys: ["KeyW"] });
    const player = playerOn(system, 0);

    key(target, "keydown", "KeyW");
    player.input.pressed("thrust");

    // The press is news for one frame; the hold is a state, and reading it
    // consumes nothing.
    expect(player.input.value("thrust")).toBe(1);
    expect(player.input.value("thrust")).toBe(1);
  });

  it("reports false for an unregistered name", () => {
    const { system } = inputSystem();

    expect(playerOn(system, 0).input.pressed("nothing-bound-here")).toBe(false);
  });

  it("discards an edge no controller consumed when the input frame closes", () => {
    const { system, target } = inputSystem();
    system.register("confirm", { keys: ["Enter"] });
    const player = playerOn(system, 0);

    key(target, "keydown", "Enter");
    system.endFrame();

    // A press is news for exactly one frame: an edge armed during a frame no
    // controller polled stays in that frame rather than surfacing later.
    expect(player.input.pressed("confirm")).toBe(false);
  });

  it("arms nothing for an auto-repeat, so a hold stays one press", () => {
    const { system, target } = inputSystem();
    system.register("confirm", { keys: ["Enter"] });
    const player = playerOn(system, 0);

    key(target, "keydown", "Enter");
    expect(player.input.pressed("confirm")).toBe(true);

    key(target, "keydown", "Enter", true);
    expect(player.input.pressed("confirm")).toBe(false);
  });

  it("arms a fresh edge for each press, and a controller that skipped one still sees only the live one", () => {
    const { system, target } = inputSystem();
    system.register("confirm", { keys: ["Enter"] });
    const player = playerOn(system, 0);

    key(target, "keydown", "Enter");
    system.endFrame();
    key(target, "keyup", "Enter");
    key(target, "keydown", "Enter");

    expect(player.input.pressed("confirm")).toBe(true);
    expect(player.input.pressed("confirm")).toBe(false);
  });

  it("gives a controller built mid-frame the edges armed since the frame opened", () => {
    const { system, target } = inputSystem();
    system.register("confirm", { keys: ["Enter"] });

    key(target, "keydown", "Enter");
    const midFrame = playerOn(system, 0);

    expect(midFrame.input.pressed("confirm")).toBe(true);
  });

  it("gives a controller built after the frame closed none of the discarded edges", () => {
    const { system, target } = inputSystem();
    system.register("confirm", { keys: ["Enter"] });

    key(target, "keydown", "Enter");
    system.endFrame();
    const nextFrame = playerOn(system, 0);

    expect(nextFrame.input.pressed("confirm")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Driving a pawn                                                             */
/* -------------------------------------------------------------------------- */

describe("driving a pawn, the way the usage page does", () => {
  const SPEED = 6;

  /** The rover from the controllers-and-pawns page, cut to its movement. */
  class Rover extends Pawn {
    private move: Vec2 = { x: 0, y: 0 };

    drive(move: Vec2): void {
      this.move = { x: clamp1(move.x), y: clamp1(move.y) };
    }

    override tick(dt: number): void {
      this.transform.position.x += this.move.x * SPEED * dt;
      this.transform.position.z -= this.move.y * SPEED * dt;
      this.move = { x: 0, y: 0 };
    }
  }

  const clamp1 = (v: number): number => Math.max(-1, Math.min(1, v));

  it("a player controller turns actions into the intent the pawn's own tick applies", () => {
    const { system, target } = inputSystem();
    system.register("move-up", { keys: ["KeyW"], kind: "analog" });
    system.register("move-down", { keys: ["KeyS"], kind: "analog" });
    system.register("move-left", { keys: ["KeyA"], kind: "analog" });
    system.register("move-right", { keys: ["KeyD"], kind: "analog" });

    class RoverController extends PlayerController {
      override tick(): void {
        const pawn = this.pawn;
        if (!(pawn instanceof Rover)) return;
        const input = this.input;
        pawn.drive({
          x: input.value("move-right") - input.value("move-left"),
          y: input.value("move-up") - input.value("move-down"),
        });
      }
    }

    const controller = new RoverController();
    Object.assign(controller, { index: 0, input: system.createReader() });
    const rover = new Rover();
    controller.possess(rover);

    key(target, "keydown", "KeyW");

    // Controllers tick before any actor, so the pawn's tick observes the intent
    // written this frame — here run by hand, in the frame's order.
    (controller as Controller).tick(1 / 60);
    rover.tick(1 / 60);

    expect(rover.transform.position.x).toBeCloseTo(0, 9);
    expect(rover.transform.position.z).toBeCloseTo(-SPEED / 60, 9);
  });

  it("cancels an axis when both of its directions are held", () => {
    const { system, target } = inputSystem();
    system.register("move-left", { keys: ["KeyA"], kind: "analog" });
    system.register("move-right", { keys: ["KeyD"], kind: "analog" });
    const player = playerOn(system, 0);

    key(target, "keydown", "KeyA");
    key(target, "keydown", "KeyD");

    expect(
      player.input.value("move-right") - player.input.value("move-left"),
    ).toBe(0);
  });

  it("carries a stick's deflection through to the pawn", () => {
    const { system } = inputSystem();
    system.register("move-up", { keys: ["KeyW"], kind: "analog" });
    const player = playerOn(system, 0);
    const rover = new Rover();
    player.possess(rover);

    system.drive("move-up", 0.5);
    rover.drive({ x: 0, y: player.input.value("move-up") });
    rover.tick(1);

    expect(rover.transform.position.z).toBeCloseTo(-SPEED / 2, 9);
  });

  it("an AI controller writes the same intent, from the world rather than from input", () => {
    class Chase extends AIController {
      override tick(): void {
        (this.pawn as Rover).drive({ x: 0, y: 1 });
      }
    }

    const controller = new Chase();
    const rover = new Rover();
    controller.possess(rover);

    (controller as Controller).tick(1);
    rover.tick(1);

    expect(rover.transform.position.z).toBeCloseTo(-SPEED, 9);
  });

  it("the intent returns to rest, so a pawn stops when its driver does", () => {
    const rover = new Rover();
    rover.drive({ x: 1, y: 0 });
    rover.tick(1);
    const afterDriven = rover.transform.position.x;

    rover.tick(1);

    expect(afterDriven).toBeCloseTo(SPEED, 9);
    expect(rover.transform.position.x).toBeCloseTo(SPEED, 9);
  });

  it("the drive clamps to the unit range", () => {
    const rover = new Rover();
    rover.drive({ x: 5, y: 0 });
    rover.tick(1);

    expect(rover.transform.position.x).toBeCloseTo(SPEED, 9);
  });

  it("a released pawn keeps ticking with whatever intent it was left holding", () => {
    const controller = new AIController();
    const rover = new Rover();
    controller.possess(rover);
    rover.drive({ x: 1, y: 0 });

    controller.unpossess();
    rover.tick(1);

    expect(rover.controller).toBeNull();
    expect(rover.transform.position.x).toBeCloseTo(SPEED, 9);
  });

  it("a controller whose pawn was taken away keeps ticking, holding null", () => {
    const holder = new AIController();
    const thief = new AIController();
    const rover = new Rover();
    holder.possess(rover);

    thief.possess(rover);

    expect(holder.pawn).toBeNull();
    expect(() => holder.tick(1 / 60)).not.toThrow();
  });
});
