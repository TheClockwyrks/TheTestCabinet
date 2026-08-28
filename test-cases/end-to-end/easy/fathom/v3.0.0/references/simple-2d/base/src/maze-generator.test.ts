import { describe, expect, it } from "vitest";
import { GRID_COLS, GRID_ROWS } from "./constants";
import { generateMaze } from "./maze-generator";
import { mazeFaults } from "./maze-rules";
import { createDraws } from "./rng";

describe("laying a maze out", () => {
  it("lays out a maze that satisfies every rule, for every seed tried", () => {
    for (let seed = 1; seed <= 120; seed++) {
      const maze = generateMaze(createDraws(seed));
      expect(mazeFaults(maze), `seed ${seed}`).toEqual([]);
    }
  });

  it("lays out the grid specs/overview.md fixes", () => {
    const maze = generateMaze(createDraws(1));
    expect(maze.rows).toHaveLength(GRID_ROWS);
    for (const row of maze.rows) expect(row).toHaveLength(GRID_COLS);
  });

  it("carries a den, a gate and a wrap tunnel", () => {
    const maze = generateMaze(createDraws(4));
    expect(maze.denTiles.length).toBeGreaterThan(0);
    expect(maze.gate).not.toBeNull();
    expect(maze.wrapRow).toBeGreaterThanOrEqual(0);
  });

  it("draws the same maze from the same generator state", () => {
    expect(generateMaze(createDraws(9)).rows).toEqual(
      generateMaze(createDraws(9)).rows,
    );
    expect(generateMaze(createDraws(9)).rows).not.toEqual(
      generateMaze(createDraws(10)).rows,
    );
  });

  it("draws a different maze from the state the last one left", () => {
    const draws = createDraws(1);
    const first = generateMaze(draws);
    const second = generateMaze(draws);
    expect(second.rows).not.toEqual(first.rows);
  });
});
