// Carom — ball/corner-tie: a tied corner resolves off the left face.
//
// specs/balls.md, step 2 of the rectangle rule: the struck face is the one with
// the smallest penetration depth, and "on a tie the first of left, right, top,
// bottom wins". A ball arriving exactly on a rectangle's top-left corner has its
// left and top depths equal, so the LEFT face wins — and off the right paddle
// the left face is the front face, which is a paddle hit.
//
// THE TIE IS EXACT BY CONSTRUCTION. The ball is posed with `x - (x0 - BALL_R)`
// equal to `y - (y0 - BALL_R)` and given equal `vx` and `vy`, so the two depths
// are the same expression on every frame and stay equal however the build divides
// its time step. Spin is zero, so nothing rotates the velocity away from the
// diagonal, and the approach speed keeps the frame to one sub-step.
//
// WHICH RESOLUTION RAN IS THE READING, rather than which face the build says it
// chose. The two outcomes are different in kind: the left face is a paddle hit,
// which places the ball at `P2_X0 - BALL_R`, multiplies its speed by SPEED_MULT
// and sends it back across the field; the top face is an end cap, which reverses
// `vy` and leaves speed alone. Reading the placement, the speed and the returning
// `vx` therefore says which of the two the build ran, without asking it.
//
// IT IS POSED AGAINST A PADDLE rather than an obstacle because a paddle is the
// axis-aligned rectangle in EVERY variant, gyre's turning obstacles included, so
// one scenario means the same thing in all three.
//
// The field holds this one ball and no obstacles; the far paddle is held out of
// the way, and the struck one is taken from the player and held still, so the
// corner the ball meets stands exactly where this check put it.

import { afterEach, beforeEach, it } from "vitest";
import { BALL_R, FIELD_CY, P2_X0, PADDLE_HALF, SPEED_MULT } from "../constants";
import {
  assertCloseTo,
  assertEqual,
  assertLessThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  aimBall,
  ball0,
  captureReplay,
  createHarness,
  enterPlaying,
  parkPaddle,
  placeBall,
  poseWorld,
  spinBall,
  type Harness,
} from "../harness";

/** The corner of the right paddle's expanded rectangle, at the field centre. */
const CORNER_X = P2_X0 - BALL_R;
const CORNER_Y = FIELD_CY - PADDLE_HALF - BALL_R;

/** How far outside the corner the ball starts, on each axis. */
const RUN_UP = 5;

/**
 * The approach on each axis, in units per second.
 *
 * Equal on both, so the two depths stay equal, and slow enough that
 * `speed * dt` stays inside MAX_SUBSTEP and the frame takes one sub-step.
 */
const APPROACH = 240;

/** The review item's margin on the resolved speed, as a fraction. */
const SPEED_TOLERANCE = 0.01;

/** Frames of the return flight recorded after the contact. */
const RETURN_TICKS = 60; // 0.5 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("resolves a tied corner off the left face, as a paddle hit", async () => {
  enterPlaying(h, "versus");
  poseWorld(h);
  parkPaddle(h, "right", FIELD_CY);
  parkPaddle(h, "left");
  placeBall(h, CORNER_X - RUN_UP, CORNER_Y - RUN_UP);
  aimBall(h, APPROACH, APPROACH);
  spinBall(h, 0);
  const before = ball0(h.snapshot());

  const corner = await captureReplay(h, "corner", async () => {
    // Either resolution changes the velocity, so the sweep stops on the frame
    // the contact was resolved whichever face the build chose.
    const struck = await h.until(
      (s) => ball0(s).vx < APPROACH - 1 || ball0(s).vy < APPROACH - 1,
      { maxFrames: 60, poll: 1 },
    );
    await h.advance(RETURN_TICKS);
    return struck;
  });

  assertEqual(corner.hit, true);
  const ball = ball0(corner.snapshot);
  // Placed off the LEFT face, and returned across the field: an end cap would
  // have left it where it was in x, still travelling right.
  assertCloseTo(ball.x, CORNER_X, 0);
  assertLessThan(ball.vx, 0);
  // And resolved as a paddle hit: an end cap leaves speed unchanged.
  assertLessThanOrEqual(
    Math.abs(ball.speed - before.speed * SPEED_MULT),
    SPEED_TOLERANCE * before.speed * SPEED_MULT,
  );
});
