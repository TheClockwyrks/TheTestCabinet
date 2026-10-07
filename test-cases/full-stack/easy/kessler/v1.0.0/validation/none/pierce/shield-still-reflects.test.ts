// pierce/shield-still-reflects — the shield ring reflects a piercing ball.
//
// specs/pods.md, "pierce": "The deflector, the shield ring, and the containment
// field reflect a piercing ball exactly as they reflect any other", and of the
// shield itself: "the shield disappears on it, so one shield reflects one ball."
// Each of the three surfaces is its own point, because a build that disables one
// of them under pierce and keeps the other two must grade differently from one
// that disables all three.
//
// THE READING IS THE SIGN OF THE RADIAL VELOCITY after the crossing tick, plus
// the shield having been spent by it — a piercing ball that passed through would
// leave the shield standing. The exact reflection arithmetic is the `effects`
// shield points' business, not this one's.
//
// THE WORLD IS ONE BALL AND THE SHIELD, per isolate(), and the ball is aimed
// away from the deflector's span so nothing else can turn it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { captureReplay, openHarness, type Harness } from "../harness";
import {
  armPierce,
  inboundBall,
  PIERCE_DURATION,
  poseIsolated,
  radialSpeedOf,
  raiseShield,
  soleBall,
} from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reflects a piercing ball and spends the shield on it", async () => {
  await poseIsolated(h);
  await armPierce(h, PIERCE_DURATION);
  await raiseShield(h);
  // Inward from radius 106, away from the deflector's span: the crossing of
  // shield contact radius 100 resolves on tick 2 (102 to 98).
  await inboundBall(h, 200, 106);

  const after = await captureReplay(h, "shield", async () => {
    const reflected = await h.tick(2);
    await h.tick(6); // let the replay show the ball flying back out
    return reflected;
  });

  assertGreaterThan(
    radialSpeedOf(soleBall(after)),
    0,
    "outward after the shield reflection, pierce notwithstanding",
  );
  assertEqual(
    after.effects.shieldActive,
    false,
    "the shield spent by the reflection it made",
  );
});
