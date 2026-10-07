// Facet — moves/r3-unproductive-refused: R3 refuses a swap that makes no run.
//
// R3 in specs/rules.md accepts a swap "only when the board it produces carries at
// least one maximal run under R4, or when at least one of the two cells holds a
// `prism`", and Enforcement says a swap that breaks a move rule "is refused and
// the board is unchanged". This is the rule that makes the game a game: without
// it a player rearranges the board at will and the board never resolves anything.
//
// THE SCENARIO IS THE RUN-FREE FILLER ITSELF. Its kinds run diagonally, so no
// three consecutive cells of any row or column share one, and no exchange of two
// adjacent cells anywhere on it produces a run either. The pair traded is a
// plain-against-plain exchange in the middle of the board: nothing on it is a
// prism, so the second half of R3 offers no way in, and nothing about the pair
// offends R1 or R2 — they are orthogonally adjacent and the board is settled. R3
// is the only rule that can refuse it, and it must.
//
// WHAT IS READ. All sixty-four cells, compared as text against the board that was
// posed, so a build that refuses the request but has already exchanged the two
// gems is caught. `phase` and `chainStep` are read because a refusal must not
// open a chain, and the score because a refusal scores nothing. The refusal MARK
// belongs to `moves/refusal-marked` and is not read here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import {
  areAdjacent,
  assertBoardEquals,
  isPrism,
  maximalRuns,
  quietRowsWithEscape,
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

/**
 * The run-free filler, carrying one spare legal swap in the far corner.
 *
 * The spare move is there so the posed board is one a round could really be
 * played on rather than one already out of moves, and it sits at the opposite
 * corner from the pair traded below, where it cannot make that pair productive.
 */
const ROWS: BoardRows = quietRowsWithEscape([]);

/** The pair traded: orthogonally adjacent, both plain, and unproductive. */
const PAIR: { a: CellRef; b: CellRef } = {
  a: { col: 3, row: 3 },
  b: { col: 4, row: 3 },
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses an exchange that leaves the board without a run", async () => {
  // The fixture, which is what makes the refusal attributable to R3: the pair is
  // adjacent (R1 is satisfied), the board is run-free before the request, the
  // exchange makes no run anywhere, and neither cell holds a prism — so neither
  // of R3's two doors is open.
  assertTrue(areAdjacent(PAIR.a, PAIR.b), "the pair is orthogonally adjacent");
  assertLength(maximalRuns(ROWS), 0, "runs on the posed board");
  assertTrue(
    !swapWouldMatch(ROWS, PAIR.a, PAIR.b),
    "the exchange makes NO maximal run",
  );
  assertTrue(!isPrism(ROWS, PAIR.a), "the first cell holds no prism");
  assertTrue(!isPrism(ROWS, PAIR.b), "the second cell holds no prism");

  const posed = await loadBoard(h, ROWS);
  const refused = await requestSwap(h, PAIR.a, PAIR.b);
  const after = await h.board();

  // One frame, so the picture kept as this item's evidence was really drawn. The
  // board is settled and one idle frame leaves it so.
  await h.advance(1);
  await captureStill(h, "refused");

  assertBoardEquals(after, ROWS, "after the unproductive request");
  assertEqual(refused.phase, "idle", "phase after the unproductive request");
  assertEqual(refused.chainStep, 0, "chainStep after the unproductive request");
  assertEqual(
    refused.score,
    posed.score,
    "score after the unproductive request",
  );
});
