// spin/moving-solo-player — the human paddle, swung as it strikes, imparts spin.
//
// The left paddle is posed moving DOWNWARD as the ball arrives; the real bounce
// imparts spin from the paddle's own motion, and a downward swing curves the ball
// one way (positive spin). The upward direction is the Versus player-one sibling,
// so the suite as a whole shows both.
//
// The contact sits below mid-field so the swing has room to travel: over the
// run-up a full-speed paddle covers 360 px, and it starts that far upstream to
// arrive as the ball does. Aimed at mid-field that start would fall above the
// field edge and the clamp would pin it still, imparting no spin at all.

import { afterEach, beforeEach, expect, it } from "vitest";
import { PADDLE_SPEED, SPIN_FROM_PADDLE } from "../../src/constants";
import {
  LEAD_TICKS,
  arrangePaddleHit,
  createHarness,
  drivePaddleHit,
  startPlaying,
  type Harness,
} from "../harness";

const CONTACT_CY = 480;
const CONTACT_BALL_Y = 500;
const SPIN_FLOOR = PADDLE_SPEED * SPIN_FROM_PADDLE * 0.65;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

it("curves the ball off a downward swing of the human paddle", async () => {
  await startPlaying(harness, "solo");
  arrangePaddleHit(harness, "left", {
    cy: CONTACT_CY,
    vy: PADDLE_SPEED,
    ballY: CONTACT_BALL_Y,
    leadTicks: LEAD_TICKS,
  });

  const contact = await drivePaddleHit(harness, "left", {
    leadTicks: LEAD_TICKS,
  });

  expect(contact.hit).toBe(true);
  expect(contact.ball.spin).toBeGreaterThan(SPIN_FLOOR);
});
