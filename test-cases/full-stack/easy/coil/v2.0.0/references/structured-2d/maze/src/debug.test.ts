// The debug surface, reached the one way a caller reaches it: as `engine.debug`,
// over a real engine. Every pose acts on the live world at the call and returns
// nothing, and every claim is read back through the surface's own `snapshot`.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  COIL_DEBUG_VERSION,
  COMBO_MAX,
  COMBO_WINDOW,
  MODE,
  OBSTACLE_CELLS,
  SCREENS,
  START_CELLS,
  TICK_SECONDS,
  type Cell,
} from "./constants";
import { startRound } from "./flow";
import { createHarness, type Harness } from "./harness";
import { HAS_OBSTACLES } from "./mode";
import { spawnPellet, tick } from "./sim";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** A chain of `length` cells laid to the left from `(col, row)`. */
function chain(col: number, row: number, length: number): Cell[] {
  return Array.from({ length }, (_, i) => ({ col: col - i, row }));
}

/** A round begun the way the title's mode entry begins one. */
function round(): void {
  startRound(h.state);
}

describe("the snapshot", () => {
  it("reports every field specs/instrumentation.md fixes", () => {
    expect(Object.keys(h.debug.snapshot()).sort()).toEqual(
      [
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
        "titleIndex",
        "travel",
        "turns",
        "version",
      ].sort(),
    );
  });

  it("carries the surface's version and the build's mode", () => {
    expect(h.debug.version).toBe(COIL_DEBUG_VERSION);
    expect(h.debug.snapshot().version).toBe(COIL_DEBUG_VERSION);
    expect(h.debug.snapshot().mode).toBe(MODE);
  });

  it("reads the live values off the state", () => {
    round();
    h.debug.setScore(120);
    h.debug.setBest(300);
    h.debug.setCombo(3);
    h.debug.setComboWindow(2);
    h.debug.setDirection("down");
    const shot = h.debug.snapshot();
    expect(shot.screen).toBe("playing");
    expect(shot.score).toBe(120);
    expect(shot.best).toBe(300);
    expect(shot.combo).toBe(3);
    expect(shot.comboWindow).toBe(2);
    expect(shot.dir).toBe("down");
    expect(shot.snake.length).toBe(START_CELLS.length);
  });

  it("copies the board rather than handing the state's own arrays out", () => {
    round();
    const shot = h.debug.snapshot();
    shot.snake.push({ col: -1, row: -1 });
    shot.turns.push("up");
    shot.obstacles.length = 0;
    expect(h.state.snake.length).toBe(START_CELLS.length);
    expect(h.state.turns).toEqual([]);
    expect(h.state.obstacles.length).toBe(OBSTACLE_CELLS.length);
    // Each cell is a copy, so nothing a caller does to one reaches the state.
    expect(h.debug.snapshot().snake[0]).not.toBe(h.state.snake[0]);
  });

  it("leaves the state it read exactly as it was", () => {
    round();
    const before = JSON.stringify(h.debug.snapshot());
    h.debug.snapshot();
    expect(JSON.stringify(h.debug.snapshot())).toBe(before);
  });
});

describe("reset", () => {
  it("restores every field the snapshot reports", () => {
    round();
    h.debug.setScore(500);
    h.debug.setBest(900);
    h.debug.setCombo(4);
    h.debug.setComboWindow(3);
    h.debug.setSnakeTravel(false);
    h.debug.setPelletRespawn(false);
    tick(h.state);

    h.debug.reset();
    const shot = h.debug.snapshot();
    expect(shot.screen).toBe("title");
    expect(shot.menuIndex).toBe(0);
    expect(shot.score).toBe(0);
    expect(shot.best).toBe(0);
    expect(shot.combo).toBe(1);
    expect(shot.comboWindow).toBe(0);
    expect(shot.ticks).toBe(0);
    expect(shot.simTime).toBe(0);
    expect(shot.snake).toEqual(START_CELLS.map((cell) => ({ ...cell })));
    expect(shot.dir).toBe("right");
    expect(shot.turns).toEqual([]);
    expect(shot.pellet).toBeNull();
    expect(shot.steering && shot.travel && shot.pelletRespawn).toBe(true);
  });

  it("lays the mode's own obstacle course again", () => {
    if (HAS_OBSTACLES) h.debug.clearObstacles!();
    h.debug.reset();
    expect(h.debug.snapshot().obstacles).toEqual(
      OBSTACLE_CELLS.map((cell) => ({ ...cell })),
    );
  });

  it("leaves the mute bit as it stands", () => {
    h.state.muted = true;
    h.debug.reset();
    expect(h.debug.snapshot().muted).toBe(true);
  });

  it("draws the same pellet sequence from the same seed", () => {
    const sequence = (seed: number): string[] => {
      h.debug.reset({ seed });
      round();
      const cells: string[] = [];
      for (let i = 0; i < 6; i++) {
        cells.push(`${h.state.pellet!.col},${h.state.pellet!.row}`);
        spawnPellet(h.state);
      }
      return cells;
    };
    expect(sequence(11)).toEqual(sequence(11));
    expect(sequence(11)).not.toEqual(sequence(12));
  });
});

