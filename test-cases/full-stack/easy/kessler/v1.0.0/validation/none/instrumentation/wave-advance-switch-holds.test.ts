// instrumentation/wave-advance-switch-holds — with the switch off, emptying the
// field by destruction is not the clearing event.
//
// specs/instrumentation.md's driver table, for `waveAdvance` off: "The clearing
// event does not fire. Play carries on in `playing` over an empty field, and
// destructions keep scoring."
//
// THE SCENE IS ONE DESTRUCTION OF A ONE-TARGET FIELD, which leaves zero live
// targets: the screen must stay `playing` over ticks that would be deep into an
// interstitial, the wave counter must not move, and the score must have risen —
// "destructions keep scoring" is half the sentence. That the switch turned back
// ON resumes the clearing is `wave-advance-switch-resumes`.
//
// `podSpawn` stays off throughout, per isolate(), so no draw lands a pod on the
// scene.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { shedDestruction } from "./shed";

/** Ticks the emptied field is watched — a real interstitial is 180. */
const WATCH_TICKS = 40;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries on in playing over the field the destruction emptied", async () => {
  await isolate(h);

  const destroyed = await captureReplay(h, "held", async () => {
    const hit = await shedDestruction(h, 0);
    assertLength(hit.rings[0].targets, 0, "targets after the destruction");
    // The reflected ball leaves the scene before the watch, so nothing it
    // could reach (the planet) decides this point.
    await h.debug.clearBalls();
    return h.tick(WATCH_TICKS);
  });

  assertEqual(destroyed.screen, "playing", "the screen over the empty field");
  assertEqual(destroyed.wave, 1, "the wave over the empty field");
  assertGreaterThan(destroyed.score, 0, "the destruction still scoring");
});
