import { describe, expect, it } from "vitest";
import { NO_SPRITES } from "./assets";
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
import { createInitialState, startRound, type CoilState } from "./game";
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
  return createInitialState(NO_SPRITES, false, seed);
}

/** A round posed at `cells` facing `dir`, with nothing else on the board. */
function posed(
  cells: readonly Cell[],
  dir: Direction,
  pellet: Cell | null = null,
): CoilState {
  return { ...opening(), snake: [...cells], dir, pellet, obstacles: [] };
}

function run(state: CoilState, ticks: number): CoilState {
  let next = state;
  for (let i = 0; i < ticks; i++) next = tick(next).state;
  return next;
}

describe("the opening board", () => {
  it("lays the starting chain of specs/board.md facing right", () => {
    const state = layChain(opening());
    expect(state.snake).toEqual(START_CELLS.map((c) => ({ ...c })));
    expect(state.snake.length).toBe(START_LENGTH);
    expect(state.dir).toBe(START_DIR);
    expect(state.turns).toEqual([]);
  });

  it("places the first pellet clear of the starting chain", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const state = startRound(opening(seed));
      const pellet = state.pellet!;
      expect(isInterior(pellet.col, pellet.row)).toBe(true);
      expect(cellsHold(state.snake, pellet.col, pellet.row)).toBe(false);
      expect(cellsHold(state.obstacles, pellet.col, pellet.row)).toBe(false);
    }
  });

  it("draws the same pellet sequence from the same seed", () => {
    const sequence = (seed: number): string[] => {
      let state = startRound(opening(seed));
      const cells: string[] = [];
      for (let i = 0; i < 8; i++) {
        cells.push(`${state.pellet!.col},${state.pellet!.row}`);
        state = spawnPellet(state).state;
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
      const state = tick(posed([start, { col: 13, row: 8 }], dir)).state;
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
    const state = tick(posed(chain, "right")).state;
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
    const result = tick(posed(chain, "right", { col: 15, row: 8 }));
    expect(result.state.snake.length).toBe(chain.length + 1);
    expect(result.state.snake[result.state.snake.length - 1]).toEqual({
      col: 13,
      row: 8,
    });
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
    const state = requestTurn(
      posed(
        [
          { col: 14, row: 8 },
          { col: 13, row: 8 },
        ],
        "right",
      ),
      "up",
    );
    expect(state.dir).toBe("right");
    expect(state.turns).toEqual(["up"]);
    const next = tick(state).state;
    expect(next.dir).toBe("up");
    expect(next.turns).toEqual([]);
    expect(next.snake[0]).toEqual({ col: 14, row: 7 });
  });

  it("discards a request that repeats or reverses the heading", () => {
    for (const request of ["right", "left"] as const) {
      const state = requestTurn(
        posed(
          [
            { col: 14, row: 8 },
            { col: 13, row: 8 },
          ],
          "right",
        ),
        request,
      );
      const next = tick(state).state;
      expect(next.dir).toBe("right");
      expect(next.turns).toEqual([]);
    }
  });

  it("resolves a pair of requests across two ticks", () => {
    let state = posed(
      [
        { col: 14, row: 8 },
        { col: 13, row: 8 },
      ],
      "right",
    );
    state = requestTurn(state, "down");
    state = requestTurn(state, "left");
    state = tick(state).state;
    expect(state.dir).toBe("down");
    state = tick(state).state;
    expect(state.dir).toBe("left");
  });

  it("holds at most TURN_QUEUE_MAX requests", () => {
    let state = posed([{ col: 14, row: 8 }], "right");
    for (const dir of ["up", "down", "up"] as const) {
      state = requestTurn(state, dir);
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
      const result = tick(posed([head], dir));
      expect(result.ended).toBe("dead");
      expect(result.events.died).toBe(true);
      expect(result.state.snake).toEqual([head]);
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
    const result = tick(posed(chain, "right"));
    expect(result.ended).toBeNull();
    expect(result.state.snake[0]).toEqual({ col: 11, row: 10 });
  });

  it("keeps the tail's cell solid on a tick that eats", () => {
    const chain = [
      { col: 10, row: 10 },
      { col: 10, row: 11 },
      { col: 11, row: 11 },
      { col: 11, row: 10 },
    ];
    const result = tick(posed(chain, "right", { col: 11, row: 10 }));
    expect(result.ended).toBe("dead");
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
    const result = tick(
      posed([{ col: 14, row: 8 }], "right", { col: 15, row: 8 }),
    );
    expect(result.state.combo).toBe(1);
    expect(result.state.score).toBe(PELLET_POINTS);
    expect(result.state.comboWindow).toBeCloseTo(COMBO_WINDOW - TICK_SECONDS, 9);
    expect(result.events.comboRose).toBe(false);
  });

  it("raises M and awards at the multiplier after the eat", () => {
    const state = {
      ...posed([{ col: 14, row: 8 }], "right", { col: 15, row: 8 }),
      combo: 2,
      comboWindow: 1,
      score: 100,
    };
    const result = tick(state);
    expect(result.state.combo).toBe(3);
    expect(result.state.score).toBe(100 + PELLET_POINTS * 3);
    expect(result.events.comboRose).toBe(true);
  });

  it("caps M at COMBO_MAX", () => {
    const state = {
      ...posed([{ col: 14, row: 8 }], "right", { col: 15, row: 8 }),
      combo: COMBO_MAX,
      comboWindow: 1,
    };
    const result = tick(state);
    expect(result.state.combo).toBe(COMBO_MAX);
    expect(result.events.comboRose).toBe(false);
  });

  it("scores at an M of 1 when the window is closed", () => {
    const state = {
      ...posed([{ col: 14, row: 8 }], "right", { col: 15, row: 8 }),
      combo: 4,
      comboWindow: 0,
    };
    const result = tick(state);
    expect(result.state.combo).toBe(1);
    expect(result.state.score).toBe(PELLET_POINTS);
  });

  it("drains the window by TICK_SECONDS a tick and lapses at zero", () => {
    let state: CoilState = {
      ...posed([{ col: 5, row: 5 }], "right"),
      combo: 3,
      comboWindow: COMBO_WINDOW,
      travel: false,
    };
    const budget = Math.round(COMBO_WINDOW / TICK_SECONDS);
    expect(budget).toBe(28);
    state = run(state, budget - 1);
    expect(state.combo).toBe(3);
    expect(state.comboWindow).toBeCloseTo(TICK_SECONDS, 9);
    state = run(state, 1);
    expect(state.comboWindow).toBe(0);
    expect(state.combo).toBe(1);
  });

  it("reports the window as a fraction of a full one", () => {
    expect(comboFraction({ comboWindow: COMBO_WINDOW })).toBe(1);
    expect(comboFraction({ comboWindow: 0 })).toBe(0);
    expect(comboFraction({ comboWindow: COMBO_WINDOW / 2 })).toBeCloseTo(0.5, 9);
  });
});

describe("the driver switches", () => {
  it("holds the heading while steering is off, and still travels", () => {
    let state: CoilState = {
      ...posed([{ col: 10, row: 10 }], "right"),
      steering: false,
    };
    state = requestTurn(state, "up");
    expect(state.turns).toEqual([]);
    state = tick(state).state;
    expect(state.dir).toBe("right");
    expect(state.snake[0]).toEqual({ col: 11, row: 10 });
  });

  it("holds the chain still while travel is off, and still steers", () => {
    let state: CoilState = {
      ...posed([{ col: 10, row: 10 }], "right"),
      travel: false,
    };
    state = requestTurn(state, "up");
    state = tick(state).state;
    expect(state.dir).toBe("up");
    expect(state.snake).toEqual([{ col: 10, row: 10 }]);
    expect(state.ticks).toBe(1);
  });

  it("leaves an eaten pellet unreplaced while respawn is off", () => {
    const state = {
      ...posed([{ col: 14, row: 8 }], "right", { col: 15, row: 8 }),
      pelletRespawn: false,
    };
    const result = tick(state);
    expect(result.events.ate).toBe(true);
    expect(result.state.pellet).toBeNull();
    expect(result.ended).toBeNull();
  });
});

describe("the pellet", () => {
  it("places the next pellet on the tick the last was eaten", () => {
    const result = tick(
      posed([{ col: 14, row: 8 }], "right", { col: 15, row: 8 }),
    );
    expect(result.state.pellet).not.toBeNull();
    expect(result.state.pellet).not.toEqual({ col: 15, row: 8 });
  });

  it("never places one under the chain or on an obstacle", () => {
    let state: CoilState = {
      ...opening(9),
      snake: [{ col: 14, row: 8 }],
      obstacles: [{ col: 3, row: 3 }],
      pellet: null,
    };
    for (let i = 0; i < 60; i++) {
      state = spawnPellet(state).state;
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
      const cols =
        row % 2 === 1
          ? Array.from(
              { length: INTERIOR_MAX_COL - INTERIOR_MIN_COL + 1 },
              (_, i) => INTERIOR_MAX_COL - i,
            )
          : Array.from(
              { length: INTERIOR_MAX_COL - INTERIOR_MIN_COL + 1 },
              (_, i) => INTERIOR_MIN_COL + i,
            );
      for (const col of cols) chain.push({ col, row });
    }
    // The path's first cell is left free and carries the last pellet; the rest of
    // it is the snake, head first, so the head stands right beside that cell.
    const free = chain.shift()!;
    const state: CoilState = {
      ...opening(),
      snake: chain,
      obstacles: [],
      pellet: free,
      dir: "right",
    };
    expect(state.snake[0]).toEqual({ col: free.col - 1, row: free.row });
    const result = tick(state);
    expect(result.events.ate).toBe(true);
    expect(result.ended).toBe("cleared");
    expect(result.state.pellet).toBeNull();
  });
});

describe("obstacle cells", () => {
  it("are fatal to the head, exactly as a wall cell is", () => {
    const state: CoilState = {
      ...posed([{ col: 10, row: 10 }], "right"),
      obstacles: [{ col: 11, row: 10 }],
    };
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
