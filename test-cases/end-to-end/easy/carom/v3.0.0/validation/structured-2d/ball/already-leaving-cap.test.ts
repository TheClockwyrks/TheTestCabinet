// Carom — ball/already-leaving-cap: a paddle end cap the ball is already leaving
// does not reverse it.
//
// Step 4 of specs/balls.md's rectangle rule reverses the component normal to the
// struck face "if it points into the face; otherwise leave the velocity as it
// is". The face this is read on is a paddle's TOP end cap, because that is where
// the specification leaves the guard reachable: "A contact whose struck face is
// the paddle's top or bottom face (an end cap) is resolved like a wall ... `vy`
// is reversed if it points into the face, speed and spin are unchanged." A
// contact on the paddle's front face is a paddle HIT, and the paddle bounce
// recomputes the velocity outright, so the front face decides nothing here.
//
// THE POSE PUTS THE TOP FACE FIRST. The ball is placed on the paddle's own
// centre line, `CAP_OVERLAP` units inside the expanded rectangle's top edge. The
// four depths are then 12 at the top against 19 at either side and 120 at the
// bottom, so the top is the shallowest and stays the shallowest after a frame of
// travel; the ball is still strictly inside the expanded rectangle when the
// resolution runs.
//
// TWO READINGS. `vy` is read back UNCHANGED, which is the guard: it points up
// and out of the top face, so nothing may happen to it. And the ball is read
// back placed clear of that face, which is step 3 and is what says the contact
// was resolved at all rather than missed — a build that never sees the overlap
// leaves the ball short of the face, still inside the rectangle.
//
// The wall form of the same guard is `ball/already-leaving-wall`'s point.
//
// The scenario runs over a field emptied to the one ball, with the obstacles off
// it and the far paddle held out of the way. `arrangeLiveBall` has already held
// both paddles off the lane, so the struck one is brought back onto it and held
// there, and what the ball meets is a rectangle standing exactly where this
// check put it.

import { afterEach, beforeEach, it } from "vitest";
import { BALL_R, FIELD_CY, P1_X0, P1_X1, PADDLE_HALF } from "../constants";
import { assertCloseTo, assertEqual, assertLessThanOrEqual } from "../assert";
import {
  arrangeLiveBall,
  ball0,
  ballOps,
  captureReplay,
  createHarness,
  drivePaddle,
  type Harness,
} from "../harness";

/** The speed the ball is posed at, in units per second. */
const SPEED = 300;

/** The left paddle's own centre line, where the side depths are deepest. */
const PADDLE_CX = (P1_X0 + P1_X1) / 2; // 56

/** The top face of the left paddle, held at the field centre. */
const CAP_TOP = FIELD_CY - PADDLE_HALF; // 305

/** Where a ball resolved off that face is placed, in units. */
const CLEAR_OF_CAP = CAP_TOP - BALL_R; // 294

/**
 * How far inside the expanded rectangle's top edge the ball is posed, in units.
 *
 * Twelve leaves the top depth (12) well under the two side depths (19) both at
 * the pose and after a frame of travel at `SPEED`, so the struck face is the
 * top on the frame the resolution runs.
 */
const CAP_OVERLAP = 12;

/** Frames recorded after the reading, so the clip shows the ball leaving. */
const AWAY_TICKS = 90; // 0.75 s

/** Room for a build that carries its placement in floating point, in units. */
const PLACE_EPSILON = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps a vy that already points out of the end cap it overlaps", async () => {
  await arrangeLiveBall(h, {
    x: PADDLE_CX,
    y: CLEAR_OF_CAP + CAP_OVERLAP,
    vx: 0,
    vy: -SPEED,
  });
  drivePaddle(h, "left", { cy: FIELD_CY, vy: 0 });
  const ball = ballOps(h);
  ball.setBallPosition(PADDLE_CX, CLEAR_OF_CAP + CAP_OVERLAP);
  ball.setBallVelocity(0, -SPEED);
  ball.setBallSpin(0);

  const leaving = await captureReplay(h, "leaving", async () => {
    await h.advance(1);
    const measured = ball0(h.snapshot());
    await h.advance(AWAY_TICKS);
    return measured;
  });

  assertEqual(leaving.held, false);
  assertLessThanOrEqual(leaving.y, CLEAR_OF_CAP + PLACE_EPSILON);
  assertCloseTo(leaving.vy, -SPEED, 6);
});
