import { describe, expect, it } from "vitest";

import { board } from "./board.test-support";
import { FORAGER_SPEED, GRID_COLS, TICK_DT, TILE } from "./constants";
import { advance, atCenter, Drifter, Forager, wanderDir } from "./entities";
import { Maze } from "./maze";
import type { CanEnter } from "./maze";
import { Rng } from "./rng";
import type { Dir, Heading } from "./types";

function posed(rows: readonly string[], top = 0, left = 0): Maze {
  const maze = new Maze();
  maze.load(board(rows, top, left));
  return maze;
}

function corridorOf(maze: Maze): CanEnter {
  return (c, r) => maze.isCorridor(c, r);
}

/** Run a body for `ticks` whole simulation ticks with one held direction. */
function drive(
  body: Forager | Drifter,
  maze: Maze,
  held: Heading,
  ticks: number,
): void {
  for (let i = 0; i < ticks; i++) {
    advance(body, TICK_DT, maze, () => held, corridorOf(maze));
  }
}

describe("travelling the corridors", () => {
  it("holds a constant speed wherever it is in the maze", () => {
    const maze = posed([".".repeat(20)], 5, 4);
    const forager = new Forager(4, 5, FORAGER_SPEED);
    const start = forager.x;
    drive(forager, maze, "right", 120);
    expect(forager.x - start).toBeCloseTo(FORAGER_SPEED, 6);
  });

  it("comes to rest at a center when the tile ahead is rock", () => {
    const maze = posed(["...."], 5, 4);
    const forager = new Forager(4, 5, FORAGER_SPEED);
    drive(forager, maze, "right", 240);
    expect(forager.col).toBe(7);
    expect(atCenter(forager)).toBe(true);
    expect(forager.dir).toBeNull();
    expect(forager.x).toBeCloseTo(Maze.centerX(7), 9);
  });

  it("never stands on rock", () => {
    const maze = posed([".....", "#####"], 5, 4);
    const forager = new Forager(4, 5, FORAGER_SPEED);
    for (let i = 0; i < 240; i++) {
      advance(forager, TICK_DT, maze, () => "down", corridorOf(maze));
      expect(maze.isRock(forager.col, forager.row)).toBe(false);
    }
  });

  it("takes a reversal at once, wherever it stands on a tile", () => {
    const maze = posed([".".repeat(12)], 5, 4);
    const forager = new Forager(6, 5, FORAGER_SPEED);
    drive(forager, maze, "right", 15); // a little under half a tile
    expect(atCenter(forager)).toBe(false);
    const mid = forager.x;
    drive(forager, maze, "left", 1);
    expect(forager.x).toBeLessThan(mid);
    expect(forager.dir).toBe("left");
  });

  it("takes a quarter turn at a tile center and nowhere else", () => {
    const maze = posed(["....", "....", "...."], 4, 4);
    const forager = new Forager(4, 4, FORAGER_SPEED);
    // A quarter of a tile along, the turn is still pending.
    drive(forager, maze, "right", 8);
    drive(forager, maze, "down", 1);
    expect(forager.row).toBe(4);
    expect(forager.dir).toBe("right");
    // Carried on to the next center, it turns there.
    drive(forager, maze, "down", 60);
    expect(forager.dir).toBe("down");
    expect(forager.col).toBe(5);
  });

  it("carries on straight past the centers where the turn is into rock", () => {
    const maze = posed(["....", "###.", "###."], 4, 4);
    const forager = new Forager(4, 4, FORAGER_SPEED);
    drive(forager, maze, "right", 15); // travelling, part-way along its tile
    // Down is rock at (5, 4) and (6, 4), and open at (7, 4) alone.
    drive(forager, maze, "down", 120);
    expect(forager.col).toBe(7);
    expect(forager.dir).toBe("down");
  });

  it("stays on a tile whose neighbors are all closed to it", () => {
    const maze = posed(["#.#", "#.#", "#.#"], 4, 4);
    const boxed = posed(["..."], 8, 4);
    const drifter = new Drifter(5, 8, FORAGER_SPEED);
    boxed.load(board(["#", "#", "#"], 8, 5)); // seal the tile it stands on
    for (let i = 0; i < 60; i++) {
      advance(
        drifter,
        TICK_DT,
        boxed,
        () => "right",
        (c, r) => boxed.isCorridor(c, r),
      );
    }
    expect(drifter.x).toBeCloseTo(Maze.centerX(5), 9);
    expect(drifter.dir).toBeNull();
    expect(maze.wrapRow).toBe(-1);
  });

  it("keeps its facing at rest and reports it while travelling", () => {
    const maze = posed([".".repeat(8)], 5, 4);
    const forager = new Forager(5, 5, FORAGER_SPEED);
    expect(forager.facing).toBe("up");
    drive(forager, maze, "right", 60);
    expect(forager.facing).toBe("right");
    drive(forager, maze, null, 60);
    expect(forager.facing).toBe("right");
    expect(forager.dir).toBeNull();
  });

  it("comes to rest where it stands the moment nothing is held", () => {
    const maze = posed([".".repeat(12)], 5, 4);
    const forager = new Forager(5, 5, FORAGER_SPEED);
    drive(forager, maze, "right", 15);
    const stopped = forager.x;
    expect(atCenter(forager)).toBe(false);
    drive(forager, maze, null, 120);
    expect(forager.x).toBeCloseTo(stopped, 9);
    expect(forager.dir).toBeNull();
  });

  it("resumes along its own axis when a quarter turn is asked for off-center", () => {
    const maze = posed(["....", "....", "...."], 4, 4);
    const forager = new Forager(4, 4, FORAGER_SPEED);
    drive(forager, maze, "right", 15); // at rest part-way along the tile
    drive(forager, maze, null, 1);
    expect(atCenter(forager)).toBe(false);
    drive(forager, maze, "down", 1);
    expect(forager.dir).toBe("right");
    drive(forager, maze, "down", 60);
    expect(forager.dir).toBe("down");
  });

  it("takes a reversal from rest wherever it stands", () => {
    const maze = posed([".".repeat(12)], 5, 4);
    const forager = new Forager(6, 5, FORAGER_SPEED);
    drive(forager, maze, "right", 15);
    drive(forager, maze, null, 1);
    const stopped = forager.x;
    drive(forager, maze, "left", 1);
    expect(forager.dir).toBe("left");
    expect(forager.x).toBeLessThan(stopped);
  });
});

