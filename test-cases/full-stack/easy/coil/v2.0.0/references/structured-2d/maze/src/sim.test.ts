// The round, one whole tick at a time.
//
// The game state is a live object, so every check here builds one, writes the
// board it is about onto it, and reads the same object back after the tick. No
// engine is needed: `tick` is arithmetic over the state and nothing else.

import { describe, expect, it } from "vitest";
import { cellsHold, isInterior } from "./board";
import {
  COMBO_MAX,
  COMBO_WINDOW,
  GRID_COLS,
  GRID_ROWS,
  INTERIOR_MAX_COL,
  INTERIOR_MAX_ROW,
  INTERIOR_MIN_COL,
  INTERIOR_MIN_ROW,
  OBSTACLE_CELLS,
  PELLET_POINTS,
  START_CELLS,
  START_DIR,
  START_LENGTH,
  TICK_SECONDS,
  TURN_QUEUE_MAX,
  type Cell,
  type Direction,
} from "./constants";
import { resetSession, startRound } from "./flow";
import { CoilState } from "./game";
import {
  comboFraction,
  fatal,
  isPerpendicular,
  layChain,
  requestTurn,
  spawnPellet,
  tick,
} from "./sim";

function opening(seed = 1): CoilState {
  const state = new CoilState();
  resetSession(state, seed);
  return state;
}

/** A round posed at `cells` facing `dir`, with nothing else on the board. */
function posed(
  cells: readonly Cell[],
  dir: Direction,
  pellet: Cell | null = null,
): CoilState {
  const state = opening();
  state.snake = cells.map((cell) => ({ col: cell.col, row: cell.row }));
  state.dir = dir;
  state.pellet = pellet;
  state.obstacles = [];
  return state;
}

function run(state: CoilState, ticks: number): void {
  for (let i = 0; i < ticks; i++) tick(state);
}

describe("the opening board", () => {
  it("lays the starting chain of specs/board.md facing right", () => {
    const state = opening();
    layChain(state);
    expect(state.snake).toEqual(START_CELLS.map((cell) => ({ ...cell })));
    expect(state.snake.length).toBe(START_LENGTH);
    expect(state.dir).toBe(START_DIR);
    expect(state.turns).toEqual([]);
  });

  it("places the first pellet clear of the starting chain", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const state = opening(seed);
      startRound(state);
      const pellet = state.pellet!;
      expect(isInterior(pellet.col, pellet.row)).toBe(true);
      expect(cellsHold(state.snake, pellet.col, pellet.row)).toBe(false);
      expect(cellsHold(state.obstacles, pellet.col, pellet.row)).toBe(false);
    }
  });

  it("draws the same pellet sequence from the same seed", () => {
    const sequence = (seed: number): string[] => {
      const state = opening(seed);
      startRound(state);
      const cells: string[] = [];
      for (let i = 0; i < 8; i++) {
        cells.push(`${state.pellet!.col},${state.pellet!.row}`);
        spawnPellet(state);
      }
      return cells;
    };
    expect(sequence(4)).toEqual(sequence(4));
    expect(sequence(4)).not.toEqual(sequence(5));
  });
});

describe("one tick of travel", () => {
  it("advances the head one cell along dir", () => {
    for (const [dir, delta] of [
      ["up", { col: 0, row: -1 }],
      ["down", { col: 0, row: 1 }],
      ["left", { col: -1, row: 0 }],
      ["right", { col: 1, row: 0 }],
    ] as const) {
      const start = { col: 14, row: 8 };
      const state = posed([start, { col: 13, row: 8 }], dir);
      tick(state);
      expect(state.snake[0]).toEqual({
        col: start.col + delta.col,
        row: start.row + delta.row,
      });
      expect(state.ticks).toBe(1);
    }
  });

  it("drops the tail on a tick that eats nothing", () => {
    const chain = [
      { col: 14, row: 8 },
      { col: 13, row: 8 },
      { col: 12, row: 8 },
    ];
    const state = posed(chain, "right");
    tick(state);
    expect(state.snake.length).toBe(chain.length);
    expect(state.snake).toEqual([
      { col: 15, row: 8 },
      { col: 14, row: 8 },
      { col: 13, row: 8 },
    ]);
  });

  it("holds the tail, and grows by one, on the tick that eats", () => {
    const chain = [
      { col: 14, row: 8 },
      { col: 13, row: 8 },
    ];
    const state = posed(chain, "right", { col: 15, row: 8 });
    const result = tick(state);
    expect(state.snake.length).toBe(chain.length + 1);
    expect(state.snake[state.snake.length - 1]).toEqual({ col: 13, row: 8 });
    expect(result.events.ate).toBe(true);
  });
});

