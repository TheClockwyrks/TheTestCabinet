// chain/swap-holds-before-resolving — an accepted swap trades its two cells and
// then holds, with nothing cleared.
//
// specs/rules.md opens the chain step with the swap itself: "An accepted swap
// exchanges the two cells at once, sets `phase` to `swapping`, sets `swapTimer`
// to `0`, and leaves `chainStep` at `0`. Nothing is cleared yet: the two gems
// are in motion between their cells for `SWAP_SECONDS` (`0.18`) of game time."
// Four claims in two sentences, and this point owns all four: the exchange has
// already happened, the phase says so, the chain has not started, and the board
// still carries whatever that exchange made.
//
// THE RUN STILL STANDING IS THE DISCRIMINATING HALF. A build that resolves step
// 1 on the frame it accepts the swap has the same two cells traded and the same
// `phase` value available to report, and every other reading here would let it
// through — but its board has no run left on it, because step 1 removed the very
// run the swap made. So the reading that decides this point is that the three
// rubies the exchange lined up are all three still sitting where the exchange
// put them, at the strain they were posed with, with nothing scored for them.
//
// THE SCENARIO. Two rubies stand in row 4 at columns 2 and 4, and the third
// waits one row above the gap at (3,3), over the run-free filler; the swap drops
// it into (3,4) and the row carries three rubies across columns 2 to 4, bounded
// by a citrine and an amethyst the filler already holds, so the run is maximal
// at exactly three. Nothing else on the board matches, so the whole board after
// the exchange is the posed board with those two tokens traded — which is what
// lets the reading be a comparison of the WHOLE board rather than of two cells.
//
// THE FRAME. `requestSwap` goes through the same acceptance path a player's
// release takes and takes effect at the call; one frame of the suite's clock is
// `0.015625` s, well inside `SWAP_SECONDS` (`0.18`), so the reading is taken
// with the swap unambiguously still in motion. The frames driven after the
// reading are for the replay alone, and there are only as many as fit strictly
// inside `SWAP_SECONDS`, so the recording ends with the two gems still
// travelling rather than on a board a step has already taken apart.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { MATCH_MIN, SWAP_SECONDS } from "../constants";
import {
  assertBoardEquals,
  maximalRuns,
  quietRowsWith,
  swapIsLegal,
  swapped,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureReplay,
  createHarness,
  framesShortOf,
  loadBoard,
  requestSwap,
  type Harness,
} from "../harness";

/**
 * The ruby three the swap completes across row 4, every gem at strain 0.
 *
 * The third ruby waits one row above the gap, so the exchange is what makes the
 * run and the run cannot have been standing before it.
 */
const RUN_CELLS: readonly PlacedToken[] = [
  { col: 2, row: 4, token: "R0" },
  { col: 3, row: 3, token: "R0" },
  { col: 4, row: 4, token: "R0" },
];

/** The swap that drops the waiting ruby into the gap. */
const SWAP_A: CellRef = { col: 3, row: 3 };
const SWAP_B: CellRef = { col: 3, row: 4 };

/** One frame of the suite's clock: `0.015625` s, well inside SWAP_SECONDS. */
const READING_FRAME = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("trades the two cells and holds, with the run it made still standing", async () => {
  const posed = quietRowsWith(RUN_CELLS);
  const exchanged = swapped(posed, SWAP_A, SWAP_B);

  // The fixture, established before the build is asked anything: the posed board
  // rests under R4, R1 and R3 accept the swap, and the exchange leaves exactly
  // one maximal run, of exactly MATCH_MIN rubies.
  assertLength(maximalRuns(posed), 0, "maximal runs on the posed board");
  assertTrue(swapIsLegal(posed, SWAP_A, SWAP_B), "R1 and R3 accept the swap");
  const made = maximalRuns(exchanged);
  assertLength(made, 1, "maximal runs the exchange makes");
  assertLength(made[0].cells, MATCH_MIN, "cells in the run it makes");

  const before = await loadBoard(h, posed);

  const held = await captureReplay(h, "swapping", async () => {
    await requestSwap(h, SWAP_A, SWAP_B);
    await h.advance(READING_FRAME);
    const reading = { snapshot: await h.snapshot(), board: await h.board() };
    // The rest of the animation, for the evidence alone. `framesShortOf` gives
    // the most frames that fit strictly inside SWAP_SECONDS — 11, `0.171875` s —
    // and one of them has already been driven, so the recording closes with the
    // swap still in motion and nothing resolved into it.
    await h.advance(Math.max(0, framesShortOf(SWAP_SECONDS) - READING_FRAME));
    return reading;
  });

  // The exchange has already happened, and it is the whole of what happened: the
  // board is the posed one with those two tokens traded, cell for cell.
  assertBoardEquals(
    held.board,
    exchanged,
    "the board one frame into the swap, against the posed board exchanged",
  );

  // The phase says the swap is in motion, and the chain has not started.
  assertEqual(held.snapshot.phase, "swapping", "the phase the swap set");
  assertEqual(held.snapshot.chainStep, 0, "the chain step the swap left");

  // Nothing has been cleared and nothing has been scored for it.
  assertEqual(
    held.snapshot.lastCleared,
    before.lastCleared,
    "cells reported cleared, against the figure the posed board carried",
  );
  assertEqual(
    held.snapshot.score,
    before.score,
    "the score, against the figure the posed board carried",
  );

  // And the discriminating half: the run the exchange made is still sitting on
  // the board, all three cells of it, which a build that resolved step 1 on the
  // accepting frame could not show.
  const standing = maximalRuns(held.board);
  assertLength(standing, 1, "maximal runs standing on the held board");
  assertLength(
    standing[0].cells,
    MATCH_MIN,
    "cells in the run standing on the held board",
  );
  assertEqual(
    standing[0].kind,
    made[0].kind,
    "the kind of the run standing on the held board",
  );
});
