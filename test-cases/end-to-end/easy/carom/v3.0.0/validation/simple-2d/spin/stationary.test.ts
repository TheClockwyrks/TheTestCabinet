// spin/stationary — a paddle that is not moving imparts no new spin.
//
// Spin comes from the paddle's vertical velocity at contact, so a still paddle
// adds none and the return flies straight. The paddle pose is the precondition;
// the bounce, and the spin it does or does not add, are the build's own physics.

import { afterEach, beforeEach, expect, it } from "vitest";
import { FIELD_CY } from "../../src/constants";
import {
  LEAD_TICKS,
  arrangePaddleHit,
  captureReplay,
  createHarness,
  drivePaddleHit,
  startPlaying,
  type Harness,
} from "../harness";

/**
 * A float margin. `spin = clamp(spin + paddleVy * SPIN_FROM_PADDLE, ...)` with
 * both terms zero is exactly zero (specs/balls.md).
 */
const SPIN_TOLERANCE = 1e-6;

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

it("imparts no spin from a still paddle", async () => {
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
  expect(Math.abs(contact.ball.spin)).toBeLessThanOrEqual(SPIN_TOLERANCE);
});