describe("turning", () => {
  it("names a perpendicular request", () => {
    expect(isPerpendicular("up", "right")).toBe(true);
    expect(isPerpendicular("down", "left")).toBe(true);
    expect(isPerpendicular("left", "up")).toBe(true);
    expect(isPerpendicular("right", "right")).toBe(false);
    expect(isPerpendicular("left", "right")).toBe(false);
  });

  it("applies a buffered request at step 1 of the next tick", () => {
    const state = posed(
      [
        { col: 14, row: 8 },
        { col: 13, row: 8 },
      ],
      "right",
    );
    requestTurn(state, "up");
    expect(state.dir).toBe("right");
    expect(state.turns).toEqual(["up"]);
    tick(state);
    expect(state.dir).toBe("up");
    expect(state.turns).toEqual([]);
    expect(state.snake[0]).toEqual({ col: 14, row: 7 });
  });

  it("discards a request that repeats or reverses the heading", () => {
    for (const request of ["right", "left"] as const) {
      const state = posed(
        [
          { col: 14, row: 8 },
          { col: 13, row: 8 },
        ],
        "right",
      );
      requestTurn(state, request);
      tick(state);
      expect(state.dir).toBe("right");
      expect(state.turns).toEqual([]);
    }
  });

  it("resolves a pair of requests across two ticks", () => {
    const state = posed(
      [
        { col: 14, row: 8 },
        { col: 13, row: 8 },
      ],
      "right",
    );
    requestTurn(state, "down");
    requestTurn(state, "left");
    tick(state);
    expect(state.dir).toBe("down");
    tick(state);
    expect(state.dir).toBe("left");
  });

  it("holds at most TURN_QUEUE_MAX requests", () => {
    const state = posed([{ col: 14, row: 8 }], "right");
    for (const dir of ["up", "down", "up"] as const) {
      requestTurn(state, dir);
    }
    expect(state.turns.length).toBe(TURN_QUEUE_MAX);
    expect(state.turns).toEqual(["up", "down"]);
  });
});

describe("collision", () => {
  it("ends the round on each of the four walls", () => {
    const cases: [Cell, Direction][] = [
      [{ col: INTERIOR_MIN_COL, row: 8 }, "left"],
      [{ col: INTERIOR_MAX_COL, row: 8 }, "right"],
      [{ col: 14, row: INTERIOR_MIN_ROW }, "up"],
      [{ col: 14, row: INTERIOR_MAX_ROW }, "down"],
    ];
    for (const [head, dir] of cases) {
      const state = posed([head], dir);
      const result = tick(state);
      expect(result.ended).toBe("dead");
      expect(result.events.died).toBe(true);
      expect(state.snake).toEqual([head]);
    }
  });

  it("frees the tail's cell on a tick that eats nothing", () => {
    // A closed loop of four cells: the head turns into the cell the tail leaves.
    const chain = [
      { col: 10, row: 10 },
      { col: 10, row: 11 },
      { col: 11, row: 11 },
      { col: 11, row: 10 },
    ];
    const state = posed(chain, "right");
    expect(tick(state).ended).toBeNull();
    expect(state.snake[0]).toEqual({ col: 11, row: 10 });
  });

  it("keeps the tail's cell solid on a tick that eats", () => {
    const chain = [
      { col: 10, row: 10 },
      { col: 10, row: 11 },
      { col: 11, row: 11 },
      { col: 11, row: 10 },
    ];
    expect(tick(posed(chain, "right", { col: 11, row: 10 })).ended).toBe(
      "dead",
    );
  });

  it("ends the round on a body segment", () => {
    const chain = [
      { col: 10, row: 10 },
      { col: 11, row: 10 },
      { col: 11, row: 9 },
      { col: 10, row: 9 },
      { col: 9, row: 9 },
    ];
    // Travelling up from (10,10) enters (10,9), a body cell that is not the tail.
    expect(tick(posed(chain, "up")).ended).toBe("dead");
  });

  it("reads the tail rule off fatal directly", () => {
    const state = posed(
      [
        { col: 10, row: 10 },
        { col: 10, row: 11 },
        { col: 11, row: 11 },
      ],
      "right",
    );
    expect(fatal(state, 11, 11, false)).toBe(false);
    expect(fatal(state, 11, 11, true)).toBe(true);
  });
});

