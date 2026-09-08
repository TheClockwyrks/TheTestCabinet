// The debug surface, reached the one way a caller reaches it: as `engine.debug`,
// over a real engine. Every pose acts on the live world at the call and returns
// nothing, and every claim is read back through the surface's own `snapshot`.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isInterior } from "./board";
import {
  COIL_DEBUG_VERSION,
  COMBO_MAX,
  COMBO_WINDOW,
  INTERIOR_MAX_COL,
  INTERIOR_MAX_ROW,
  INTERIOR_MIN_COL,
  INTERIOR_MIN_ROW,
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
import { tick } from "./sim";

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
        "nextPellet",
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

  it("clears a posed next pellet", () => {
    h.debug.setNextPellet(20, 4);
    h.debug.reset();
    expect(h.debug.snapshot().nextPellet).toBeNull();
  });
});

describe("the posed spawn", () => {
  /** A round with a chain along row 8 and its meal one cell ahead of the head. */
  function arrangeEat(): void {
    round();
    h.state.obstacles = [];
    h.debug.setSnake(chain(10, 8, 3));
    h.debug.setDirection("right");
    h.debug.setPellet(11, 8);
  }

  it("reports the posed cell until a spawn takes it", () => {
    arrangeEat();
    h.debug.setNextPellet(20, 4);
    expect(h.debug.snapshot().nextPellet).toEqual({ col: 20, row: 4 });
    h.debug.setNextPellet(21, 5);
    expect(h.debug.snapshot().nextPellet).toEqual({ col: 21, row: 5 });
  });

  it("places the next pellet on the posed cell and consumes the pose", () => {
    arrangeEat();
    h.debug.setNextPellet(20, 4);
    tick(h.state);
    const shot = h.debug.snapshot();
    expect(shot.snake[0]).toEqual({ col: 11, row: 8 });
    expect(shot.pellet).toEqual({ col: 20, row: 4 });
    expect(shot.nextPellet).toBeNull();
  });

  it("discards a posed cell the chain holds at the spawn", () => {
    arrangeEat();
    h.debug.setNextPellet(9, 8);
    tick(h.state);
    const shot = h.debug.snapshot();
    expect(shot.pellet).not.toBeNull();
    expect(shot.pellet).not.toEqual({ col: 9, row: 8 });
    expect(shot.nextPellet).toBeNull();
  });

  it("keeps the pose through an eat with respawn off", () => {
    arrangeEat();
    h.debug.setPelletRespawn(false);
    h.debug.setNextPellet(20, 4);
    tick(h.state);
    const shot = h.debug.snapshot();
    expect(shot.pellet).toBeNull();
    expect(shot.nextPellet).toEqual({ col: 20, row: 4 });
  });

  it("keeps the pose when a pellet is placed by hand", () => {
    arrangeEat();
    h.debug.setNextPellet(20, 4);
    h.debug.setPellet(12, 8);
    expect(h.debug.snapshot().nextPellet).toEqual({ col: 20, row: 4 });
  });

  it("discards a posed wall cell and draws an interior cell instead", () => {
    arrangeEat();
    h.debug.setNextPellet(0, 8);
    tick(h.state);
    const shot = h.debug.snapshot();
    expect(shot.pellet).not.toBeNull();
    expect(shot.pellet).not.toEqual({ col: 0, row: 8 });
    expect(shot.nextPellet).toBeNull();
  });

  it("refuses a cell off the grid", () => {
    expect(() => h.debug.setNextPellet(-1, 8)).toThrow();
    expect(() => h.debug.setNextPellet(30, 8)).toThrow();
    expect(() => h.debug.setNextPellet(5, 18)).toThrow();
    expect(() => h.debug.setNextPellet(1.5, 8)).toThrow();
  });
});

describe("the draw alone", () => {
  /** A round with a chain along row 8 and a live pellet elsewhere. */
  function arrangeBoard(): void {
    round();
    h.state.obstacles = [];
    h.debug.setSnake(chain(10, 8, 3));
    h.debug.setPellet(20, 6);
  }

  /** Every interior cell as one chain, row by row and back the next. */
  function fullChain(): Cell[] {
    const path: Cell[] = [];
    for (let row = INTERIOR_MIN_ROW; row <= INTERIOR_MAX_ROW; row++) {
      for (let i = INTERIOR_MIN_COL; i <= INTERIOR_MAX_COL; i++) {
        const col =
          row % 2 === 1 ? i : INTERIOR_MAX_COL - (i - INTERIOR_MIN_COL);
        path.push({ col, row });
      }
    }
    return path;
  }

  it("answers a cell of the valid set", () => {
    arrangeBoard();
    for (let draw = 0; draw < 20; draw++) {
      const cell = h.debug.drawPelletCell();
      expect(cell).not.toBeNull();
      expect(isInterior(cell!.col, cell!.row)).toBe(true);
      expect(h.state.snake).not.toContainEqual(cell);
      expect(cell).not.toEqual({ col: 20, row: 6 });
    }
  });

  it("answers more than one cell over repeated draws", () => {
    arrangeBoard();
    const seen = new Set<string>();
    for (let draw = 0; draw < 20; draw++) {
      const cell = h.debug.drawPelletCell()!;
      seen.add(`${cell.col},${cell.row}`);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("leaves the state and a standing pose as they were", () => {
    arrangeBoard();
    h.debug.setNextPellet(20, 4);
    const before = h.debug.snapshot();
    h.debug.drawPelletCell();
    expect(h.debug.snapshot()).toEqual(before);
  });

  it("answers null when the valid set is empty", () => {
    round();
    h.state.obstacles = [];
    h.debug.clearPellet();
    h.debug.setSnake(fullChain());
    expect(h.debug.drawPelletCell()).toBeNull();
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
