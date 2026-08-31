// instrumentation/clear-pods — every falling pod comes off the field, and
// nothing resolves on the way out.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md words `clearPods` as
// "removes every falling pod, leaving `pods` empty. Nothing is caught and
// nothing burns, so no score, cue, effect, or particle comes of it."
//
// THE POSE MAKES "NOTHING RESOLVES" SHARP. One pod hangs just above the
// deflector's catch radius ON the deflector's angle, one tick from the catch
// that would score 25 and put widen in force; another hangs just above the
// burn-up radius, ticks from burning. `clearPods` must take both without either
// resolving: `pods` reads empty, the score stays, no effect timer starts, the
// span stands at its baseline, and the lives stand — and the ticks run
// afterwards have nothing left to resolve, so all of it still stands.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureReplay,
  isolate,
  openHarness,
  spawnPodPolar,
  type Harness,
} from "../harness";

/** Just above the catch radius (196), on the deflector's start angle (90). */
const NEAR_CATCH_RADIUS = 200;
const DEFLECTOR_ANGLE = 90;

/** Just above the burn-up radius (78), far from the deflector. */
const NEAR_BURN_RADIUS = 85;
const AWAY_ANGLE = 270;

/** Ticks watched after the clear — past both crossings the pods would make. */
const WATCH_TICKS = 20;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes every pod with no catch, burn, score, or effect", async () => {
  const posed = await isolate(h);
  await spawnPodPolar(h, "widen", NEAR_CATCH_RADIUS, DEFLECTOR_ANGLE);
  await spawnPodPolar(h, "pierce", NEAR_BURN_RADIUS, AWAY_ANGLE);
  assertLength((await h.snapshot()).pods, 2, "the pods posed before the call");

  const after = await captureReplay(h, "cleared", async () => {
    await h.debug.clearPods();
    return h.tick(WATCH_TICKS);
  });

  assertLength(after.pods, 0, "pods after the call");
  assertEqual(after.score, posed.score, "the score after the call");
  assertEqual(after.lives, posed.lives, "the lives after the call");
  assertEqual(after.effects.widenTicks, 0, "the widen timer after the call");
  assertEqual(after.effects.narrowTicks, 0, "the narrow timer after the call");
  assertEqual(after.effects.pierceTicks, 0, "the pierce timer after the call");
  assertEqual(after.effects.shieldActive, false, "the shield after the call");
  assertEqual(
    after.paddle.spanDeg,
    posed.paddle.spanDeg,
    "the span after the call",
  );
  assertEqual(after.screen, "playing", "the screen after the call");
});