describe("scoring and the combo", () => {
  it("awards PELLET_POINTS at an M of 1 on the first eat", () => {
    const state = posed([{ col: 14, row: 8 }], "right", { col: 15, row: 8 });
    const result = tick(state);
    expect(state.combo).toBe(1);
    expect(state.score).toBe(PELLET_POINTS);
    expect(state.comboWindow).toBeCloseTo(COMBO_WINDOW - TICK_SECONDS, 9);
    expect(result.events.comboRose).toBe(false);
  });

  it("raises M and awards at the multiplier after the eat", () => {
    const state = posed([{ col: 14, row: 8 }], "right", { col: 15, row: 8 });
    state.combo = 2;
    state.comboWindow = 1;
    state.score = 100;
    const result = tick(state);
    expect(state.combo).toBe(3);
    expect(state.score).toBe(100 + PELLET_POINTS * 3);
    expect(result.events.comboRose).toBe(true);
  });

  it("caps M at COMBO_MAX", () => {
    const state = posed([{ col: 14, row: 8 }], "right", { col: 15, row: 8 });
    state.combo = COMBO_MAX;
    state.comboWindow = 1;
    const result = tick(state);
    expect(state.combo).toBe(COMBO_MAX);
    expect(result.events.comboRose).toBe(false);
  });

  it("scores at an M of 1 when the window is closed", () => {
    const state = posed([{ col: 14, row: 8 }], "right", { col: 15, row: 8 });
    state.combo = 4;
    state.comboWindow = 0;
    tick(state);
    expect(state.combo).toBe(1);
    expect(state.score).toBe(PELLET_POINTS);
  });

  it("drains the window by TICK_SECONDS a tick and lapses at zero", () => {
    const state = posed([{ col: 5, row: 5 }], "right");
    state.combo = 3;
    state.comboWindow = COMBO_WINDOW;
    state.travel = false;
    const budget = Math.round(COMBO_WINDOW / TICK_SECONDS);
    expect(budget).toBe(28);
    run(state, budget - 1);
    expect(state.combo).toBe(3);
    expect(state.comboWindow).toBeCloseTo(TICK_SECONDS, 9);
    run(state, 1);
    expect(state.comboWindow).toBe(0);
    expect(state.combo).toBe(1);
  });

  it("reports the window as a fraction of a full one", () => {
    expect(comboFraction({ comboWindow: COMBO_WINDOW })).toBe(1);
    expect(comboFraction({ comboWindow: 0 })).toBe(0);
    expect(comboFraction({ comboWindow: COMBO_WINDOW / 2 })).toBeCloseTo(
      0.5,
      9,
    );
  });
});

