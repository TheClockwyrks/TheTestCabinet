// spin/at-bound — a paddle pinned against a bound imparts no spin.
//
// specs/playfield.md: a paddle pinned against a bound carries `vy = 0` while
// the movement is held into it, because the clamp rewrites `vy` to the
// distance actually covered. specs/balls.md reads that integrated `vy` at
// contact, so the ball leaves with spin exactly 0. A build that reads the held
// input rather than the real motion fails here.
//
// DISCRIMINATING. The same held velocity clear of the bound, where the paddle
// really does move, imparts `PADDLE_SPEED * SPIN_FROM_PADDLE` (612) within five
// percent, so passing proves the build reads real motion rather than never
// adding spin at all.

import { afterEach, beforeEach, expect, it } from "vitest";
import { PADDLE_MAX_CY, PADDLE_SPEED, SPIN_FROM_PADDLE } from "../constants";
import {
  FACE_SHOT_SPEED,
  LEAD_TICKS,
  arrangePaddleHit,
  captureReplay,
  createHarness,
  drivePaddleHit,
  nearBallX,
  seconds,
  startPlaying,
  type Harness,
} from "../harness";

/**
 * The pinned contact's ball start.
 *
 * The paddle here must stay PINNED, so it cannot be led upstream the way a
 * swinging one is: leading it would unpin it and hand it back the very velocity
 * this check exists to deny. Only the ball is pushed back instead: its zero-lead
 * start plus the distance it covers over the run-up.
 */
const BOUND_START_X = nearBallX("left") + FACE_SHOT_SPEED * seconds(LEAD_TICKS);

const EXPECTED_SPIN = PADDLE_SPEED * SPIN_FROM_PADDLE;
const SPIN_TOLERANCE = EXPECTED_SPIN * 0.05;

/** A contact clear of the bound, where a full-speed swing has room to travel. */
const FREE_CONTACT_CY = 480;
const FREE_CONTACT_BALL_Y = 500;

/** Frames of the return flight recorded after the contact, for the replay. */
const RETURN_TICKS = 90; // 0.75 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("imparts no spin from a bound-pinned paddle, but does from a free one", async () => {
  // The pinned contact: the paddle sits on the bottom clamp with the movement
  // still driving it further down, so it cannot move at all.
  await startPlaying(harness);
  await arrangePaddleHit(harness, "left", {
    cy: PADDLE_MAX_CY,
    vy: PADDLE_SPEED,
    ballY: PADDLE_MAX_CY,
    approachSpeed: FACE_SHOT_SPEED,
    startX: BOUND_START_X,
  });

  const bound = await captureReplay(harness, "at-bound", async () => {
    const rebound = await drivePaddleHit(harness, "left", {
      leadTicks: LEAD_TICKS,
    });
    await harness.advance(RETURN_TICKS);
    return rebound;
  });

  expect(bound.hit).toBe(true);
  expect(bound.paddle.cy).toBeCloseTo(PADDLE_MAX_CY, 6);
  expect(bound.paddle.vy).toBeCloseTo(0, 6);
  expect(bound.ball.spin).toBeCloseTo(0, 6);

  // The control: the same held velocity, clear of the bound. The contact sits
  // below mid-field so the run-up starts inside the top clamp.
  await startPlaying(harness);
  await arrangePaddleHit(harness, "left", {
    cy: FREE_CONTACT_CY,
    vy: PADDLE_SPEED,
    ballY: FREE_CONTACT_BALL_Y,
    approachSpeed: FACE_SHOT_SPEED,
    leadTicks: LEAD_TICKS,
  });

  const free = await drivePaddleHit(harness, "left", { leadTicks: LEAD_TICKS });

  expect(free.hit).toBe(true);
  expect(Math.abs(free.ball.spin - EXPECTED_SPIN)).toBeLessThanOrEqual(
    SPIN_TOLERANCE,
  );
});
