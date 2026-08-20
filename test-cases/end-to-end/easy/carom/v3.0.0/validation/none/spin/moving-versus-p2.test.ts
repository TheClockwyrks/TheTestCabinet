// spin/moving-versus-p2 — player two's paddle, swung as it strikes, imparts spin.
//
// The right paddle is posed moving DOWNWARD as a ball arrives from the left; the
// real bounce imparts spin from that motion, curving the ball's flight. The
// contact sits below mid-field for the same reason as its player-one sibling: the
// swing needs room upstream to be travelling when it strikes.

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

it("curves the ball off a downward swing of player two's paddle", async () => {
  await startPlaying(harness, "versus");
  arrangePaddleHit(harness, "right", {
    cy: CONTACT_CY,
    vy: PADDLE_SPEED,
    ballY: CONTACT_BALL_Y,
    leadTicks: LEAD_TICKS,
  });

  const contact = await drivePaddleHit(harness, "right", {
    leadTicks: LEAD_TICKS,
  });

  expect(contact.hit).toBe(true);
  expect(contact.ball.spin).toBeGreaterThan(SPIN_FLOOR);
});