describe("the wrap tunnel", () => {
  function tunnel(): Maze {
    const maze = new Maze();
    const rows = board([]);
    rows[9] = ".".repeat(GRID_COLS);
    maze.load(rows);
    return maze;
  }

  it("covers one ordinary step from one mouth's center to the other's", () => {
    const maze = tunnel();
    const forager = new Forager(0, 9, FORAGER_SPEED);
    const ticks = Math.round(TILE / FORAGER_SPEED / TICK_DT);
    drive(forager, maze, "left", ticks);
    expect(forager.col).toBe(GRID_COLS - 1);
    expect(forager.x).toBeCloseTo(Maze.centerX(GRID_COLS - 1), 6);
  });

  it("carries a position across rather than snapping it", () => {
    const maze = tunnel();
    const forager = new Forager(0, 9, FORAGER_SPEED);
    const ticks = 24;
    const travelled = ticks * FORAGER_SPEED * TICK_DT;
    drive(forager, maze, "left", ticks);
    // It stands as far short of the far mouth's center as it has still to go.
    expect(forager.x).toBeCloseTo(
      Maze.centerX(GRID_COLS - 1) + TILE - travelled,
      6,
    );
  });

  it("keeps a center inside the maze region", () => {
    const maze = tunnel();
    const forager = new Forager(GRID_COLS - 1, 9, FORAGER_SPEED);
    for (let i = 0; i < 600; i++) {
      advance(forager, TICK_DT, maze, () => "right", corridorOf(maze));
      expect(forager.x).toBeGreaterThanOrEqual(64);
      expect(forager.x).toBeLessThanOrEqual(1216);
    }
  });

  it("does not wrap a row the tunnel does not pierce", () => {
    const maze = new Maze();
    const rows = board([]);
    rows[9] = ".".repeat(GRID_COLS);
    rows[12] = ".".repeat(GRID_COLS);
    maze.load(rows);
    const forager = new Forager(0, 12, FORAGER_SPEED);
    drive(forager, maze, "left", 120);
    expect(forager.col).toBe(0);
    expect(forager.x).toBeCloseTo(Maze.centerX(0), 9);
  });
});

describe("the wander", () => {
  it("prefers a direction other than the way it came", () => {
    const maze = posed(["....", "....", "...."], 4, 4);
    const rng = new Rng(5);
    const drifter = new Drifter(5, 5, 64);
    drifter.dir = "right";
    const picks = new Set<Heading>();
    for (let i = 0; i < 200; i++)
      picks.add(wanderDir(drifter, maze, rng, corridorOf(maze)));
    expect(picks.has("left")).toBe(false);
    expect(picks.size).toBeGreaterThan(1);
  });

  it("turns back where the tile offers nothing else", () => {
    const maze = posed(["..."], 5, 4);
    const rng = new Rng(5);
    const drifter = new Drifter(6, 5, 64);
    drifter.dir = "right";
    // (6, 5) is the far end: only the way back is open.
    expect(wanderDir(drifter, maze, rng, corridorOf(maze))).toBe("left");
  });

  it("stands still on a tile with no open neighbor", () => {
    const maze = posed(["."], 5, 4);
    const rng = new Rng(5);
    const drifter = new Drifter(4, 5, 64);
    expect(wanderDir(drifter, maze, rng, corridorOf(maze))).toBeNull();
  });

  it("takes every open direction over enough draws", () => {
    const maze = posed(["...", "...", "..."], 4, 4);
    const rng = new Rng(9);
    const drifter = new Drifter(5, 5, 64);
    const seen = new Set<Dir>();
    for (let i = 0; i < 400; i++) {
      const d = wanderDir(drifter, maze, rng, corridorOf(maze));
      if (d !== null) seen.add(d);
    }
    expect(seen.size).toBe(4);
  });
});
