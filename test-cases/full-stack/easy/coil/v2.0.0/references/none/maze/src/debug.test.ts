import { beforeEach, describe, expect, it } from "vitest";
import {
  COIL_DEBUG_VERSION,
  COMBO_MAX,
  COMBO_WINDOW,
  START_CELLS,
  TICK_SECONDS,
  type Cue,
} from "./constants";
import { createDebugApi, type CoilDebugApi, type DebugClock } from "./debug";
import { Game, type AudioBus } from "./game";
import { HAS_OBSTACLES, MODE, OBSTACLE_CELLS } from "./mode";

class SilentBus implements AudioBus {
  muted = false;
  play(_cue: Cue): void {}
  startLoop(_cue: Cue): void {}
  stopLoop(_cue: Cue): void {}
  toggleMute(): void {
    this.muted = !this.muted;
  }
}

/** A clock that drives the game's own update, as the frame loop does. */
class TestClock implements DebugClock {
  autoStep = true;
  constructor(private readonly game: Game) {}
  advance(seconds: number, frames: number): void {
    for (let i = 0; i < frames; i++) this.game.update(seconds / frames);
  }
}

let game: Game;
let debug: CoilDebugApi;

beforeEach(() => {
  game = new Game(new SilentBus());
  debug = createDebugApi(game, new TestClock(game));
});

describe("the snapshot", () => {
  it("reports every field specs/instrumentation.md fixes", () => {
    expect(Object.keys(debug.snapshot()).sort()).toEqual(
      [
        "autoStep",
        "best",
        "combo",
        "comboWindow",
        "dir",
        "menuIndex",
        "mode",
        "muted",
        "obstacles",
        "pellet",
        "pelletRespawn",
        "score",
        "screen",
        "simTime",
        "snake",
        "steering",
        "ticks",
        "travel",
        "turns",
        "version",
      ].sort(),
    );
  });

  it("carries the surface's version and the build's mode", () => {
    expect(debug.version).toBe(COIL_DEBUG_VERSION);
    expect(debug.snapshot().version).toBe(COIL_DEBUG_VERSION);
    expect(debug.snapshot().mode).toBe(MODE);
  });

  it("reads the live values off the game", () => {
    debug.setScreen("playing");
    debug.setScore(120);
    debug.setBest(300);
    debug.setCombo(3);
    debug.setComboWindow(2);
    debug.setDirection("up");
    const snapshot = debug.snapshot();
    expect(snapshot.screen).toBe("playing");
    expect(snapshot.score).toBe(120);
    expect(snapshot.best).toBe(300);
    expect(snapshot.combo).toBe(3);
    expect(snapshot.comboWindow).toBe(2);
    expect(snapshot.dir).toBe("up");
  });

  it("copies the board rather than handing the live arrays out", () => {
    const snapshot = debug.snapshot();
    snapshot.snake[0]!.col = -1;
    expect(debug.snapshot().snake[0]!.col).toBe(START_CELLS[0]!.col);
  });
});

describe("reset", () => {
  it("restores the opening values and re-arms manual stepping", () => {
    debug.setScreen("playing");
    debug.setScore(500);
    debug.setBest(900);
    debug.setSnakeTravel(false);
    debug.reset();
    const snapshot = debug.snapshot();
    expect(snapshot.screen).toBe("title");
    expect(snapshot.menuIndex).toBe(0);
    expect(snapshot.score).toBe(0);
    expect(snapshot.best).toBe(0);
    expect(snapshot.combo).toBe(1);
    expect(snapshot.comboWindow).toBe(0);
    expect(snapshot.ticks).toBe(0);
    expect(snapshot.simTime).toBe(0);
    expect(snapshot.snake).toEqual(START_CELLS.map((cell) => ({ ...cell })));
    expect(snapshot.dir).toBe("right");
    expect(snapshot.turns).toEqual([]);
    expect(snapshot.pellet).toBeNull();
    expect(snapshot.steering).toBe(true);
    expect(snapshot.travel).toBe(true);
    expect(snapshot.pelletRespawn).toBe(true);
    expect(snapshot.autoStep).toBe(false);
  });

  it("lays the mode's own obstacle course again", () => {
    debug.reset();
    expect(debug.snapshot().obstacles).toEqual(
      OBSTACLE_CELLS.map((cell) => ({ ...cell })),
    );
  });

  it("draws the same pellet sequence from the same seed", () => {
    const run = (): string[] => {
      debug.reset({ seed: 5 });
      debug.setScreen("playing");
      const cells: string[] = [];
      for (let i = 0; i < 4; i++) {
        const pellet = debug.snapshot().pellet;
        if (pellet) cells.push(`${pellet.col},${pellet.row}`);
        debug.advance(TICK_SECONDS);
      }
      return cells;
    };
    const first = run();
    game = new Game(new SilentBus());
    debug = createDebugApi(game, new TestClock(game));
    expect(run()).toEqual(first);
  });
});

