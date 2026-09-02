// paddles/hit-bottom-edge — the bottom edge of a still paddle deflects the ball
// downward, at the full angle.
//
// A contact one paddle half-height below centre is `offset = +1`, so the
// outgoing angle is +MAX_BOUNCE_ANGLE (specs/balls.md): 55 degrees
// below horizontal, which on screen is `vy > 0`. The paddle is stationary,
// so the angle is the contact point's doing alone rather than spin from a moving
// paddle. The contact is a paddle hit rather than an end-cap bounce because the
// ball arrives level at the face: its penetration through the front face is at
// most one sub-step, far less than the `BALL_R` it sits short of the cap.

import { afterEach, beforeEach, it } from "vitest";
import { FIELD_CY, MAX_BOUNCE_ANGLE, PADDLE_HALF } from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
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
/** The review item's margin, in degrees. */
const ANGLE_TOLERANCE_DEG = 2;

/**
 * Frames of the return flight recorded after the contact.
 *
 * `drivePaddleHit` stops on the frame the ball comes off the paddle, because
 * that is the instant the reading has to be taken at. The flight is driven after
 * it, inside the same recorded section, so the clip shows the deflection.
 */
const RETURN_TICKS = 90; // 0.75 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("deflects the ball downward off the bottom edge of a still paddle", async () => {
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

  assertEqual(contact.hit, true);
  assertGreaterThan(contact.ball.vx, 0);
  assertGreaterThan(contact.ball.vy, 0);
  assertLessThanOrEqual(
    Math.abs(angleDeg(contact.ball) - EDGE_ANGLE_DEG),
    ANGLE_TOLERANCE_DEG,
  );
});
