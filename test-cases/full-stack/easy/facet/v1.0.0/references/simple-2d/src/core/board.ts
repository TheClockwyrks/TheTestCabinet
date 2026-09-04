// Facet — the board: cell geometry, cell access, and the notation.
//
// Everything here is arithmetic over `BoardState` (specs/board.md). Nothing in
// this module holds state and nothing applies a rule: a cell's position on the
// stage is derived from its address, a gem is read out of the row-major array
// by address, and a board is written down in, and read back from, the notation
// `specs/board.md` fixes. The rules that run over a board are in `rules.ts`.

import {
  BOARD_CX,
  BOARD_CY,
  CELL_PITCH,
  GEM_HIT_R,
  GEM_KINDS,
  GRID_COLS,
  GRID_ROWS,
  MAX_STRAIN,
} from "../constants";
import type { BoardState, Cell, Cut, Gem, GemKind } from "./state";

// ---- Where a cell sits (specs/board.md) ----------------------------------

/** The stage x of a cell's center. */
export function cellX(col: number): number {
  return BOARD_CX - ((GRID_COLS - 1) * CELL_PITCH) / 2 + col * CELL_PITCH;
}

/** The stage y of a cell's center. */
export function cellY(row: number): number {
  return BOARD_CY - ((GRID_ROWS - 1) * CELL_PITCH) / 2 + row * CELL_PITCH;
}

/** A cell's center on the stage, both axes at once. */
export function cellCenter(cell: Cell): readonly [number, number] {
  return [cellX(cell.col), cellY(cell.row)];
}

// ---- Cells ---------------------------------------------------------------

export function sameCell(a: Cell, b: Cell): boolean {
  return a.col === b.col && a.row === b.row;
}

/**
 * R1's geometry: the two cells differ by `1` in column and `0` in row, or by
 * `0` in column and `1` in row (specs/rules.md). Diagonals are not adjacent.
 */
export function orthogonallyAdjacent(a: Cell, b: Cell): boolean {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1;
}

export function inBounds(board: BoardState, cell: Cell): boolean {
  return (
    cell.col >= 0 &&
    cell.col < board.cols &&
    cell.row >= 0 &&
    cell.row < board.rows
  );
}

/** The gem at a cell, or `null` for an empty cell or one off the board. */
export function gemAt(board: BoardState, cell: Cell): Gem | null {
  if (!inBounds(board, cell)) return null;
  return board.gems[cell.row * board.cols + cell.col];
}

/** The board with one cell replaced. The board handed in is not touched. */
export function withGem(
  board: BoardState,
  cell: Cell,
  gem: Gem | null,
): BoardState {
  const gems = [...board.gems];
  gems[cell.row * board.cols + cell.col] = gem;
  return { ...board, gems };
}

/** Every cell of the board in reading order, top-left to bottom-right. */
export function cellsOf(board: BoardState): Cell[] {
  const cells: Cell[] = [];
  for (let row = 0; row < board.rows; row++) {
    for (let col = 0; col < board.cols; col++) cells.push({ col, row });
  }
  return cells;
}

/** The four orthogonal neighbors of a cell that lie on the board. */
export function orthogonalNeighbors(board: BoardState, cell: Cell): Cell[] {
  const around = [
    { col: cell.col, row: cell.row - 1 },
    { col: cell.col, row: cell.row + 1 },
    { col: cell.col - 1, row: cell.row },
    { col: cell.col + 1, row: cell.row },
  ];
  return around.filter((next) => inBounds(board, next));
}

/** The eight cells surrounding a cell that lie on the board (R6). */
export function surroundingCells(board: BoardState, cell: Cell): Cell[] {
  const around: Cell[] = [];
  for (let dRow = -1; dRow <= 1; dRow++) {
    for (let dCol = -1; dCol <= 1; dCol++) {
      if (dCol === 0 && dRow === 0) continue;
      const next = { col: cell.col + dCol, row: cell.row + dRow };
      if (inBounds(board, next)) around.push(next);
    }
  }
  return around;
}

/**
 * The cell the pointer targets: the one whose center lies within `GEM_HIT_R`
 * of `(x, y)`, or `null` when no center is that close (specs/controls.md).
 *
 * `GEM_HIT_R` is exactly half of `CELL_PITCH`, so at most one center lies
 * STRICTLY within it, and the only ambiguity is a position lying exactly that
 * far from two centers. The scan runs in reading order and keeps a candidate
 * only on a strictly smaller distance, which is precisely the tie-break the
 * specification states: the lower row wins, and within one row the lower
 * column.
 */
export function targetCell(
  board: BoardState,
  x: number,
  y: number,
): Cell | null {
  let best: Cell | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const cell of cellsOf(board)) {
    const distance = Math.hypot(x - cellX(cell.col), y - cellY(cell.row));
    if (distance <= GEM_HIT_R && distance < bestDistance) {
      best = cell;
      bestDistance = distance;
    }
  }
  return best;
}

