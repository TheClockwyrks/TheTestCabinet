import { describe, expect, it } from "vitest";
import { Pawn } from "./actors";
import type { EngineEventMap, World } from "./contract";
import { AIController, Controller, PlayerController } from "./controllers";

type PossessionEvent = EngineEventMap["possession:changed"];

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

  it("leaves the released pawn in the world, alive", () => {
    const { world } = fakeWorld([]);
    const controller = controllerIn(world, "c");
    const pawn = new Pawn();
    controller.possess(pawn);

    controller.unpossess();

    expect(pawn.alive).toBe(true);
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

describe("driving a pawn, the way the examples do", () => {
  /** The pawn from the pawns-and-controllers example, cut to its movement. */
  class Paddle extends Pawn {
    private direction = 0;

    drive(direction: number): void {
      this.direction = Math.min(Math.max(direction, -1), 1);
    }

    override tick(dt: number): void {
      this.transform.y += this.direction * 320 * dt;
      this.direction = 0;
    }
  }

  it("a scripted controller writes intent the pawn's own tick applies", () => {
    class HoldUp extends AIController {
      override tick(): void {
        (this.pawn as Paddle).drive(-1);
      }
    }

    const controller = new HoldUp();
    const paddle = new Paddle();
    paddle.transform.y = 180;
    controller.possess(paddle);

    // Controllers tick before any actor, so the pawn's tick observes the
    // intent written this frame — here run by hand, the frame's order. The
    // engine calls through the base signature, dt and all, which is why the
    // example's parameterless override is fine.
    (controller as Controller).tick(1 / 60);
    paddle.tick(1 / 60);

    expect(paddle.transform.y).toBeCloseTo(180 - 320 / 60, 9);
  });

  it("the intent returns to rest, so a pawn stops when its driver does", () => {
    const paddle = new Paddle();
    paddle.drive(1);
    paddle.tick(0.1);
    const afterDriven = paddle.transform.y;

    paddle.tick(0.1);

    expect(afterDriven).toBeCloseTo(32, 9);
    expect(paddle.transform.y).toBeCloseTo(32, 9);
  });

  it("the drive clamps to the unit range", () => {
    const paddle = new Paddle();
    paddle.drive(5);
    paddle.tick(0.1);

    expect(paddle.transform.y).toBeCloseTo(32, 9);
  });

  it("a released pawn keeps ticking with whatever intent it was left holding", () => {
    const controller = new AIController();
    const paddle = new Paddle();
    controller.possess(paddle);
    paddle.drive(1);

    controller.unpossess();
    paddle.tick(0.1);

    expect(paddle.controller).toBeNull();
    expect(paddle.transform.y).toBeCloseTo(32, 9);
  });
});
