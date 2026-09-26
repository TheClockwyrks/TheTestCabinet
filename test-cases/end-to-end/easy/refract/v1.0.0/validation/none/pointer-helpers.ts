// Refract — geometry shared by the pointer suites. CASE-PROVIDED.
//
// The cell center formula is specs/board.md's, and it lives in `notation.ts`
// beside the rest of the spec-derived oracle. This module is the one shape the
// pointer suites want it in: a board and a cell in, a stage position out.

import { cellCenter, type Board } from "./notation";

/** One cell address, `col` and `row` zero-indexed from the top-left. */
export interface CellRef {
  col: number;
  row: number;
}

/** The stage position of `cell`'s center on `board` (specs/board.md). */
export function cellCenterOf(
  board: Pick<Board, "cols" | "rows">,
  cell: CellRef,
): { x: number; y: number } {
  return cellCenter(cell.col, cell.row, board.cols, board.rows);
}
