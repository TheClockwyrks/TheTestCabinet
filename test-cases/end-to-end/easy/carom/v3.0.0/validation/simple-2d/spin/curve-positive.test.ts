// spin/curve-positive — positive spin turns the flight clockwise.
//
// Each sub-step rotates the velocity by `(spin / speed) * h` radians, "a
// positive angle turning the direction of travel from +x toward +y, clockwise on
// screen", with speed unchanged (specs/balls.md). So a ball posed level and
// rightward with positive spin is, a short flight later, heading clockwise: `vy > 0`,
// at the speed it was posed at.
//
// The flight is short and the field holds that ball alone: both obstacles are
// removed and both paddles driven out of the lane, so nothing but the spin acts
// on the velocity over the frames the heading is read across.

import { afterEach, beforeEach, it } from "vitest";
import { SPIN_HALFLIFE } from "../constants";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import {
  angleDeg,
  arrangeLiveBall,
  ball0,
  captureReplay,
  createHarness,
  seconds,
  spinBall,
  type Harness,
} from "../harness";

const SPEED = 400;
const POSED_SPIN = 600;
/**
 * A short flight: long enough for the turn to read, short enough that the ball
 * stays well inside the field from where it is posed.
 */
const FLIGHT_TICKS = 12; // 0.1 s
/** Frames recorded after the reading, so the clip shows the arc. */
const ARC_TICKS = 48; // 0.4 s
/** The review item's margin on the speed: one percent. */
const SPEED_TOLERANCE = SPEED * 0.01;
/**
 * The heading the spin rule integrates to over the flight, in degrees: the
 * velocity turns at `spin / speed` radians per second while the spin decays as
 * `0.5 ^ (t / SPIN_HALFLIFE)`, so the turn over `t` seconds is
 * `(|spin| / speed) * (SPIN_HALFLIFE / ln 2) * (1 - 0.5 ^ (t / SPIN_HALFLIFE))`.
 */
const EXPECTED_TURN_DEG =
  ((Math.abs(POSED_SPIN) / SPEED) *
    (SPIN_HALFLIFE / Math.LN2) *
    (1 - Math.pow(0.5, seconds(FLIGHT_TICKS) / SPIN_HALFLIFE)) *
    180) /
  Math.PI;
/** The review item's margin on the heading: two degrees. */
const ANGLE_TOLERANCE_DEG = 2;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("turns a level rightward flight clockwise under positive spin", async () => {
  arrangeLiveBall(harness, { x: 300, y: 360, vx: SPEED, vy: 0 });
  spinBall(harness, POSED_SPIN);

  const ball = await captureReplay(harness, "curve", async () => {
    await harness.advance(FLIGHT_TICKS);
    const read = ball0(harness.snapshot());
    await harness.advance(ARC_TICKS);
    return read;
  });

  assertGreaterThan(ball.vx, 0);
  assertGreaterThan(ball.vy, 0);
  assertLessThanOrEqual(Math.abs(ball.speed - SPEED), SPEED_TOLERANCE);
  assertLessThanOrEqual(
    Math.abs(angleDeg(ball) - EXPECTED_TURN_DEG),
    ANGLE_TOLERANCE_DEG,
  );
});
