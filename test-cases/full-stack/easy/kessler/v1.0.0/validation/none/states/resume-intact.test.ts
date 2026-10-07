// states/resume-intact — resuming returns to playing with the session exactly
// as it stood at the pause.
//
// specs/screens.md, on `paused`: "`confirm` on `RESUME` returns to `playing`
// with the session intact", and "resuming carries on from there" after the
// freeze sentence. So the score, lives, wave, deflector, every ball, every
// pod, and every effect timer must come back exactly as the pause held them.
//
// ONE HONEST TOLERANCE. specs/controls.md reads all of a frame's edges
// "against the screen the frame began on, so a press that changes screens
// never also acts on the screen it lands in" — but whether the simulation is
// already advancing again on the very tick the resume lands in is a design
// the specs leave to the build. Everything a single tick cannot change is
// compared exactly; each moving body and falling timer is allowed exactly 0
// or 1 ticks of its own ordinary travel, and nothing else.
//
// The session is posed rich on purpose — the item is about the WHOLE session
// surviving — with every body far from any contact, so one tick of play can
// move nothing but positions and timers. RESUME is accepted with Enter, the
// confirm key that does not also carry launch.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertCloseTo,
  assertEqual,
  assertLength,
  fail,
} from "../assert";
import { CENTER_X, CENTER_Y, POD_FALL_SPEED, TICK_DT } from "../constants";
import {
  captureReplay,
  isolate,
  openHarness,
  spawnBallPolar,
  spawnPodPolar,
  tap,
  type Harness,
} from "../harness";

/** `now` equals `was`, or `was` plus exactly one tick of travel at `v`. */
function assertCarried(
  now: number,
  was: number,
  v: number,
  what: string,
): void {
  const drift = now - was;
  const step = v * TICK_DT;
  if (Math.abs(drift) <= 1e-6 || Math.abs(drift - step) <= 1e-6) return;
  fail(
    `${what}: ${was} carried intact through the resume ` +
      `(or one tick of its own travel, to ${was + step})`,
    now,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries the whole session through RESUME", async () => {
  await isolate(h);
  await h.debug.setScore(777);
  await h.debug.setLives(2);
  await h.debug.setWave(2);
  await h.debug.setPaddleAngle(210);
  await spawnBallPolar(h, 300, 20, 240, 0);
  await spawnBallPolar(h, 320, 200, 240, 90);
  await spawnPodPolar(h, "multiball", 420, 120);
  await h.debug.setEffectTicks("widen", 500);
  await h.debug.setEffectTicks("pierce", 300);
  await h.debug.setShield(true);

  await h.debug.setScreen("paused");
  const paused = await h.snapshot();
  assertEqual(paused.screen, "paused", "the pause the session resumes from");
  assertEqual(paused.menu.index, 0, "the highlighted entry, RESUME");

  await captureReplay(h, "resume", () => tap(h, "Enter"));

  const resumed = await h.snapshot();
  assertEqual(resumed.screen, "playing", "the screen RESUME returns to");
  assertEqual(resumed.score, paused.score, "the score across the resume");
  assertEqual(resumed.lives, paused.lives, "the lives across the resume");
  assertEqual(resumed.wave, paused.wave, "the wave across the resume");
  assertEqual(
    resumed.paddle.angleDeg,
    paused.paddle.angleDeg,
    "the deflector's center angle across the resume (no rotation key is held)",
  );
  assertEqual(
    resumed.paddle.spanDeg,
    paused.paddle.spanDeg,
    "the deflector's span across the resume (widen is still in force)",
  );
  assertEqual(
    resumed.effects.shieldActive,
    true,
    "the shield across the resume",
  );
  assertBetween(
    resumed.effects.widenTicks,
    paused.effects.widenTicks - 1,
    paused.effects.widenTicks,
    "the widen timer across the resume (at most its own single-tick fall)",
  );
  assertBetween(
    resumed.effects.pierceTicks,
    paused.effects.pierceTicks - 1,
    paused.effects.pierceTicks,
    "the pierce timer across the resume (at most its own single-tick fall)",
  );

  assertLength(
    resumed.balls,
    paused.balls.length,
    "the balls across the resume",
  );
  for (const [i, ball] of resumed.balls.entries()) {
    const was = paused.balls[i];
    assertCloseTo(ball.vx, was.vx, 6, `ball ${i}'s vx across the resume`);
    assertCloseTo(ball.vy, was.vy, 6, `ball ${i}'s vy across the resume`);
    assertCarried(ball.x, was.x, was.vx, `ball ${i}'s x`);
    assertCarried(ball.y, was.y, was.vy, `ball ${i}'s y`);
  }

  assertLength(resumed.pods, 1, "the pod across the resume");
  assertEqual(resumed.pods[0].kind, "multiball", "the pod's kind");
  const rWas = Math.hypot(
    paused.pods[0].x - CENTER_X,
    paused.pods[0].y - CENTER_Y,
  );
  const rNow = Math.hypot(
    resumed.pods[0].x - CENTER_X,
    resumed.pods[0].y - CENTER_Y,
  );
  assertBetween(
    rNow,
    rWas - POD_FALL_SPEED * TICK_DT - 1e-6,
    rWas + 1e-6,
    "the pod's radius across the resume (at most one tick of its own fall)",
  );
});
