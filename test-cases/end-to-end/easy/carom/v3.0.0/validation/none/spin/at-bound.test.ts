// spin/at-bound — a paddle pinned against a bound imparts no spin.
//
// A paddle held into the top or bottom edge cannot move, so it is stationary and
// adds no spin even while the movement input is still applied: the spin mechanic
// reads the paddle's ACTUAL velocity, which the clamp has taken to zero. A build
// that drives spin off the held input rather than the real motion fails here.
//
// DISCRIMINATING. The same held velocity clear of the bound, where the paddle
// really does move, must impart spin — so passing proves the build reads real
// motion, not merely that it never adds spin at all.

import { afterEach, beforeEach, expect, it } from "vitest";
import {
  PADDLE_MAX_CY,
  PADDLE_SPEED,
  SPIN_FROM_PADDLE,
} from "../../src/constants";
import {
  LEAD_TICKS,
  arrangePaddleHit,
  createHarness,
  drivePaddleHit,
  nearBallX,
  seconds,
  startPlaying,
  type Harness,
} from "../harness";

/** The approach `arrangePaddleHit` poses by default, in px/s. */
const APPROACH_SPEED = 400;
/**
 * The pinned contact's ball start.
 *
 * The paddle here must stay PINNED, so it cannot be led upstream the way a
 * swinging one is — leading it would unpin it and hand it back the very velocity
 * this check exists to deny. Only the ball is pushed back instead: its zero-lead
 * start plus the distance it covers over the run-up.
 */
const BOUND_START_X = nearBallX("left") + APPROACH_SPEED * seconds(LEAD_TICKS);
/**
 * The floor a real swing must clear. A full-speed swing imparts
 * `PADDLE_SPEED * SPIN_FROM_PADDLE`; two thirds of that is comfortably clear of
 * zero and comfortably below what the mechanic actually produces.
 */
const SPIN_FLOOR = PADDLE_SPEED * SPIN_FROM_PADDLE * 0.65;
/** A paddle the clamp has stopped reports zero velocity, to a float margin. */
const STILL_TOLERANCE = 1;
const SPIN_TOLERANCE = 0.5;

/** A contact clear of the bound, where a full-speed swing has room to travel. */
const FREE_CONTACT_CY = 480;
const FREE_CONTACT_BALL_Y = 500;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

it("imparts no spin from a bound-pinned paddle, but does from a free one", async () => {
  // The pinned contact: the paddle sits on the bottom clamp with the movement
  // still driving it further down, so it cannot move at all.
  await startPlaying(harness);
  arrangePaddleHit(harness, "left", {
    cy: PADDLE_MAX_CY,
    vy: PADDLE_SPEED,
    ballY: PADDLE_MAX_CY,
    startX: BOUND_START_X,
  });

  const bound = await drivePaddleHit(harness, "left", {
    leadTicks: LEAD_TICKS,
  });

  expect(bound.hit).toBe(true);
  expect(Math.abs(bound.paddle.vy)).toBeLessThanOrEqual(STILL_TOLERANCE);
  expect(Math.abs(bound.ball.spin)).toBeLessThanOrEqual(SPIN_TOLERANCE);

  // The control: the same held velocity, clear of the bound. The contact sits
  // below mid-field so the run-up starts inside the top clamp — aimed at the
  // centre the swing would have to begin above the field edge, where the clamp
  // would pin it still, which is the very condition this half is the control FOR.
  await startPlaying(harness);
  arrangePaddleHit(harness, "left", {
    cy: FREE_CONTACT_CY,
    vy: PADDLE_SPEED,
    ballY: FREE_CONTACT_BALL_Y,
    leadTicks: LEAD_TICKS,
  });

  const free = await drivePaddleHit(harness, "left", { leadTicks: LEAD_TICKS });

  expect(free.hit).toBe(true);
  expect(free.ball.spin).toBeGreaterThan(SPIN_FLOOR);
});