describe("the clock", () => {
  it("takes the game off the wall clock and gives it back", () => {
    debug.setAutoStep(false);
    expect(debug.snapshot().autoStep).toBe(false);
    debug.setAutoStep(true);
    expect(debug.snapshot().autoStep).toBe(true);
  });

  it("runs a second of game time as one frame or as sixty alike", () => {
    debug.reset();
    debug.setScreen("playing");
    debug.clearPellet();
    debug.advance(1, 1);
    const once = debug.snapshot();
    debug.reset();
    debug.setScreen("playing");
    debug.clearPellet();
    debug.advance(1, 60);
    const divided = debug.snapshot();
    expect(divided.ticks).toBe(once.ticks);
    expect(divided.snake).toEqual(once.snake);
  });
});

describe("posing the board", () => {
  beforeEach(() => {
    debug.reset();
    debug.setScreen("playing");
  });

  it("sets the chain alone", () => {
    debug.setDirection("up");
    debug.setSnake([
      { col: 10, row: 8 },
      { col: 10, row: 9 },
    ]);
    const snapshot = debug.snapshot();
    expect(snapshot.snake).toEqual([
      { col: 10, row: 8 },
      { col: 10, row: 9 },
    ]);
    expect(snapshot.dir).toBe("up");
  });

  it("places and removes the pellet outright", () => {
    debug.setPellet(25, 15);
    expect(debug.snapshot().pellet).toEqual({ col: 25, row: 15 });
    debug.clearPellet();
    expect(debug.snapshot().pellet).toBeNull();
  });

  it("empties the turn buffer, turning nothing", () => {
    debug.setDirection("right");
    game.sim.requestTurn("up");
    expect(debug.snapshot().turns).toEqual(["up"]);
    debug.clearTurns();
    expect(debug.snapshot().turns).toEqual([]);
    debug.advance(TICK_SECONDS);
    expect(debug.snapshot().dir).toBe("right");
  });

  it("holds one faculty still while the other runs", () => {
    debug.clearPellet();
    debug.setSnakeSteering(false);
    game.sim.requestTurn("up");
    debug.advance(TICK_SECONDS);
    expect(debug.snapshot().turns).toEqual([]);
    expect(debug.snapshot().dir).toBe("right");

    debug.setSnakeSteering(true);
    debug.setSnakeTravel(false);
    const before = debug.snapshot().snake;
    game.sim.requestTurn("up");
    debug.advance(TICK_SECONDS * 4);
    expect(debug.snapshot().snake).toEqual(before);
    expect(debug.snapshot().dir).toBe("up");
  });

  it("leaves an eaten pellet unreplaced with respawn off", () => {
    debug.setSnake([
      { col: 10, row: 8 },
      { col: 9, row: 8 },
    ]);
    debug.setDirection("right");
    debug.setPellet(11, 8);
    debug.setPelletRespawn(false);
    debug.advance(TICK_SECONDS);
    expect(debug.snapshot().pellet).toBeNull();
    expect(debug.snapshot().screen).toBe("playing");
  });

  it("moves the highlight without accepting anything", () => {
    debug.setScreen("title");
    debug.setMenuIndex(1);
    expect(debug.snapshot().menuIndex).toBe(1);
    expect(debug.snapshot().screen).toBe("title");
  });
});

