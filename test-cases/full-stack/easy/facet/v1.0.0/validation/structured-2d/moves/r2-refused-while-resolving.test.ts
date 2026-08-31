// Facet — moves/r2-refused-while-resolving: R2 refuses a swap while the board is
// resolving.
//
// R2 in specs/rules.md is one sentence — "A swap is accepted only while `phase`
// is `idle`" — and it is the rule that keeps a board in motion from being reached
// into. `phase` has two ways of not being `idle`, and a build can guard one and
// not the other, so the sentence is two points: this one is `resolving`, and
// `moves/r2-refused-while-swapping` is the other. A build that checks only R1 and
// R3 lets a player trade gems out from under a step that has already scored them,
// and nothing else in the ruleset catches it.
//
// HOW THE SCENARIO ISOLATES R2, WHICH IS THE WHOLE DIFFICULTY. A refusal proves
// nothing unless the request would otherwise have been ACCEPTED. So the posed
// board carries two arrangements far apart from each other: a ruby scenario in
// the middle whose exchange opens a chain, and a beryl scenario in the top-right
// corner whose exchange is orthogonally adjacent and productive. The middle
// chain clears three cells of row 4 and refills columns 2, 3 and 4; it never
// touches rows 0 and 1 of columns 5, 6 and 7, so the corner pair is still R1-
// and R3-clean when the second request is made. The check proves that against
// the board the BUILD is holding at that moment, not against the fixture, so
// what the second request meets is exactly one objection: R2.
//
// WHERE IN THE STEP THE REQUEST LANDS. The opening swap is carried through its
// own animation — nothing is `resolving` until `SWAP_SECONDS` (`0.18`) of game
// time has gone by — and then part of the way through step 1, so `stepTimer` is
// holding real game time when the second request arrives. That turns "the chain
// was not disturbed" into something readable: a build that answered the request
// by restarting its step, or by counting a second one, shows a `stepTimer` back
// at zero or a `chainStep` at 2. The drive stops well short of the step's own
// hold, whose floor is `0.3` s, so no second board read has happened and the step
// under examination is still step 1.
//
// The board is compared cell by cell against the board the build held an instant
// before the request, rather than against the fixture: step 1 has already cleared
// and refilled part of the fixture, and what R2 owes is that the REQUEST changed
// nothing.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertLength,
  assertTrue,
} from "../assert";
import {
  assertBoardEquals,
  maximalRuns,
  quietRowsWith,
  swapIsLegal,
  type BoardRows,
  type CellRef,
} from "../board";
import {
  captureReplay,
  createHarness,
  loadBoard,
  requestSwap,
  swapAndStep,
  type Harness,
} from "../harness";

/** One requested exchange, named as R1 names its two cells. */
interface Pair {
  a: CellRef;
  b: CellRef;
}

/**
 * Two arrangements on one run-free board, chosen so that resolving the first
 * cannot reach the second.
 *
 * The rubies at `(2,4)`, `(4,4)` and `(3,3)` make the opening move: trading
 * `(3,3)` down completes row 4 over columns 2, 3 and 4. That clear touches only
 * those three columns, and R7's strain reaches only their immediate neighbors,
 * so nothing it does can travel as far as row 0 or row 1.
 *
 * The beryls at `(5,1)`, `(7,1)` and `(6,0)` make the second move: trading
 * `(6,0)` down completes row 1 over columns 5, 6 and 7.
 */
const ROWS: BoardRows = quietRowsWith([
  { col: 2, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 3, row: 3, token: "R0" },
  { col: 5, row: 1, token: "B0" },
  { col: 7, row: 1, token: "B0" },
  { col: 6, row: 0, token: "B0" },
]);

/** The move that opens the chain. */
const OPENING: Pair = { a: { col: 3, row: 3 }, b: { col: 3, row: 4 } };

/** The move requested mid-chain, which R1 and R3 both welcome. */
const SECOND: Pair = { a: { col: 6, row: 0 }, b: { col: 6, row: 1 } };

/**
 * Frames advanced into step 1, beyond the ones the swap animation cost.
 *
 * `swapAndStep` leaves the step `0.03875` s into its hold; eight more frames of
 * the suite's clock add `0.125` s, for `0.16375` s in all. That is enough that
 * `stepTimer` is carrying a figure a restart would visibly lose, and it is short
 * of `0.3` s, the SHORTEST hold any step can have, so the board has not been read
 * a second time and the step being examined is still step 1.
 */
const MID_STEP_FRAMES = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("refuses a swap requested while a chain is resolving", async () => {
  // The fixture: a settled board carrying two independent moves.
  assertLength(maximalRuns(ROWS), 0, "runs on the posed board");
  assertTrue(
    swapIsLegal(ROWS, OPENING.a, OPENING.b),
    "the opening pair is a legal swap",
  );
  loadBoard(h, ROWS);

  // Open the chain, and carry the swap through its own animation: specs/rules.md
  // clears nothing until `SWAP_SECONDS` has passed, so it is the drive rather
  // than the request that leaves the board `resolving`.
  const opening = await swapAndStep(h, OPENING.a, OPENING.b);
  assertEqual(opening.phase, "resolving", "phase after the opening swap");
  assertEqual(opening.chainStep, 1, "chainStep after the opening swap");

  // Run further into the step, so `stepTimer` holds a figure worth watching.
  await h.advance(MID_STEP_FRAMES);
  const before = h.snapshot();
  const boardBefore = h.board();

  // The load-bearing precondition, read off the board the build is holding: the
  // pair about to be requested is orthogonally adjacent and productive RIGHT
  // NOW, so R1 and R3 would both accept it and R2 is the only rule left.
  assertTrue(
    swapIsLegal(boardBefore, SECOND.a, SECOND.b),
    "the second pair is a legal swap on the board mid-chain",
  );

  const refused = await captureReplay(h, "refused", async () => {
    const reading = requestSwap(h, SECOND.a, SECOND.b);
    const board = h.board();
    await h.advance(1);
    return { reading, board };
  });

  // Nothing moved: not the cells the request named, not any other cell, and not
  // the chain that was running.
  assertBoardEquals(refused.board, boardBefore, "after the mid-chain request");
  assertEqual(refused.reading.phase, "resolving", "phase after the request");
  assertEqual(refused.reading.chainStep, 1, "chainStep after the request");
  assertCloseTo(
    refused.reading.stepTimer,
    before.stepTimer,
    9,
    "stepTimer after the request",
  );
});
