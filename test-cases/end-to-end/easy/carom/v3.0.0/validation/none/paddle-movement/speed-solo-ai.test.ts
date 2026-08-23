// paddle-movement/speed-solo-ai — the AI paddle's chase speed in Solo.
//
// specs/modes/single-player.md fixes the AI exactly: with the ball in flight
// toward it, `target = ball.y - ball.vy * AI_REACT`, `diff = target - cy`, and
// beyond the deadzone `vy = sign(diff) * min(AI_SPEED, |diff| / dt)`, then the
// paddle integrates `vy * dt`. So a paddle far from its target moves at
// exactly `AI_SPEED` (560 units per second) every frame until it is within
// `AI_SPEED * dt` of the deadzone. The real AI is handed its paddle with a
// level ball far down the field, and its displacement over a short window is
// measured back into a speed; two percent is rounding room.
//
// The window: from `cy = 120` toward a target of 650 the paddle is over 500
// units short, and covers 56 in the 12 frames measured.

import { afterEach, beforeEach, expect, it } from "vitest";
import { AI_SPEED } from "../constants";
import {
  arrangeAiChase,
  captureReplay,
  createHarness,
  driveAiChaseSpeed,
  type Harness,
} from "../harness";

const SPEED_TOLERANCE = AI_SPEED * 0.02;

/** Frames of the chase recorded after the measured window, for the replay. */
const CHASE_TICKS = 84; // 0.7 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("chases the ball at AI_SPEED", async () => {
  await arrangeAiChase(harness);

  const chase = await captureReplay(harness, "move", async () => {
    const measured = await driveAiChaseSpeed(harness);
    await harness.advance(CHASE_TICKS);
    return measured;
  });

  expect(chase.delta).toBeGreaterThan(0); // toward the ball, down the field
  expect(Math.abs(chase.speed - AI_SPEED)).toBeLessThanOrEqual(SPEED_TOLERANCE);
});
