import { describe, expect, it } from "vitest";

import { board } from "./board.test-support";
import { TILE, VISION_GAIN, VISION_MIN } from "./constants";
import { Maze } from "./maze";
import { Fog, lineOfSightClear } from "./sensing";

function posed(rows: readonly string[], top = 0, left = 0): Maze {
  const maze = new Maze();
  maze.load(board(rows, top, left));
  return maze;
}

describe("line of sight", () => {
  it("runs clear along an open corridor", () => {
    const maze = posed(["........"], 5, 4);
    expect(lineOfSightClear(maze, 4, 5, 11, 5)).toBe(true);
  });

  it("is broken by rock standing between the two tiles", () => {
    const maze = posed(["...#...."], 5, 4);
    expect(lineOfSightClear(maze, 4, 5, 11, 5)).toBe(false);
  });

  it("reaches the rock it lands on", () => {
    const maze = posed(["....#"], 5, 4);
    expect(lineOfSightClear(maze, 4, 5, 8, 5)).toBe(true);
  });

  it("does not bend around a corner", () => {
    // An L: a top corridor and a right-hand corridor, with rock filling the
    // corner between them.
    const maze = posed(["....", "###.", "###."], 4, 4);
    expect(lineOfSightClear(maze, 7, 6, 7, 4)).toBe(true);
    expect(lineOfSightClear(maze, 7, 6, 4, 4)).toBe(false);
  });

  it("holds trivially between a tile and itself", () => {
    const maze = posed(["...."], 5, 4);
    expect(lineOfSightClear(maze, 5, 5, 5, 5)).toBe(true);
  });
});

describe("the light pocket", () => {
  it("lights every tile inside V with a clear line, and none beyond it", () => {
    const maze = posed([".".repeat(20)], 5, 4);
    const fog = new Fog();
    fog.lightPocket(maze, Maze.centerX(10), Maze.centerY(5), VISION_MIN);

    // V is 96, three tiles, so the tiles three either way are lit and the fourth
    // is not.
    expect(fog.isLit(10, 5)).toBe(true);
    expect(fog.isLit(13, 5)).toBe(true);
    expect(fog.isLit(7, 5)).toBe(true);
    expect(fog.isLit(14, 5)).toBe(false);
    expect(fog.isLit(6, 5)).toBe(false);
  });

  it("widens with the brightness the specification's formula gives", () => {
    const maze = posed([".".repeat(20)], 5, 4);
    const fog = new Fog();
    fog.lightPocket(
      maze,
      Maze.centerX(10),
      Maze.centerY(5),
      VISION_MIN + VISION_GAIN,
    );
    // V is 160 at G = 1, five tiles.
    expect(fog.isLit(15, 5)).toBe(true);
    expect(fog.isLit(16, 5)).toBe(false);
  });

  it("stops at the rock it lands on, leaving what is behind it alone", () => {
    const maze = posed([".....#....."], 5, 4);
    const fog = new Fog();
    fog.lightPocket(maze, Maze.centerX(7), Maze.centerY(5), VISION_MIN);
    expect(fog.isLit(9, 5)).toBe(true); // the rock itself
    expect(fog.isLit(10, 5)).toBe(false); // the corridor behind it
    expect(fog.isRevealed(10, 5)).toBe(false);
  });

  it("remembers what it lit once the light has moved on", () => {
    const maze = posed([".".repeat(30)], 5, 2);
    const fog = new Fog();
    fog.lightPocket(maze, Maze.centerX(5), Maze.centerY(5), VISION_MIN);
    expect(fog.visibility(5, 5)).toBe("lit");

    fog.clearLit();
    fog.lightPocket(maze, Maze.centerX(25), Maze.centerY(5), VISION_MIN);
    expect(fog.visibility(5, 5)).toBe("remembered");
    expect(fog.visibility(25, 5)).toBe("lit");
  });

  it("leaves a tile no source has touched unrevealed", () => {
    const maze = posed([".".repeat(30)], 5, 2);
    const fog = new Fog();
    fog.lightPocket(maze, Maze.centerX(5), Maze.centerY(5), VISION_MIN);
    expect(fog.visibility(25, 5)).toBe("unrevealed");
  });

  it("forgets the whole maze when reset", () => {
    const maze = posed([".".repeat(30)], 5, 2);
    const fog = new Fog();
    fog.lightPocket(maze, Maze.centerX(5), Maze.centerY(5), VISION_MIN);
    fog.reset();
    expect(fog.visibility(5, 5)).toBe("unrevealed");
  });
});

describe("a flare's disc", () => {
  it("lights rock and floor alike, straight through the rock between", () => {
    posed([".#.#.#.#."], 5, 4);
    const fog = new Fog();
    fog.lightDisc(Maze.centerX(4), Maze.centerY(5), 3 * TILE);
    for (let c = 4; c <= 7; c++) expect(fog.isLit(c, 5)).toBe(true);
    expect(fog.isLit(8, 5)).toBe(false);
  });
});

describe("the visibility grid", () => {
  it("reports one character per tile in the snapshot's alphabet", () => {
    const maze = posed([".".repeat(20)], 5, 4);
    const fog = new Fog();
    fog.lightPocket(maze, Maze.centerX(10), Maze.centerY(5), VISION_MIN);
    const rows = fog.rows();
    expect(rows).toHaveLength(18);
    for (const row of rows) expect(row).toMatch(/^[url]{36}$/);
    expect(rows[5][10]).toBe("l");
    expect(rows[0][0]).toBe("u");
  });
});