describe("the poses", () => {
  it("sets the chain alone", () => {
    round();
    h.debug.setDirection("up");
    const before = h.debug.snapshot();
    h.debug.setSnake(chain(10, 8, 4));
    const after = h.debug.snapshot();
    expect(after.snake).toEqual(chain(10, 8, 4));
    expect(after.dir).toBe(before.dir);
    expect(after.pellet).toEqual(before.pellet);
    expect(after.score).toBe(before.score);
  });

  it("places and removes the pellet outright", () => {
    round();
    h.debug.setSnake(chain(10, 8, 3));
    h.debug.setPellet(20, 4);
    expect(h.debug.snapshot().pellet).toEqual({ col: 20, row: 4 });
    h.debug.clearPellet();
    expect(h.debug.snapshot().pellet).toBeNull();
  });

  it("places a pellet without drawing from the generator", () => {
    round();
    const before = h.state.rngState;
    h.debug.setPellet(20, 4);
    expect(h.state.rngState).toBe(before);
  });

  it("empties the turn buffer, turning nothing", () => {
    round();
    h.state.turns = ["up", "down"];
    h.debug.clearTurns();
    expect(h.debug.snapshot().turns).toEqual([]);
    expect(h.debug.snapshot().dir).toBe("right");
  });

  it("holds one faculty still while the other runs", () => {
    round();
    h.debug.setSnake(chain(10, 8, 3));
    h.debug.setSnakeTravel(false);
    h.debug.clearPellet();
    const before = h.debug.snapshot();
    tick(h.state);
    const after = h.debug.snapshot();
    expect(after.snake).toEqual(before.snake);
    expect(after.ticks).toBe(before.ticks + 1);
    expect(after.steering).toBe(true);
  });

  it("drains the combo window while the snake is held still", () => {
    round();
    h.debug.setSnakeTravel(false);
    h.debug.setCombo(4);
    h.debug.setComboWindow(COMBO_WINDOW);
    tick(h.state);
    expect(h.debug.snapshot().comboWindow).toBeCloseTo(
      COMBO_WINDOW - TICK_SECONDS,
      9,
    );
  });

  it("moves the highlight without accepting anything", () => {
    h.debug.setMenuIndex(1);
    expect(h.debug.snapshot().menuIndex).toBe(1);
    expect(h.debug.snapshot().screen).toBe("title");
  });

  it("sets the screen without laying out a round", () => {
    h.debug.setSnake(chain(10, 8, 3));
    h.debug.setMenuIndex(1);
    h.debug.setScreen("playing");
    const shot = h.debug.snapshot();
    expect(shot.screen).toBe("playing");
    expect(shot.snake).toEqual(chain(10, 8, 3));
    expect(shot.pellet).toBeNull();
  });
});

