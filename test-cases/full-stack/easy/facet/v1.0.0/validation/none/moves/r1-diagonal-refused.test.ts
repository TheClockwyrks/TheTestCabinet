// Facet — moves/r1-diagonal-refused: R1 refuses a diagonally neighboring pair.
//
// R1 in specs/rules.md fixes the two cells of an exchange as differing "by 1 in
// column and 0 in row, or by 0 in column and 1 in row", and Enforcement says a
// swap that breaks a move rule "is refused and the board is unchanged".
//
// THE EXCHANGE WOULD MAKE A MAXIMAL RUN. That is the whole point of the
// scenario: R3 has no objection to it, so a build that refuses it is refusing it
// under R1, and a build that accepts it is not applying R1 at all. A pair chosen
// so that R3 would also have refused it would prove nothing about R1.
//
// WHAT IS READ. "The board is unchanged" is read as ALL SIXTY-FOUR CELLS,
// compared as text against the board that was posed — kind, strain and cut alike
// — rather than as the two cells the request named. A build that refuses the
// request but has already exchanged the gems, or that runs a chain step
// somewhere else, is caught by the whole-board reading and missed by the narrow
// one. The score is read for the same reason: a refused request scores nothing.
// The refusal MARK the request leaves behind belongs to `moves/refusal-marked`
// and is not read here.
//
// A DIAGONAL pair is one of the two ways a build plausibly lets a non-adjacent
// exchange through: a distance test written as `|dc| <= 1 && |dr| <= 1` admits
// it, and a drag read as "the cell under the pointer when it lifts" reaches it
// without ever crossing an orthogonal neighbor. A pair TWO COLUMNS APART is the
// other way, and it is `moves/r1-distant-refused`'s point: the two mistakes are
// independent, and a build can make one and not the other.

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
  requestSwap,
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
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
  const posed = await loadBoard(h, DIAGONAL_ROWS);

  const refused = await requestSwap(h, DIAGONAL.a, DIAGONAL.b);
  const after = await h.board();

  // One frame, so the picture kept as this item's evidence is a board that was
  // really drawn. It advances no chain: the board is settled and stays settled.
  await h.advance(1);
  await captureStill(h, "refused");

  assertBoardEquals(after, DIAGONAL_ROWS, "after the diagonal request");
  assertEqual(refused.phase, "idle", "phase after the diagonal request");
  assertEqual(refused.score, posed.score, "score after the diagonal request");
});
