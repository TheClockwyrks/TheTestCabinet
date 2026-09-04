// instrumentation/reset-restores — `reset()` returns a thoroughly disturbed
// session to the boot state.
//
// specs/instrumentation.md, on `reset`: "Restores the game to its boot state:
// the `title` screen with `menu.index` at `0`, the score at `0`, `3` lives,
// wave `1`, `ticks` at `0`, the deflector at angle `90` with span `48`, every
// ring slot filled at its full hit points with every ring angle at `0` and
// each ring's speed from the wave-1 formulas, no balls, no pods, no timed
// effect, no shield, and both driver switches on."
//
// WHY IT IS ITS OWN POINT. Every posed scene in this project opens with a
// reset, so a reset that leaves anything behind fails quietly: it leaks one
// section's score, ring pose, or spent effect into the next, and the point
// that then fails is whichever happened to run after. So the game is first
// disturbed in every region an operation can reach — screen, figures, wave,
// deflector, rings, balls, pods, effects, shield, and both switches — ticked,
// and then reset and read back whole.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertLength } from "../assert";
import { START_LIVES } from "../constants";
import { captureStill, openHarness, type Harness } from "../harness";
import {
  assertWaveLaid,
  PADDLE_START,
  polarPose,
  SPAN_BASE,
  toXy,
} from "./helpers";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("restores the boot state from a thoroughly disturbed session", async () => {
  h.reset();
  h.debug.setScreen("playing");
  h.debug.setScore(4321);
  h.debug.setLives(1);
  h.debug.setWave(3);
  h.debug.setPaddleAngle(222);
  h.debug.clearTargets();
  h.debug.spawnTarget(2, 5, 1);
  h.debug.setRingAngle(2, 155);
  h.debug.setRingSpeed(3, 77);
  const ball = polarPose(250, 200, 60, 80);
  h.debug.spawnBall(ball.x, ball.y, ball.vx, ball.vy);
  const pod = toXy(320, 250);
  h.debug.spawnPod("narrow", pod.x, pod.y);
  h.debug.setEffectTicks("widen", 300);
  h.debug.setShield(true);
  h.debug.setWaveAdvance(false);
  h.debug.setPodSpawn(false);
  const disturbed = await h.tick(5);
  assertEqual(disturbed.ticks, 5, "the ticks a reset has to clear");
  assertEqual(disturbed.screen, "playing", "the screen a reset has to leave");

  h.debug.reset();
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "reset");

  assertEqual(s.screen, "title", "screen");
  assertEqual(s.menu.index, 0, "menu.index");
  assertEqual(s.score, 0, "score");
  assertEqual(s.lives, START_LIVES, "lives");
  assertEqual(s.ticks, 0, "ticks");
  assertCloseTo(s.paddle.angleDeg, PADDLE_START, 6, "the deflector at 90");
  assertCloseTo(s.paddle.spanDeg, SPAN_BASE, 6, "the deflector's span at 48");
  assertWaveLaid(s, 1, 1e-6, "the boot state's wave-1 layout");
  assertLength(s.balls, 0, "no balls");
  assertLength(s.pods, 0, "no pods");
  assertEqual(s.effects.widenTicks, 0, "no widen effect");
  assertEqual(s.effects.narrowTicks, 0, "no narrow effect");
  assertEqual(s.effects.pierceTicks, 0, "no pierce effect");
  assertEqual(s.effects.shieldActive, false, "no shield");
  assertEqual(s.waveAdvance, true, "the waveAdvance switch, back on");
  assertEqual(s.podSpawn, true, "the podSpawn switch, back on");
});