describe("an argument outside its domain", () => {
  it("rejects a screen no build has", () => {
    expect(() =>
      h.debug.setScreen("nowhere" as (typeof SCREENS)[number]),
    ).toThrow(/setScreen/);
  });

  it("rejects a menu index the current screen does not hold", () => {
    expect(() => h.debug.setMenuIndex(9)).toThrow(/menu item/);
    h.debug.setScreen("playing");
    expect(() => h.debug.setMenuIndex(1)).toThrow(/menu item/);
  });

  it("rejects a score or a best below zero", () => {
    expect(() => h.debug.setScore(-1)).toThrow(/setScore/);
    expect(() => h.debug.setBest(-1)).toThrow(/setBest/);
    expect(() => h.debug.setScore(1.5)).toThrow(/setScore/);
  });

  it("rejects a multiplier outside [1, COMBO_MAX]", () => {
    expect(() => h.debug.setCombo(0)).toThrow(/setCombo/);
    expect(() => h.debug.setCombo(COMBO_MAX + 1)).toThrow(/setCombo/);
  });

  it("rejects a window outside [0, COMBO_WINDOW]", () => {
    expect(() => h.debug.setComboWindow(-0.1)).toThrow(/setComboWindow/);
    expect(() => h.debug.setComboWindow(COMBO_WINDOW + 0.1)).toThrow(
      /setComboWindow/,
    );
  });

  it("rejects a direction that is not one of the four", () => {
    expect(() => h.debug.setDirection("sideways" as "up")).toThrow(
      /setDirection/,
    );
  });

  it("rejects a chain that is empty, broken, repeated, or off the interior", () => {
    expect(() => h.debug.setSnake([])).toThrow(/at least one cell/);
    expect(() =>
      h.debug.setSnake([
        { col: 10, row: 8 },
        { col: 12, row: 8 },
      ]),
    ).toThrow(/adjacent/);
    expect(() =>
      h.debug.setSnake([
        { col: 10, row: 8 },
        { col: 11, row: 8 },
        { col: 10, row: 8 },
      ]),
    ).toThrow(/repeated/);
    expect(() => h.debug.setSnake([{ col: 0, row: 8 }])).toThrow(/interior/);
  });

  it("rejects a pellet on a wall cell or under the chain", () => {
    h.debug.setSnake(chain(10, 8, 3));
    expect(() => h.debug.setPellet(0, 8)).toThrow(/interior/);
    expect(() => h.debug.setPellet(10, 8)).toThrow(/snake segment/);
  });

  it("rejects a switch that is not a boolean", () => {
    expect(() => h.debug.setSnakeSteering(1 as unknown as boolean)).toThrow(
      /true or false/,
    );
    expect(() => h.debug.setSnakeTravel(null as unknown as boolean)).toThrow(
      /true or false/,
    );
    expect(() => h.debug.setPelletRespawn("yes" as unknown as boolean)).toThrow(
      /true or false/,
    );
  });
});

describe("the obstacle operations", () => {
  it("are laid only by a mode that places obstacle cells", () => {
    expect(typeof h.debug.clearObstacles).toBe(
      HAS_OBSTACLES ? "function" : "undefined",
    );
    expect(typeof h.debug.addObstacle).toBe(
      HAS_OBSTACLES ? "function" : "undefined",
    );
  });

  it.runIf(HAS_OBSTACLES)("clear the course and add a cell back", () => {
    h.debug.setSnake(chain(10, 8, 3));
    h.debug.clearObstacles!();
    expect(h.debug.snapshot().obstacles).toEqual([]);
    h.debug.addObstacle!(20, 4);
    h.debug.addObstacle!(20, 4);
    expect(h.debug.snapshot().obstacles).toEqual([{ col: 20, row: 4 }]);
  });

  it.runIf(HAS_OBSTACLES)(
    "reject a cell under the chain or off the interior",
    () => {
      h.debug.setSnake(chain(10, 8, 3));
      expect(() => h.debug.addObstacle!(10, 8)).toThrow(/snake segment/);
      expect(() => h.debug.addObstacle!(0, 8)).toThrow(/interior/);
    },
  );
});

describe("reconcile", () => {
  it("re-derives the mute mirror from the bit it is a copy of", () => {
    // `muted` is the game's readable copy of the engine's bit, refreshed by the
    // frame. Moving the engine's bit without running a frame leaves the copy
    // stale, which is the situation `reconcile` exists for: no frame is run, and
    // the reading answers for the engine as it is now.
    h.engine.world.audio.setMuted(true);
    expect(h.debug.snapshot().muted).toBe(false);

    h.debug.reconcile();

    expect(h.debug.snapshot().muted).toBe(true);
  });

  it("advances nothing, and twice matches once", () => {
    h.debug.setScreen("playing");
    h.debug.setSnake(chain(10, 8, 3));
    h.debug.setDirection("right");
    h.debug.setPellet(14, 8);
    h.debug.setComboWindow(2);
    const before = h.debug.snapshot();

    h.debug.reconcile();
    const once = h.debug.snapshot();

    expect(once.ticks).toBe(before.ticks);
    expect(once.simTime).toBe(before.simTime);
    expect(once.snake).toEqual(before.snake);
    expect(once.pellet).toEqual(before.pellet);
    expect(once.turns).toEqual(before.turns);
    expect(once.comboWindow).toBe(before.comboWindow);
    expect(once).toEqual(before);

    h.debug.reconcile();
    expect(h.debug.snapshot()).toEqual(once);
  });
});
