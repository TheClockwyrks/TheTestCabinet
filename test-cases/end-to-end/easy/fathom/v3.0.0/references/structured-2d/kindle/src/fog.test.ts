import { describe, expect, it } from "vitest";

import {
  GRID_COLS,
  GRID_ROWS,
  TILE,
  VISION_GAIN,
  VISION_MIN,
} from "./constants";
import { anchor, stampLayout } from "./fixtures";
import { Fog, lineOfSightClear, visionRadius } from "./fog";
import { tileCenterX, tileCenterY } from "./grid";
import { Maze } from "./maze";

describe("the light radius", () => {
  it("runs from VISION_MIN at rest to its full reach at G = 1", () => {
    expect(visionRadius(0)).toBe(VISION_MIN);
    expect(visionRadius(1)).toBe(VISION_MIN + VISION_GAIN);
    expect(visionRadius(0.5)).toBe(VISION_MIN + VISION_GAIN / 2);
  });
});

describe("line of sight", () => {
  it("carries down an open corridor", () => {
    const board = stampLayout(["A......B"]);
    const maze = new Maze(board.rows);
    expect(lineOfSightClear(maze, anchor(board, "A"), anchor(board, "B"))).toBe(
      true,
    );
  });

  it("stops at the rock between two tiles", () => {
    const board = stampLayout(["A..#..B"]);
    const maze = new Maze(board.rows);
    expect(lineOfSightClear(maze, anchor(board, "A"), anchor(board, "B"))).toBe(
      false,
    );
  });

  it("reaches the rock it lands on and stops there", () => {
    const board = stampLayout(["A..#"]);
    const maze = new Maze(board.rows);
    const from = anchor(board, "A");
    const rock = { tx: from.tx + 3, ty: from.ty };
    expect(maze.isRock(rock.tx, rock.ty)).toBe(true);
    expect(lineOfSightClear(maze, from, rock)).toBe(true);
    expect(lineOfSightClear(maze, from, { tx: from.tx + 4, ty: from.ty })).toBe(
      false,
    );
  });

  it("does not slip diagonally past a rock corner", () => {
    const board = stampLayout(["A#", "#B"]);
    const maze = new Maze(board.rows);
    expect(lineOfSightClear(maze, anchor(board, "A"), anchor(board, "B"))).toBe(
      false,
    );
  });
});

describe("the fog of war", () => {
  it("opens with every tile unrevealed", () => {
    const fog = new Fog();
    const rows = fog.toRows();
    expect(rows).toHaveLength(GRID_ROWS);
    expect(rows.every((row) => row === "u".repeat(GRID_COLS))).toBe(true);
  });

  it("remembers a tile once it has been lit", () => {
    const fog = new Fog();
    fog.light(4, 5);
    expect(fog.visibilityAt(4, 5)).toBe("l");
    fog.clearLit();
    expect(fog.visibilityAt(4, 5)).toBe("r");
    expect(fog.isRevealed(4, 5)).toBe(true);
  });

  it("forgets everything on a reset", () => {
    const fog = new Fog();
    fog.light(4, 5);
    fog.reset();
    expect(fog.visibilityAt(4, 5)).toBe("u");
  });

  it("lights the pocket around the forager and stops at rock", () => {
    const board = stampLayout(["A..#..B"]);
    const maze = new Maze(board.rows);
    const from = anchor(board, "A");
    const behind = anchor(board, "B");
    const fog = new Fog();
    fog.lightPocket(
      maze,
      tileCenterX(from.tx),
      tileCenterY(from.ty),
      visionRadius(1),
    );
    expect(fog.isLit(from.tx, from.ty)).toBe(true);
    expect(fog.isLit(from.tx + 3, from.ty)).toBe(true);
    expect(fog.isLit(behind.tx, behind.ty)).toBe(false);
  });

  it("leaves a tile beyond the light radius dark", () => {
    const board = stampLayout(["A..........."]);
    const maze = new Maze(board.rows);
    const from = anchor(board, "A");
    const fog = new Fog();
    const radius = visionRadius(0);
    fog.lightPocket(maze, tileCenterX(from.tx), tileCenterY(from.ty), radius);
    const reach = Math.floor(radius / TILE);
    expect(fog.isLit(from.tx + reach, from.ty)).toBe(true);
    expect(fog.isLit(from.tx + reach + 1, from.ty)).toBe(false);
  });

  it("lights a flare's disc straight through rock", () => {
    const board = stampLayout(["A..#..B"]);
    const from = anchor(board, "A");
    const behind = anchor(board, "B");
    const fog = new Fog();
    fog.lightDisc(tileCenterX(from.tx), tileCenterY(from.ty), 6 * TILE);
    expect(fog.isLit(from.tx + 3, from.ty)).toBe(true);
    expect(fog.isLit(behind.tx, behind.ty)).toBe(true);
  });
});