// ---- Notation (specs/board.md) -------------------------------------------

/** Kind letter → kind, in the order of `GEM_KINDS`. `X` is the prism. */
const KIND_LETTERS = ["R", "A", "C", "J", "B", "S", "M"] as const;

/** Cut letter → cut. `plain` writes no letter at all. */
const CUT_LETTERS: Readonly<Record<string, Cut>> = {
  b: "brilliant",
  s: "star",
};

// cspell:ignore RACJBSMX
const TOKEN = /^([RACJBSMX])([0-3])([bs]?)$/;

/**
 * One cell token — a kind letter, a strain digit, and an optional cut letter —
 * read into a gem. A token that is not the notation's throws an `Error` naming
 * it, so a bad pose fails loudly instead of producing a gem the rules cannot
 * make sense of.
 *
 * The notation carries no `fell`: every gem of a written board is standing
 * still in the cell it is written at, so it reads back at `0`.
 */
export function parseToken(token: string): Gem {
  const matched = TOKEN.exec(token);
  if (!matched) {
    throw new Error(`Facet: "${token}" is not a board notation cell token`);
  }
  const [, letter, digit, cutLetter] = matched;
  const strain = Number(digit);
  if (letter === "X") {
    // A prism carries no kind, so it takes no cut letter either: its cut IS
    // `prism`, and `Xb` would be naming two cuts for one gem.
    if (cutLetter !== "") {
      throw new Error(`Facet: "${token}" gives a prism a second cut`);
    }
    return { kind: null, cut: "prism", strain, fell: 0 };
  }
  return {
    kind: GEM_KINDS[KIND_LETTERS.indexOf(letter as (typeof KIND_LETTERS)[0])],
    cut: cutLetter === "" ? "plain" : CUT_LETTERS[cutLetter],
    strain,
    fell: 0,
  };
}

/** A gem written back as the cell token that would read it back unchanged. */
export function formatToken(gem: Gem): string {
  if (gem.cut === "prism") return `X${gem.strain}`;
  if (gem.kind === null) {
    throw new Error(
      `Facet: a ${gem.cut} gem carries a kind, and this one has none`,
    );
  }
  const letter = KIND_LETTERS[GEM_KINDS.indexOf(gem.kind)];
  const cutLetter =
    gem.cut === "brilliant" ? "b" : gem.cut === "star" ? "s" : "";
  return `${letter}${gem.strain}${cutLetter}`;
}

/**
 * A board from its notation: `GRID_ROWS` strings of `GRID_COLS` space-separated
 * tokens, read from the top-left to the bottom-right. The dimensions and every
 * token are checked as they are read, and anything wrong throws. Every gem of
 * the board it builds is standing still, so every one of them carries `fell`
 * `0`.
 */
export function parseBoard(rows: readonly string[]): BoardState {
  if (rows.length !== GRID_ROWS) {
    throw new Error(`Facet: a board is ${GRID_ROWS} rows, not ${rows.length}`);
  }
  const gems: Gem[] = [];
  rows.forEach((line, row) => {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length !== GRID_COLS) {
      throw new Error(
        `Facet: row ${row} carries ${tokens.length} cells, not ${GRID_COLS}`,
      );
    }
    for (const token of tokens) gems.push(parseToken(token));
  });
  return { cols: GRID_COLS, rows: GRID_ROWS, gems };
}

/**
 * A board written back in the notation, one string per row. A board with an
 * empty cell has no notation — a cell stands empty only inside a chain step —
 * so writing one out throws rather than inventing a token for it.
 */
export function formatBoard(board: BoardState): string[] {
  const lines: string[] = [];
  for (let row = 0; row < board.rows; row++) {
    const tokens: string[] = [];
    for (let col = 0; col < board.cols; col++) {
      const gem = gemAt(board, { col, row });
      if (!gem) {
        throw new Error(`Facet: (${col}, ${row}) is empty and has no token`);
      }
      tokens.push(formatToken(gem));
    }
    lines.push(tokens.join(" "));
  }
  return lines;
}

/**
 * A plain gem of a kind at strain `0`, which is what a refill and a deal both
 * place. `fell` is how far it traveled to arrive, which is `0` for a gem
 * written down where it stands and `row + 1` or more for one dealt in from
 * above the board's top row.
 */
export function plainGem(kind: GemKind, fell: number = 0): Gem {
  return { kind, cut: "plain", strain: 0, fell };
}

/** Whether a gem is flawed, which is to say it carries `MAX_STRAIN` (R6). */
export function isFlawed(gem: Gem): boolean {
  return gem.strain >= MAX_STRAIN;
}