describe("the driver switches", () => {
  it("holds the heading while steering is off, and still travels", () => {
    const state = posed([{ col: 10, row: 10 }], "right");
    state.steering = false;
    requestTurn(state, "up");
    expect(state.turns).toEqual([]);
    tick(state);
    expect(state.dir).toBe("right");
    expect(state.snake[0]).toEqual({ col: 11, row: 10 });
  });

  it("holds the chain still while travel is off, and still steers", () => {
    const state = posed([{ col: 10, row: 10 }], "right");
    state.travel = false;
    requestTurn(state, "up");
    tick(state);
    expect(state.dir).toBe("up");
    expect(state.snake).toEqual([{ col: 10, row: 10 }]);
    expect(state.ticks).toBe(1);
  });

  it("leaves an eaten pellet unreplaced while respawn is off", () => {
    const state = posed([{ col: 14, row: 8 }], "right", { col: 15, row: 8 });
    state.pelletRespawn = false;
    const result = tick(state);
    expect(result.events.ate).toBe(true);
    expect(state.pellet).toBeNull();
    expect(result.ended).toBeNull();
  });
});

describe("the pellet", () => {
  it("places the next pellet on the tick the last was eaten", () => {
    const state = posed([{ col: 14, row: 8 }], "right", { col: 15, row: 8 });
    tick(state);
    expect(state.pellet).not.toBeNull();
    expect(state.pellet).not.toEqual({ col: 15, row: 8 });
  });

  it("never places one under the chain or on an obstacle", () => {
    const state = opening(9);
    state.snake = [{ col: 14, row: 8 }];
    state.obstacles = [{ col: 3, row: 3 }];
    state.pellet = null;
    for (let i = 0; i < 60; i++) {
      spawnPellet(state);
      const pellet = state.pellet!;
      expect(cellsHold(state.snake, pellet.col, pellet.row)).toBe(false);
      expect(cellsHold(state.obstacles, pellet.col, pellet.row)).toBe(false);
      expect(isInterior(pellet.col, pellet.row)).toBe(true);
    }
  });

  it("ends the round on the cleared win when no valid cell is left", () => {
    // The interior filled but for one cell ahead of the head, which holds the
    // last pellet: eating it leaves the valid set empty.
    const chain: Cell[] = [];
    for (let row = INTERIOR_MIN_ROW; row <= INTERIOR_MAX_ROW; row++) {
      const width = INTERIOR_MAX_COL - INTERIOR_MIN_COL + 1;
      const cols =
        row % 2 === 1
          ? Array.from({ length: width }, (_, i) => INTERIOR_MAX_COL - i)
          : Array.from({ length: width }, (_, i) => INTERIOR_MIN_COL + i);
      for (const col of cols) chain.push({ col, row });
    }
    // The path's first cell is left free and carries the last pellet; the rest of
    // it is the snake, head first, so the head stands right beside that cell.
    const free = chain.shift()!;
    const state = opening();
    state.snake = chain;
    state.obstacles = [];
    state.pellet = free;
    state.dir = "right";
    expect(state.snake[0]).toEqual({ col: free.col - 1, row: free.row });
    const result = tick(state);
    expect(result.events.ate).toBe(true);
    expect(result.ended).toBe("cleared");
    expect(state.pellet).toBeNull();
  });
});

describe("obstacle cells", () => {
  it("are fatal to the head, exactly as a wall cell is", () => {
    const state = posed([{ col: 10, row: 10 }], "right");
    state.obstacles = [{ col: 11, row: 10 }];
    expect(tick(state).ended).toBe("dead");
  });

  it("are laid by the mode this build ships", () => {
    const state = opening();
    expect(state.obstacles.length).toBe(OBSTACLE_CELLS.length);
    for (const cell of state.obstacles) {
      expect(isInterior(cell.col, cell.row)).toBe(true);
      expect(cell.row).not.toBe(START_CELLS[0]!.row);
    }
  });

  it("stays inside the grid the specification fixes", () => {
    expect(GRID_COLS).toBe(30);
    expect(GRID_ROWS).toBe(18);
  });
});
