// instrumentation/set-screen-playing — `setScreen('playing')` starts a fresh
// session exactly as confirming START does.
//
// specs/instrumentation.md, `setScreen`'s table for `playing`: "Starts a fresh
// session exactly as confirming START does: score `0`, `3` lives, wave `1`,
// every slot filled, ring angles at `0`, the wave-1 figures in force, and a
// ball parked on the deflector."
//
// The pose is made over a session disturbed in every one of those regions —
// score, lives, wave, layout, ring pose, balls, pods, shield — so "a fresh
// session" is read against values that would all betray a `setScreen` that
// merely flips the screen field. The route is the surface alone: whether the
// title menu can start a session is a `controls` point, and a build with a
// broken menu and a working pose must fail there, not here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { START_LIVES } from "../constants";
import { captureStill, openHarness, type Harness } from "../harness";
import {
  assertParkedOnDeflector,
  assertWaveLaid,
  polarPose,
  toXy,
} from "./helpers";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("starts a fresh session over a disturbed one", async () => {
  await h.reset();
  await h.debug.setScreen("playing");
  await h.debug.setScore(4321);
  await h.debug.setLives(1);
  await h.debug.setWave(3);
  await h.debug.clearTargets();
  await h.debug.setRingAngle(2, 111);
  await h.debug.clearBalls();
  const ball = polarPose(250, 200, 60, 80);
  await h.debug.spawnBall(ball.x, ball.y, ball.vx, ball.vy);
  const pod = toXy(320, 250);
  await h.debug.spawnPod("shield", pod.x, pod.y);
  await h.debug.setShield(true);

  await h.debug.setScreen("playing");
  const s = await h.snapshot();
  await h.tick(1);
  await captureStill(h, "fresh");

  assertEqual(s.screen, "playing", "the screen");
  assertEqual(s.score, 0, "the fresh session's score");
  assertEqual(s.lives, START_LIVES, "the fresh session's lives");
  assertWaveLaid(s, 1, 1e-6, "the fresh session's wave-1 layout");
  assertParkedOnDeflector(s, "the fresh session");
});
