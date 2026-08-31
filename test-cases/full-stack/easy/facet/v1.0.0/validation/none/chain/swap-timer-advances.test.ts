// chain/swap-timer-advances — swapTimer runs while the swap is in motion, and
// rests at 0 either side of it.
//
// specs/rules.md: "`swapTimer` holds `0` while `phase` is not `swapping`, and
// accumulates game time while it is." specs/instrumentation.md reports the same
// field and says the same of it: "`swapTimer` is `0` while `phase` is not
// `swapping`". So the field has three readings to give and this point takes all
// three — at rest on an idle board, running while the two gems travel, and back
// at rest the moment the chain has taken over.
//
// WHY IT IS WORTH ITS OWN POINT. `chain/swap-resolves-after-swap-seconds`
// decides that the animation ends where the specification says it does, and it
// would pass for a build that reached the boundary without ever reporting the
// timer — a build that counted frames privately and left the field at `0`
// throughout. What is read here is the FIELD: it rises with the game time the
// game was handed, and it returns to `0` rather than standing at whatever it
// stopped on.
//
// THE TOLERANCE IS ONE FRAME, AND THAT IS THE SPECIFICATION'S DOING. The swap is
// accepted by the call to `requestSwap`, which takes effect at once and is not
// itself a frame; nothing fixes whether the frame that runs next counts its own
// delta into a timer the call started, so two frames of game time may be read
// back as one frame's worth or as two. `TICK_S` (`0.015625` s) either side of
// the game time actually covered admits both readings and admits nothing else —
// a build that never accumulated would report `0`, which is a whole frame below
// the band, and one that accumulated per frame twice over would report double.
//
// THE PHASE IS READ BESIDE EVERY FIGURE. A timer reading `0` because the swap
// was never accepted at all would otherwise satisfy the first and last readings
// between them, so each is paired with the phase that makes it mean something.
//
// THE SCENARIO. Two rubies stand in row 4 at columns 2 and 4 and the third waits
// one row above the gap at (3,3), over the run-free filler; the swap drops it
// into (3,4) and makes a maximal run of exactly three, so R1 and R3 both accept
// and the board really does enter `swapping`. Nothing about the clear matters
// here — only that the swap was taken.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertTrue,
} from "../assert";
import { MATCH_MIN, SWAP_SECONDS, TICK_S } from "../constants";
import {
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
  framesPast,
  loadBoard,
  requestSwap,
  type Harness,
} from "../harness";

/** The ruby three the swap completes across row 4, every gem at strain 0. */
const RUN_CELLS: readonly PlacedToken[] = [
  { col: 2, row: 4, token: "R0" },
  { col: 3, row: 3, token: "R0" },
  { col: 4, row: 4, token: "R0" },
];

/** The swap that drops the waiting ruby into the gap. */
const SWAP_A: CellRef = { col: 3, row: 3 };
const SWAP_B: CellRef = { col: 3, row: 4 };

/**
 * Frames driven while the swap is in motion before the timer is read.
 *
 * Two of the suite's frames is `0.03125` s of game time, well inside
 * `SWAP_SECONDS` (`0.18`), so the reading is taken with the swap unambiguously
 * still running and nowhere near its boundary.
 */
const TIMED_FRAMES = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("accumulates while the swap is in motion and rests at 0 either side", async () => {
  const posed = quietRowsWith(RUN_CELLS);

  // The fixture: the posed board rests under R4, and R1 and R3 both accept the
  // swap, so the board really does enter `swapping` rather than refusing.
  assertLength(maximalRuns(posed), 0, "maximal runs on the posed board");
  assertTrue(swapIsLegal(posed, SWAP_A, SWAP_B), "R1 and R3 accept the swap");
  const made = maximalRuns(swapped(posed, SWAP_A, SWAP_B));
  assertLength(made, 1, "maximal runs the exchange makes");
  assertLength(made[0].cells, MATCH_MIN, "cells in the run the exchange makes");

  // At rest on the posed board: nothing is in motion, so the timer reports 0.
  const idle = await loadBoard(h, posed);
  assertEqual(idle.phase, "idle", "the phase the posed board rests in");
  assertEqual(idle.swapTimer, 0, "swapTimer while the board is idle");

  const readings = await captureReplay(h, "timer", async () => {
    // The acceptance itself, which sets the timer to 0 and starts it.
    const accepted = await requestSwap(h, SWAP_A, SWAP_B);
    await h.advance(TIMED_FRAMES);
    const running = await h.snapshot();
    // Past the boundary, so the chain has taken over from the animation.
    await h.advance(framesPast(Math.max(0, SWAP_SECONDS - running.swapTimer)));
    return { accepted, running, resolved: await h.snapshot() };
  });

  // The acceptance put the board into `swapping` with the timer at 0, which is
  // where specs/rules.md starts it.
  assertEqual(
    readings.accepted.phase,
    "swapping",
    "the phase the acceptance set",
  );
  assertEqual(
    readings.accepted.chainStep,
    0,
    "the chain step the acceptance left",
  );
  assertEqual(readings.accepted.swapTimer, 0, "swapTimer at the acceptance");

  // Two frames later it has risen, and it holds the game time those frames
  // covered to within the one frame the acceptance's own delta is worth.
  assertEqual(
    readings.running.phase,
    "swapping",
    "the phase while the swap is in motion",
  );
  assertGreaterThan(
    readings.running.swapTimer,
    0,
    "swapTimer after two frames of the swap",
  );
  assertBetween(
    readings.running.swapTimer,
    (TIMED_FRAMES - 1) * TICK_S,
    (TIMED_FRAMES + 1) * TICK_S,
    `swapTimer against the ${TIMED_FRAMES * TICK_S} s those frames covered, ` +
      `within the frame nothing fixes`,
  );

  // And past the boundary the animation is over, so the field is back at rest
  // while the chain runs.
  assertEqual(
    readings.resolved.phase,
    "resolving",
    "the phase once the swap is spent",
  );
  assertEqual(
    readings.resolved.chainStep,
    1,
    "the chain step once the swap is spent",
  );
  assertEqual(
    readings.resolved.swapTimer,
    0,
    "swapTimer while the phase is resolving",
  );
});
