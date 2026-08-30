import { describe, expect, it } from "vitest";
import {
  COMBO_MAX,
  COMBO_WINDOW,
  DEFAULT_SEED,
  GRID_COLS,
  GRID_ROWS,
  PELLET_POINTS,
  START_CELLS,
  START_LENGTH,
  TICK_SECONDS,
  TURN_QUEUE_MAX,
  type Cell,
} from "./constants";
import { Sim, isAdjacent, isPerpendicular } from "./sim";

function sim(): Sim {
  const s = new Sim(DEFAULT_SEED);
  s.layRound();
  return s;
}

/** A straight chain of `length` cells running left from `(col, row)`. */
function chain(col: number, row: number, length: number): Cell[] {
  return Array.from({ length }, (_, i) => ({ col: col - i, row }));
}

describe("the opening board", () => {
  it("lays the starting chain of specs/board.md facing right", () => {
    const s = sim();
    expect(s.snake).toEqual(START_CELLS.map((cell) => ({ ...cell })));
    expect(s.snake).toHaveLength(START_LENGTH);
    expect(s.dir).toBe("right");
    expect(s.turns).toEqual([]);
    expect(s.score).toBe(0);
    expect(s.combo).toBe(1);
    expect(s.comboWindow).toBe(0);
  });

  it("places the first pellet clear of the starting chain", () => {
    for (let seed = 1; seed <= 24; seed++) {
      const s = new Sim(seed);
      s.layRound();
      const pellet = s.pellet;
      expect(pellet).not.toBeNull();
      expect(
        START_CELLS.some(
          (cell) => cell.col === pellet!.col && cell.row === pellet!.row,
        ),
      ).toBe(false);
      expect(pellet!.col).toBeGreaterThanOrEqual(1);
      expect(pellet!.col).toBeLessThanOrEqual(GRID_COLS - 2);
      expect(pellet!.row).toBeGreaterThanOrEqual(1);
      expect(pellet!.row).toBeLessThanOrEqual(GRID_ROWS - 2);
    }
  });

  it("draws the same pellet sequence from the same seed", () => {
    const run = (): string[] => {
      const s = new Sim(99);
      s.layRound();
      const cells: string[] = [];
      for (let i = 0; i < 6; i++) {
        cells.push(`${s.pellet!.col},${s.pellet!.row}`);
        s.setSnake(chain(s.pellet!.col - 1, s.pellet!.row, 3));
        s.dir = "right";
        s.tick();
      }
      return cells;
    };
    expect(run()).toEqual(run());
  });
});

describe("movement", () => {
  it("advances the head one cell along dir", () => {
    const s = sim();
    s.clearPellet();
    s.tick();
    expect(s.snake[0]).toEqual({ col: 16, row: 8 });
    expect(s.snake).toHaveLength(START_LENGTH);
  });

  it("drops the tail on a tick that eats nothing", () => {
    const s = sim();
    s.clearPellet();
    const before = s.snake.map((cell) => ({ ...cell }));
    s.tick();
    expect(s.snake.slice(1)).toEqual(before.slice(0, before.length - 1));
  });

  it("holds the tail, and grows by one, on the tick that eats", () => {
    const s = sim();
    s.setSnake(chain(10, 8, 3));
    s.dir = "right";
    s.setPellet(11, 8);
    const tail = { ...s.snake[s.snake.length - 1]! };
    s.tick();
    expect(s.snake).toHaveLength(4);
    expect(s.snake[s.snake.length - 1]).toEqual(tail);
  });
});

