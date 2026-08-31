// Facet — screens/paused-freezes: game time stops advancing the round while the
// game is paused.
//
// specs/ui.md tables what advances on each screen and gives `paused` the entry
// "Nothing", against `playing`'s "The board and the chain resolving over it, the
// chain step timer, and the refusal mark". specs/instrumentation.md says the
// same of the pose that reaches it: "The board, the chain, and every timer stand
// where they were, and game time stops advancing them for as long as the game is
// paused." So a pause is not a screen drawn over a running game — the round
// itself is held, and a player who pauses mid-chain finds the same position
// waiting however long they were away.
//
// WHAT A FAILING BUILD LOOKS LIKE. A build that draws the pause menu but keeps
// integrating the step timer resolves its chain behind the menu: the paused
// stretch here is four whole multiples of `STEP_SECONDS`, so such a build comes
// back with a higher `chainStep`, a board that moved, and a score that grew,
// each of which is read separately so the failure names which of them slipped.
//
// THE ONE THING THAT MUST STILL ADVANCE is `simTime`, which
// specs/instrumentation.md has accumulate "the delta time of every update,
// whatever the screen". Reading it is what separates a build that HELD the round
// from a harness that simply stopped handing out frames: the frames were driven,
// the game counted them, and it moved nothing with them.
//
// The chain is a real one with a step still to come, so a build that failed to
// hold it would have somewhere to go. The board is posed over the filler that
// carries a spare legal swap, so the round is not already over when the swap is
// made.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertLength,
  assertTrue,
} from "../assert";
import { FRAMES_PER_STEP, TICK_S } from "../constants";
import {
  assertBoardEquals,
  maximalRuns,
  quietRowsWithEscape,
  swapIsLegal,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureReplay,
  createHarness,
  loadBoard,
  swap,
  type Harness,
} from "../harness";

/** Step 1's run across row 4, and the amethyst the swap trades out of it. */
const STEP_ONE: PlacedToken[] = [
  { col: 3, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 5, row: 4, token: "M0" },
  { col: 6, row: 4, token: "R0" },
];

/**
 * The jades that fall into a run of their own once step 1's cells empty, so the
 * chain has a step still ahead of it while the game is paused. A build that let
 * the timer run would reach that step and change the board with it.
 */
const STEP_TWO: PlacedToken[] = [
  { col: 4, row: 3, token: "J0" },
  { col: 4, row: 5, token: "J0" },
  { col: 4, row: 6, token: "J0" },
];

const SWAP_A: CellRef = { col: 5, row: 4 };
const SWAP_B: CellRef = { col: 6, row: 4 };

/**
 * Frames run between the swap and the pause, so the step timer is caught at a
 * value of its own rather than at the `0` the swap left.
 */
const FRAMES_BEFORE_PAUSE = 5;

/**
 * The paused stretch: four whole multiples of `STEP_SECONDS` of game time.
 *
 * Long enough that a build integrating the timer through a pause would have read
 * the board four times over, which is more than this chain has steps.
 */
const PAUSED_FRAMES = 4 * FRAMES_PER_STEP;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the board, the chain and every timer for as long as the game is paused", async () => {
  const posed = quietRowsWithEscape([...STEP_ONE, ...STEP_TWO]);
  assertLength(maximalRuns(posed), 0, "maximal runs on the posed board");
  assertTrue(swapIsLegal(posed, SWAP_A, SWAP_B), "R1 and R3 accept the swap");

  loadBoard(h, posed);
  swap(h, SWAP_A, SWAP_B);

  // A few frames of real resolution, so the pause catches a timer part way
  // through a step. A build that zeroed the timer on pausing, or that let it
  // keep running, both differ from this reading.
  await h.advance(FRAMES_BEFORE_PAUSE);
  const held = h.snapshot();
  const heldBoard = h.board();
  assertEqual(held.phase, "resolving", "the phase the pause catches");
  assertEqual(held.chainStep, 1, "the chain step the pause catches");
  assertCloseTo(
    held.stepTimer,
    FRAMES_BEFORE_PAUSE * TICK_S,
    6,
    "the step timer the pause catches",
  );

  h.debug.pause();
  assertEqual(h.snapshot().screen, "paused", "the screen driven from");

  await captureReplay(h, "frozen", () => h.advance(PAUSED_FRAMES));

  const after = h.snapshot();
  assertEqual(after.screen, "paused", "the screen after the paused stretch");
  // Every one of these is what specs/ui.md's "Nothing" advances on `paused`.
  assertEqual(after.phase, "resolving", "phase across the paused stretch");
  assertEqual(after.chainStep, held.chainStep, "chainStep across the pause");
  assertCloseTo(
    after.stepTimer,
    held.stepTimer,
    6,
    "stepTimer across the paused stretch",
  );
  assertBoardEquals(h.board(), heldBoard, "the board across the pause");
  assertEqual(after.score, held.score, "score across the paused stretch");
  assertEqual(
    after.levelScore,
    held.levelScore,
    "levelScore across the paused stretch",
  );

  // And the frames really were handed to the game: `simTime` accumulates every
  // update's delta whatever the screen, so it alone moved.
  assertCloseTo(
    after.simTime - held.simTime,
    PAUSED_FRAMES * TICK_S,
    3,
    "the game time the paused stretch handed the game",
  );
});
