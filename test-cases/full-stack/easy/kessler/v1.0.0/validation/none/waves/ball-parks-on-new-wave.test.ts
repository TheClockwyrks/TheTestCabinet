// waves/ball-parks-on-new-wave — when the interstitial ends a ball parks on
// the deflector, following it until launched.
//
// specs/rings.md: "When it ends, ... a ball parks on the deflector."
// specs/deflector-and-ball.md: "A parked ball sits at radius `194` at the
// deflector's center angle and follows the deflector as it moves" and "A ball
// parks ... when a wave begins." The park is read at the tick the
// interstitial hands back — one parked ball at the serve radius on the
// deflector's angle — and the following is read after the deflector is posed
// to a new angle. Half-unit and half-degree tolerances, per the guard against
// exact float equality at posed contact boundaries.
//
// THE WORLD IS THE INTERSTITIAL AND THE DEFLECTOR: entering waveclear removed
// every ball, so the ball the reading finds can only be the new wave's park.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertLessThanOrEqual } from "../assert";
import {
  angularOffset,
  polarOf,
  SERVE_RADIUS,
  WAVECLEAR_TICKS,
} from "../constants";
import {
  captureReplay,
  openHarness,
  poseInterstitial,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("parks one ball on the deflector when the new wave begins", async () => {
  await h.reset();
  await h.debug.setScreen("playing");
  await poseInterstitial(h);
  const during = await h.snapshot();
  assertEqual(during.balls.length, 0, "the interstitial holds no ball");

  const { begun, moved } = await captureReplay(h, "re-parked", async () => {
    const handedBack = await h.tick(WAVECLEAR_TICKS);
    await h.debug.setPaddleAngle(210);
    const followed = await h.tick(1);
    return { begun: handedBack, moved: followed };
  });

  assertEqual(begun.screen, "playing", "the interstitial ran out");
  assertEqual(begun.balls.length, 1, "one ball on the new wave");
  assertEqual(begun.balls[0].parked, true, "the ball is parked");
  const at = polarOf(begun.balls[0].x, begun.balls[0].y);
  assertBetween(
    at.r,
    SERVE_RADIUS - 0.5,
    SERVE_RADIUS + 0.5,
    "the serve radius",
  );
  assertLessThanOrEqual(
    Math.abs(angularOffset(begun.paddle.angleDeg, at.theta)),
    0.5,
    "at the deflector's center angle",
  );

  // And it follows the deflector until launched.
  assertEqual(moved.balls[0].parked, true, "still parked, not launched");
  const followedTo = polarOf(moved.balls[0].x, moved.balls[0].y);
  assertLessThanOrEqual(
    Math.abs(angularOffset(210, followedTo.theta)),
    0.5,
    "the parked ball followed the deflector",
  );
});
