import { describe, expect, it } from "vitest";
import { Pawn, type ActorClass } from "./actors";
import { AIController, PlayerController, type Controller } from "./controllers";
import {
  GameMode,
  GameState,
  PlayerState,
  bindGameMode,
  type GameModeHost,
} from "./game-mode";
import type { InputReader } from "./input";
import type { Transform } from "./math";
import type { EngineEventMap, SpawnSpec, World } from "./worlds";

/**
 * The mode, the state, and the player states over fakes. The suite binds
 * modes to a fake world and host through `bindGameMode` — the same seam the
 * world uses — so every rule here is asserted with no engine behind it; the
 * world-driven half (construction order, `pawnDied` timing, elapsed accrual)
 * belongs to the worlds suite next door.
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

/** The identity transform the base `spawnPoint` promises, fresh per use. */
function identity(): Transform {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

/** A pawn class of this suite's own; the real `destroy` mark works bare. */
class TestPawn extends Pawn {}

/** Another pawn class, for telling override paths apart by identity. */
class OtherPawn extends TestPawn {}

/**
 * A player controller that records what it possessed while running the real
 * possession machinery — the fake world has no broadcaster, and the
 * possession code tolerates exactly that.
 */
class RecordingController extends PlayerController {
  readonly possessions: Pawn[] = [];

  override possess(pawn: Pawn): void {
    super.possess(pawn);
    this.possessions.push(pawn);
  }
}

/** The AI twin of {@link RecordingController}. */
class RecordingBot extends AIController {
  readonly possessions: Pawn[] = [];

  override possess(pawn: Pawn): void {
    super.possess(pawn);
    this.possessions.push(pawn);
  }
}

/** What one `world.spawn` call carried, as the fake world recorded it. */
interface SpawnCall {
  type: ActorClass;
  spec: SpawnSpec | undefined;
  actor: TestPawn;
}

/**
 * A mode bound to a fake world and host, with everything the binding touched
 * handed back for assertions. The fake world implements only what the mode's
 * own machinery reaches — `spawn`, for pawns — which is the whole point of
 * the `GameModeHost` seam: the mode is testable with no engine behind it.
 */
function bound<M extends GameMode>(type: new () => M) {
  const mode = new type();
  const state = new mode.gameStateClass();
  const emitted: Emitted[] = [];
  const readers: InputReader[] = [];
  const added: Controller[] = [];
  const spawns: SpawnCall[] = [];
  const world = {
    spawn: (type: ActorClass, spec?: SpawnSpec) => {
      const actor = new type() as TestPawn;
      if (spec?.transform !== undefined) {
        Object.assign(actor.transform, spec.transform);
      }
      spawns.push({ type, spec, actor });
      return actor;
    },
  } as unknown as World;
  const host: GameModeHost = {
    emit: (event, payload) => {
      emitted.push({ event, payload });
    },
    addController: (controller) => {
      added.push(controller);
      controller.beginPlay();
    },
    createInputReader: () => {
      const reader = makeReader();
      readers.push(reader);
      return reader;
    },
  };
  bindGameMode(mode, world, {}, state, host);
  return { mode, state, world, emitted, readers, added, spawns };
}

describe("GameMode defaults", () => {
  it("carries the documented class-field defaults", () => {
    const mode = new GameMode();
    expect(mode.gameStateClass).toBe(GameState);
    expect(mode.playerStateClass).toBe(PlayerState);
    expect(mode.playerControllerClass).toBe(PlayerController);
    expect(mode.pawnClass).toBeNull();
  });

  it("holds the waiting phase before anything moves it, even unbound", () => {
    expect(new GameMode().phase).toBe("waiting");
  });

  it("has do-nothing beginPlay, tick, endPlay, and pawnDied", () => {
    const mode = new GameMode();
    expect(() => {
      mode.beginPlay();
      mode.tick(1 / 60);
      mode.endPlay("level-closed");
      mode.pawnDied(new RecordingController(), new TestPawn());
    }).not.toThrow();
  });
});

describe("bindGameMode", () => {
  it("assigns world, options, and state before beginPlay would run", () => {
    const { mode, state, world } = bound(GameMode);
    expect(mode.world).toBe(world);
    expect(mode.state).toBe(state);
    expect(mode.options).toEqual({});
    expect(state.world).toBe(world);
  });

  it("hands the mode the options the transition supplied", () => {
    const mode = new GameMode();
    const state = new GameState();
    const options = { round: 2 };
    bindGameMode(mode, {} as World, options, state, {
      emit: () => {},
      addController: () => {},
      createInputReader: makeReader,
    });
    expect(mode.options).toBe(options);
  });

  it("refuses the participant and phase machinery on an unbound mode", () => {
    const mode = new GameMode();
    expect(() => mode.addPlayer()).toThrow(/not bound to a world/);
    expect(() => mode.addBot(AIController)).toThrow(/not bound to a world/);
    expect(() => mode.setPhase("playing")).toThrow(/not bound to a world/);
  });
});

describe("setPhase", () => {
  it("sets the phase, writes it onto the state, and emits match:phase", () => {
    const { mode, state, emitted } = bound(GameMode);
    mode.setPhase("playing");
    expect(mode.phase).toBe("playing");
    expect(state.phase).toBe("playing");
    expect(emitted).toEqual([
      {
        event: "match:phase",
        payload: { phase: "playing", previous: "waiting" },
      },
    ]);
  });

  it("carries the previous phase through a full waiting-playing-over run", () => {
    const { mode, emitted } = bound(GameMode);
    mode.setPhase("playing");
    mode.setPhase("over");
    expect(emitted.map((entry) => entry.payload)).toEqual([
      { phase: "playing", previous: "waiting" },
      { phase: "over", previous: "playing" },
    ]);
  });

  it("emits nothing for the phase the mode already holds", () => {
    const { mode, emitted } = bound(GameMode);
    mode.setPhase("waiting");
    expect(mode.phase).toBe("waiting");
    expect(emitted).toEqual([]);
  });

  it("keeps mode.phase and state.phase one value, not two kept in step", () => {
    // The docs promise the two always agree; the getter makes that
    // structural, so even a direct state write cannot split them.
    const { mode, state } = bound(GameMode);
    state.phase = "over";
    expect(mode.phase).toBe("over");
  });
});

describe("addPlayer", () => {
  it("builds the state and the controller, wired both ways, on index 0", () => {
    const { mode, state, added } = bound(GameMode);
    const controller = mode.addPlayer();
    expect(controller).toBeInstanceOf(PlayerController);
    expect(controller.index).toBe(0);
    expect(controller.playerState.index).toBe(0);
    expect(controller.playerState.controller).toBe(controller);
    expect(controller.world).toBe(mode.world);
    expect(state.players).toEqual([controller.playerState]);
    expect(added).toEqual([controller]);
  });

  it("assigns the next free index, filling the lowest gap", () => {
    const { mode } = bound(GameMode);
    expect(mode.addPlayer().index).toBe(0);
    expect(mode.addPlayer().index).toBe(1);
    expect(mode.addPlayer({ index: 5 }).index).toBe(5);
    expect(mode.addPlayer().index).toBe(2);
  });

  it("writes the name only when the options carry one", () => {
    const { mode } = bound(GameMode);
    expect(mode.addPlayer({ name: "Left" }).playerState.name).toBe("Left");
    expect(mode.addPlayer().playerState.name).toBe("");
  });

  it("keeps state.players in index order whatever the addition order", () => {
    const { mode, state } = bound(GameMode);
    mode.addPlayer({ index: 1, name: "Right" });
    mode.addPlayer({ index: 0, name: "Left" });
    expect(state.players.map((player) => player.name)).toEqual([
      "Left",
      "Right",
    ]);
  });

  it("builds playerStateClass, read on each call", () => {
    class Lives extends PlayerState {
      lives = 3;
    }

    const { mode } = bound(GameMode);
    const first = mode.addPlayer().playerState;
    mode.playerStateClass = Lives;
    const second = mode.addPlayer().playerState;
    expect(first).not.toBeInstanceOf(Lives);
    expect(second).toBeInstanceOf(Lives);
    expect((second as Lives).lives).toBe(3);
  });

  it("builds playerControllerClass unless the options name a controller", () => {
    class LeftPaddle extends RecordingController {}

    const { mode } = bound(GameMode);
    mode.playerControllerClass = RecordingController;
    expect(mode.addPlayer()).toBeInstanceOf(RecordingController);
    expect(mode.addPlayer({ controller: LeftPaddle })).toBeInstanceOf(
      LeftPaddle,
    );
  });

  it("hands each player controller its own input reader", () => {
    const { mode, readers } = bound(GameMode);
    const first = mode.addPlayer();
    const second = mode.addPlayer();
    expect(readers).toHaveLength(2);
    expect(first.input).toBe(readers[0]);
    expect(second.input).toBe(readers[1]);
    expect(first.input).not.toBe(second.input);
  });

  it("has every field in place before the controller's beginPlay", () => {
    const seen: unknown[] = [];

    class Probing extends PlayerController {
      override beginPlay(): void {
        seen.push(this.world, this.playerState, this.index, this.input);
      }
    }

    const { mode, world, readers } = bound(GameMode);
    const controller = mode.addPlayer({ controller: Probing });
    expect(seen).toEqual([world, controller.playerState, 0, readers[0]]);
  });

  it("spawns pawnClass at the identity spawnPoint and possesses it", () => {
    const { mode, spawns } = bound(GameMode);
    mode.playerControllerClass = RecordingController;
    mode.pawnClass = TestPawn;
    const controller = mode.addPlayer() as RecordingController;
    expect(spawns).toHaveLength(1);
    expect(spawns[0]?.type).toBe(TestPawn);
    expect(spawns[0]?.spec?.transform).toEqual(identity());
    expect(controller.possessions).toEqual([spawns[0]?.actor]);
    expect(controller.pawn).toBe(spawns[0]?.actor);
  });

  it("lets the options substitute a pawn class, or none at all", () => {
    const { mode, spawns } = bound(GameMode);
    mode.playerControllerClass = RecordingController;
    mode.pawnClass = TestPawn;
    mode.addPlayer({ pawn: OtherPawn });
    expect(spawns[0]?.type).toBe(OtherPawn);
    mode.addPlayer({ pawn: null });
    expect(spawns).toHaveLength(1);
  });

  it("possesses nothing when pawnClass is null", () => {
    const { mode, spawns } = bound(GameMode);
    const controller = mode.addPlayer();
    expect(spawns).toEqual([]);
    expect(controller.pawn).toBeNull();
  });
});

describe("addBot", () => {
  it("builds the named class with the next free index, beside the players", () => {
    const { mode, state, added } = bound(GameMode);
    const player = mode.addPlayer({ name: "Left" });
    const bot = mode.addBot(RecordingBot, { name: "Right" });
    expect(bot).toBeInstanceOf(RecordingBot);
    expect(bot.playerState.index).toBe(1);
    expect(bot.playerState.name).toBe("Right");
    expect(bot.playerState.controller).toBe(bot);
    expect(bot.world).toBe(mode.world);
    expect(state.players).toEqual([player.playerState, bot.playerState]);
    expect(added).toEqual([player, bot]);
  });

  it("takes no input reader — input reaches the game through players alone", () => {
    const { mode, readers } = bound(GameMode);
    const bot = mode.addBot(RecordingBot);
    expect(readers).toHaveLength(0);
    expect("input" in bot).toBe(false);
  });

  it("spawns and possesses a pawn exactly as addPlayer does", () => {
    const { mode, spawns } = bound(GameMode);
    mode.pawnClass = TestPawn;
    const bot = mode.addBot(RecordingBot) as RecordingBot;
    expect(spawns[0]?.type).toBe(TestPawn);
    expect(bot.pawn).toBe(spawns[0]?.actor);
    mode.addBot(RecordingBot, { pawn: null });
    expect(spawns).toHaveLength(1);
  });
});

describe("restart", () => {
  it("returns null, touching nothing, when pawnClass is null", () => {
    const { mode, spawns } = bound(GameMode);
    mode.playerControllerClass = RecordingController;
    const controller = mode.addPlayer();
    expect(mode.restart(controller)).toBeNull();
    expect(spawns).toEqual([]);
  });

  it("destroys the current pawn, spawns at spawnPoint, and possesses", () => {
    const { mode, spawns } = bound(GameMode);
    mode.playerControllerClass = RecordingController;
    mode.pawnClass = TestPawn;
    const controller = mode.addPlayer() as RecordingController;
    const first = controller.pawn as TestPawn;
    const second = mode.restart(controller) as TestPawn;
    // The real `destroy` marks at once: `alive` is false from the call.
    expect(first.alive).toBe(false);
    expect(second).not.toBe(first);
    expect(controller.pawn).toBe(second);
    expect(spawns[1]?.spec?.transform).toEqual(identity());
  });

  it("copes with a controller that has no pawn yet", () => {
    const { mode } = bound(GameMode);
    mode.playerControllerClass = RecordingController;
    mode.pawnClass = TestPawn;
    const controller = mode.addPlayer({ pawn: null });
    const pawn = mode.restart(controller);
    expect(pawn).toBeInstanceOf(TestPawn);
    expect(controller.pawn).toBe(pawn);
  });

  it("spawns pawnClass even for a participant added with a substitute", () => {
    const { mode, spawns } = bound(GameMode);
    mode.playerControllerClass = RecordingController;
    mode.pawnClass = TestPawn;
    const controller = mode.addPlayer({ pawn: OtherPawn });
    mode.restart(controller);
    // `restart` reads `pawnClass`; the per-participant override was a
    // property of the addition, not of the controller.
    expect(spawns[1]?.type).toBe(TestPawn);
  });

  it("places the pawn where an overridden spawnPoint says", () => {
    class SidedMode extends GameMode {
      override playerControllerClass = RecordingController;
      override pawnClass: ActorClass<Pawn> | null = TestPawn;

      override spawnPoint(controller: Controller): Transform {
        const left = controller.playerState.index === 0;
        return {
          position: { x: left ? -5 : 5, y: 0, z: 0 },
          rotation: {
            x: 0,
            y: left ? -Math.SQRT1_2 : Math.SQRT1_2,
            z: 0,
            w: Math.SQRT1_2,
          },
          scale: { x: 1, y: 1, z: 1 },
        };
      }
    }

    const { mode, spawns } = bound(SidedMode);
    mode.addPlayer({ index: 1 });
    expect(spawns[0]?.spec?.transform).toMatchObject({
      position: { x: 5, y: 0, z: 0 },
    });
  });
});

describe("spawnPoint", () => {
  it("returns the identity transform by default, fresh per call", () => {
    const { mode } = bound(GameMode);
    mode.playerControllerClass = RecordingController;
    const controller = mode.addPlayer();
    const point = mode.spawnPoint(controller);
    expect(point).toEqual(identity());
    // A fresh value each time: a mode that mutates one placement must not
    // move the next respawn with it.
    expect(mode.spawnPoint(controller)).not.toBe(point);
    expect(mode.spawnPoint(controller).position).not.toBe(point.position);
  });
});

describe("GameState and PlayerState", () => {
  it("carry the documented defaults", () => {
    const state = new GameState();
    expect(state.players).toEqual([]);
    expect(state.phase).toBe("waiting");
    expect(state.elapsed).toBe(0);

    const playerState = new PlayerState();
    expect(playerState.name).toBe("");
    expect(playerState.score).toBe(0);
  });

  it("keeps each state's player list its own", () => {
    // The list is an instance field: two matches never share participants.
    const { mode } = bound(GameMode);
    mode.addPlayer();
    expect(new GameState().players).toEqual([]);
  });

  it("supports the documented subclassing idiom", () => {
    class RallyPlayerState extends PlayerState {
      aces = 0;
    }

    class RallyState extends GameState {
      declare readonly players: readonly RallyPlayerState[];
      rallies = 0;
    }

    class RallyMode extends GameMode {
      declare readonly state: RallyState;
      override gameStateClass = RallyState;
      override playerStateClass = RallyPlayerState;
      override playerControllerClass = RecordingController;

      override beginPlay(): void {
        this.addPlayer({ index: 0, name: "left" });
        this.addPlayer({ index: 1, name: "right" });
        this.setPhase("playing");
      }
    }

    const { mode, state, emitted } = bound(RallyMode);
    expect(state).toBeInstanceOf(RallyState);
    mode.beginPlay();
    expect(mode.state.rallies).toBe(0);
    expect(state.players.map((player) => player.name)).toEqual([
      "left",
      "right",
    ]);
    expect(state.players[0]).toBeInstanceOf(RallyPlayerState);
    expect(emitted).toEqual([
      {
        event: "match:phase",
        payload: { phase: "playing", previous: "waiting" },
      },
    ]);
  });
});
