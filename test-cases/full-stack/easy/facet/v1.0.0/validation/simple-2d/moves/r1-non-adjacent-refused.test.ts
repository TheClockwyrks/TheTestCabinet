// Facet — moves/r1-non-adjacent-refused: R1 refuses a pair that is not
// orthogonally adjacent.
//
// R1 in specs/rules.md fixes the two cells of an exchange as differing "by 1 in
// column and 0 in row, or by 0 in column and 1 in row", and Enforcement says a
// swap that breaks a move rule "is refused and the board is unchanged". Two
// pairs break it in the two ways a build plausibly lets through:
//
//  - a DIAGONAL pair, which a distance test written as `|dc| <= 1 && |dr| <= 1`
//    admits, and which a drag read as "the cell under the pointer when it lifts"
//    reaches without ever crossing an orthogonal neighbor;
//  - a pair TWO COLUMNS APART, which a test written as `dc + dr <= 2` or as
//    "same row" admits.
//
// BOTH EXCHANGES WOULD MAKE A MAXIMAL RUN. That is the whole point of the
// scenario: R3 has no objection to either, so a build that refuses them is
// refusing them under R1, and a build that accepts them is not applying R1 at
// all. A pair chosen so that R3 would also have refused it would prove nothing
// about R1.
//
// WHAT IS READ. "The board is unchanged" is read as ALL SIXTY-FOUR CELLS,
// compared as text against the board that was posed — kind, strain and cut alike
// — rather than as the two cells the request named. A build that refuses the
// request but has already exchanged the gems, or that runs a chain step
// somewhere else, is caught by the whole-board reading and missed by the narrow
// one. The score is read for the same reason: a refused request scores nothing.
// The refusal MARK the request leaves behind belongs to `moves/refusal-marked`
// and is not read here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import {
  areAdjacent,
  assertBoardEquals,
  maximalRuns,
  quietRowsWith,
  swapWouldMatch,
  type BoardRows,
  type CellRef,
} from "../board";
import {
  captureStill,
  createHarness,
  loadBoard,
  swap,
  type Harness,
} from "../harness";

/** One requested exchange, named as R1 names its two cells. */
interface Pair {
  a: CellRef;
  b: CellRef;
}

/**
 * A board on which the DIAGONAL exchange `(2,3)` with `(3,4)` would complete row
 * 4 over columns 2, 3 and 4 with rubies.
 *
 * The ruby the exchange would carry into `(3,4)` sits one column left and one row
 * up from it, so the pair differs by `1` on BOTH axes and R1 admits neither
 * shape.
 */
const DIAGONAL_ROWS: BoardRows = quietRowsWith([
  { col: 2, row: 3, token: "R0" },
  { col: 2, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
]);

/** The diagonal pair: `1` in column and `1` in row. */
const DIAGONAL: Pair = { a: { col: 2, row: 3 }, b: { col: 3, row: 4 } };

/**
 * A board on which the exchange `(4,4)` with `(6,4)` — two columns apart on one
 * row — would complete row 4 over columns 2, 3 and 4.
 *
 * The two rubies already sit side by side at `(2,4)` and `(3,4)`, and the third
 * waits two cells beyond the gap, so the exchange is productive and nothing but
 * the distance stands against it.
 */
const APART_ROWS: BoardRows = quietRowsWith([
  { col: 2, row: 4, token: "R0" },
  { col: 3, row: 4, token: "R0" },
  { col: 6, row: 4, token: "R0" },
]);

/** The distant pair: `2` in column, `0` in row. */
const APART: Pair = { a: { col: 4, row: 4 }, b: { col: 6, row: 4 } };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/**
 * The world the scenario claims: a pair R1 does not admit, on a settled board,
 * whose exchange R3 would have welcomed.
 *
 * The third assertion is the load-bearing one. It is what makes a refusal
 * attributable to R1: if the exchange made no run, R3 would refuse it too and
 * the check would pass on a build that had never heard of adjacency.
 */
function assertFixture(rows: BoardRows, pair: Pair, context: string): void {
  assertTrue(
    !areAdjacent(pair.a, pair.b),
    `${context}: the pair is NOT orthogonally adjacent`,
  );
  assertLength(maximalRuns(rows), 0, `${context}: runs on the posed board`);
  assertTrue(
    swapWouldMatch(rows, pair.a, pair.b),
    `${context}: the exchange would make a maximal run`,
  );
}

it("refuses a diagonal pair and leaves the board as it stands", async () => {
  assertFixture(DIAGONAL_ROWS, DIAGONAL, "the diagonal exchange");
  const posed = loadBoard(h, DIAGONAL_ROWS);

  const refused = swap(h, DIAGONAL.a, DIAGONAL.b);
  const after = h.board();

  // One frame, so the picture kept as this item's evidence is a board that was
  // really drawn. It advances no chain: the board is settled and stays settled.
  await h.advance(1);
  captureStill(h, "refused");

  assertBoardEquals(after, DIAGONAL_ROWS, "after the diagonal request");
  assertEqual(refused.phase, "idle", "phase after the diagonal request");
  assertEqual(refused.score, posed.score, "score after the diagonal request");
});

it("refuses a pair two columns apart and leaves the board as it stands", async () => {
  assertFixture(APART_ROWS, APART, "the two-column exchange");
  const posed = loadBoard(h, APART_ROWS);

  const refused = swap(h, APART.a, APART.b);
  const after = h.board();

  assertBoardEquals(after, APART_ROWS, "after the two-column request");
  assertEqual(refused.phase, "idle", "phase after the two-column request");
  assertEqual(refused.score, posed.score, "score after the two-column request");
});
