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
  createHarness,
  drivePaddleHit,
  startPlaying,
  type Harness,
} from "../harness";

/** The old browser suite's margin: spin is either imparted or it is not. */
const SPIN_TOLERANCE = 0.5;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

it("imparts no spin from a still paddle", async () => {
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
  expect(Math.abs(contact.ball.spin)).toBeLessThanOrEqual(SPIN_TOLERANCE);
});
