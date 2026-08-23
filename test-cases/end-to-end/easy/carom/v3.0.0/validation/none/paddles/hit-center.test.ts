// paddles/hit-center — a center contact on a still paddle returns straight
// across.
//
// specs/balls.md: `offset = (ballY - paddleCy) / PADDLE_HALF` and
// `theta = offset * MAX_BOUNCE_ANGLE`, so a contact level with the paddle's
// center leaves at 0 degrees from horizontal. The paddle is stationary, so
// nothing but the contact point sets the angle. The ball approaches at
// `FACE_SHOT_SPEED`, one sub-step per frame, so the frame of the rebound ends
// with exactly the velocity the bounce formula produced; the margin of a degree
// is rounding room, since `sin(0)` is exact.

import { afterEach, beforeEach, expect, it } from "vitest";
import { FIELD_CY } from "../constants";
import {
  FACE_SHOT_SPEED,
  LEAD_TICKS,
  angleDeg,
  arrangePaddleHit,
  captureReplay,
  createHarness,
  drivePaddleHit,
  startPlaying,
  type Harness,
} from "../harness";

const STRAIGHT_MAX_DEG = 1;

/** Frames of the return flight recorded after the contact, for the replay. */
const RETURN_TICKS = 90; // 0.75 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("returns the ball level from the center of a still paddle", async () => {
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
  expect(contact.ball.vx).toBeGreaterThan(0);
  expect(angleDeg(contact.ball)).toBeLessThanOrEqual(STRAIGHT_MAX_DEG);
});
