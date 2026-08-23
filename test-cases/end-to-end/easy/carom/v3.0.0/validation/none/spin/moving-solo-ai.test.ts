// spin/moving-solo-ai — the AI paddle, chasing as it strikes, imparts spin
// (Solo).
//
// specs/balls.md: on a paddle hit, `spin = clamp(spin + paddleVy *
// SPIN_FROM_PADDLE, ...)`, with `paddleVy` the paddle's integrated velocity.
// specs/modes/single-player.md fixes the AI's velocity while it chases a ball
// far from its target: `sign(diff) * AI_SPEED`. The real AI is handed its
// paddle above the lane with a ball arriving while it is still sweeping down,
// so it strikes moving at `AI_SPEED` and the ball leaves with spin of magnitude
// `AI_SPEED * SPIN_FROM_PADDLE` (476), signed by the paddle's direction.
//
// Ten percent is the room for the frame of the contact: the ball approaches at
// 500 units per second, two sub-steps a frame, so the contact may resolve in
// the first sub-step and the second decays the spin a fraction of a percent;
// and the AI's own per-frame integration decides where in the frame it stands.

import { afterEach, beforeEach, expect, it } from "vitest";
import { AI_SPEED, SPIN_FROM_PADDLE } from "../constants";
import {
  arrangeAiMovingHit,
  captureReplay,
  createHarness,
  drivePaddleHit,
  type Harness,
} from "../harness";

const EXPECTED_SPIN = AI_SPEED * SPIN_FROM_PADDLE;
const SPIN_TOLERANCE = EXPECTED_SPIN * 0.1;

/** Frames of the return flight recorded after the contact, for the replay. */
const RETURN_TICKS = 90; // 0.75 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("imparts AI_SPEED * SPIN_FROM_PADDLE, signed by the AI paddle's direction", async () => {
  await arrangeAiMovingHit(harness);

  const contact = await captureReplay(harness, "curve", async () => {
    const rebound = await drivePaddleHit(harness, "right");
    await harness.advance(RETURN_TICKS);
    return rebound;
  });

  expect(contact.hit).toBe(true);
  // The AI starts above the lane and sweeps down, so it strikes moving down.
  expect(contact.paddle.vy).toBeGreaterThan(0);
  expect(Math.sign(contact.ball.spin)).toBe(Math.sign(contact.paddle.vy));
  expect(
    Math.abs(Math.abs(contact.ball.spin) - EXPECTED_SPIN),
  ).toBeLessThanOrEqual(SPIN_TOLERANCE);
});
