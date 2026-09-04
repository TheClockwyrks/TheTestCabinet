// paddle/bounce-crossing — the deflector bounces a ball crossing its face: in
// a tick where the ball's center radius moves from above 194 to 194 or below
// with inward radial velocity and its center angle within the span, the ball's
// velocity turns outward instead of carrying on toward the planet.
//
// specs/deflector-and-ball.md: "In a tick where a ball's center radius moves
// from above `194` to `194` or below, with inward radial velocity
// (`v . n < 0`), and the ball's center angle is within the deflector's span,
// the ball bounces off the deflector." What is decided here is THAT the
// crossing bounces — the posed ball arrives dead-center on the span, straight
// inward, and its radial velocity must read outward on the crossing tick. The
// bounce's four-step arithmetic, its cue, and its spark are other items.
//
// The pose crosses STRICTLY: at 4 units per tick from radius 205 the ball
// reads 197 before the crossing tick and 193 after it, so no reading lands on
// the boundary itself and no float ambiguity decides the point. THE WORLD IS
// ONE BALL AND THE DEFLECTOR: an isolated field, the deflector standing at its
// start angle, and nothing else for the ball to touch on its way in.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan, assertTrue } from "../assert";
import { ballSpeedAtWave, DEFLECTOR_START_ANGLE_DEG } from "../constants";
import {
  captureReplay,
  isolate,
  openHarness,
  spawnBallPolar,
  type Harness,
} from "../harness";
import { ballRadial } from "./readings";

/** Posed start radius: 205 - 4 * 3 = 193 crosses 194 on the third tick. */
const START_RADIUS = 205;

/** The tick the pose crosses on, at the wave-1 speed of 4 units per tick. */
const CROSSING_TICK = 3;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns an inward crossing within the span outward", async () => {
  isolate(h);
  spawnBallPolar(
    h,
    START_RADIUS,
    DEFLECTOR_START_ANGLE_DEG,
    -ballSpeedAtWave(1),
  );

  const posed = h.snapshot();
  assertEqual(posed.balls.length, 1, "the posed field's balls");
  assertLessThan(
    ballRadial(posed.balls[0]).vr,
    0,
    "the posed radial velocity, inward",
  );

  const swept = await captureReplay(h, "bounce", () =>
    h.until((s) => s.balls.length === 1 && ballRadial(s.balls[0]).vr > 0, {
      maxTicks: CROSSING_TICK + 2,
    }),
  );

  assertTrue(swept.hit, "an outward radial velocity after the inward crossing");
  assertEqual(
    swept.ticks,
    CROSSING_TICK,
    "the tick the bounce resolved on: the crossing tick",
  );
});
