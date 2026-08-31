// Facet — screens/paused-freezes: game time stops advancing the round while the
// game is paused.
//
// specs/ui.md tables what advances on each screen and gives `paused` the entry
// "Nothing", against `playing`'s "The board and the chain resolving over it, the
// swap timer, the chain step timer, and the refusal mark", and then says it
// again in a sentence of its own: "the swap timer, the chain step timer, and the
// refusal mark advance only while `screen` is `playing`."
// specs/instrumentation.md says the same of the pose that reaches the screen:
// "The board, the chain, and every timer stand where they were, and game time
// stops advancing them for as long as the game is paused." So a pause is not a
// screen drawn over a running game — the round itself is held, and a player who
// pauses mid-chain finds the same position waiting however long they were away.
//
// WHAT A FAILING BUILD LOOKS LIKE. A build that draws the pause menu but keeps
// integrating the step timer resolves its chain behind the menu: the paused
// stretch here is four whole multiples of the step's OWN hold, so such a build
// comes back with a higher `chainStep`, a board that moved, and a score that
// grew, each of which is read separately so the failure names which of them
// slipped.
//
// THE STRETCH IS FOUR OF THE STEP'S OWN HOLDS, not four of any constant. A
// step's hold is `lastWaves * WAVE_SECONDS + lastFall * FALL_SECONDS_PER_ROW +
// STEP_SECONDS` (specs/rules.md), so it is the step's own figure and the
// snapshot reports it as `stepHold`. Reading it off the paused step is what
// makes the stretch long enough on every board a build can produce: `lastFall`
// is partly the build's own choice, since specs/rules.md leaves a refilled gem's
// fall at "at least `r + 1`", so a stretch reckoned from a constant would be
// four holds on one build and less than one on another.
//
// BOTH TIMERS ARE READ, and the point is not the same for each. `stepTimer` is
// caught part way through a step, so a build that kept integrating it moves it.
// `swapTimer` rests at `0` while `phase` is `resolving` — specs/instrumentation.md
// fixes that resting value — so what is read there is that it STAYS at rest: a
// build that runs the swap animation's clock off the pause has to put something
// in it.
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
import { TICK_S } from "../constants";
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
  framesPast,
  loadBoard,
  swapAndStep,
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
 * Frames run between step 1 resolving and the pause, so the step timer is caught
 * at a figure of its own rather than at the little `swapAndStep` leaves in it.
 *
 * Six frames is `0.09375` s. `swapAndStep` returns `0.03875` s into the step, so
 * the pause catches the timer at about `0.1325` s — well inside the `0.3` s that
 * is the shortest hold any step can have, and far enough from `0` that a build
 * that quietly restarted the timer on pausing cannot be mistaken for one that
 * held it.
 */
const FRAMES_BEFORE_PAUSE = 6;

/** How many of the paused step's own holds the game is left standing for. */
const HOLDS_PAUSED = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the board, the chain and every timer for as long as the game is paused", async () => {
  const posed = quietRowsWithEscape([...STEP_ONE, ...STEP_TWO]);
  assertLength(maximalRuns(posed), 0, "maximal runs on the posed board");
  assertTrue(swapIsLegal(posed, SWAP_A, SWAP_B), "R1 and R3 accept the swap");

  await loadBoard(h, posed);
  const first = await swapAndStep(h, SWAP_A, SWAP_B);
  assertEqual(first.phase, "resolving", "the phase the accepted swap opened");
  assertEqual(first.chainStep, 1, "the chain step the accepted swap opened");

  // A few more frames of real resolution, so the pause catches a timer part way
  // through a step.
  await h.advance(FRAMES_BEFORE_PAUSE);
  const held = await h.snapshot();
  const heldBoard = await h.board();
  assertEqual(held.phase, "resolving", "the phase the pause catches");
  assertEqual(held.chainStep, 1, "the chain step the pause catches");
  assertTrue(held.stepTimer > 0, "the step timer the pause catches is running");
  assertTrue(held.stepHold > held.stepTimer, "the step still has hold left");

  await h.debug.pause();
  assertEqual((await h.snapshot()).screen, "paused", "the screen driven from");

  // Four of THIS step's holds, read off the step the pause caught, so the
  // stretch is long enough whatever fall the build's refill chose.
  const pausedFrames = HOLDS_PAUSED * framesPast(held.stepHold);
  await captureReplay(h, "frozen", () => h.advance(pausedFrames));

  const after = await h.snapshot();
  assertEqual(after.screen, "paused", "the screen after the paused stretch");
  // Every one of these is what specs/ui.md's "Nothing" advances on `paused`.
  assertEqual(after.phase, "resolving", "phase across the paused stretch");
  assertEqual(after.chainStep, held.chainStep, "chainStep across the pause");
  assertCloseTo(
    after.swapTimer,
    held.swapTimer,
    6,
    "swapTimer across the paused stretch",
  );
  assertCloseTo(
    after.stepTimer,
    held.stepTimer,
    6,
    "stepTimer across the paused stretch",
  );
  assertBoardEquals(await h.board(), heldBoard, "the board across the pause");
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
    pausedFrames * TICK_S,
    3,
    "the game time the paused stretch handed the game",
  );
});
