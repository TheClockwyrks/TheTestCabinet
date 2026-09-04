// instrumentation/set-screen-waveclear — `setScreen('waveclear')` enters a
// fresh interstitial exactly as the clearing event does, and it runs out into
// the next wave exactly as a played one does.
//
// specs/instrumentation.md, `setScreen`'s table for `waveclear`: "Enters the
// interstitial exactly as the clearing event enters it: balls, pods, timed
// effects, and the shield are removed and a fresh interstitial begins for the
// wave the counter holds. The score stays as it stands, and the interstitial
// runs out into the next wave exactly as a played one does." specs/rings.md,
// on the interstitial's end: "every slot of every ring refills with a
// full-hit-point target, ring angles reset to `0`, the wave number rises by
// one, the new wave's ball speed and orbit speeds apply, and a ball parks on
// the deflector."
//
// The interstitial being FRESH is read by holding it 170 ticks in — a timer
// that entered part-spent would already have lapsed — and the run-out is then
// swept for, so a boundary tick either side of the 180 of specs/screens.md
// (whose exact figure is a `screens` point) does not decide this one. The
// entering session carries a ball, a pod, an effect, and the shield, so each
// removal is read against something that was there.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import {
  advanceTicks,
  captureReplay,
  openHarness,
  type Harness,
} from "../harness";
import {
  assertParkedOnDeflector,
  assertWaveLaid,
  polarPose,
  toXy,
} from "./helpers";

/** Ticks the fresh interstitial is held before the run-out is swept for. */
const HELD_TICKS = 170;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("empties the field, keeps the score, and runs out into the next wave", async () => {
  h.reset();
  h.debug.setScreen("playing");
  const ball = polarPose(250, 200, 60, 80);
  h.debug.spawnBall(ball.x, ball.y, ball.vx, ball.vy);
  const pod = toXy(320, 250);
  h.debug.spawnPod("pierce", pod.x, pod.y);
  h.debug.setEffectTicks("narrow", 300);
  h.debug.setShield(true);
  h.debug.setScore(3210);

  h.debug.setScreen("waveclear");
  const entered = h.snapshot();

  assertEqual(entered.screen, "waveclear", "the interstitial, entered");
  assertLength(entered.balls, 0, "balls removed, the parked one included");
  assertLength(entered.pods, 0, "pods removed");
  assertEqual(entered.effects.narrowTicks, 0, "the timed effect removed");
  assertEqual(entered.effects.shieldActive, false, "the shield removed");
  assertEqual(entered.score, 3210, "the score, standing");
  assertEqual(entered.wave, 1, "the wave the counter holds");

  const run = await captureReplay(h, "interstitial", async () => {
    await advanceTicks(h, HELD_TICKS);
    const held = h.snapshot();
    assertEqual(
      held.screen,
      "waveclear",
      `a FRESH interstitial, still running ${HELD_TICKS} ticks in`,
    );
    return h.until((s) => s.screen === "playing", { maxTicks: 20 });
  });

  assertTrue(run.hit, "the interstitial running out into playing");
  const next = run.snapshot;
  assertEqual(next.score, 3210, "the score across the interstitial");
  assertWaveLaid(next, 2, 0.5, "the next wave, laid out");
  assertParkedOnDeflector(next, "the next wave");
});
