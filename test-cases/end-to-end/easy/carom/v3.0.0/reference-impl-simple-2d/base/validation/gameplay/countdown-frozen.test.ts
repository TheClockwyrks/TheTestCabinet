// gameplay/countdown-frozen — the pre-serve countdown does not run while paused.
//
// A match is started with menu keys (opening on the countdown), advanced partway,
// then paused; far more than the whole hold is then let pass. A countdown that
// kept running while paused would elapse and the ball would serve — so the game
// must stay paused with the ball still held at centre, resume back INTO the
// countdown rather than into a live rally, and then finish the remaining hold and
// actually launch.

import { afterEach, beforeEach, expect, it } from "vitest";
import { HOLD_TIME } from "../../src/constants";
import {
  TICK_HZ,
  createHarness,
  startWithKeys,
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

afterEach(() => {
  harness.dispose();
});

it("freezes the countdown while paused and resumes it where it stopped", async () => {
  await startWithKeys(harness, "solo");

  await harness.advance(PARTWAY_TICKS);
  const mid = harness.snapshot();
  expect(mid.screen).toBe("countdown");

  await harness.tap("Escape");
  expect(harness.snapshot().screen).toBe("paused");

  await harness.advance(PAUSED_TICKS);
  const whilePaused = harness.snapshot();

  expect(whilePaused.screen).toBe("paused");
  expect(Math.abs(whilePaused.ball.x - mid.ball.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(whilePaused.ball.y - mid.ball.y)).toBeLessThanOrEqual(1);

  // Resuming returns to the countdown; it did not skip ahead to a live serve.
  await harness.tap("Escape");
  expect(harness.snapshot().screen).toBe("countdown");

  // And the resumed countdown is live, not stuck for good: the remainder of the
  // hold runs out and the ball really launches.
  await harness.advance(RESUMED_TICKS);
  const resumed = harness.snapshot();

  expect(resumed.screen).toBe("playing");
  expect(resumed.ball.speed).toBeGreaterThan(1);
});
