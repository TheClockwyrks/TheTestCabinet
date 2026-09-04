// levels/levelclear-bests-reset — a level opens with the three figures it will be
// measured by at zero.
//
// specs/rules.md: "`bestMove` and `bestChain` return to `0` when a level is
// opened and when a round starts, so each level is measured on its own", and
// specs/instrumentation.md says the same of the choice that opens it:
// `continueLevel` returns "`levelScore`, `bestMove`, `bestChain` and `moveScore`"
// to `0`. Three figures, one moment.
//
// REACHING THE SCREEN WITH THE FIGURES ACTUALLY CARRYING SOMETHING IS THE POINT.
// A check that opened a level from a standing start would read three zeros
// whether the build zeroed them or never accumulated them at all, and both
// builds would pass. So the level is won by an actual chain: the chain supplies
// `moveScore`, which specs/rules.md accumulates over every step of the move, and
// `bestChain`, which each step raises to its own `chainStep`. `bestMove` is then
// posed on top with `setBestMove`, which specs/instrumentation.md says "changes
// nothing else" — the chain's own settle already takes `bestMove` up to
// `moveScore`, and posing a larger figure over it makes the reading afterwards
// unambiguous about which of the two was zeroed.
//
// All three are asserted NON-ZERO at the level-clear screen before the choice is
// posed, so the reading after it is a reading of three figures that moved rather
// than of three that never left the floor.
//
// WHAT THIS DOES NOT DECIDE. What each figure is worth is the `scoring`
// category's — `moveScore` accumulating across a chain, `bestMove` tracking the
// level's biggest move, `bestChain` its deepest step. This point is only that
// opening a level puts all three back.
//
// WHERE THE TARGET COMES FROM. Off the round, not out of `LEVEL_TARGET_STEP`:
// what that figure ought to be is `levels/level-target-derived`'s point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import {
  hasAnyRun,
  quietRowsWithEscape,
  swapIsLegal,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureStill,
  createHarness,
  loadBoard,
  resolveChain,
  swapAndStep,
  type Harness,
} from "../harness";

/** Three rubies one exchange short of a run in row 4, clear of the filler's corner. */
const RUN_CELLS: readonly PlacedToken[] = [
  { col: 2, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 3, row: 3, token: "R0" },
];

/** The exchange that drops the third ruby into row 4 and makes the run. */
const RUN_SWAP: { a: CellRef; b: CellRef } = {
  a: { col: 3, row: 3 },
  b: { col: 3, row: 4 },
};

/**
 * The figure `bestMove` is posed at over whatever the chain's own settle left
 * there.
 *
 * Larger than any move this scenario's chain can score, so the reading before the
 * choice is unambiguously the posed figure and the reading after it is
 * unambiguously a zeroing rather than a coincidence.
 */
const POSED_BEST_MOVE = 12_345;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns moveScore, bestMove and bestChain to zero on the next level", async () => {
  const posed = quietRowsWithEscape(RUN_CELLS);
  assertEqual(hasAnyRun(posed), false, "a maximal run on the posed board");
  assertTrue(
    swapIsLegal(posed, RUN_SWAP.a, RUN_SWAP.b),
    "the scenario's exchange is legal under R1 and R3",
  );

  loadBoard(h, posed);
  h.debug.setLevel(1);

  const opened = h.snapshot();
  assertGreaterThan(opened.levelTarget, 0, "the target the round reports");
  h.debug.setLevelScore(opened.levelTarget);

  // A real chain, so the two figures the move earns are figures the build
  // actually accumulated.
  await swapAndStep(h, RUN_SWAP.a, RUN_SWAP.b);
  const settled = await resolveChain(h);
  assertTrue(settled.settled, "the chain returned to idle within the cap");
  assertEqual(
    settled.snapshot.screen,
    "levelclear",
    "the screen the met target opened",
  );

  h.debug.setBestMove(POSED_BEST_MOVE);

  const won = h.snapshot();
  assertGreaterThan(won.moveScore, 0, "the move score the winning move earned");
  assertGreaterThan(won.bestChain, 0, "the longest chain the level reached");
  assertEqual(won.bestMove, POSED_BEST_MOVE, "the best move posed over it");

  h.debug.continueLevel();

  // The frame that draws the new level, and the picture of the readouts it opens
  // with.
  await h.advance(1);
  captureStill(h, "reset");

  const next = h.snapshot();
  assertEqual(next.screen, "playing", "the screen CONTINUE returns to");
  assertEqual(next.level, 2, "the level CONTINUE opened");
  assertEqual(next.moveScore, 0, "the move score the new level opens at");
  assertEqual(next.bestMove, 0, "the best move the new level opens at");
  assertEqual(next.bestChain, 0, "the longest chain the new level opens at");
});
