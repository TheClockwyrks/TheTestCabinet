// paddles/hit-center — a centre contact on a still paddle returns straight across.
//
// The outgoing angle comes from the contact point: `offset = (ballY - paddleCy) /
// PADDLE_HALF` and `theta = offset * MAX_BOUNCE_ANGLE`, so a contact level with
// the paddle's centre returns level. The paddle is stationary, so the angle is
// the contact point's doing alone with no spin from paddle motion mixed in. The
// paddle pose and the contact height are the preconditions; the outgoing velocity
// is what the real bounce produced. The steep cases are the siblings
// `hit-top-edge` and `hit-bottom-edge`.

import { afterEach, beforeEach, expect, it } from "vitest";
import { FIELD_CY } from "../../src/constants";
import {
  LEAD_TICKS,
  angleDeg,
  arrangePaddleHit,
  captureReplay,
  createHarness,
  drivePaddleHit,
  startPlaying,
  type Harness,
} from "../harness";

/**
 * The review item's margin, in degrees. The contact is posed dead level with a
 * still paddle and no spin, so the specified angle is exactly 0; a degree covers
 * the frame's own sub-step drift.
 */
const STRAIGHT_MAX_DEG = 1;

/**
 * Frames of the return flight recorded after the contact.
 *
 * `drivePaddleHit` stops on the frame the ball comes off the paddle, because that
 * is the instant the reading has to be taken at — a frame later and spin has
 * already begun to curve the flight this check is about. That makes it a bad
 * place to stop RECORDING: the clip would end on the contact and a reviewer would
 * never see the shot it produced.
 *
 * So the reading stays exactly where it was and the flight is driven after it,
 * inside the same recorded section. Three quarters of a second is long enough for
 * a curve to be a curve and a straight return to be visibly straight, and short
 * enough that the ball is still on the field at the end of it.
 */
const RETURN_TICKS = 90; // 0.75 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("returns the ball level from the centre of a still paddle", async () => {
  await startPlaying(harness);
  arrangePaddleHit(harness, "left", {
    cy: FIELD_CY,
    vy: 0,
    ballY: FIELD_CY,
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
