import { describe, expect, it } from "vitest";
import { GRID_COLS, GRID_ROWS } from "./constants";
import { generateMaze } from "./maze-generator";
import { mazeFaults } from "./maze-rules";
import { createDraws } from "./rng";

describe("laying a maze out", () => {
  it("lays out a maze that satisfies every rule, for every layout tried", () => {
    for (let layout = 1; layout <= 120; layout++) {
      const maze = generateMaze(createDraws());
      expect(mazeFaults(maze), `layout ${layout}`).toEqual([]);
    }
  });

  it("lays out the grid specs/overview.md fixes", () => {
    const maze = generateMaze(createDraws());
    expect(maze.rows).toHaveLength(GRID_ROWS);
    for (const row of maze.rows) expect(row).toHaveLength(GRID_COLS);
  });

  it("carries a den, a gate and a wrap tunnel", () => {
    const maze = generateMaze(createDraws());
    expect(maze.denTiles.length).toBeGreaterThan(0);
    expect(maze.gate).not.toBeNull();
    expect(maze.wrapRow).toBeGreaterThanOrEqual(0);
  });

  it("lays out different mazes from one draw to the next", () => {
    const draws = createDraws();
    const first = generateMaze(draws);
    const second = generateMaze(draws);
    expect(second.rows).not.toEqual(first.rows);
  });
});
