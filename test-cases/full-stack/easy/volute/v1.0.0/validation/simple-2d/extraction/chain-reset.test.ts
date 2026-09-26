// extraction/chain-reset — CHAIN_RESET (2.0 s) of quiet takes the chain step back
// to 1 on its own.
//
// THE RULE, FROM THE SPEC. specs/extraction.md — "The chain step":
// "`CHAIN_RESET` (2.0 s) elapses with no extraction | 1", and "The elapsed time
// since the most recent extraction falls with the ticks that advance play, and
// every extraction restarts it." specs/instrumentation.md reports both halves —
// `chainStep` and `chainTimer`, "seconds left before the step returns to 1".
// `CHAIN_RESET` is 2.0 s in specs/extraction.md's Figures table.
//
// THIS IS THE THIRD DIRECTION. chain-increment grades the step a merge adds and
// chain-insertion-resets the step an insertion takes the chain back to; a build can
// get both of those right and never let the chain lapse on its own, so the quiet
// hall is its own point.
//
// THE DRIVE. The chain is POSED at step 2, through the operation
// specs/instrumentation.md carries for it: `setChainStep(k)` "Sets the chain step
// an extraction scores at to `k` ... and restarts the window that returns the step
// to `1`, so the posed step holds for `CHAIN_RESET` (`2.0` s) of play from the
// call." Then nothing is done but step. Reaching step 2 by driving a real merge
// extraction instead would fold `extraction/chain-increment`'s requirement into
// this one — a build whose merge never raises the chain would fail here for a
// reason this point does not own — and would spend the frames of the catch-up on
// top of the lapse.
//
// WHY 122 TICKS. specs/instrumentation.md fixes the tick at `TICK_DT` (1 / 60 s),
// so 2.0 s is exactly 120 ticks and the lapse falls on the 120th. The check steps
// two ticks past that — the case's standing `TICK_TOL` of +/- 2 ticks on a
// duration — so a conformant build has lapsed however it rounds the last tick.
// Both figures come from `ticksFor` over `CHAIN_RESET` and from `TICK_TOL` rather
// than being spelled.
//
// WHAT THE QUIET HALL HAS TO KEEP. Two things would make the reading mean something
// else, so both are asserted rather than assumed:
//
//   - Cores still standing. specs/progression.md — "Clearing a level": "A level is
//     cleared the moment its quota is exhausted and no cores remain on the
//     channel", and specs/channel.md's tick order runs that check every tick. A
//     hall that emptied would leave `playing` and stop the clock this point is
//     about. Two cores of DIFFERENT charges are posed a channel spacing apart, so
//     they ride as one segment and can never extract — a run of two is under
//     specs/extraction.md's minimum of three, and their charges differ besides —
//     and the channel stays occupied and quiet at the same time. The inlet is held
//     by `poseHall`, so nothing arrives to join them.
//   - No extraction in the window. "elapses with no extraction" is the whole
//     condition, so the check reads that the score never moved across the span.
//
// THE TOLERANCE. The step is a whole number, read exactly. The timer is read as a
// bound rather than an equality: a build that clamps the countdown at 0 and one
// that lets the last partial tick carry it just below 0 are both honest readings of
// "seconds left", and one tick's worth of slack admits both while still ruling out
// a timer that restarted itself.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { CHAIN_RESET, SPACING, TICK_DT, TICK_TOL } from "../constants";
import {
  captureReplay,
  coreCount,
  createHarness,
  poseHall,
  ticksFor,
  type Harness,
} from "../harness";

/** The head of the pair the quiet hall stands on, clear of both ends of the channel. */
const HEAD_S = 500;

/** The chain step the hall is posed at, so a return to 1 is readable. */
const POSED_STEP = 2;

/** 2.0 s of quiet plus the standing two-tick slack: 122 ticks. */
const LAPSE_TICKS = ticksFor(CHAIN_RESET) + TICK_TOL;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns the chain to step 1 after 2.0 s with no extraction", async () => {
  await poseHall(h, {
    chainStep: POSED_STEP,
    cores: [
      [HEAD_S, "halide", null],
      [HEAD_S - SPACING, "cobalt", null],
    ],
  });

  const posed = await h.snapshot();
  assertEqual(
    posed.chainStep,
    POSED_STEP,
    "the chain step the pose left standing",
  );
  assertGreaterThan(
    posed.chainTimer,
    0,
    "the window the pose left running, which is what has to elapse",
  );

  const quiet = await captureReplay(h, "reset", () => h.step(LAPSE_TICKS));

  // The hall was quiet: nothing extracted across the window, so what lapsed is the
  // clock rather than a run being drawn out.
  assertEqual(quiet.score, posed.score, "the score across the quiet");
  // And it was still a level being played, with cores on the channel — an emptied
  // channel under an exhausted quota clears the level instead.
  assertGreaterThan(coreCount(quiet), 0, "cores standing through the quiet");
  assertEqual(quiet.screen, "playing");

  // The rule itself.
  assertEqual(quiet.chainStep, 1);
  assertLessThanOrEqual(
    quiet.chainTimer,
    TICK_DT,
    "seconds left on a lapsed chain",
  );
});
