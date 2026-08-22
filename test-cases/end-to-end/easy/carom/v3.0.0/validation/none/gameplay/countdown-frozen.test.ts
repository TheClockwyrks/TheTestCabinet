// gameplay/countdown-frozen — the pre-serve countdown does not run while paused.
//
// A match is started with menu keys (opening on the countdown), advanced partway,
// then paused; far more than the whole hold is then let pass. A countdown that
// kept running while paused would elapse and the ball would serve — so the game
// must stay paused with the ball still held at centre, resume back INTO the
// countdown rather than into a live rally, and then finish the remaining hold and
// actually launch.

import { afterEach, beforeEach, expect, it } from "vitest";
import { HOLD_TIME } from "../constants";
import {
  ball0,
  captureReplay,
  createHarness,
  startWithKeys,
  TICK_HZ,
  type Harness,
} from "../harness";

/** Partway into the hold: far enough in to be visibly counting, well short of it. */
const PARTWAY_TICKS = 24; // 0.2 s
/** Far longer than the whole hold, so a countdown that ran would have elapsed. */
const PAUSED_TICKS = Math.round(HOLD_TIME * TICK_HZ * 5);
/** Past the remainder of the hold once the game is running again. */
const RESUMED_TICKS = Math.round(HOLD_TIME * TICK_HZ * 1.2);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("freezes the countdown while paused and resumes it where it stopped", async () => {
  await startWithKeys(harness, "solo");

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
    expect(mid.screen).toBe("countdown");

    await harness.tap("Escape");
    expect((await harness.snapshot()).screen).toBe("paused");

    await harness.advance(PAUSED_TICKS);
    const whilePaused = await harness.snapshot();

    expect(whilePaused.screen).toBe("paused");
    expect(Math.abs(ball0(whilePaused).x - ball0(mid).x)).toBeLessThanOrEqual(
      1,
    );
    expect(Math.abs(ball0(whilePaused).y - ball0(mid).y)).toBeLessThanOrEqual(
      1,
    );

    // Resuming returns to the countdown; it did not skip ahead to a live serve.
    await harness.tap("Escape");
    expect((await harness.snapshot()).screen).toBe("countdown");

    // And the resumed countdown is live, not stuck for good: the remainder of
    // the hold runs out and the ball really launches.
    await harness.advance(RESUMED_TICKS);
    const resumed = await harness.snapshot();

    expect(resumed.screen).toBe("playing");
    expect(ball0(resumed).speed).toBeGreaterThan(1);
  });
});
