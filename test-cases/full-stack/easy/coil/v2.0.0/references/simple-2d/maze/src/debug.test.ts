// The debug surface, driven exactly as a caller drives it: every pose takes the
// state and returns the next, and every reading takes the state and returns what
// it read. Nothing here holds a writable state, which is the property the surface
// is written around.

import { describe, expect, it } from "vitest";
import { NO_SPRITES } from "./assets";
import { createDebugApi, type CoilDebugApi } from "./debug";
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
import { createInitialState, startRound, type CoilState } from "./game";
import { HAS_OBSTACLES } from "./mode";
import { tick } from "./sim";

const debug: CoilDebugApi = createDebugApi();

function opening(): CoilState {
  return createInitialState(NO_SPRITES, false);
}

/** A chain of `length` cells laid to the left from `(col, row)`. */
function chain(col: number, row: number, length: number): Cell[] {
  return Array.from({ length }, (_, i) => ({ col: col - i, row }));
}

describe("the snapshot", () => {
  it("reports every field specs/instrumentation.md fixes", () => {
    const shot = debug.snapshot(opening());
    expect(Object.keys(shot).sort()).toEqual(
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
    expect(debug.version).toBe(COIL_DEBUG_VERSION);
    expect(debug.snapshot(opening()).version).toBe(COIL_DEBUG_VERSION);
    expect(debug.snapshot(opening()).mode).toBe(MODE);
  });

  it("reads the live values off the state", () => {
    let state = startRound(opening());
    state = debug.setScore(state, 120);
    state = debug.setBest(state, 300);
    state = debug.setCombo(state, 3);
    state = debug.setComboWindow(state, 2);
    state = debug.setDirection(state, "down");
    const shot = debug.snapshot(state);
    expect(shot.screen).toBe("playing");
    expect(shot.score).toBe(120);
    expect(shot.best).toBe(300);
    expect(shot.combo).toBe(3);
    expect(shot.comboWindow).toBe(2);
    expect(shot.dir).toBe("down");
    expect(shot.snake.length).toBe(START_CELLS.length);
  });

  it("copies the board rather than handing the state's own arrays out", () => {
    const state = startRound(opening());
    const shot = debug.snapshot(state);
    shot.snake.push({ col: -1, row: -1 });
    shot.turns.push("up");
    shot.obstacles.length = 0;
    expect(state.snake.length).toBe(START_CELLS.length);
    expect(state.turns).toEqual([]);
    expect(state.obstacles.length).toBe(OBSTACLE_CELLS.length);
    // Each cell is a copy, so nothing a caller does to one reaches the state.
    expect(debug.snapshot(state).snake[0]).not.toBe(state.snake[0]);
  });

  it("leaves the state it read exactly as it was", () => {
    const state = startRound(opening());
    const before = JSON.stringify(debug.snapshot(state));
    debug.snapshot(state);
    expect(JSON.stringify(debug.snapshot(state))).toBe(before);
  });
});

describe("reset", () => {
  it("restores every field the snapshot reports", () => {
    let state = startRound(opening());
    state = debug.setScore(state, 500);
    state = debug.setBest(state, 900);
    state = debug.setCombo(state, 4);
    state = debug.setComboWindow(state, 3);
    state = debug.setSnakeTravel(state, false);
    state = debug.setPelletRespawn(state, false);
    state = tick(state).state;

    const shot = debug.snapshot(debug.reset(state));
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
    const state = debug.reset(opening());
    expect(debug.snapshot(state).obstacles).toEqual(
      OBSTACLE_CELLS.map((cell) => ({ ...cell })),
    );
  });

  it("leaves the mute bit as it stands", () => {
    const muted = { ...opening(), muted: true };
    expect(debug.snapshot(debug.reset(muted)).muted).toBe(true);
  });

  it("clears a posed next pellet", () => {
    const posed = debug.setNextPellet(opening(), 20, 4);
    expect(debug.snapshot(debug.reset(posed)).nextPellet).toBeNull();
  });
});

describe("the posed spawn", () => {
  /** A round with a chain along row 8 and its meal one cell ahead of the head. */
  function arrangedEat(): CoilState {
    let state = startRound(opening());
    state = { ...state, obstacles: [] };
    state = debug.setSnake(state, chain(10, 8, 3));
    state = debug.setDirection(state, "right");
    return debug.setPellet(state, 11, 8);
  }

  it("reports the posed cell until a spawn takes it", () => {
    let state = debug.setNextPellet(arrangedEat(), 20, 4);
    expect(debug.snapshot(state).nextPellet).toEqual({ col: 20, row: 4 });
    state = debug.setNextPellet(state, 21, 5);
    expect(debug.snapshot(state).nextPellet).toEqual({ col: 21, row: 5 });
  });

  it("places the next pellet on the posed cell and consumes the pose", () => {
    const state = debug.setNextPellet(arrangedEat(), 20, 4);
    const shot = debug.snapshot(tick(state).state);
    expect(shot.snake[0]).toEqual({ col: 11, row: 8 });
    expect(shot.pellet).toEqual({ col: 20, row: 4 });
    expect(shot.nextPellet).toBeNull();
  });

  it("discards a posed cell the chain holds at the spawn", () => {
    const state = debug.setNextPellet(arrangedEat(), 9, 8);
    const shot = debug.snapshot(tick(state).state);
    expect(shot.pellet).not.toBeNull();
    expect(shot.pellet).not.toEqual({ col: 9, row: 8 });
    expect(shot.nextPellet).toBeNull();
  });

  it("keeps the pose through an eat with respawn off", () => {
    let state = debug.setPelletRespawn(arrangedEat(), false);
    state = debug.setNextPellet(state, 20, 4);
    const shot = debug.snapshot(tick(state).state);
    expect(shot.pellet).toBeNull();
    expect(shot.nextPellet).toEqual({ col: 20, row: 4 });
  });

  it("keeps the pose when a pellet is placed by hand", () => {
    let state = debug.setNextPellet(arrangedEat(), 20, 4);
    state = debug.setPellet(state, 12, 8);
    expect(debug.snapshot(state).nextPellet).toEqual({ col: 20, row: 4 });
  });

  it("discards a posed wall cell and draws an interior cell instead", () => {
    const state = debug.setNextPellet(arrangedEat(), 0, 8);
    const shot = debug.snapshot(tick(state).state);
    expect(shot.pellet).not.toBeNull();
    expect(shot.pellet).not.toEqual({ col: 0, row: 8 });
    expect(shot.nextPellet).toBeNull();
  });

  it("refuses a cell off the grid", () => {
    expect(() => debug.setNextPellet(opening(), -1, 8)).toThrow();
    expect(() => debug.setNextPellet(opening(), 30, 8)).toThrow();
    expect(() => debug.setNextPellet(opening(), 5, 18)).toThrow();
    expect(() => debug.setNextPellet(opening(), 1.5, 8)).toThrow();
  });
});

describe("the draw alone", () => {
  /** A round with a chain along row 8 and a live pellet elsewhere. */
  function arrangedBoard(): CoilState {
    let state = startRound(opening());
    state = { ...state, obstacles: [] };
    state = debug.setSnake(state, chain(10, 8, 3));
    return debug.setPellet(state, 20, 6);
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
    const state = arrangedBoard();
    for (let draw = 0; draw < 20; draw++) {
      const cell = debug.drawPelletCell(state);
      expect(cell).not.toBeNull();
      expect(isInterior(cell!.col, cell!.row)).toBe(true);
      expect(state.snake).not.toContainEqual(cell);
      expect(cell).not.toEqual(state.pellet);
    }
  });

  it("answers more than one cell over repeated draws", () => {
    const state = arrangedBoard();
    const seen = new Set<string>();
    for (let draw = 0; draw < 20; draw++) {
      const cell = debug.drawPelletCell(state)!;
      seen.add(`${cell.col},${cell.row}`);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("leaves the state and a standing pose as they were", () => {
    const state = debug.setNextPellet(arrangedBoard(), 20, 4);
    const before = debug.snapshot(state);
    debug.drawPelletCell(state);
    expect(debug.snapshot(state)).toEqual(before);
  });

  it("answers null when the valid set is empty", () => {
    const state: CoilState = {
      ...startRound(opening()),
      obstacles: [],
      snake: fullChain(),
      pellet: null,
    };
    expect(debug.drawPelletCell(state)).toBeNull();
  });
});

describe("the poses", () => {
  it("sets the chain alone", () => {
    let state = startRound(opening());
    state = debug.setDirection(state, "up");
    const before = debug.snapshot(state);
    state = debug.setSnake(state, chain(10, 8, 4));
    const after = debug.snapshot(state);
    expect(after.snake).toEqual(chain(10, 8, 4));
    expect(after.dir).toBe(before.dir);
    expect(after.pellet).toEqual(before.pellet);
    expect(after.score).toBe(before.score);
  });

  it("places and removes the pellet outright", () => {
    let state = startRound(opening());
    state = debug.setSnake(state, chain(10, 8, 3));
    state = debug.setPellet(state, 20, 4);
    expect(debug.snapshot(state).pellet).toEqual({ col: 20, row: 4 });
    state = debug.clearPellet(state);
    expect(debug.snapshot(state).pellet).toBeNull();
  });

  it("empties the turn buffer, turning nothing", () => {
    let state = startRound(opening());
    state = { ...state, turns: ["up", "down"] };
    state = debug.clearTurns(state);
    expect(debug.snapshot(state).turns).toEqual([]);
    expect(debug.snapshot(state).dir).toBe("right");
  });

  it("holds one faculty still while the other runs", () => {
    let state = startRound(opening());
    state = debug.setSnake(state, chain(10, 8, 3));
    state = debug.setSnakeTravel(state, false);
    state = debug.clearPellet(state);
    const before = debug.snapshot(state);
    state = tick(state).state;
    const after = debug.snapshot(state);
    expect(after.snake).toEqual(before.snake);
    expect(after.ticks).toBe(before.ticks + 1);
    expect(after.steering).toBe(true);
  });

  it("drains the combo window while the snake is held still", () => {
    let state = startRound(opening());
    state = debug.setSnakeTravel(state, false);
    state = debug.setCombo(state, 4);
    state = debug.setComboWindow(state, COMBO_WINDOW);
    state = tick(state).state;
    expect(debug.snapshot(state).comboWindow).toBeCloseTo(
      COMBO_WINDOW - TICK_SECONDS,
      9,
    );
  });

  it("moves the highlight without accepting anything", () => {
    const state = debug.setMenuIndex(opening(), 1);
    expect(debug.snapshot(state).menuIndex).toBe(1);
    expect(debug.snapshot(state).screen).toBe("title");
  });

  it("sets the screen without laying out a round", () => {
    let state = debug.setSnake(opening(), chain(10, 8, 3));
    state = debug.setMenuIndex(state, 1);
    state = debug.setScreen(state, "playing");
    const shot = debug.snapshot(state);
    expect(shot.screen).toBe("playing");
    expect(shot.snake).toEqual(chain(10, 8, 3));
    expect(shot.pellet).toBeNull();
  });
});

describe("an argument outside its domain", () => {
  it("rejects a screen no build has", () => {
    expect(() =>
      debug.setScreen(opening(), "nowhere" as (typeof SCREENS)[number]),
    ).toThrow(/setScreen/);
  });

  it("rejects a menu index the current screen does not hold", () => {
    expect(() => debug.setMenuIndex(opening(), 9)).toThrow(/menu item/);
    expect(() =>
      debug.setMenuIndex(debug.setScreen(opening(), "playing"), 1),
    ).toThrow(/menu item/);
  });

  it("rejects a score or a best below zero", () => {
    expect(() => debug.setScore(opening(), -1)).toThrow(/setScore/);
    expect(() => debug.setBest(opening(), -1)).toThrow(/setBest/);
    expect(() => debug.setScore(opening(), 1.5)).toThrow(/setScore/);
  });

  it("rejects a multiplier outside [1, COMBO_MAX]", () => {
    expect(() => debug.setCombo(opening(), 0)).toThrow(/setCombo/);
    expect(() => debug.setCombo(opening(), COMBO_MAX + 1)).toThrow(/setCombo/);
  });

  it("rejects a window outside [0, COMBO_WINDOW]", () => {
    expect(() => debug.setComboWindow(opening(), -0.1)).toThrow(
      /setComboWindow/,
    );
    expect(() => debug.setComboWindow(opening(), COMBO_WINDOW + 0.1)).toThrow(
      /setComboWindow/,
    );
  });

  it("rejects a direction that is not one of the four", () => {
    expect(() => debug.setDirection(opening(), "sideways" as "up")).toThrow(
      /setDirection/,
    );
  });

  it("rejects a chain that is empty, broken, repeated, or off the interior", () => {
    expect(() => debug.setSnake(opening(), [])).toThrow(/at least one cell/);
    expect(() =>
      debug.setSnake(opening(), [
        { col: 10, row: 8 },
        { col: 12, row: 8 },
      ]),
    ).toThrow(/adjacent/);
    expect(() =>
      debug.setSnake(opening(), [
        { col: 10, row: 8 },
        { col: 11, row: 8 },
        { col: 10, row: 8 },
      ]),
    ).toThrow(/repeated/);
    expect(() => debug.setSnake(opening(), [{ col: 0, row: 8 }])).toThrow(
      /interior/,
    );
  });

  it("rejects a pellet on a wall cell or under the chain", () => {
    const state = debug.setSnake(opening(), chain(10, 8, 3));
    expect(() => debug.setPellet(state, 0, 8)).toThrow(/interior/);
    expect(() => debug.setPellet(state, 10, 8)).toThrow(/snake segment/);
  });

  it("rejects a switch that is not a boolean", () => {
    expect(() =>
      debug.setSnakeSteering(opening(), 1 as unknown as boolean),
    ).toThrow(/true or false/);
    expect(() =>
      debug.setSnakeTravel(opening(), null as unknown as boolean),
    ).toThrow(/true or false/);
    expect(() =>
      debug.setPelletRespawn(opening(), "yes" as unknown as boolean),
    ).toThrow(/true or false/);
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

  it.runIf(HAS_OBSTACLES)("clear the course and add a cell back", () => {
    let state = debug.setSnake(opening(), chain(10, 8, 3));
    state = debug.clearObstacles!(state);
    expect(debug.snapshot(state).obstacles).toEqual([]);
    state = debug.addObstacle!(state, 20, 4);
    state = debug.addObstacle!(state, 20, 4);
    expect(debug.snapshot(state).obstacles).toEqual([{ col: 20, row: 4 }]);
  });

  it.runIf(HAS_OBSTACLES)(
    "reject a cell under the chain or off the interior",
    () => {
      const state = debug.setSnake(opening(), chain(10, 8, 3));
      expect(() => debug.addObstacle!(state, 10, 8)).toThrow(/snake segment/);
      expect(() => debug.addObstacle!(state, 0, 8)).toThrow(/interior/);
    },
  );
});

describe("reconcile", () => {
  it("leaves every reading answering for the state it was handed", () => {
    // Nothing this build reports is held as a copy of something a pose can leave
    // behind, so the reconciled state describes exactly the world that was posed
    // — which is the guarantee, whether a build had work to do here or not.
    const posed = debug.setPellet(
      debug.setDirection(debug.setSnake(opening(), chain(10, 8, 3)), "right"),
      14,
      8,
    );

    const reconciled = debug.reconcile(posed);

    expect(debug.snapshot(reconciled)).toEqual(debug.snapshot(posed));
  });

  it("advances nothing, and twice matches once", () => {
    const posed = debug.setComboWindow(
      debug.setScreen(debug.setSnake(opening(), chain(10, 8, 3)), "playing"),
      2,
    );
    const before = debug.snapshot(posed);

    const once = debug.reconcile(posed);
    const after = debug.snapshot(once);

    expect(after.ticks).toBe(before.ticks);
    expect(after.simTime).toBe(before.simTime);
    expect(after.snake).toEqual(before.snake);
    expect(after.pellet).toEqual(before.pellet);
    expect(after.turns).toEqual(before.turns);
    expect(after.comboWindow).toBe(before.comboWindow);
    expect(after).toEqual(before);

    expect(debug.snapshot(debug.reconcile(once))).toEqual(after);
  });
});
