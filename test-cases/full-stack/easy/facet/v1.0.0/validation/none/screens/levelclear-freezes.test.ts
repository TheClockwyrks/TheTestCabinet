// Facet — screens/levelclear-freezes: the finished board is held still while the
// level-clear screen shows.
//
// specs/ui.md tables what advances on each screen and puts `levelclear` among
// the screens whose entry is "Nothing", against `playing`'s "The board and the
// chain resolving over it, the swap timer, the chain step timer, and the refusal
// mark", and then says it again in a sentence of its own: those timers "advance
// only while `screen` is `playing`."
//
// WHY IT MATTERS HERE AND NOT ONLY ON `paused`. The board behind this screen is
// a real settled board, not an empty one — specs/rules.md has it "stand as the
// chain left it" — and it is the position the player has just won on. A build
// that keeps resolving under the panel changes the very arrangement the player
// is looking at while they decide between `CONTINUE` and `QUIT`, and the board
// that `QUIT` walks away from is not the one the level ended on.
//
// THE STRETCH IS FOUR OF A STEP'S OWN HOLDS, not four of any constant. A step's
// hold is `lastWaves * WAVE_SECONDS + lastFall * FALL_SECONDS_PER_ROW +
// STEP_SECONDS` (specs/rules.md), which is the step's own figure and partly the
// build's, since specs/rules.md leaves a refilled gem's fall at "at least
// `r + 1`". So the hold of the step that ENDED the level is read off the
// snapshot while it still holds, and the stretch is measured against that.
//
// WHAT IS READ. Every cell in the notation of specs/board.md, the chain step,
// both timers, the score and the level score — each on its own, so the failure
// names which of them slipped. `chainStep` and both timers are at their resting
// `0` on an idle board (specs/instrumentation.md fixes those resting values), so
// what is read of them is that they STAY at rest: a build that let a chain start
// again behind the panel has to put something in one of them.
//
// THE ONE THING THAT MUST STILL ADVANCE is `simTime`, which
// specs/instrumentation.md has accumulate "the delta time of every update,
// whatever the screen". Reading it is what separates a build that HELD the board
// from a harness that simply stopped handing out frames.
//
// HOW THE SCREEN IS REACHED. A swap is accepted on a posed board and carried
// into step 1; while that step still holds, the board it will next be read
// against is written under it with `setGem`, which specs/instrumentation.md says
// leaves the screen and the phase where they were, and `levelScore` is posed at
// the target the round reports. That board carries a legal swap, so the settled
// board meets the level condition and nothing else — which screen a build raises
// when a board is both complete and dead is `levels/level-before-gameover`'s
// point, and this check keeps clear of it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertTrue,
} from "../assert";
import { GRID_COLS, GRID_ROWS, TICK_S } from "../constants";
import {
  assertBoardEquals,
  legalSwaps,
  maximalRuns,
  quietRowsWith,
  quietRowsWithEscape,
  swapIsLegal,
  type BoardRows,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  advanceStep,
  captureReplay,
  createHarness,
  framesPast,
  loadBoard,
  swapAndStep,
  writeBoard,
  type Harness,
} from "../harness";

/** Three rubies across row 4, parted by the amethyst the swap trades out. */
const TRIGGER: PlacedToken[] = [
  { col: 3, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 5, row: 4, token: "M0" },
  { col: 6, row: 4, token: "R0" },
];

const SWAP_A: CellRef = { col: 5, row: 4 };
const SWAP_B: CellRef = { col: 6, row: 4 };

/**
 * The board the holding step is read against: no maximal run, so the chain
 * settles there, and a legal swap, so the settled board meets the level
 * condition alone.
 */
const SETTLED: BoardRows = quietRowsWithEscape([]);

/** How many of the finishing step's own holds the screen is left standing for. */
const HOLDS_SHOWING = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the finished board and every timer for as long as the level-clear screen shows", async () => {
  const posed = quietRowsWith(TRIGGER);
  assertLength(maximalRuns(posed), 0, "maximal runs on the posed board");
  assertTrue(swapIsLegal(posed, SWAP_A, SWAP_B), "R1 and R3 accept the swap");
  assertLength(maximalRuns(SETTLED), 0, "maximal runs on the settled board");
  assertGreaterThan(
    legalSwaps(SETTLED).length,
    0,
    "legal swaps on the settled board",
  );

  await loadBoard(h, posed);
  const first = await swapAndStep(h, SWAP_A, SWAP_B);
  assertEqual(first.phase, "resolving", "the phase the accepted swap opened");

  await writeBoard(h, SETTLED);
  const standing = await h.snapshot();
  assertGreaterThan(standing.levelTarget, 0, "the target the round reports");
  await h.debug.setLevelScore(standing.levelTarget);

  // The hold of the step that is about to end the level, read while it still
  // holds: the stretch below is four of these.
  const finishingHold = (await h.snapshot()).stepHold;
  assertGreaterThan(finishingHold, 0, "the hold of the finishing step");

  await advanceStep(h);

  const cleared = await h.snapshot();
  const clearedBoard = await h.board();
  assertEqual(cleared.phase, "idle", "the phase the chain ended in");
  assertEqual(
    cleared.screen,
    "levelclear",
    "the screen the met target reaches",
  );
  assertLength(
    cleared.board.cells,
    GRID_COLS * GRID_ROWS,
    "cells of the finished board the screen shows",
  );

  const showingFrames = HOLDS_SHOWING * framesPast(finishingHold);
  await captureReplay(h, "frozen", () => h.advance(showingFrames));

  const after = await h.snapshot();
  assertEqual(after.screen, "levelclear", "the screen after the stretch");
  // Every one of these is what specs/ui.md's "Nothing" advances on this screen.
  assertEqual(after.phase, cleared.phase, "phase across the stretch");
  assertEqual(
    after.chainStep,
    cleared.chainStep,
    "chainStep across the stretch",
  );
  assertCloseTo(
    after.swapTimer,
    cleared.swapTimer,
    6,
    "swapTimer across the stretch",
  );
  assertCloseTo(
    after.stepTimer,
    cleared.stepTimer,
    6,
    "stepTimer across the stretch",
  );
  assertBoardEquals(
    await h.board(),
    clearedBoard,
    "the board across the stretch",
  );
  assertEqual(after.score, cleared.score, "score across the stretch");
  assertEqual(
    after.levelScore,
    cleared.levelScore,
    "levelScore across the stretch",
  );
  assertEqual(after.level, cleared.level, "level across the stretch");

  // And the frames really were handed to the game: `simTime` accumulates every
  // update's delta whatever the screen, so it alone moved.
  assertCloseTo(
    after.simTime - cleared.simTime,
    showingFrames * TICK_S,
    3,
    "the game time the stretch handed the game",
  );
});
