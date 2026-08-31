// effects/shield-catch-noop-while-active — catching a shield pod while a
// shield is active scores the catch and changes nothing else: the shield
// stays active and is still consumed by its first reflection.
//
// specs/pods.md: "Catching a `shield` pod while a shield is active scores and
// changes nothing else." The score is the exact 25-point pod catch of
// specs/scoring.md; the shield reading is the exact boolean, before and
// after the one reflection that must still spend it — a build that stacked a
// second shield would survive that reflection.
//
// THE WORLD IS AN ACTIVE SHIELD, ONE POD, THEN ONE BALL. The field is
// emptied and the switches are off, so the catch and the reflection are the
// only events their ticks resolve.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertLength } from "../assert";
import {
  CATCH_POINTS,
  close,
  dropPod,
  open,
  polar,
  record,
  setShieldOn,
  SHIELD_CROSS_RADIUS,
  snap,
  spawnBallAt,
  speedAtWave,
  ticks,
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

it("scores the catch, keeps one shield, spends it on one reflection", async () => {
  await world(h);
  await setShieldOn(h, true);
  const posed = await snap(h);
  assertEqual(posed.effects.shieldActive, true, "the posed shield");
  assertEqual(posed.score, 0, "the score before the catch");

  const after = await record(h, "shield-re-catch", () => dropPod(h, "shield"));

  assertLength(after.pods, 0, "the pod after the catch tick");
  assertEqual(after.score, CATCH_POINTS, "the catch scores its 25 points");
  assertEqual(
    after.effects.shieldActive,
    true,
    "the shield stays active — nothing else changes",
  );

  await spawnBallAt(h, SHIELD_CROSS_RADIUS + 3, 0, speedAtWave(1), 180);
  const reflected = await ticks(h, 1);
  const a = reflected.balls[0];
  assertCloseTo(
    velocityAt(a, polar(a).theta).offDeg,
    0,
    3,
    "the ball reflects straight back off the one shield",
  );
  assertEqual(
    reflected.effects.shieldActive,
    false,
    "still consumed by its first reflection — one shield, not two",
  );
});
