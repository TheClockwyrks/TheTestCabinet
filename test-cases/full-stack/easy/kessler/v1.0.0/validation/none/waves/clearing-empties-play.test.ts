// waves/clearing-empties-play — at the instant of the clearing event every
// ball, every pod, every timed effect, and the shield are removed, with no
// life lost.
//
// specs/rings.md: "At that instant every ball, every pod, every timed effect,
// and the shield are removed, with no life lost". The reading is the snapshot
// of the tick the screen turned waveclear. The event removing the last live
// ball must not trip the life-loss check of specs/field.md, which is why the
// lives reading is load-bearing.
//
// THE WORLD IS A STRIKE PLUS ONE OF EVERYTHING THE EVENT REMOVES: a bystander
// ball drifting far from every surface, one falling pod, the widen and pierce
// timers running (narrow cannot run beside widen — the two "replace each
// other", specs/pods.md), and the shield up. waveAdvance is turned back on
// because the event IS the requirement; podSpawn stays off.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import { PIERCE_TICKS, START_LIVES, WIDEN_TICKS } from "../constants";
import {
  captureReplay,
  isolate,
  openHarness,
  spawnBallPolar,
  spawnPodPolar,
  type Harness,
} from "../harness";
import { armStrike, STRIKE_BUDGET_TICKS } from "./rig";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes balls, pods, effects, and shield, losing no life", async () => {
  await isolate(h);
  await h.debug.setWaveAdvance(true);
  await h.debug.setEffectTicks("widen", WIDEN_TICKS);
  await h.debug.setEffectTicks("pierce", PIERCE_TICKS);
  await h.debug.setShield(true);
  // A bystander ball drifting tangentially at radius 300, angle 30 — far from
  // the strike's arc and from every contact radius for the few ticks it lives.
  await spawnBallPolar(h, 300, 30, 60, 90);
  // A bystander pod high above the deflector, 2 units of fall per tick.
  await spawnPodPolar(h, "shield", 440, 300);
  await armStrike(h, 6);

  const posed = await h.snapshot();
  assertEqual(posed.balls.length, 2, "the posed balls");
  assertEqual(posed.pods.length, 1, "the posed pod");
  assertGreaterThan(posed.effects.widenTicks, 0, "the posed widen timer");
  assertGreaterThan(posed.effects.pierceTicks, 0, "the posed pierce timer");
  assertEqual(posed.effects.shieldActive, true, "the posed shield");
  assertEqual(posed.lives, START_LIVES, "the posed lives");

  const swept = await captureReplay(h, "field-emptied", () =>
    h.until((s) => s.screen === "waveclear", {
      maxTicks: STRIKE_BUDGET_TICKS,
    }),
  );
  assertTrue(swept.hit, "the strike fired the clearing event");

  const at = swept.snapshot;
  assertEqual(at.balls.length, 0, "every ball removed");
  assertEqual(at.pods.length, 0, "every pod removed");
  assertEqual(at.effects.widenTicks, 0, "the widen timer ended");
  assertEqual(at.effects.narrowTicks, 0, "no narrow timer runs");
  assertEqual(at.effects.pierceTicks, 0, "the pierce timer ended");
  assertEqual(at.effects.shieldActive, false, "the shield removed");
  assertEqual(at.lives, START_LIVES, "no life lost");
});