describe("turning", () => {
  it("names a perpendicular request", () => {
    expect(isPerpendicular("up", "right")).toBe(true);
    expect(isPerpendicular("left", "right")).toBe(false);
    expect(isPerpendicular("right", "right")).toBe(false);
    expect(isPerpendicular("left", "up")).toBe(true);
  });

  it("applies a buffered request at step 1 of the next tick", () => {
    const s = sim();
    s.clearPellet();
    s.requestTurn("up");
    expect(s.dir).toBe("right");
    expect(s.turns).toEqual(["up"]);
    s.tick();
    expect(s.dir).toBe("up");
    expect(s.turns).toEqual([]);
    expect(s.snake[0]).toEqual({ col: 15, row: 7 });
  });

  it("discards a request that repeats the heading", () => {
    const s = sim();
    s.clearPellet();
    s.requestTurn("right");
    s.tick();
    expect(s.dir).toBe("right");
    expect(s.turns).toEqual([]);
  });

  it("discards a request that reverses the heading", () => {
    const s = sim();
    s.clearPellet();
    s.requestTurn("left");
    s.tick();
    expect(s.dir).toBe("right");
    expect(s.snake[0]).toEqual({ col: 16, row: 8 });
  });

  it("resolves a pair of requests across two ticks", () => {
    const s = sim();
    s.clearPellet();
    s.requestTurn("down");
    s.requestTurn("left");
    s.tick();
    expect(s.dir).toBe("down");
    s.tick();
    expect(s.dir).toBe("left");
  });

  it("holds at most TURN_QUEUE_MAX requests", () => {
    const s = sim();
    s.requestTurn("up");
    s.requestTurn("down");
    s.requestTurn("up");
    expect(s.turns).toHaveLength(TURN_QUEUE_MAX);
    expect(s.turns).toEqual(["up", "down"]);
  });
});

describe("collision", () => {
  it("ends the round on each of the four walls", () => {
    const cases: [Cell[], "up" | "down" | "left" | "right"][] = [
      [chain(14, 1, 3), "up"],
      [chain(14, GRID_ROWS - 2, 3), "down"],
      [Array.from({ length: 3 }, (_, i) => ({ col: 1 + i, row: 8 })), "left"],
      [chain(GRID_COLS - 2, 8, 3), "right"],
    ];
    for (const [cells, dir] of cases) {
      const s = sim();
      s.clearPellet();
      s.setSnake(cells);
      s.dir = dir;
      const events = s.tick();
      expect(events.died).toBe(true);
      expect(s.ended).toBe(true);
      expect(s.endReason).toBe("dead");
    }
  });

  it("frees the tail's cell on a tick that eats nothing", () => {
    const s = sim();
    s.clearPellet();
    // A closed hook: the head is one cell from the tail it is about to chase.
    s.setSnake([
      { col: 10, row: 8 },
      { col: 10, row: 9 },
      { col: 11, row: 9 },
      { col: 11, row: 8 },
    ]);
    s.dir = "right";
    s.tick();
    expect(s.ended).toBe(false);
    expect(s.snake[0]).toEqual({ col: 11, row: 8 });
  });

  it("keeps the tail's cell solid on a tick that eats", () => {
    const s = sim();
    s.setSnake([
      { col: 10, row: 8 },
      { col: 10, row: 9 },
      { col: 11, row: 9 },
      { col: 11, row: 8 },
    ]);
    s.dir = "right";
    s.setPellet(11, 8);
    const events = s.tick();
    expect(events.died).toBe(true);
    expect(s.endReason).toBe("dead");
  });

  it("ends the round on a body segment", () => {
    const s = sim();
    s.clearPellet();
    // The cell ahead of the head is a middle segment rather than the tail.
    s.setSnake([
      { col: 10, row: 8 },
      { col: 10, row: 9 },
      { col: 11, row: 9 },
      { col: 11, row: 8 },
      { col: 12, row: 8 },
      { col: 13, row: 8 },
    ]);
    s.dir = "right";
    expect(s.tick().died).toBe(true);
  });

  it("resolves no further step once the head has died", () => {
    const s = sim();
    s.setSnake(chain(GRID_COLS - 2, 8, 3));
    s.dir = "right";
    s.combo = 3;
    s.comboWindow = COMBO_WINDOW;
    const before = s.snake.map((cell) => ({ ...cell }));
    s.tick();
    expect(s.snake).toEqual(before);
    expect(s.comboWindow).toBe(COMBO_WINDOW);
    expect(s.combo).toBe(3);
  });
});

