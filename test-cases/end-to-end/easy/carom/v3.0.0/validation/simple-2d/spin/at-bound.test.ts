// spin/at-bound — a paddle pinned against a bound imparts no spin.
//
// A paddle held into the top or bottom edge cannot move, so it is stationary and
// adds no spin even while the movement input is still applied: the spin mechanic
// reads the paddle's integrated `vy`, which the clamp has taken to zero
// (specs/playfield.md, specs/balls.md). A build that drives spin off the held
// input rather than the real motion fails here.
//
// DISCRIMINATING. The same held velocity clear of the bound, where the paddle
// really does move, must impart spin — so passing proves the build reads real
// motion, not merely that it never adds spin at all.

import { afterEach, beforeEach, it } from "vitest";
import { PADDLE_MAX_CY, PADDLE_SPEED } from "../../src/constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  arrangePaddleHit,
  captureReplay,
  createHarness,
  drivePaddleHit,
  LEAD_TICKS,
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
 * The control must impart spin: the item says only that it does, and how much a
 * full swing imparts is `moving-solo-player`'s point, so the floor is a float
 * margin above zero.
 */
const SPIN_FLOOR = 1e-6;
/** A paddle the clamp has stopped reports exactly zero velocity, to a float margin. */
const STILL_TOLERANCE = 1e-6;
const SPIN_TOLERANCE = 1e-6;

/** A contact clear of the bound, where a full-speed swing has room to travel. */
const FREE_CONTACT_CY = 480;
const FREE_CONTACT_BALL_Y = 500;

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

  const bound = await captureReplay(harness, "at-bound", async () => {
    const rebound = await drivePaddleHit(harness, "left", {
      leadTicks: LEAD_TICKS,
    });
    await harness.advance(RETURN_TICKS);
    return rebound;
  });

  assertEqual(bound.hit, true);
  assertLessThanOrEqual(Math.abs(bound.paddle.vy), STILL_TOLERANCE);
  assertLessThanOrEqual(Math.abs(bound.ball.spin), SPIN_TOLERANCE);

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

  assertEqual(free.hit, true);
  assertGreaterThan(free.ball.spin, SPIN_FLOOR);
});
