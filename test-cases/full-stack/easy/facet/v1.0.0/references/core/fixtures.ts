// Facet — boards the core's own tests are written against.
//
// This module is test support, not game code: nothing under `src/` outside the
// `*.test.ts` files imports it. It lives beside the core rather than inside one
// test file because several of them need the same substrate.
//
// THE QUIET BOARD is that substrate. Its kind at `(col, row)` is
// `GEM_KINDS[(col + 3 * row) % 7]`, so along a row the kind advances by one and
// down a column by three: no two neighbors are ever alike, the board therefore
// carries no run under R4, and — because every swap moves a kind by one or
// three into a neighborhood that differs from it by one, two, three, four, or
// six — no swap on it is productive either. A test can pose it, edit the
// handful of cells its scenario is about, and know that everything it did not
// touch stays out of the way.

import { GRID_COLS, GRID_ROWS } from "../constants";
import { loadBoard, setRefillKinds, setScreen } from "./debug";
import { createInitialState, type FacetState } from "./state";

/** The kind letters of the notation, in the order of `GEM_KINDS`. */
const KIND_LETTERS = ["R", "A", "C", "J", "B", "S", "M"] as const;

/**
 * The quiet board: no run stands on it, and no swap on it is productive, so it
 * is both a board with no legal swap and an inert filler around a scenario.
 */
export function quietRows(): string[] {
  const rows: string[] = [];
  for (let row = 0; row < GRID_ROWS; row++) {
    const tokens: string[] = [];
    for (let col = 0; col < GRID_COLS; col++) {
      tokens.push(`${KIND_LETTERS[(col + 3 * row) % KIND_LETTERS.length]}0`);
    }
    rows.push(tokens.join(" "));
  }
  return rows;
}

/** One cell of a notation board rewritten, keyed `"col,row"`. */
export function rewrite(
  rows: readonly string[],
  edits: Readonly<Record<string, string>>,
): string[] {
  const grid = rows.map((line) => line.trim().split(/\s+/));
  for (const [key, token] of Object.entries(edits)) {
    const [col, row] = key.split(",").map(Number);
    if (
      !Number.isInteger(col) ||
      !Number.isInteger(row) ||
      col < 0 ||
      col >= GRID_COLS ||
      row < 0 ||
      row >= GRID_ROWS
    ) {
      throw new Error(`Facet: "${key}" is not a cell of the board`);
    }
    grid[row][col] = token;
  }
  return grid.map((line) => line.join(" "));
}

/**
 * The refill posed on columns 2 to 4, the columns a run across row 4 of the
 * quiet board empties, with kinds that complete no run against what the quiet
 * board leaves standing. A chain posed over it settles where the rules end it
 * rather than where a draw would, so a test about the end of a chain reads one
 * answer every time.
 */
export function withQuietRefill(state: FacetState): FacetState {
  let posed = setRefillKinds(state, 2, "SMRJ");
  posed = setRefillKinds(posed, 3, "JBSM");
  return setRefillKinds(posed, 4, "CJBS");
}

/** The quiet board with the given cells rewritten, which is the usual pose. */
export function quietRowsWith(
  edits: Readonly<Record<string, string>>,
): string[] {
  return rewrite(quietRows(), edits);
}

/**
 * The quiet board posed and in play, which is the substrate nearly every test
 * starts from. It is written the way a caller writes it: the board posed with
 * `loadBoard`, the screen shown with `setScreen`, one element of the state at a
 * time (specs/instrumentation.md).
 */
export function posedPlaying(
  edits: Readonly<Record<string, string>> = {},
): FacetState {
  return setScreen(
    loadBoard(createInitialState(), quietRowsWith(edits)),
    "playing",
  );
}
