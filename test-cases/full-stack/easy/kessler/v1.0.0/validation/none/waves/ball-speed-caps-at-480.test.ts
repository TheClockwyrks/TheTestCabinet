// waves/ball-speed-caps-at-480 — the wave ball speed 240 + 30 * (w - 1) is
// capped at 480 units per second, so at wave 9 and every wave beyond a launch
// serves at 480.
//
// specs/deflector-and-ball.md: "The ball speed of wave `w` is
// `240 + 30 * (w - 1)` units per second, capped at `480`." Wave 9 is the
// boundary the formula meets exactly (240 + 30 * 8 = 480); wave 12 (570
// uncapped) is a wave beyond it. Both exercise the same cap the same way:
// a launch that must serve at 480.
//
// THE WORLD IS ONE PARKED BALL PER ROUND. isolate() empties the field, the
// wave is posed, and the launch is the surface's own — "the parked ball
// launches radially outward at the current wave's ball speed".

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("serves at 480 at wave 9 and at wave 12", async () => {
  await isolate(h);
  await h.debug.setWave(9);
  await h.debug.parkBall();
  const atNine = await captureReplay(h, "capped-launch", async () => {
    await h.debug.launchBall();
    const serve = await h.snapshot();
    await h.tick(10);
    return serve;
  });
  assertEqual(atNine.balls.length, 1, "one ball in the wave-9 round");
  assertEqual(atNine.balls[0].parked, false, "the wave-9 launch");
  assertCloseTo(
    Math.hypot(atNine.balls[0].vx, atNine.balls[0].vy),
    480,
    3,
    "the wave-9 serve speed, where the formula meets the cap",
  );

  await h.debug.clearBalls();
  await h.debug.setWave(12);
  await h.debug.parkBall();
  await h.debug.launchBall();
  const atTwelve = await h.snapshot();
  assertEqual(atTwelve.balls.length, 1, "one ball in the wave-12 round");
  assertEqual(atTwelve.balls[0].parked, false, "the wave-12 launch");
  assertCloseTo(
    Math.hypot(atTwelve.balls[0].vx, atTwelve.balls[0].vy),
    480,
    3,
    "the wave-12 serve speed, capped",
  );
});
