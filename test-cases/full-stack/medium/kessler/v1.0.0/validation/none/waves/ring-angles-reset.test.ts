// waves/ring-angles-reset — when the interstitial ends the ring angles reset
// to 0.
//
// specs/rings.md: "When it ends, every slot of every ring refills ..., ring
// angles reset to `0`, ...", and "Every ring starts a session, and starts each
// wave, at ring angle `0`." Each angle is posed far from 0 first, so the
// reading can only be the reset. The read comes after the tick that ends the
// interstitial, and the spec leaves to the build whether the new wave's first
// ring advance shares that tick — so the moving rings are read within one
// tick of orbit of 0, and ring 1, stationary at every wave, exactly at 0.
//
// THE WORLD IS THE INTERSTITIAL OVER POSED RING ANGLES: a fresh session, each
// ring angle posed, then waveclear run out.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { angularOffset, RINGS, TICK_DT, WAVECLEAR_TICKS } from "../constants";
import { captureStill, openHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("resets every ring angle to 0 for the new wave", async () => {
  await h.reset();
  await h.debug.setScreen("playing");
  await h.debug.setRingAngle(1, 123);
  await h.debug.setRingAngle(2, 210);
  await h.debug.setRingAngle(3, 301);
  await h.debug.setScreen("waveclear");

  const after = await h.tick(WAVECLEAR_TICKS);
  await captureStill(h, "reset-angles");

  assertEqual(after.screen, "playing", "the interstitial ran out");
  assertEqual(after.rings[0].angleDeg, 0, "ring 1 (stationary) at 0");
  for (const ring of [2, 3]) {
    const oneTick = Math.abs(RINGS[ring - 1].speedAtWave(after.wave)) * TICK_DT;
    assertLessThanOrEqual(
      Math.abs(angularOffset(0, after.rings[ring - 1].angleDeg)),
      oneTick + 1e-6,
      `ring ${ring} within one tick of orbit of 0`,
    );
  }
});
