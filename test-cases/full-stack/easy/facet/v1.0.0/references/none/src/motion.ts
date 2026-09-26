// Facet — where a gem is DRAWN, which is not always the cell it is in.
//
// `specs/rules.md` fixes three spans a board is in motion over, and this module
// is the arithmetic that turns each of them into a position. It is pure — a
// state and a cell in, a point out — so the renderer stays a pure function of
// the state it is handed and every figure below can be checked without a
// canvas.
//
// THE STEP'S TIMELINE. `stepTimer` counts from `0` at the moment a chain step
// resolves, and the step has already left the settled board behind: the cells
// it cleared are gone, the survivors are in their new cells, and every gem
// carries the `fell` R9 gave it. So the picture runs BACKWARD off that board.
// From `0` to `SHATTER_END` the clear set shatters, a cell at wave `w` going at
// `w * WAVE_SECONDS` (`src/effects.ts` plays those), and every gem that moved
// is still held `fell` rows above its cell. From `SHATTER_END` each gem falls
// for `fell * FALL_SECONDS_PER_ROW` and arrives.
//
// A FRESH BOARD POURS IN THE SAME WAY. A dealt board's gems carry a `fell` of
// at least `row + 1` — they came from above the board's top row — but no step
// resolved, so `stepTimer` is `0` and there is nothing in the state to run the
// pour off. The presentation layer times that one itself, and hands the elapsed
// game time in as `pourAge`; `Number.POSITIVE_INFINITY` means no pour is
// running and every gem is resting in its cell.
//
// THE SWAP. While `phase` is `swapping` the two cells have ALREADY been
// exchanged, so the gem standing at `a` is the one that was at `b`: it is drawn
// travelling from `b` to `a` over `SWAP_SECONDS`, which is what a player reads
// as the two stones trading places.
//
// THE OFFER. While an offer stands nothing has moved at all — a release is what
// plays the move — so the two named gems are simply drawn in each other's
// cells, and a player sees the move a release would play before committing to
// it (specs/ui.md).

import { CELL_PITCH, FALL_SECONDS_PER_ROW, SWAP_SECONDS } from "./constants";
import {
  cellCenter,
  gemAt,
  sameCell,
  shatterEnd,
  type Cell,
  type FacetState,
  type Gem,
} from "./core";

/** A point on the stage, in logical units. */
export type Point = readonly [number, number];

/** `pourAge` for a board with no pour running: every gem rests in its cell. */
export const NO_POUR = Number.POSITIVE_INFINITY;

/**
 * How long a gem that traveled `fell` rows is in the air, in game time.
 * `specs/rules.md`: "a gem that fell `n` rows taking `n * FALL_SECONDS_PER_ROW`
 * to arrive".
 */
export function fallSeconds(fell: number): number {
  return Math.max(0, fell) * FALL_SECONDS_PER_ROW;
}

/**
 * The game time the board's current fall has run for, which is `stepTimer` past
 * the step's shattering while a chain is resolving and the presentation's own
 * pour clock otherwise.
 */
export function fallElapsed(state: FacetState, pourAge: number): number {
  if (state.phase === "resolving") return state.stepTimer - shatterEnd(state);
  return pourAge;
}

/**
 * How many rows ABOVE its cell a gem that traveled `fell` rows still stands,
 * `elapsed` into the fall: the whole of `fell` while the clear set is still
 * shattering, closing linearly to `0` as it arrives.
 */
export function fallRows(fell: number, elapsed: number): number {
  const span = fallSeconds(fell);
  if (span <= 0 || elapsed >= span) return 0;
  if (elapsed <= 0) return fell;
  return fell * (1 - elapsed / span);
}

/**
 * The cell a gem standing at `cell` is travelling FROM, or `null` when it is
 * not in a swap. The swap exchanged the two cells already, so the origin of
 * each is the other one.
 */
export function swapOrigin(state: FacetState, cell: Cell): Cell | null {
  if (state.phase !== "swapping" || state.chainSwap === null) return null;
  const { a, b } = state.chainSwap;
  if (sameCell(a, cell)) return b;
  if (sameCell(b, cell)) return a;
  return null;
}

/** How far through the swap in motion the board is, in `0..1`. */
export function swapProgress(state: FacetState): number {
  return Math.min(1, Math.max(0, state.swapTimer / SWAP_SECONDS));
}

/**
 * Where the gem standing at `cell` is drawn: travelling between the two swapped
 * cells while a swap is in motion, still short of its cell while it is falling,
 * and on the cell center `specs/board.md` fixes once it has arrived.
 */
export function gemCenter(
  state: FacetState,
  cell: Cell,
  pourAge: number,
): Point {
  const [x, y] = cellCenter(cell);
  const origin = swapOrigin(state, cell);
  if (origin !== null) {
    const [fromX, fromY] = cellCenter(origin);
    const traveled = swapProgress(state);
    return [fromX + (x - fromX) * traveled, fromY + (y - fromY) * traveled];
  }
  const fell = gemAt(state.board, cell)?.fell ?? 0;
  return [x, y - fallRows(fell, fallElapsed(state, pourAge)) * CELL_PITCH];
}

/**
 * The gem DRAWN at `cell`, which is the neighbor's while an offer stands: the
 * gem at `selection` and the gem at `offer` trade places on the screen and
 * nowhere else, so the board itself is untouched until a release plays the
 * move (specs/ui.md, specs/controls.md).
 */
export function gemShownAt(state: FacetState, cell: Cell): Gem | null {
  const { selection, offer } = state;
  if (selection !== null && offer !== null) {
    if (sameCell(cell, selection)) return gemAt(state.board, offer);
    if (sameCell(cell, offer)) return gemAt(state.board, selection);
  }
  return gemAt(state.board, cell);
}

/**
 * Whether every gem on a board came in from above it, which is exactly what
 * `specs/rules.md` requires of an opening board: "a gem dealt into row `r`
 * carries a `fell` of at least `r + 1`".
 *
 * It is what tells a board that was DEALT from a board that merely changed —
 * a swap exchanging two cells, a posed `loadBoard`, one cell written — so only
 * the first of those pours in from above.
 */
export function isPouredBoard(state: FacetState): boolean {
  const { board } = state;
  if (board.cols === 0 || board.rows === 0) return false;
  for (let row = 0; row < board.rows; row += 1) {
    for (let col = 0; col < board.cols; col += 1) {
      const gem = board.gems[row * board.cols + col];
      if (!gem || gem.fell < row + 1) return false;
    }
  }
  return true;
}
