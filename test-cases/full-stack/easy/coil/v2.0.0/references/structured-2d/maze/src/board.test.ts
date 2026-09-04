import { describe, expect, it } from "vitest";
import {
  cellKey,
  cellX,
  cellY,
  cellsHold,
  isAdjacent,
  isInterior,
  isWall,
  sameCell,
  validPelletCells,
} from "./board";
import {
  BOARD_X,
  BOARD_Y,
  CELL,
  GRID_COLS,
  GRID_ROWS,
  INTERIOR_MAX_COL,
  INTERIOR_MAX_ROW,
  INTERIOR_MIN_COL,
  INTERIOR_MIN_ROW,
} from "./constants";

describe("cells on the stage", () => {
  it("maps a cell onto the logical square specs/board.md fixes", () => {
    expect(cellX(0)).toBe(BOARD_X);
    expect(cellY(0)).toBe(BOARD_Y);
    expect(cellX(GRID_COLS)).toBe(BOARD_X + GRID_COLS * CELL);
    expect(cellY(GRID_ROWS)).toBe(BOARD_Y + GRID_ROWS * CELL);
  });

  it("names each cell of the grid uniquely", () => {
    const keys = new Set<number>();
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) keys.add(cellKey(col, row));
    }
    expect(keys.size).toBe(GRID_COLS * GRID_ROWS);
  });
});

describe("the wall border", () => {
  it("is one cell thick on all four sides", () => {
    expect(isWall(0, 8)).toBe(true);
    expect(isWall(GRID_COLS - 1, 8)).toBe(true);
    expect(isWall(15, 0)).toBe(true);
    expect(isWall(15, GRID_ROWS - 1)).toBe(true);
    expect(isWall(INTERIOR_MIN_COL, INTERIOR_MIN_ROW)).toBe(false);
    expect(isWall(INTERIOR_MAX_COL, INTERIOR_MAX_ROW)).toBe(false);
  });

  it("leaves an interior of 28 by 16 cells", () => {
    let interior = 0;
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        if (isInterior(col, row)) interior += 1;
      }
    }
    expect(interior).toBe(28 * 16);
  });
});

describe("cell predicates", () => {
  it("holds for orthogonal neighbours alone", () => {
    const centre = { col: 5, row: 5 };
    expect(isAdjacent(centre, { col: 6, row: 5 })).toBe(true);
    expect(isAdjacent(centre, { col: 5, row: 4 })).toBe(true);
    expect(isAdjacent(centre, { col: 6, row: 6 })).toBe(false);
    expect(isAdjacent(centre, { col: 7, row: 5 })).toBe(false);
    expect(isAdjacent(centre, centre)).toBe(false);
  });

  it("finds a cell in a list, and reports its absence", () => {
    const cells = [
      { col: 3, row: 3 },
      { col: 4, row: 3 },
    ];
    expect(cellsHold(cells, 4, 3)).toBe(true);
    expect(cellsHold(cells, 3, 4)).toBe(false);
    expect(sameCell(cells[0]!, 3, 3)).toBe(true);
  });
});

describe("the valid pellet set", () => {
  it("is every interior cell on an empty board", () => {
    expect(validPelletCells([], null, []).length).toBe(28 * 16);
  });

  it("excludes the snake, the obstacles, and the live pellet", () => {
    const snake = [
      { col: 5, row: 5 },
      { col: 4, row: 5 },
    ];
    const obstacles = [{ col: 6, row: 5 }];
    const pellet = { col: 7, row: 5 };
    const free = validPelletCells(snake, pellet, obstacles);
    expect(free.length).toBe(28 * 16 - 4);
    for (const cell of [...snake, ...obstacles, pellet]) {
      expect(cellsHold(free, cell.col, cell.row)).toBe(false);
    }
  });

  it("is empty when every interior cell is taken", () => {
    const filled = [];
    for (let row = INTERIOR_MIN_ROW; row <= INTERIOR_MAX_ROW; row++) {
      for (let col = INTERIOR_MIN_COL; col <= INTERIOR_MAX_COL; col++) {
        filled.push({ col, row });
      }
    }
    expect(validPelletCells(filled, null, [])).toEqual([]);
  });
});
