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
  captureReplay,
  createHarness,
  drivePaddleHit,
  startPlaying,
  type Harness,
} from "../harness";

const EDGE_ANGLE_DEG = (MAX_BOUNCE_ANGLE * 180) / Math.PI;
/** The old browser suite's margin, in degrees. */
const ANGLE_TOLERANCE_DEG = 8;

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

  const contact = await captureReplay(harness, "deflection", async () => {
    const rebound = await drivePaddleHit(harness, "left", {
      leadTicks: LEAD_TICKS,
    });
    await harness.advance(RETURN_TICKS);
    return rebound;
  });

  expect(contact.hit).toBe(true);
  expect(contact.ball.vx).toBeGreaterThan(0);
  expect(Math.abs(angleDeg(contact.ball) - EDGE_ANGLE_DEG)).toBeLessThanOrEqual(
    ANGLE_TOLERANCE_DEG,
  );
});
