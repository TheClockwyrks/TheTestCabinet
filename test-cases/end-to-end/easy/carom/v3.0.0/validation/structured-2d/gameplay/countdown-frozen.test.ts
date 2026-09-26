// gameplay/countdown-frozen — the pre-serve countdown does not run while paused.
//
// A match is opened on its countdown through the debug surface — the freeze is
// what this check decides, so the menus are not its to drive — then advanced
// partway and paused; far more than the whole hold is then let pass. A countdown
// that kept running while paused would elapse and the ball would serve — so the
// game must stay paused with the ball still held at its home point, resume back
// INTO the countdown rather than into a live rally, and then finish the remaining
// hold and actually launch.
//
// HOW THE FROZEN TIMER IS READ. The hold's remaining seconds have no one
// spec-fixed home in every variant — the one-ball matches count `state.holdTimer`
// down and each `multi` ball carries a hold of its own — so the freeze is read
// off the launch instead: the serve after resuming arrives the REMAINDER of the
// hold later, to the frame. A countdown that ran while paused has no remainder
// left and serves at once; one that restarted from the top takes the whole hold
// again; only a timer held exactly where the pause caught it takes the time this
// check demands. That is "holdTimer does not change" measured by what the timer
// is FOR.

import { afterEach, beforeEach, it } from "vitest";
import { HOLD_TIME } from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  ball0,
  captureReplay,
  createHarness,
  isolateField,
  openCountdown,
  TICK_HZ,
  type Harness,
} from "../harness";

/** The whole hold, in frames of the harness's clock. */
const HOLD_TICKS = Math.round(HOLD_TIME * TICK_HZ);
/** Partway into the hold: far enough in to be visibly counting, well short of it. */
const PARTWAY_TICKS = 24; // 0.2 s
/** Far longer than the whole hold, so a countdown that ran would have elapsed. */
const PAUSED_TICKS = HOLD_TICKS * 5;
/**
 * The margin on the resumed remainder, in frames. Each update reads input first
 * and then advances the screen it left (specs/ui.md), so the taps that pause and
 * resume may each spend a frame of countdown, and the launch frame itself counts
 * or not — a handful of frames, against a remainder 24 frames from either wrong
 * answer (zero for a countdown that elapsed, the whole hold for one restarted).
 */
const REMAINDER_TOLERANCE = 4;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("freezes the countdown while paused and resumes it where it stopped", async () => {
  await openCountdown(harness, "solo");
  // One ball, no obstacles. `isolateField` respawns the ball with a full hold, so
  // the countdown the frames below are counted against starts here.
  isolateField(harness);

  // The whole bracket is one recorded section: a countdown part-run, the press
  // that pauses it, the long stretch in which it does NOT run, the press that
  // resumes it, and the launch that proves it picked up where it stopped. The
  // frozen stretch alone would be a still screen, which is what a countdown that
  // wrongly kept running looks like too until it elapses — the freeze is only
  // legible against the counting either side of it. Nothing about the timeline
  // moves; the recorder is simply armed earlier and disarmed later.
  await captureReplay(harness, "countdown", async () => {
    await harness.advance(PARTWAY_TICKS);
    const mid = harness.snapshot();
    assertEqual(mid.screen, "countdown");
    assertEqual(ball0(mid).held, true);

    await harness.tap("Escape");
    assertEqual(harness.snapshot().screen, "paused");

    await harness.advance(PAUSED_TICKS);
    const whilePaused = harness.snapshot();

    // "Paddles, ball, and holdTimer are all frozen" (specs/ui.md).
    assertEqual(whilePaused.screen, "paused");
    assertEqual(ball0(whilePaused).held, true);
    assertLessThanOrEqual(Math.abs(ball0(whilePaused).x - ball0(mid).x), 1);
    assertLessThanOrEqual(Math.abs(ball0(whilePaused).y - ball0(mid).y), 1);

    // Resuming returns to the countdown; it did not skip ahead to a live serve.
    await harness.tap("Escape");
    assertEqual(harness.snapshot().screen, "countdown");

    // And the resumed countdown is live, not stuck for good: the remainder of
    // the hold — and only the remainder — runs out, and the ball really
    // launches.
    const resumed = await harness.until((s) => s.screen === "playing", {
      maxFrames: HOLD_TICKS + PARTWAY_TICKS,
      poll: 1,
    });

    assertEqual(resumed.hit, true);
    assertLessThanOrEqual(
      Math.abs(resumed.frames - (HOLD_TICKS - PARTWAY_TICKS)),
      REMAINDER_TOLERANCE,
    );
    assertGreaterThan(ball0(resumed.snapshot).speed, 1);
  });
});
