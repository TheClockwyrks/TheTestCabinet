// Carom — spin/clamped: a hard strike on an already-spinning ball holds at SPIN_CLAMP.
//
// specs/balls.md, step 3 of the paddle bounce: `spin = clamp(spin + paddleVy *
// SPIN_FROM_PADDLE, -SPIN_CLAMP, SPIN_CLAMP)`. NOTHING ELSE CAN REACH THE BOUND.
// A paddle travels at PADDLE_SPEED at most, so one strike off a spinless ball
// adds at most `PADDLE_SPEED * SPIN_FROM_PADDLE` (612), well short of SPIN_CLAMP
// (900), and the four `moving-*` points therefore only ever read the unclamped
// sum. The bound is reached by striking a ball that is ALREADY spinning, which is
// how a rally reaches it too.
//
// BOTH SIGNS, ONE VALIDATOR. The clamp is symmetric and the two ends are the same
// edge case exercised the same way, so a downward swing on a positively spinning
// ball and an upward swing on a negatively spinning one share this check.
//
// The ball is posed carrying most of the bound and struck by a paddle swung the
// same way, so the unclamped sum overshoots by several hundred. There is no
// run-up: the ball is posed just off the face and the paddle is already moving at
// PADDLE_SPEED, so the few frames before contact leave the decay almost nothing
// to take and the spin turns the flight by about a degree. The spin is read on
// the frame the ball comes off the face, which is the frame the bounce set it,
// and step 3 is the last thing the sub-step does to it.
//
// The field is emptied to this ball alone, and both paddles are taken from the
// player: the paddles are the instrument of the contact being measured, so a
// paddle the AI or a stray key could still move would make the reading theirs.

import { afterEach, beforeEach, it } from "vitest";
import {
  FIELD_CY,
  PADDLE_SPEED,
  SPIN_CLAMP,
  SPIN_FROM_PADDLE,
} from "../constants";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  arrangePaddleHit,
  ballOps,
  captureReplay,
  createHarness,
  drivePaddleHit,
  type Harness,
} from "../harness";

/**
 * The spin the ball already carries, in units per second squared.
 *
 * Inside the bound, and far enough up it that a full-speed swing the same way
 * overshoots by several hundred: 850 + 612 is 1462 against a clamp of 900.
 */
const START_SPIN = 850;

/** The review item's margin on the clamped spin, in units per second squared. */
const SPIN_TOLERANCE = 1;

/** Frames of the return flight recorded after the contact. */
const RETURN_TICKS = 60; // 0.5 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the spin at SPIN_CLAMP on a strike that would overshoot it", async () => {
  // The scenario is only meaningful if the unclamped sum really overshoots.
  assertGreaterThan(START_SPIN + PADDLE_SPEED * SPIN_FROM_PADDLE, SPIN_CLAMP);

  // Downward swing on a ball already spinning positively: the sum overshoots
  // +SPIN_CLAMP.
  await arrangePaddleHit(h, "left", {
    cy: FIELD_CY,
    vy: PADDLE_SPEED,
    ballY: FIELD_CY,
  });
  ballOps(h).setBallSpin(START_SPIN);

  const up = await captureReplay(h, "clamp", async () => {
    const rebound = await drivePaddleHit(h, "left");
    await h.advance(RETURN_TICKS);
    return rebound;
  });

  assertEqual(up.hit, true);
  assertCloseTo(up.paddle.vy, PADDLE_SPEED, 6);
  assertLessThanOrEqual(
    Math.abs(up.ball.spin - SPIN_CLAMP),
    SPIN_TOLERANCE,
    "the spin holds at +SPIN_CLAMP",
  );

  // And the mirror: an upward swing on a ball already spinning negatively
  // overshoots -SPIN_CLAMP.
  await arrangePaddleHit(h, "left", {
    cy: FIELD_CY,
    vy: -PADDLE_SPEED,
    ballY: FIELD_CY,
  });
  ballOps(h).setBallSpin(-START_SPIN);

  const down = await drivePaddleHit(h, "left");
  assertEqual(down.hit, true);
  assertCloseTo(down.paddle.vy, -PADDLE_SPEED, 6);
  assertLessThanOrEqual(
    Math.abs(down.ball.spin + SPIN_CLAMP),
    SPIN_TOLERANCE,
    "the spin holds at -SPIN_CLAMP",
  );
});
