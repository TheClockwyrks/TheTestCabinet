// serve/launch-radial — a launch sends the ball radially outward.
//
// specs/deflector-and-ball.md: "Pressing `Space` launches the parked ball
// radially outward at the current wave's ball speed", and
// specs/instrumentation.md gives the surface the same action: "launchBall():
// Exactly as `Space` on a parked ball." Radially outward means the velocity
// points along the outward radial at the ball's center, so across free flight
// the center angle holds while the radius grows. The speed figure is its own
// item (launch-at-wave-speed).
//
// THE WORLD IS THE DEFLECTOR AND ITS PARKED BALL, per isolate(); the deflector
// is posed off its start angle so the radial read is not the 90-degree one.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertGreaterThan, assertLength } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { offsetDeg, readBall, unparked } from "./reading";

/** Where the deflector — and so the serve — is posed. */
const ANGLE = 210;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("serves along the outward radial: angle holds, radius grows", async () => {
  await isolate(h);
  await h.debug.setPaddleAngle(ANGLE);
  await h.debug.parkBall();

  const { first, last } = await captureReplay(h, "launch", async () => {
    await h.debug.launchBall();
    return { first: await h.tick(1), last: await h.tick(9) };
  });

  const flying = unparked(first);
  assertLength(flying, 1, "the parked ball left the deflector as one ball");
  const early = readBall(flying[0]);
  assertCloseTo(
    early.offOutwardDeg,
    0,
    1,
    "the launched velocity points along the outward radial",
  );
  assertCloseTo(
    offsetDeg(ANGLE, early.thetaDeg),
    0,
    1,
    "the ball leaves at the deflector's center angle",
  );

  const late = readBall(unparked(last)[0]);
  assertGreaterThan(late.r, early.r, "the radius grows across the flight");
  assertCloseTo(
    offsetDeg(ANGLE, late.thetaDeg),
    0,
    1,
    "the center angle still holds after ten ticks of flight",
  );
});
