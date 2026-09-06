// Facet — dealing an opening board (specs/rules.md, `## The opening board`).
//
// An opening board has two properties: it holds NO RUN under R4, and AT LEAST
// ONE LEGAL SWAP exists on it. Every gem on it is plain at strain 0, with its
// kind drawn at random from `GEM_KINDS`.
//
// The first property is earned by construction: a cell is drawn from the kinds
// that would not complete a run with the two cells already placed to its left
// or above it, so no run can exist when the last cell is placed. At most two
// kinds are ever barred, so at least five remain and the draw never gets stuck.
//
// The second is earned by rejection: a dealt board almost always carries a
// legal swap, and one that does not is simply dealt again. The reserve board at
// the bottom is what makes that loop total rather than merely likely — it is a
// fixed board verified against both properties by this module's own tests, and
// it is reached only if every attempt in the budget misses.
//
// The whole board is dealt in from above, so a gem dealt into row `r` carries a
// `fell` of `r + 1`, exactly as a refilled gem does under R9: one row of
// travel per row of board it passed, and one more for the row above the top.

import { GEM_KINDS, GRID_COLS, GRID_ROWS } from "../constants";
import { parseBoard, plainGem } from "./board";
import { legalSwapExists, maximalRuns } from "./rules";
import { randomPicker, type Picker } from "./random";
import type { BoardState, Cell, Gem, GemKind } from "./state";

/** Deals made before the reserve board is taken. */
const MAX_ATTEMPTS = 64;

/**
 * A fixed opening board, held in the notation so what it is can be read.
 *
 * It is a diagonal Latin pattern — kind `(col + 3 * row) mod 7` — which has no
 * two neighbors alike in any row or column and therefore no run at all, with
 * two cells rewritten to plant a swap: exchanging `(2, 0)` with `(2, 1)` puts a
 * third ruby into the top row. `deal.test.ts` asserts both properties rather
 * than trusting this note.
 */
const RESERVE_ROWS = [
  "R0 R0 C0 J0 B0 S0 M0 R0",
  "J0 B0 R0 M0 R0 A0 C0 J0",
  "M0 R0 A0 C0 J0 B0 S0 M0",
  "C0 J0 B0 S0 M0 R0 A0 C0",
  "S0 M0 R0 A0 C0 J0 B0 S0",
  "A0 C0 J0 B0 S0 M0 R0 A0",
  "B0 S0 M0 R0 A0 C0 J0 B0",
  "R0 A0 C0 J0 B0 S0 M0 R0",
];

/**
 * The reserve board, parsed fresh so no caller can hold onto one instance. It
 * is dealt in from above like any other opening board, so the notation's
 * standing-still gems take the `fell` their rows give them.
 */
export function reserveBoard(): BoardState {
  const board = parseBoard(RESERVE_ROWS);
  return {
    ...board,
    gems: board.gems.map((gem, index) =>
      gem ? { ...gem, fell: Math.floor(index / board.cols) + 1 } : gem,
    ),
  };
}

/**
 * The kinds a cell may take without completing a run: everything except a kind
 * already standing on the `MATCH_MIN - 1` cells to its left, or on the
 * `MATCH_MIN - 1` cells above it. At most two kinds are ever barred, so five of
 * the seven always remain.
 */
function allowedKinds(
  gems: readonly (Gem | null)[],
  cols: number,
  cell: Cell,
): GemKind[] {
  const barred = new Set<GemKind>();
  const kindAt = (col: number, row: number): GemKind | null => {
    if (col < 0 || row < 0) return null;
    return gems[row * cols + col]?.kind ?? null;
  };
  const left = kindAt(cell.col - 1, cell.row);
  if (left !== null && left === kindAt(cell.col - 2, cell.row))
    barred.add(left);
  const above = kindAt(cell.col, cell.row - 1);
  if (above !== null && above === kindAt(cell.col, cell.row - 2)) {
    barred.add(above);
  }
  return GEM_KINDS.filter((kind) => !barred.has(kind));
}

/**
 * One deal of the fixed `GRID_COLS` by `GRID_ROWS` grid: plain gems at strain
 * `0`, each with the `fell` its row gives it, and no run under R4. Whether it
 * carries a legal swap is the caller's to check. The picker is anything that
 * can pick out of a list, so a test can hand it a degenerate one.
 */
export function dealBoardWithoutRuns(picker: Picker): BoardState {
  const cells = GRID_COLS * GRID_ROWS;
  const gems: (Gem | null)[] = new Array<Gem | null>(cells).fill(null);
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const kind = picker.pick(allowedKinds(gems, GRID_COLS, { col, row }));
      gems[row * GRID_COLS + col] = plainGem(kind, row + 1);
    }
  }
  return { cols: GRID_COLS, rows: GRID_ROWS, gems: gems as Gem[] };
}

/**
 * An opening board. Deals until one carries a legal swap, and falls to the
 * reserve board if the budget runs out. `attempts` is the budget, named so a
 * test can watch the fallback rather than trust it, and `picker` is the random
 * source, named so a test can hand it a degenerate one.
 */
export function dealOpeningBoard(
  picker: Picker = randomPicker,
  attempts: number = MAX_ATTEMPTS,
): BoardState {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const board = dealBoardWithoutRuns(picker);
    if (legalSwapExists(board)) return board;
  }
  return reserveBoard();
}

/**
 * Whether a board satisfies every property an opening board has: every gem
 * plain at strain `0` and dealt in from above its row, no run under R4, and at
 * least one legal swap. The deal guarantees them; this is what says so out
 * loud, and what the tests ask.
 */
export function isOpeningBoard(board: BoardState): boolean {
  const dealt = board.gems.every(
    (gem, index) =>
      gem !== null &&
      gem.cut === "plain" &&
      gem.strain === 0 &&
      gem.fell >= Math.floor(index / board.cols) + 1,
  );
  return dealt && maximalRuns(board).length === 0 && legalSwapExists(board);
}
