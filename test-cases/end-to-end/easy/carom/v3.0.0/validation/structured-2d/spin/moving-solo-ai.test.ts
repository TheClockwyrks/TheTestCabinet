// spin/moving-solo-ai — the AI's paddle, moving as it strikes, imparts spin too.
//
// The REAL AI is handed control of its paddle and a ball is aimed to arrive while
// it is still sweeping down the field to intercept, so it strikes while moving.
// Nothing poses the AI's velocity: its own chase is what curves the ball.
//
// The AI rule (specs/modes/single-player.md) moves the paddle at exactly
// AI_SPEED whenever it is more than AI_DEADZONE from its target: on this suite's
// clock `|diff| / dt` exceeds AI_SPEED for any `|diff|` past the deadzone, so
// there is no easing. The ball is aimed to arrive while the paddle is still well
// short of its target, so the contact is at AI_SPEED and the spin it imparts is
// `AI_SPEED * SPIN_FROM_PADDLE` (specs/balls.md), signed by the direction the
// paddle is sweeping, which the paddle's own reported `vy` gives.

import { afterEach, beforeEach, it } from "vitest";
import { AI_SPEED, SPIN_FROM_PADDLE } from "../../src/constants";
import { assertEqual, assertLessThanOrEqual, assertNotEqual } from "../assert";
import {
  arrangeAiMovingHit,
  captureReplay,
  createHarness,
  drivePaddleHit,
  type Harness,
} from "../harness";

/** The expected magnitude, and the review item's margin of ten percent. */
const EXPECTED_SPIN = AI_SPEED * SPIN_FROM_PADDLE;
const SPIN_TOLERANCE = EXPECTED_SPIN * 0.1;

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

it("imparts AI_SPEED * SPIN_FROM_PADDLE of spin, signed by its sweep", async () => {
  await arrangeAiMovingHit(harness);

  const contact = await captureReplay(harness, "curve", async () => {
    const rebound = await drivePaddleHit(harness, "right");
    await harness.advance(RETURN_TICKS);
    return rebound;
  });

  assertEqual(contact.hit, true);
  // The AI was sweeping as it struck, and the spin carries its direction.
  assertNotEqual(contact.paddle.vy, 0);
  assertEqual(Math.sign(contact.ball.spin), Math.sign(contact.paddle.vy));
  assertLessThanOrEqual(
    Math.abs(Math.abs(contact.ball.spin) - EXPECTED_SPIN),
    SPIN_TOLERANCE,
  );
});