describe("scoring and the combo", () => {
  it("awards PELLET_POINTS at an M of 1 on the first eat", () => {
    const s = sim();
    s.setSnake(chain(10, 8, 3));
    s.dir = "right";
    s.setPellet(11, 8);
    s.tick();
    expect(s.combo).toBe(1);
    expect(s.score).toBe(PELLET_POINTS);
    expect(s.comboWindow).toBeCloseTo(COMBO_WINDOW - TICK_SECONDS, 10);
  });

  it("raises M and awards at the multiplier after the eat", () => {
    const s = sim();
    s.setSnake(chain(10, 8, 3));
    s.dir = "right";
    s.setPellet(11, 8);
    s.combo = 3;
    s.comboWindow = COMBO_WINDOW;
    s.score = 100;
    s.tick();
    expect(s.combo).toBe(4);
    expect(s.score).toBe(100 + PELLET_POINTS * 4);
  });

  it("caps M at COMBO_MAX", () => {
    const s = sim();
    s.setSnake(chain(10, 8, 3));
    s.dir = "right";
    s.setPellet(11, 8);
    s.combo = COMBO_MAX;
    s.comboWindow = COMBO_WINDOW;
    s.tick();
    expect(s.combo).toBe(COMBO_MAX);
  });

  it("scores at an M of 1 when the window is closed", () => {
    const s = sim();
    s.setSnake(chain(10, 8, 3));
    s.dir = "right";
    s.setPellet(11, 8);
    s.combo = 4;
    s.comboWindow = 0;
    s.tick();
    expect(s.combo).toBe(1);
    expect(s.score).toBe(PELLET_POINTS);
  });

  it("drains the window by TICK_SECONDS a tick and lapses at zero", () => {
    const s = sim();
    s.clearPellet();
    s.combo = 3;
    s.comboWindow = COMBO_WINDOW;
    const budget = Math.round(COMBO_WINDOW / TICK_SECONDS);
    // Held still, so the window is the only thing the ticks change.
    s.travel = false;
    for (let i = 0; i < budget - 1; i++) s.tick();
    expect(s.comboWindow).toBeGreaterThan(0);
    expect(s.combo).toBe(3);
    s.tick();
    expect(s.comboWindow).toBe(0);
    expect(s.combo).toBe(1);
  });
});

describe("the driver switches", () => {
  it("holds the heading while steering is off, and still travels", () => {
    const s = sim();
    s.clearPellet();
    s.steering = false;
    s.requestTurn("up");
    expect(s.turns).toEqual([]);
    s.tick();
    expect(s.dir).toBe("right");
    expect(s.snake[0]).toEqual({ col: 16, row: 8 });
  });

  it("holds the chain still while travel is off, and still steers", () => {
    const s = sim();
    const before = s.snake.map((cell) => ({ ...cell }));
    s.travel = false;
    s.requestTurn("up");
    for (let i = 0; i < 20; i++) s.tick();
    expect(s.snake).toEqual(before);
    expect(s.dir).toBe("up");
    expect(s.ended).toBe(false);
  });

  it("drains the combo window while travel is off", () => {
    const s = sim();
    s.travel = false;
    s.combo = 2;
    s.comboWindow = COMBO_WINDOW;
    s.tick();
    expect(s.comboWindow).toBeCloseTo(COMBO_WINDOW - TICK_SECONDS, 10);
  });

  it("leaves an eaten pellet unreplaced while respawn is off", () => {
    const s = sim();
    s.pelletRespawn = false;
    s.setSnake(chain(10, 8, 3));
    s.dir = "right";
    s.setPellet(11, 8);
    s.tick();
    expect(s.pellet).toBeNull();
    expect(s.ended).toBe(false);
    expect(s.score).toBe(PELLET_POINTS);
  });
});

