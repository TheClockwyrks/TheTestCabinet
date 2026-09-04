// instrumentation/set-screen-leaves-the-rest — the pose changes the screen and
// nothing else.
//
// specs/instrumentation.md, `setScreen(name)`: it "changes nothing else. The
// score, the lives, the wave, the deflector, the balls, the rings, the pods,
// the timed effects, the shield, the interstitial timer, the menu highlight,
// and both driver switches all stand exactly as they stood."
//
// THE SCENE IS DISTURBED IN EVERY ONE OF THOSE REGIONS FIRST, so "stands
// exactly as it stood" is read against values a build that rearranged anything
// on the way into a screen would have to move. The comparison is the whole
// snapshot bar `screen` itself, so no region is checked by omission.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { captureStill, openHarness, type Harness } from "../harness";
import { polarPose, toXy } from "./helpers";

/** Figures no boot state holds, so an untouched read can only be the pose. */
const SCORE = 4321;
const LIVES = 1;
const WAVE = 3;
const PADDLE_ANGLE = 200;
const RING_ANGLE = 111;
const NARROW = 300;
const INTERSTITIAL = 77;
const MENU_INDEX = 1;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("holds every other field across a screen change", async () => {
  await h.debug.reset();
  await h.debug.setScreen("paused");
  await h.debug.setScore(SCORE);
  await h.debug.setLives(LIVES);
  await h.debug.setWave(WAVE);
  await h.debug.setPaddleAngle(PADDLE_ANGLE);
  await h.debug.setRingAngle(2, RING_ANGLE);
  const ball = polarPose(250, 200, 60, 80);
  await h.debug.spawnBall(ball.x, ball.y, ball.vx, ball.vy);
  const pod = toXy(320, 250);
  await h.debug.spawnPod("shield", pod.x, pod.y);
  await h.debug.setEffectTicks("narrow", NARROW);
  await h.debug.setShield(true);
  await h.debug.setInterstitialTicks(INTERSTITIAL);
  await h.debug.setWaveAdvance(false);
  await h.debug.setPodSpawn(false);
  await h.debug.setMenuIndex(MENU_INDEX);

  const before = await h.snapshot();
  assertEqual(before.menu.index, MENU_INDEX, "the posed menu highlight");
  await h.debug.setScreen("title");
  const after = await h.snapshot();
  await captureStill(h, "held");

  assertEqual(after.screen, "title", "the screen the call named");
  const { screen: _wasScreen, ...restBefore } = before;
  const { screen: _isScreen, ...restAfter } = after;
  assertDeepEqual(restAfter, restBefore, "every field but the screen");
});
