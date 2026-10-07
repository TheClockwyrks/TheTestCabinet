// instrumentation/set-wave-leaves-the-rest — `setWave(n)` changes nothing but
// the wave figures.
//
// specs/instrumentation.md, on `setWave`: "The rings keep their targets and
// their angles, every ball keeps the velocity it holds, and the effects, pods,
// score, lives, and screen stay as they stand."
//
// One of everything the sentence names is posed first — a damaged target on a
// turned ring, a ball with an odd velocity, a falling pod, a running timer,
// the shield, a score, a lives figure — and the whole snapshot is read on both
// sides of the pose, so any collateral change reads back against the exact
// value that stood before. The ring SPEEDS are the one thing the operation is
// for, decided by `set-wave-figures`; everything else must hold.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertDeepEqual, assertEqual } from "../assert";
import { captureStill, isolate, openHarness, type Harness } from "../harness";
import { polarPose, toXy } from "./helpers";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps targets, angles, velocities, effects, pods, score, lives, and screen", async () => {
  isolate(h);
  h.debug.spawnTarget(2, 3, 1);
  h.debug.setRingAngle(2, 123);
  const ball = polarPose(250, 300, 60, 90);
  h.debug.spawnBall(ball.x, ball.y, ball.vx, ball.vy);
  const pod = toXy(320, 200);
  h.debug.spawnPod("pierce", pod.x, pod.y);
  h.debug.setEffectTicks("pierce", 200);
  h.debug.setShield(true);
  h.debug.setScore(840);
  h.debug.setLives(2);
  const before = h.snapshot();

  h.debug.setWave(5);
  const after = h.snapshot();
  await h.tick(1);
  captureStill(h, "held");

  assertEqual(after.wave, 5, "the wave counter, the one thing set");
  assertDeepEqual(
    after.rings.map((ring) => ring.targets),
    before.rings.map((ring) => ring.targets),
    "the rings' targets",
  );
  assertCloseTo(after.rings[1].angleDeg, 123, 6, "ring 2's posed angle");
  assertDeepEqual(after.balls, before.balls, "the ball's pose and velocity");
  assertDeepEqual(after.pods, before.pods, "the falling pod");
  assertDeepEqual(after.effects, before.effects, "the effects and the shield");
  assertEqual(after.score, 840, "the score");
  assertEqual(after.lives, 2, "the lives");
  assertEqual(after.screen, "playing", "the screen");
});
