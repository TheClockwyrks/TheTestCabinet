// paddles/hit-edge — the extreme edge of a still paddle deflects the ball steeply.
//
// A contact one paddle half-height off centre is `offset = 1`, so the outgoing
// angle is the full MAX_BOUNCE_ANGLE. The paddle is stationary, so the steep
// angle is the contact point's doing alone rather than spin imparted by a moving
// paddle. The straight case is the sibling `hit-center`.

import { afterEach, beforeEach, expect, it } from "vitest";
import { FIELD_CY, MAX_BOUNCE_ANGLE, PADDLE_HALF } from "../../src/constants";
import {
  LEAD_TICKS,
  angleDeg,
  arrangePaddleHit,
  createHarness,
  drivePaddleHit,
  startPlaying,
  type Harness,
} from "../harness";

const EDGE_ANGLE_DEG = (MAX_BOUNCE_ANGLE * 180) / Math.PI;
/** The old browser suite's margin, in degrees. */
const ANGLE_TOLERANCE_DEG = 8;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

it("deflects the ball steeply off the extreme edge of a still paddle", async () => {
  await startPlaying(harness);
  arrangePaddleHit(harness, "left", {
    cy: FIELD_CY,
    vy: 0,
    ballY: FIELD_CY + PADDLE_HALF,
    leadTicks: LEAD_TICKS,
  });

  const contact = await drivePaddleHit(harness, "left", {
    leadTicks: LEAD_TICKS,
  });

  expect(contact.hit).toBe(true);
  expect(contact.ball.vx).toBeGreaterThan(0);
  expect(Math.abs(angleDeg(contact.ball) - EDGE_ANGLE_DEG)).toBeLessThanOrEqual(
    ANGLE_TOLERANCE_DEG,
  );
});
