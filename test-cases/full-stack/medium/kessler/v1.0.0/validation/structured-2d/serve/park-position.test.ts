// serve/park-position — a parked ball sits on the deflector.
//
// specs/deflector-and-ball.md: "A parked ball sits at radius `194` at the
// deflector's center angle", and specs/instrumentation.md has the snapshot
// report it "with parked true". The deflector is posed away from its start
// angle first, so the reading is "at the deflector's center angle" rather
// than "at 90".
//
// THE WORLD IS THE DEFLECTOR AND ITS PARKED BALL, per isolate() and one
// parkBall.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertLength, assertTrue } from "../assert";
import { captureStill, isolate, openHarness, type Harness } from "../harness";
import { offsetDeg, readBall } from "./reading";

/** Where the deflector is posed — nowhere special, and not the start angle. */
const ANGLE = 137;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("parks the ball at radius 194 at the deflector's center angle", async () => {
  isolate(h);
  h.debug.setPaddleAngle(ANGLE);
  h.debug.parkBall();

  const after = await h.tick(1);
  captureStill(h, "parked");

  assertLength(after.balls, 1, "exactly one ball, the parked one");
  const ball = after.balls[0];
  assertTrue(ball.parked, "the ball is reported with parked true");
  const read = readBall(ball);
  assertCloseTo(read.r, 194, 2, "the parked ball's center radius");
  assertCloseTo(
    offsetDeg(ANGLE, read.thetaDeg),
    0,
    1,
    "the parked ball sits at the deflector's center angle",
  );
});
