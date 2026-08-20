// spin/moving-versus-p1 — player one's paddle, swung upward, imparts spin the
// other way.
//
// The left paddle is posed moving UPWARD as the ball arrives. An upward swing
// curves the ball the opposite way from a downward one (negative spin), so this
// and its downward siblings together show up and down curving opposite ways.
//
// The contact sits above mid-field so the swing has room: over the run-up a
// full-speed paddle covers 360 px, and it starts that far DOWNstream to arrive as
// the ball does. Aimed at mid-field that start would fall below the field edge,
// where the clamp would pin it still.

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

const CONTACT_CY = 240;
const CONTACT_BALL_Y = 220;
const SPIN_FLOOR = PADDLE_SPEED * SPIN_FROM_PADDLE * 0.65;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

it("curves the ball the other way off an upward swing", async () => {
  await startPlaying(harness, "versus");
  arrangePaddleHit(harness, "left", {
    cy: CONTACT_CY,
    vy: -PADDLE_SPEED,
    ballY: CONTACT_BALL_Y,
    leadTicks: LEAD_TICKS,
  });

  const contact = await drivePaddleHit(harness, "left", {
    leadTicks: LEAD_TICKS,
  });

  expect(contact.hit).toBe(true);
  expect(contact.ball.spin).toBeLessThan(-SPIN_FLOOR);
});
