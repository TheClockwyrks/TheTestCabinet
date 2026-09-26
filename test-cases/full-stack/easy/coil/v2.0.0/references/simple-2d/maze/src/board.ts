// Coil — the board's geometry, in cells and in logical units (specs/board.md).
//
// `src/constants.ts` fixes the grid's figures and the engine fixes nothing about
// them, so the arithmetic over those figures is the build's. Two jobs live here
// and they are deliberately kept apart: mapping a cell onto the logical square it
// is drawn in, which only the renderer needs, and answering what a cell IS, which
// only the simulation needs.
//
// Every function is pure and total: none reads the state, none allocates beyond
// what it returns, and a cell outside the grid is answered rather than refused.

import {
  BOARD_X,
  BOARD_Y,
  CELL,
  GRID_COLS,
  INTERIOR_MAX_COL,
  INTERIOR_MAX_ROW,
  INTERIOR_MIN_COL,
  INTERIOR_MIN_ROW,
  type Cell,
} from "./constants";

/** The logical x of the left edge of column `col`. */
export function cellX(col: number): number {
  return BOARD_X + col * CELL;
}

/** The logical y of the top edge of row `row`. */
export function cellY(row: number): number {
  return BOARD_Y + row * CELL;
}

/** Whether `(col, row)` is one of the perimeter cells the wall border occupies. */
export function isWall(col: number, row: number): boolean {
  return (
    col < INTERIOR_MIN_COL ||
    col > INTERIOR_MAX_COL ||
    row < INTERIOR_MIN_ROW ||
    row > INTERIOR_MAX_ROW
  );
}

/** Whether `(col, row)` is an interior cell, which is any cell not a wall cell. */
export function isInterior(col: number, row: number): boolean {
  return !isWall(col, row);
}

/**
 * A single integer naming one cell of the grid, for set membership.
 *
 * The grid is 30 by 18, so `row * GRID_COLS + col` is unique across it and a set
 * of cells is a set of numbers rather than a set of objects no two of which are
 * ever the same reference.
 */
export function cellKey(col: number, row: number): number {
  return row * GRID_COLS + col;
}

/** Whether two cells are the same cell. */
export function sameCell(cell: Cell, col: number, row: number): boolean {
  return cell.col === col && cell.row === row;
}

/** Whether two cells are orthogonally adjacent. */
export function isAdjacent(a: Cell, b: Cell): boolean {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1;
}

/** Whether any cell of `cells` is `(col, row)`. */
export function cellsHold(
  cells: readonly Cell[],
  col: number,
  row: number,
): boolean {
  return cells.some((cell) => sameCell(cell, col, row));
}

/**
 * Every cell a pellet may spawn on: an interior cell holding no snake segment, no
 * obstacle, and not the cell the current pellet occupies (specs/board.md).
 *
 * Collected in one pass rather than sampled and retried, so a nearly full board
 * picks its pellet without a stall. An empty result is the board-cleared win.
 */
export function validPelletCells(
  snake: readonly Cell[],
  pellet: Cell | null,
  obstacles: readonly Cell[],
): Cell[] {
  const taken = new Set<number>();
  for (const segment of snake) taken.add(cellKey(segment.col, segment.row));
  for (const cell of obstacles) taken.add(cellKey(cell.col, cell.row));
  if (pellet) taken.add(cellKey(pellet.col, pellet.row));

  const free: Cell[] = [];
  for (let row = INTERIOR_MIN_ROW; row <= INTERIOR_MAX_ROW; row++) {
    for (let col = INTERIOR_MIN_COL; col <= INTERIOR_MAX_COL; col++) {
      if (!taken.has(cellKey(col, row))) free.push({ col, row });
    }
  }
  return free;
}
