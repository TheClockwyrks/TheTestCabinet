// Facet — screens/paused-resume: RESUME hands the round back exactly where the
// pause took it.
//
// specs/ui.md gives the pause menu's first entry one effect — "`RESUME` — Sets
// `screen = playing`, with the board exactly as it was left" — and
// specs/instrumentation.md says what "exactly" covers for the pose that stands
// for that choice: "the screen returns to `playing` and the board, the chain,
// and every timer carry on from exactly where `pause` left them."
//
// THE POSE IS THE ROUTE. specs/instrumentation.md defines `resume()` as the
// choice of `RESUME` from the pause menu, so the pose decides the same thing the
// menu entry does. It is the right route because this point is about what the
// screen change PRESERVES rather than about which key chose it: taking the
// choice through the menu would put `PAUSED_ITEMS`' ordering and the `confirm`
// binding inside a verdict about the board, and both of those are points of
// their own.
//
// TWO HALVES, AND THE SECOND IS THE ONE A REREAD CANNOT FAKE. First the reading
// itself: the chain step, the step timer and every cell come back as the pause
// left them, after a paused stretch four times longer than a step. Then the
// round is driven on, and the timer is measured by what it DOES rather than by
// what it reports — `FRAMES_BEFORE_PAUSE` and `FRAMES_AFTER_RESUME` sum to
// `STEP_DRIVE_FRAMES`, so a build that carried the timer across the pause reads
// the board on the far side and the chain reaches step 2, while a build that
// restarted it at `0` on resuming is still short of `STEP_SECONDS` and still on
// step 1.
//
// The chain is posed with a second step waiting so there is a step 2 to reach at
// all, over the filler that carries a spare legal swap so the round is not
// already over when the swap is made.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertLength,
  assertTrue,
} from "../assert";
import { FRAMES_PER_STEP, STEP_DRIVE_FRAMES, TICK_S } from "../constants";
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
 * The jades that fall into a run of their own once step 1's cells empty. They
 * are what gives the resumed chain a step 2 to reach, which is how the timer is
 * shown to have carried on rather than merely to have reported a number.
 */
const STEP_TWO: PlacedToken[] = [
  { col: 4, row: 3, token: "J0" },
  { col: 4, row: 5, token: "J0" },
  { col: 4, row: 6, token: "J0" },
];

const SWAP_A: CellRef = { col: 5, row: 4 };
const SWAP_B: CellRef = { col: 6, row: 4 };

/** Frames of the step spent before the pause, so the timer is caught mid-step. */
const FRAMES_BEFORE_PAUSE = 5;

/** The paused stretch: four whole multiples of `STEP_SECONDS` of game time. */
const PAUSED_FRAMES = 4 * FRAMES_PER_STEP;

/**
 * Frames driven after the resume, which with the five spent before the pause
 * carry the step past `STEP_SECONDS`.
 *
 * `STEP_DRIVE_FRAMES` is 17 frames, 0.265625 s: past `STEP_SECONDS` (0.25)
 * whether the build fires at `>=` or at `>`, and short of two steps. Twelve of
 * them are left, so a timer that carried across the pause reads the board and a
 * timer that restarted at `0` is still 0.1875 s short of doing so.
 */
const FRAMES_AFTER_RESUME = STEP_DRIVE_FRAMES - FRAMES_BEFORE_PAUSE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to playing with the board, the chain and the timer where the pause left them", async () => {
  const posed = quietRowsWithEscape([...STEP_ONE, ...STEP_TWO]);
  assertLength(maximalRuns(posed), 0, "maximal runs on the posed board");
  assertTrue(swapIsLegal(posed, SWAP_A, SWAP_B), "R1 and R3 accept the swap");

  await loadBoard(h, posed);
  await swap(h, SWAP_A, SWAP_B);
  await h.advance(FRAMES_BEFORE_PAUSE);

  const held = await h.snapshot();
  const heldBoard = await h.board();
  assertEqual(held.phase, "resolving", "the phase the pause catches");
  assertEqual(held.chainStep, 1, "the chain step the pause catches");
  assertCloseTo(
    held.stepTimer,
    FRAMES_BEFORE_PAUSE * TICK_S,
    6,
    "the step timer the pause catches",
  );

  // Paused, and left paused for four steps' worth of game time, so a build that
  // rebuilt the position on resuming has had every chance to lose it.
  await h.debug.pause();
  await h.advance(PAUSED_FRAMES);

  await captureReplay(h, "resumed", async () => {
    await h.debug.resume();

    const resumed = await h.snapshot();
    assertEqual(resumed.screen, "playing", "the screen RESUME returns to");
    assertEqual(resumed.phase, "resolving", "the phase the resume hands back");
    assertEqual(resumed.chainStep, held.chainStep, "chainStep after resuming");
    assertCloseTo(
      resumed.stepTimer,
      held.stepTimer,
      6,
      "stepTimer after resuming",
    );
    assertBoardEquals(await h.board(), heldBoard, "the board after resuming");

    await h.advance(FRAMES_AFTER_RESUME);
  });

  // The timer carried on from where the pause left it, so the frames left in
  // the step were enough to spend it and the chain read the board again.
  const carried = await h.snapshot();
  assertEqual(carried.chainStep, 2, "the chain step the resumed timer reached");
});
