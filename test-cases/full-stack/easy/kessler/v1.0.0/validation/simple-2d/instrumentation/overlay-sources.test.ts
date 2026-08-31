// instrumentation/overlay-sources — the shown overlay reports every registered
// diagnostic with the live value the snapshot reports.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md (Diagnostics):
// "Register at least the current `screen`, the score, the lives, the wave, the
// deflector's angle and span, the count of live balls, the count of live
// targets, the count of falling pods, the three effect timers, and the shield
// state, the same facts the snapshot reports."
//
// HOW IT IS READ. The overlay is text the frame draws, so the panel's
// contribution is the multiset difference between a frame with it shown and the
// frame before the toggle — the game's own HUD text, drawn alike in both,
// cancels out, so a HUD that shows the score cannot answer for an overlay that
// omits it. Every posed figure is distinctive, and each must appear in that
// difference as its own token, against the live snapshot read beside the same
// frame. Neither the panel's wording nor its layout is fixed, so tokens are all
// this point may ask for — and the shield state, whose wording is free, is read
// as the panel's stable lines CHANGING when the shield flips, with everything
// that varies frame to frame (timers, the engine's own metrics) dropped from
// both sides.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotEqual, assertTrue } from "../assert";
import {
  captureStill,
  isolate,
  openHarness,
  spawnBallPolar,
  spawnPodPolar,
  type Harness,
} from "../harness";
import {
  frameText,
  hasToken,
  minusLines,
  pressToggle,
  stableLines,
} from "./overlay";

/** The posed figures — each distinctive enough to read back as a token. */
const SCORE = 4321;
const LIVES = 8;
const WAVE = 6;
const PADDLE_DEG = 217;
const WIDEN_POSED = 543;
const PIERCE_POSED = 111;
const BALLS = 5;
const TARGETS = 4;
const PODS = 3;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("shows each registered source with its live value", async () => {
  isolate(h);
  h.debug.setScore(SCORE);
  h.debug.setLives(LIVES);
  h.debug.setWave(WAVE);
  h.debug.setPaddleAngle(PADDLE_DEG);
  h.debug.setEffectTicks("widen", WIDEN_POSED);
  h.debug.setEffectTicks("pierce", PIERCE_POSED);
  h.debug.setShield(true);
  for (let i = 0; i < BALLS; i += 1) spawnBallPolar(h, 250, 30 + i * 60, 0, 0);
  for (let slot = 0; slot < TARGETS; slot += 1) {
    h.debug.spawnTarget(1, slot * 3, 1);
  }
  for (let i = 0; i < PODS; i += 1) {
    spawnPodPolar(h, "shield", 400 + i * 10, 200 + i * 40);
  }

  const before = await frameText(h);
  await pressToggle(h);
  const shown = await frameText(h);
  const live = h.snapshot();
  captureStill(h, "sources");
  const panel = minusLines(shown, before);

  assertTrue(hasToken(panel, "playing"), "the screen on the panel");
  assertTrue(hasToken(panel, String(SCORE)), "the score on the panel");
  assertTrue(hasToken(panel, String(LIVES)), "the lives on the panel");
  assertTrue(hasToken(panel, String(WAVE)), "the wave on the panel");
  assertTrue(hasToken(panel, String(PADDLE_DEG)), "the angle on the panel");
  assertTrue(
    hasToken(panel, String(live.paddle.spanDeg)),
    "the span on the panel",
  );
  assertTrue(hasToken(panel, String(BALLS)), "the ball count on the panel");
  assertTrue(hasToken(panel, String(TARGETS)), "the target count on the panel");
  assertTrue(hasToken(panel, String(PODS)), "the pod count on the panel");
  assertTrue(
    hasToken(panel, String(live.effects.widenTicks)),
    "the widen timer on the panel",
  );
  assertTrue(
    hasToken(panel, String(live.effects.narrowTicks)),
    "the narrow timer on the panel",
  );
  assertTrue(
    hasToken(panel, String(live.effects.pierceTicks)),
    "the pierce timer on the panel",
  );

  // The shield state: the panel's stable lines change when the shield flips.
  const shieldUp = stableLines(shown, await frameText(h));
  h.debug.setShield(false);
  const downA = await frameText(h);
  const shieldDown = stableLines(downA, await frameText(h));
  assertNotEqual(
    [...shieldUp].sort().join("\n"),
    [...shieldDown].sort().join("\n"),
    "the panel's stable lines across the shield flip",
  );
});
