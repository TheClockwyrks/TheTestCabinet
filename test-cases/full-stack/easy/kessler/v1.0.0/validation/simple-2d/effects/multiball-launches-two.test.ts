// effects/multiball-launches-two — a multiball catch launches up to two balls
// from radius 194 at the deflector's center angle, each at the current wave's
// ball speed.
//
// specs/pods.md: "The catch launches up to two balls from radius `194` at the
// deflector's center angle, at the current wave's ball speed." The count and
// the parked flag are exact; the position is read to within one tick of
// flight (whether a ball launched during the tick advances that same tick is
// a design choice the specs leave to the build, so the radius may sit
// anywhere from 194 to 194 plus one tick of travel, and the angle may drift
// by the tangential share of that same tick, under a degree at this radius);
// the speed is the wave-1 figure 240 of specs/deflector-and-ball.md, read to
// float precision.
//
// THE WORLD IS ONE POD AND THE DEFLECTOR. The field holds no other ball, so
// what the catch launches is everything the snapshot lists.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertCloseTo,
  assertEqual,
  assertLength,
  assertLessThanOrEqual,
} from "../assert";
import {
  close,
  dropPod,
  DT,
  LAUNCH_RADIUS,
  offset,
  open,
  polar,
  record,
  speedAtWave,
  START_ANGLE,
  velocityAt,
  world,
  type Harness,
} from "./pose";

let h: Harness;

beforeEach(async () => {
  h = await open();
});

afterEach(async () => {
  await close(h);
});

it("launches two unparked balls from radius 194 at the wave speed", async () => {
  const posed = await world(h);
  assertLength(posed.balls, 0, "the emptied field before the catch");

  const after = await record(h, "multiball-pair", () =>
    dropPod(h, "multiball"),
  );

  assertLength(after.pods, 0, "the pod after the catch tick");
  assertLength(after.balls, 2, "the launched pair");

  const speed = speedAtWave(after.wave);
  for (const ball of after.balls) {
    assertEqual(ball.parked, false, "a launched ball is not parked");
    const p = polar(ball);
    assertBetween(
      p.r,
      LAUNCH_RADIUS - 0.01,
      LAUNCH_RADIUS + speed * DT + 0.01,
      "launched from radius 194, within one tick of flight",
    );
    assertLessThanOrEqual(
      Math.abs(offset(START_ANGLE, p.theta)),
      1,
      "launched at the deflector's center angle, within one tick of tangential drift",
    );
    assertCloseTo(
      velocityAt(ball, p.theta).speed,
      speed,
      3,
      "the current wave's ball speed",
    );
  }
});
