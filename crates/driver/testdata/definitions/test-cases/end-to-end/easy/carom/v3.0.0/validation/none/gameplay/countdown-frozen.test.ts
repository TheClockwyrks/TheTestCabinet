// gameplay/countdown-frozen — the pre-serve countdown does not run while paused.
//
// A match is opened on its countdown through the debug surface — the freeze is
// what this check decides, so the menus are not its to drive — then advanced
// partway and paused; far more than the whole hold is then let pass. A countdown
// that kept running while paused would elapse and the ball would serve — so the
// game must stay paused with the ball still held at centre, resume back INTO the
// countdown rather than into a live rally, and then finish the remaining hold
// and actually launch.
//
// WHAT IS READ IS THE HOLD ITSELF. The snapshot reports the ball's `holdTimer`
// (specs/instrumentation.md), so the freeze is read where the specification puts
// it rather than inferred from a ball that would sit at its home point either
// way: a countdown ticking away behind the pause menu moves that number, and a
// frozen one does not.
//
// THE FIELD HOLDS THE HELD BALL AND NOTHING ELSE. The obstacles take no part in
// a countdown and none in a pause, so they come off the field; what a reviewer
// watches is the one body whose hold this point is about.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  assertLessThanOrEqual,
} from "../assert";
import { HOLD_TIME } from "../constants";
import {
  ball0,
  captureReplay,
  createHarness,
  isolateBall,
  openCountdown,
  TICK_HZ,
  type Harness,
} from "../harness";

/** Partway into the hold: far enough in to be visibly counting, well short of it. */
const PARTWAY_TICKS = 24; // 0.2 s
/** Far longer than the whole hold, so a countdown that ran would have elapsed. */
const PAUSED_TICKS = Math.round(HOLD_TIME * TICK_HZ * 5);
/** Past the remainder of the hold once the game is running again. */
const RESUMED_TICKS = Math.round(HOLD_TIME * TICK_HZ * 1.2);
/**
 * How far the frozen `holdTimer` may drift, in seconds: two frames of the
 * suite's clock.
 *
 * The pausing press runs one frame of its own, and `specs/ui.md` has an update
 * read its input first and then advance the screen that input left it on — so
 * that frame advances the pause, not the countdown. Two frames' room covers a
 * build that resolves the edge one frame later and the rounding of the
 * subtractions either side of it, and is still six hundred times smaller than
 * the drift a countdown left running would show.
 */
const FROZEN_TOLERANCE = 2 / TICK_HZ;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("freezes the countdown while paused and resumes it where it stopped", async () => {
  await openCountdown(harness, "solo");
  await isolateBall(harness);

  // The whole bracket is one recorded section: a countdown part-run, the press
  // that pauses it, the long stretch in which it does NOT run, the press that
  // resumes it, and the launch that proves it picked up where it stopped. The
  // frozen stretch alone would be a still screen, which is what a countdown that
  // wrongly kept running looks like too until it elapses — the freeze is only
  // legible against the counting either side of it. Nothing about the timeline
  // moves; the recorder is simply armed earlier and disarmed later.
  await captureReplay(harness, "countdown", async () => {
    await harness.advance(PARTWAY_TICKS);
    const mid = await harness.snapshot();
    assertEqual(mid.screen, "countdown");
    // The countdown really was running before the pause: part of the hold is
    // gone, and the rest of it is what must survive the freeze.
    assertLessThan(ball0(mid).holdTimer, HOLD_TIME);
    assertGreaterThan(ball0(mid).holdTimer, 0);

    await harness.tap("Escape");
    assertEqual((await harness.snapshot()).screen, "paused");

    await harness.advance(PAUSED_TICKS);
    const whilePaused = await harness.snapshot();

    assertEqual(whilePaused.screen, "paused");
    assertEqual(ball0(whilePaused).held, true);
    assertLessThanOrEqual(
      Math.abs(ball0(whilePaused).holdTimer - ball0(mid).holdTimer),
      FROZEN_TOLERANCE,
    );

    // Resuming returns to the countdown; it did not skip ahead to a live serve.
    await harness.tap("Escape");
    assertEqual((await harness.snapshot()).screen, "countdown");

    // And the resumed countdown is live, not stuck for good: the remainder of
    // the hold runs out and the ball really launches.
    await harness.advance(RESUMED_TICKS);
    const resumed = await harness.snapshot();

    assertEqual(resumed.screen, "playing");
    assertGreaterThan(ball0(resumed).speed, 1);
  });
});
