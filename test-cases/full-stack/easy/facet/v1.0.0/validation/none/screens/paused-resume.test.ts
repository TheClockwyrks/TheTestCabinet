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
// itself: the chain step, both timers and every cell come back as the pause left
// them, after a paused stretch four times longer than the step's own hold. Then
// the round is driven on, and the timer is measured by what it DOES rather than
// by what it reports.
//
// HOW THE SECOND HALF IS SIZED. The drive after the resume is
// `framesPast(stepHold - stepTimer)` taken from the reading the PAUSE recorded —
// the remainder of that step, plus the frame or two that carries the boundary
// with a whole frame to spare either side of a `>=` and a `>` build. A build
// that carried the timer across the pause therefore spends the step, reads the
// board, and reaches step 2. A build that restarted the timer at `0` on resuming
// has that same drive to spend and is still short of the hold by everything the
// pause had already banked — about `0.1325` s, better than eight frames of the
// suite's clock, against the two frames of overshoot the drive carries — so it
// is still on step 1. The two answers are different, and that is the whole
// reading.
//
// The chain is posed with a second step waiting so there is a step 2 to reach at
// all, over the filler that carries a spare legal swap so the round is not
// already over when the swap is made.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertEqual,
  assertLength,
  assertTrue,
} from "../assert";
import { PAUSED_ITEMS, TICK_S } from "../constants";
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
  pauseGame,
  swapAndStep,
  takeMenuItem,
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

/**
 * Frames of the step spent before the pause, so the timer is caught mid-step
 * with enough banked that a build which restarted it cannot still finish the
 * step on the drive that follows the resume.
 */
const FRAMES_BEFORE_PAUSE = 6;

/** How many of the paused step's own holds the game is left standing for. */
const HOLDS_PAUSED = 4;

/** Where `RESUME` sits on the pause menu, from specs/ui.md's `PAUSED_ITEMS`. */
const RESUME_INDEX = PAUSED_ITEMS.indexOf("RESUME");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to playing with the board, the chain and both timers where the pause left them", async () => {
  const posed = quietRowsWithEscape([...STEP_ONE, ...STEP_TWO]);
  assertLength(maximalRuns(posed), 0, "maximal runs on the posed board");
  assertTrue(swapIsLegal(posed, SWAP_A, SWAP_B), "R1 and R3 accept the swap");

  await loadBoard(h, posed);
  const first = await swapAndStep(h, SWAP_A, SWAP_B);
  assertEqual(first.phase, "resolving", "the phase the accepted swap opened");
  await h.advance(FRAMES_BEFORE_PAUSE);

  const held = await h.snapshot();
  const heldBoard = await h.board();
  assertEqual(held.phase, "resolving", "the phase the pause catches");
  assertEqual(held.chainStep, 1, "the chain step the pause catches");
  assertTrue(held.stepTimer > 0, "the step timer the pause catches is running");
  assertTrue(held.stepHold > held.stepTimer, "the step still has hold left");

  // The remainder of THIS step, reckoned from the reading the pause recorded
  // rather than from anything read after it — which is what makes the drive
  // below decide whether the timer survived the pause.
  const remainingFrames = framesPast(held.stepHold - held.stepTimer);

  // Paused, and left paused for four of that step's own holds, so a build that
  // rebuilt the position on resuming has had every chance to lose it.
  await pauseGame(h);
  assertEqual(
    (await h.snapshot()).screen,
    "paused",
    "the screen RESUME is taken from",
  );
  await h.advance(HOLDS_PAUSED * framesPast(held.stepHold));

  await captureReplay(h, "resumed", async () => {
    // RESUME is really CHOSEN, which is what the item says: the highlight is
    // posed onto it — `setMenuIndex` takes no item — and `confirm` is what takes
    // it, through the key specs/controls.md binds and the build's own input path.
    await takeMenuItem(h, RESUME_INDEX);

    const resumed = await h.snapshot();
    assertEqual(resumed.screen, "playing", "the screen RESUME returns to");
    assertEqual(resumed.phase, "resolving", "the phase the resume hands back");
    assertEqual(resumed.chainStep, held.chainStep, "chainStep after resuming");

    // A WINDOW OF ONE FRAME, not an equality, and the reason is the choice
    // itself: `confirm` is a key, and a key press is delivered by a frame. A
    // build that reads the press in its event handler is back on `playing`
    // before that frame's update runs, so the step's timer carries a tick of
    // that frame; one that compares held state at the top of the frame is still
    // on `paused` through it and carries nothing. Both are conformant, and
    // specs/ui.md fixes neither. What the item forbids is the timer being LOST
    // — reset to zero, or rebuilt from the resume — and a window one frame wide
    // catches that while passing both readings of when the press lands.
    assertBetween(
      resumed.swapTimer,
      held.swapTimer,
      held.swapTimer + TICK_S,
      "swapTimer after resuming",
    );
    assertBetween(
      resumed.stepTimer,
      held.stepTimer,
      held.stepTimer + TICK_S,
      "stepTimer after resuming",
    );
    assertBoardEquals(await h.board(), heldBoard, "the board after resuming");

    await h.advance(remainingFrames);
  });

  // The timer carried on from where the pause left it, so what remained of the
  // step was enough to spend it and the chain read the board again.
  const carried = await h.snapshot();
  assertEqual(carried.chainStep, 2, "the chain step the resumed timer reached");
});
