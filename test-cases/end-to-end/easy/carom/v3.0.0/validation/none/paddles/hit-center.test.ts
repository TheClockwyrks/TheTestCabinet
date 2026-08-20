// paddles/hit-center — a centre contact on a still paddle returns straight across.
//
// The outgoing angle comes from the contact point: `offset = (ballY - paddleCy) /
// PADDLE_HALF` and `theta = offset * MAX_BOUNCE_ANGLE`, so a contact level with
// the paddle's centre returns level. The paddle is stationary, so the angle is
// the contact point's doing alone with no spin from paddle motion mixed in. The
// paddle pose and the contact height are the preconditions; the outgoing velocity
// is what the real bounce produced. The steep case is the sibling `hit-edge`.

import { afterEach, beforeEach, expect, it } from "vitest";
import { FIELD_CY } from "../../src/constants";
import {
  LEAD_TICKS,
  angleDeg,
  arrangePaddleHit,
  createHarness,
  drivePaddleHit,
  startPlaying,
  type Harness,
} from "../harness";

/** The old browser suite's margin for "straight", in degrees. */
const STRAIGHT_MAX_DEG = 3;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

it("returns the ball level from the centre of a still paddle", async () => {
  await startPlaying(harness);
  arrangePaddleHit(harness, "left", {
    cy: FIELD_CY,
    vy: 0,
    ballY: FIELD_CY,
    leadTicks: LEAD_TICKS,
  });

  const contact = await drivePaddleHit(harness, "left", {
    leadTicks: LEAD_TICKS,
  });

  expect(contact.hit).toBe(true);
  expect(contact.ball.vx).toBeGreaterThan(0);
  expect(angleDeg(contact.ball)).toBeLessThan(STRAIGHT_MAX_DEG);
});
