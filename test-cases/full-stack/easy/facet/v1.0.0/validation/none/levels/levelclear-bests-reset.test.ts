// levels/levelclear-bests-reset — a level opens with the two figures it will be
// measured by at zero.
//
// specs/rules.md: "`bestMove` and `bestChain` return to `0` when a level is
// opened and when a round starts, so each level is measured on its own", and
// specs/ui.md names the choice that opens it: the level-clear menu's `CONTINUE`
// "opens the next level, as `specs/rules.md` describes". Two figures, one
// moment.
//
// `moveScore` IS NOT ONE OF THEM. specs/rules.md's CONTINUE sentence returns
// `levelScore`, `bestChain` and `bestMove` to `0` and names no other figure, and
// the figure table fixes `moveScore`'s one reset: "It returns to `0` when a swap
// is accepted." A build that carries the winning move's points onto the new
// board until its first accepted swap reads the specification as written, so
// `moveScore` is read here only as evidence that the chain scored.
//
// REACHING THE SCREEN WITH THE FIGURES ACTUALLY CARRYING SOMETHING IS THE POINT.
// A check that opened a level from a standing start would read two zeros
// whether the build zeroed them or never accumulated them at all, and both
// builds would pass. So the level is won by an actual chain: the chain supplies
// `bestChain`, which each step raises to its own `chainStep`, and a `moveScore`
// that shows it scored. `bestMove` is then posed on top with `setBestMove`,
// which specs/instrumentation.md says "changes nothing else" — the chain's own
// settle already takes `bestMove` up to `moveScore`, and posing a larger figure
// over it makes the reading afterwards unambiguous about which of the two was
// zeroed.
//
// Both are asserted NON-ZERO at the level-clear screen before the choice is
// posed, so the reading after it is a reading of two figures that moved rather
// than of two that never left the floor.
//
// WHAT THIS DOES NOT DECIDE. What each figure is worth is the `scoring`
// category's — `bestMove` tracking the level's biggest move, `bestChain` its
// deepest step. This point is only that opening a level puts both back.
//
// WHERE THE TARGET COMES FROM. Off the round, not out of `LEVEL_TARGET_STEP`:
// what that figure ought to be is `levels/level-target-derived`'s point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import { LEVELCLEAR_ITEMS } from "../constants";
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
  takeMenuItem,
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

/** Where `CONTINUE` sits on the level-clear menu, from specs/ui.md's `LEVELCLEAR_ITEMS`. */
const CONTINUE_INDEX = LEVELCLEAR_ITEMS.indexOf("CONTINUE");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns bestMove and bestChain to zero on the next level", async () => {
  const posed = quietRowsWithEscape(RUN_CELLS);
  assertEqual(hasAnyRun(posed), false, "a maximal run on the posed board");
  assertTrue(
    swapIsLegal(posed, RUN_SWAP.a, RUN_SWAP.b),
    "the scenario's exchange is legal under R1 and R3",
  );

  await loadBoard(h, posed);
  await h.debug.setLevel(1);

  const opened = await h.snapshot();
  assertGreaterThan(opened.levelTarget, 0, "the target the round reports");
  await h.debug.setLevelScore(opened.levelTarget);

  // A real chain, so `bestChain` is a figure the build actually accumulated.
  await swapAndStep(h, RUN_SWAP.a, RUN_SWAP.b);
  const settled = await resolveChain(h);
  assertTrue(settled.settled, "the chain returned to idle within the cap");
  assertEqual(
    settled.snapshot.screen,
    "levelclear",
    "the screen the met target opened",
  );

  await h.debug.setBestMove(POSED_BEST_MOVE);

  const won = await h.snapshot();
  assertGreaterThan(won.moveScore, 0, "the points the winning move scored");
  assertGreaterThan(won.bestChain, 0, "the longest chain the level reached");
  assertEqual(won.bestMove, POSED_BEST_MOVE, "the best move posed over it");

  // CONTINUE is really CHOSEN, which is what the item says: the highlight is
  // posed onto it — `setMenuIndex` takes no item — and `confirm` is what takes
  // it, through the key specs/controls.md binds and the build's own input path.
  await takeMenuItem(h, CONTINUE_INDEX);

  // The frame that draws the new level, and the picture of the readouts it opens
  // with.
  await h.advance(1);
  await captureStill(h, "reset");

  const next = await h.snapshot();
  assertEqual(next.screen, "playing", "the screen CONTINUE returns to");
  assertEqual(next.level, 2, "the level CONTINUE opened");
  assertEqual(next.bestMove, 0, "the best move the new level opens at");
  assertEqual(next.bestChain, 0, "the longest chain the new level opens at");
});
