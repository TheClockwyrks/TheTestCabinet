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
import { PADDLE_SPEED, SPIN_FROM_PADDLE } from "../constants";
import {
  LEAD_TICKS,
  arrangePaddleHit,
  captureReplay,
  createHarness,
  drivePaddleHit,
  startPlaying,
  type Harness,
} from "../harness";

const CONTACT_CY = 240;
const CONTACT_BALL_Y = 220;
const SPIN_FLOOR = PADDLE_SPEED * SPIN_FROM_PADDLE * 0.65;

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

afterEach(async () => {
  await harness.dispose();
});

it("curves the ball the other way off an upward swing", async () => {
  await startPlaying(harness, "versus");
  await arrangePaddleHit(harness, "left", {
    cy: CONTACT_CY,
    vy: -PADDLE_SPEED,
    ballY: CONTACT_BALL_Y,
    leadTicks: LEAD_TICKS,
  });

  const contact = await captureReplay(harness, "curve", async () => {
    const rebound = await drivePaddleHit(harness, "left", {
      leadTicks: LEAD_TICKS,
    });
    await harness.advance(RETURN_TICKS);
    return rebound;
  });

  expect(contact.hit).toBe(true);
  expect(contact.ball.spin).toBeLessThan(-SPIN_FLOOR);
});