describe("invalid arguments", () => {
  beforeEach(() => {
    debug.reset();
    debug.setScreen("playing");
  });

  it("rejects a screen no build has", () => {
    expect(() => debug.setScreen("nowhere" as never)).toThrow();
  });

  it("rejects a menu index the current screen does not hold", () => {
    expect(() => debug.setMenuIndex(1)).toThrow();
    debug.setScreen("title");
    expect(() => debug.setMenuIndex(2)).toThrow();
    expect(() => debug.setMenuIndex(-1)).toThrow();
  });

  it("rejects a score or a best below zero", () => {
    expect(() => debug.setScore(-1)).toThrow();
    expect(() => debug.setBest(-1)).toThrow();
    expect(() => debug.setScore(1.5)).toThrow();
  });

  it("rejects a multiplier outside [1, COMBO_MAX]", () => {
    expect(() => debug.setCombo(0)).toThrow();
    expect(() => debug.setCombo(COMBO_MAX + 1)).toThrow();
  });

  it("rejects a window outside [0, COMBO_WINDOW]", () => {
    expect(() => debug.setComboWindow(-0.1)).toThrow();
    expect(() => debug.setComboWindow(COMBO_WINDOW + 0.1)).toThrow();
  });

  it("rejects a direction that is not one of the four", () => {
    expect(() => debug.setDirection("sideways" as never)).toThrow();
  });

  it("rejects a chain that is empty, broken, repeated, or off the interior", () => {
    expect(() => debug.setSnake([])).toThrow();
    expect(() =>
      debug.setSnake([
        { col: 5, row: 5 },
        { col: 8, row: 5 },
      ]),
    ).toThrow();
    expect(() =>
      debug.setSnake([
        { col: 5, row: 5 },
        { col: 5, row: 5 },
      ]),
    ).toThrow();
    expect(() => debug.setSnake([{ col: 0, row: 5 }])).toThrow();
  });

  it("rejects a pellet on a wall cell or under the chain", () => {
    expect(() => debug.setPellet(0, 5)).toThrow();
    const head = debug.snapshot().snake[0]!;
    expect(() => debug.setPellet(head.col, head.row)).toThrow();
  });

  it("rejects an advance of negative time or of no frames", () => {
    expect(() => debug.advance(-1)).toThrow();
    expect(() => debug.advance(1, 0)).toThrow();
    expect(() => debug.advance(1, 1.5)).toThrow();
  });

  it("rejects a switch that is not a boolean", () => {
    expect(() => debug.setSnakeTravel("yes" as never)).toThrow();
    expect(() => debug.setAutoStep(1 as never)).toThrow();
  });
});

describe("the obstacle operations", () => {
  it("are laid only by a mode that places obstacle cells", () => {
    expect(typeof debug.clearObstacles).toBe(
      HAS_OBSTACLES ? "function" : "undefined",
    );
    expect(typeof debug.addObstacle).toBe(
      HAS_OBSTACLES ? "function" : "undefined",
    );
  });

  it("clear the course and add a cell back", () => {
    if (!debug.clearObstacles || !debug.addObstacle) return;
    debug.reset();
    debug.clearObstacles();
    expect(debug.snapshot().obstacles).toEqual([]);
    debug.addObstacle(20, 5);
    debug.addObstacle(20, 5);
    expect(debug.snapshot().obstacles).toEqual([{ col: 20, row: 5 }]);
  });

  it("reject a cell under the chain or off the interior", () => {
    if (!debug.addObstacle) return;
    debug.reset();
    const head = debug.snapshot().snake[0]!;
    expect(() => debug.addObstacle!(head.col, head.row)).toThrow();
    expect(() => debug.addObstacle!(0, 0)).toThrow();
  });
});
