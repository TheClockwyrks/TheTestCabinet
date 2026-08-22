// Carom — pause/ball-continues: after unpausing, the ball carries on from exactly
// where it was suspended.
//
// The fault this catches is a build that treats resuming as a fresh start: a
// re-serve, or a jump back to the centre. So the ball is posed in mid-flight,
// frozen, confirmed still, and then resumed — and where it ends up a known number
// of frames later is compared against where its own preserved velocity would have
// carried it from the paused position.
//
// The window is one frame wide, deliberately. Resuming is itself a frame, and
// whether a build simulates the frame that consumed the resume or starts from the
// next one is not something the specification fixes; either is a continuation. A
// teleport is a hundred pixels out and misses the window by any measure.

import { afterEach, beforeEach, expect, it } from "vitest";
import {
  arrangeLiveBall,
  ball0,
  captureReplay,
  createHarness,
  TICK_HZ,
  type Harness,
} from "../harness";

/** Frames run after the resume key, the resuming frame included. */
const RESUMED_TICKS = 24;

/** How long the ball is left hanging before it is resumed. */
const FROZEN_TICKS = 120; // 1 s

/**
 * How much of the freeze is recorded, out of the whole of it.
 *
 * A recording that opened on the resume key would show a ball moving and nothing
 * to tell a reviewer it had ever stopped — the review item promises "the ball
 * resuming from where it was paused", and the "from where it was paused" half is
 * the still frames in front of it. The freeze still lasts exactly `FROZEN_TICKS`;
 * the split is only where the recorder is armed.
 */
const HANGING_TICKS = 48; // 0.4 s

/** Float slop, in logical px. The window itself is a whole frame of travel. */
const SLOP = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("resumes the ball from its paused position at its preserved velocity", async () => {
  await arrangeLiveBall(h, { x: 500, y: 360, vx: 400, vy: -120 });

  await h.advance(30); // 0.25 s of visible flight
  await h.tap("Escape");
  const paused = await h.snapshot();
  expect(paused.screen).toBe("paused");

  await h.advance(FROZEN_TICKS - HANGING_TICKS);

  const held = await captureReplay(h, "continues", async () => {
    await h.advance(HANGING_TICKS);
    // The end of the freeze, read on exactly the frame it was read on before.
    const still = await h.snapshot();

    await h.tap("Escape"); // resume, which is itself one frame
    await h.advance(RESUMED_TICKS - 1);
    return still;
  });
  expect(ball0(held).x).toBeCloseTo(ball0(paused).x, 1);
  expect(ball0(held).y).toBeCloseTo(ball0(paused).y, 1);

  const resumed = await h.snapshot();

  expect(resumed.screen).toBe("playing");

  // Where the paused velocity carries the paused position over the resumed span.
  // The window is one frame wide because the frame that consumed the resume may
  // or may not have been simulated, and either reading is a continuation.
  const travel = (from: number, v: number): [number, number] => {
    const a = from + (v * (RESUMED_TICKS - 1)) / TICK_HZ;
    const b = from + (v * RESUMED_TICKS) / TICK_HZ;
    return [Math.min(a, b) - SLOP, Math.max(a, b) + SLOP];
  };
  const [xLow, xHigh] = travel(ball0(paused).x, ball0(paused).vx);
  const [yLow, yHigh] = travel(ball0(paused).y, ball0(paused).vy);

  expect(ball0(resumed).x).toBeGreaterThanOrEqual(xLow);
  expect(ball0(resumed).x).toBeLessThanOrEqual(xHigh);
  expect(ball0(resumed).y).toBeGreaterThanOrEqual(yLow);
  expect(ball0(resumed).y).toBeLessThanOrEqual(yHigh);
  expect(ball0(resumed).speed).toBeCloseTo(ball0(paused).speed, 1);
});
