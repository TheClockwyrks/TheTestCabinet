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
// THE DRIVE. The step is POSED at 2 and then nothing is done but step.
// specs/instrumentation.md's `setChainStep` "sets the chain step an extraction
// scores at to `k` ... and restarts the window that returns the step to `1`, so
// the posed step holds for `CHAIN_RESET` (`2.0` s) of play from the call" — so
// the window this point measures starts at the pose, exactly as it would start at
// an extraction.
//
// WHY THE STEP IS POSED RATHER THAN EARNED. Raising it by driving a merge
// extraction is `extraction/chain-increment`'s requirement: a build with a broken
// merge would fail both points instead of one, and the drive would spend two
// hundred ticks reaching a state a single pose reaches. The surface carries a
// single-field pose for the step so that a point about the LAPSE can decide the
// lapse alone.
//
// WHY 122 TICKS. specs/instrumentation.md fixes the tick at `TICK_DT` (1 / 60 s),
// so 2.0 s is exactly 120 ticks and the lapse falls on the 120th. The check steps
// two ticks past that — the case's standing `TICK_TOL` of +/- 2 ticks on a
// duration — so a conformant build has lapsed however it rounds the last tick.
// Both figures come from `ticksFor` over `CHAIN_RESET` and from `TICK_TOL` rather
// than being spelled.
//
// WHAT THE QUIET HALL HAS TO KEEP. Two things would make the reading mean
// something else, so both are asserted rather than assumed:
//
//   - A level still being played. The hall is EMPTY, which it can be because
//     `poseHall` holds the inlet with `setEmission(false)` and leaves the quota
//     unexhausted: specs/progression.md clears a level "the moment its quota is
//     exhausted and no cores remain on the channel", and an unexhausted quota
//     never satisfies that. A hall that left `playing` would stop the clock this
//     point is about.
//   - No extraction in the window. "elapses with no extraction" is the whole
//     condition, and an empty channel makes it structural — there is nothing to
//     insert into and nothing to merge — but the score is read across the span
//     anyway, so a build that scored from somewhere cannot pass.
//
// THE TOLERANCE. The step is a whole number, read exactly. The window's opening
// value is read at the case's standing +/- 2 ticks on a duration, which is what
// makes 122 ticks the right count to step. The timer at the end is read as a
// bound rather than an equality: a build that clamps the countdown at 0 and one
// that lets the last partial tick carry it just below 0 are both honest readings
// of "seconds left", and one tick's worth of slack admits both while still ruling
// out a timer that restarted itself.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual, assertNear } from "../assert";
import { CHAIN_RESET, TICK_DT, TICK_TOL } from "../constants";
import {
  captureReplay,
  coreCount,
  createHarness,
  poseHall,
  ticksFor,
  type Harness,
} from "../harness";

/** The step the chain is posed at, so "back to 1" is a reading and not a default. */
const POSED_STEP = 2;

/** 2.0 s of quiet plus the standing two-tick slack: 122 ticks. */
const LAPSE_TICKS = ticksFor(CHAIN_RESET) + TICK_TOL;

/** The +/- 2 ticks the case's standing tolerances put on a duration, in seconds. */
const DURATION_TOL = TICK_TOL * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns the chain to step 1 after 2.0 s with no extraction", async () => {
  await poseHall(h, { chainStep: POSED_STEP });

  const posed = await h.snapshot();
  assertEqual(posed.chainStep, POSED_STEP, "the chain step the pose left");
  assertNear(
    posed.chainTimer,
    CHAIN_RESET,
    DURATION_TOL,
    "the seconds left on the window the pose restarted",
  );
  assertEqual(coreCount(posed), 0, "the cores the pose left on the channel");

  const quiet = await captureReplay(h, "reset", () => h.step(LAPSE_TICKS));

  // The hall was quiet: nothing scored across the window, so what lapsed is the
  // clock rather than a run being drawn out.
  assertEqual(quiet.score, posed.score, "the score across the quiet");
  assertEqual(quiet.screen, "playing", "the screen the quiet ran on");

  // The rule itself.
  assertEqual(quiet.chainStep, 1, "the chain step after the window lapsed");
  assertLessThanOrEqual(
    quiet.chainTimer,
    TICK_DT,
    "seconds left on a lapsed chain",
  );
});
