// paddles/hit-bottom-edge — a contact at the bottom edge of a still paddle
// leaves downward at the full bounce angle.
//
// specs/balls.md: `offset = (ballY - paddleCy) / PADDLE_HALF`, clamped to
// [-1, 1], and `theta = offset * MAX_BOUNCE_ANGLE`. A ball level with
// `cy + PADDLE_HALF` is `offset = 1`, so it leaves at `+MAX_BOUNCE_ANGLE`:
// 55 degrees below horizontal, `vy > 0`. The paddle is stationary, so nothing
// but the contact point sets the angle. The ball approaches at
// `FACE_SHOT_SPEED`, one sub-step per frame, so the frame of the rebound ends
// with exactly the velocity the formula produced; two degrees is rounding room.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { FIELD_CY, MAX_BOUNCE_ANGLE, PADDLE_HALF } from "../constants";
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

const EDGE_ANGLE_DEG = (MAX_BOUNCE_ANGLE * 180) / Math.PI;
const ANGLE_TOLERANCE_DEG = 2;

/** Frames of the return flight recorded after the contact, for the replay. */
const RETURN_TICKS = 90; // 0.75 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("deflects the ball downward at the full bounce angle off the bottom edge", async () => {
  await startPlaying(harness);
  await arrangePaddleHit(harness, "left", {
    cy: FIELD_CY,
    vy: 0,
    ballY: FIELD_CY + PADDLE_HALF,
    approachSpeed: FACE_SHOT_SPEED,
    leadTicks: LEAD_TICKS,
  });

  const contact = await captureReplay(harness, "deflection", async () => {
    const rebound = await drivePaddleHit(harness, "left", {
      leadTicks: LEAD_TICKS,
    });
    await harness.advance(RETURN_TICKS);
    return rebound;
  });

  assertEqual(contact.hit, true);
  assertGreaterThan(contact.ball.vx, 0);
  assertGreaterThan(contact.ball.vy, 0);
  assertLessThanOrEqual(
    Math.abs(angleDeg(contact.ball) - EDGE_ANGLE_DEG),
    ANGLE_TOLERANCE_DEG,
  );
});