describe("the pellet", () => {
  it("places the next pellet on the tick the last was eaten", () => {
    const s = sim();
    s.setSnake(chain(10, 8, 3));
    s.dir = "right";
    s.setPellet(11, 8);
    s.tick();
    expect(s.pellet).not.toBeNull();
    expect(s.pellet).not.toEqual({ col: 11, row: 8 });
  });

  it("never places one under the chain or on an obstacle", () => {
    const s = sim();
    s.addObstacle(20, 5);
    for (let i = 0; i < 200; i++) {
      s.setSnake(chain(s.pellet!.col - 1, s.pellet!.row, 4));
      s.dir = "right";
      s.tick();
      if (s.ended) break;
      const pellet = s.pellet!;
      expect(
        s.snake.some(
          (cell) => cell.col === pellet.col && cell.row === pellet.row,
        ),
      ).toBe(false);
      expect(pellet).not.toEqual({ col: 20, row: 5 });
    }
  });

  it("ends the round on the cleared win when no valid cell is left", () => {
    const s = sim();
    // A path over every interior cell, running along each row and back the next.
    const path: Cell[] = [];
    for (let row = 1; row <= GRID_ROWS - 2; row++) {
      for (let i = 1; i <= GRID_COLS - 2; i++) {
        const col = row % 2 === 1 ? i : GRID_COLS - 1 - i;
        path.push({ col, row });
      }
    }
    // The chain covers the path but its last cell, head at the cell beside it.
    const free = path[path.length - 1]!;
    const body = path.slice(0, path.length - 1).reverse();
    s.clearPellet();
    s.setSnake(body);
    s.setPellet(free.col, free.row);
    const head = s.snake[0]!;
    expect(isAdjacent(head, free)).toBe(true);
    if (free.col > head.col) s.dir = "right";
    else if (free.col < head.col) s.dir = "left";
    else if (free.row > head.row) s.dir = "down";
    else s.dir = "up";
    s.tick();
    expect(s.ended).toBe(true);
    expect(s.endReason).toBe("cleared");
    expect(s.pellet).toBeNull();
  });
});

describe("obstacles", () => {
  it("makes an added obstacle cell fatal to the head", () => {
    const s = sim();
    s.clearPellet();
    s.addObstacle(16, 8);
    expect(s.tick().died).toBe(true);
  });

  it("adds a cell once, however often it is asked for", () => {
    const s = sim();
    s.addObstacle(20, 5);
    s.addObstacle(20, 5);
    expect(s.obstacles.filter((c) => c.col === 20 && c.row === 5)).toHaveLength(
      1,
    );
  });

  it("takes every obstacle off the board at once", () => {
    const s = sim();
    s.addObstacle(20, 5);
    s.addObstacle(20, 6);
    s.clearObstacles();
    expect(s.obstacles).toEqual([]);
    s.clearPellet();
    s.setSnake(chain(19, 5, 3));
    s.dir = "right";
    expect(s.tick().died).toBe(false);
  });
});

describe("restore", () => {
  it("returns every field to its opening value and leaves no pellet", () => {
    const s = sim();
    s.setSnake(chain(10, 8, 5));
    s.dir = "up";
    s.requestTurn("left");
    s.score = 400;
    s.combo = 4;
    s.comboWindow = 2;
    s.steering = false;
    s.travel = false;
    s.pelletRespawn = false;
    s.restore(DEFAULT_SEED);
    expect(s.snake).toEqual(START_CELLS.map((cell) => ({ ...cell })));
    expect(s.dir).toBe("right");
    expect(s.turns).toEqual([]);
    expect(s.score).toBe(0);
    expect(s.combo).toBe(1);
    expect(s.comboWindow).toBe(0);
    expect(s.pellet).toBeNull();
    expect(s.steering).toBe(true);
    expect(s.travel).toBe(true);
    expect(s.pelletRespawn).toBe(true);
  });
});

describe("isAdjacent", () => {
  it("holds for orthogonal neighbours alone", () => {
    expect(isAdjacent({ col: 3, row: 3 }, { col: 4, row: 3 })).toBe(true);
    expect(isAdjacent({ col: 3, row: 3 }, { col: 3, row: 2 })).toBe(true);
    expect(isAdjacent({ col: 3, row: 3 }, { col: 4, row: 4 })).toBe(false);
    expect(isAdjacent({ col: 3, row: 3 }, { col: 3, row: 3 })).toBe(false);
  });
});
