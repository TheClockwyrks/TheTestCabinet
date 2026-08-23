// spin/stationary — a paddle that is not moving imparts no spin.
//
// specs/balls.md: on a paddle hit, `spin = clamp(spin + paddleVy *
// SPIN_FROM_PADDLE, ...)`. A spinless ball struck by a paddle whose integrated
// `vy` is 0 leaves with spin exactly 0; the margin is rounding room. The
// paddle pose is the precondition; the bounce is the build's own.

import { afterEach, beforeEach, expect, it } from "vitest";
import { FIELD_CY } from "../constants";
import {
  FACE_SHOT_SPEED,
  LEAD_TICKS,
  arrangePaddleHit,
  captureReplay,
  createHarness,
  drivePaddleHit,
  startPlaying,
  type Harness,
} from "../harness";

/** Frames of the return flight recorded after the contact, for the replay. */
const RETURN_TICKS = 90; // 0.75 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("imparts no spin from a still paddle", async () => {
  await startPlaying(harness);
  await arrangePaddleHit(harness, "left", {
    cy: FIELD_CY,
    vy: 0,
    ballY: FIELD_CY,
    approachSpeed: FACE_SHOT_SPEED,
    leadTicks: LEAD_TICKS,
  });

  const contact = await captureReplay(harness, "straight", async () => {
    const rebound = await drivePaddleHit(harness, "left", {
      leadTicks: LEAD_TICKS,
    });
    await harness.advance(RETURN_TICKS);
    return rebound;
  });

  expect(contact.hit).toBe(true);
  expect(contact.paddle.vy).toBeCloseTo(0, 6);
  expect(contact.ball.spin).toBeCloseTo(0, 6);
});
