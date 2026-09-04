// waves/new-wave-figures-apply — the new wave's ball speed and orbit speeds
// apply: at wave 2 a launch serves at 270 units per second, ring 2 orbits at
// 15 degrees per second, and ring 3 at 10 (toward -theta).
//
// specs/rings.md: "the new wave's ball speed and orbit speeds apply", with
// ring 2 at "+min(12 + 3 * (w - 1), 45)" and ring 3 at
// "-min(8 + 2 * (w - 1), 30)" degrees per second; specs/deflector-and-ball.md:
// "The ball speed of wave `w` is `240 + 30 * (w - 1)` units per second" — so
// wave 2 is 270, +15, and -10. The orbit speeds are read off the snapshot,
// and the ball speed off a launch, "Pressing `Space` launches the parked ball
// radially outward at the current wave's ball speed."
//
// THE WORLD IS THE FRESH WAVE-2 SESSION the interstitial hands back. The ball
// is parked through the surface's own parkBall (a no-op beside a parked ball)
// so the launch reading does not ride on the park-on-new-wave item.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { ballSpeed, RINGS, WAVECLEAR_TICKS } from "../constants";
import { captureReplay, openHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("serves at 270 and orbits at +15/-10 on wave 2", async () => {
  await h.reset();
  await h.debug.setScreen("playing");
  await h.debug.setScreen("waveclear");
  const after = await h.tick(WAVECLEAR_TICKS);
  assertEqual(after.screen, "playing", "the interstitial ran out");
  assertEqual(after.wave, 2, "the new wave");

  assertCloseTo(
    after.rings[1].speedDegPerSec,
    RINGS[1].speedAtWave(2),
    6,
    "ring 2's wave-2 orbit speed (+15)",
  );
  assertCloseTo(
    after.rings[2].speedDegPerSec,
    RINGS[2].speedAtWave(2),
    6,
    "ring 3's wave-2 orbit speed (-10)",
  );

  await h.debug.parkBall();
  const launched = await captureReplay(h, "wave-two-launch", async () => {
    await h.debug.launchBall();
    const serve = await h.snapshot();
    await h.tick(20);
    return serve;
  });
  const ball = launched.balls[0];
  assertEqual(ball.parked, false, "the launch unparked the ball");
  assertCloseTo(
    Math.hypot(ball.vx, ball.vy),
    ballSpeed(2),
    3,
    "the wave-2 serve speed (270)",
  );
});
