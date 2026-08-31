// instrumentation/wave-advance-switch — with the switch off, emptying the field
// by destruction is not the clearing event, and turning it back on catches
// nothing up.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md's driver table, for
// `waveAdvance` off: "the clearing event does not fire. Play carries on in
// `playing` over an empty field, and destructions keep scoring." And of a
// switch coming back on: "turning one back on resumes that consequence from the
// next event onward, with no catching up for the events it missed."
//
// THE SCENE IS THREE DESTRUCTIONS OF A ONE-TARGET FIELD. The first, with the
// switch off, leaves zero live targets: the screen must stay `playing` over
// ticks that would be deep into an interstitial, and the score must have risen.
// Then the switch comes back on over the still-empty field: nothing fires (the
// missed event is not caught up). The third destruction, with the switch on, is
// the next qualifying event, and the clearing resumes there: the `waveclear`
// interstitial begins, exactly as specs/rings.md's clearing event states.
//
// `podSpawn` stays off throughout, so no draw lands a pod on the scene.

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

afterEach(() => {
  h?.dispose();
});

it("holds the clearing while off and resumes on the next event", async () => {
  isolate(h);

  // Off: a destruction that empties the field fires nothing.
  const destroyed = await captureReplay(h, "held", async () => {
    const hit = await shedDestruction(h, 0);
    assertLength(hit.rings[0].targets, 0, "targets after the destruction");
    // The reflected ball leaves the scene before the watch, so nothing it
    // could reach (the planet) decides this point.
    h.debug.clearBalls();
    return h.tick(WATCH_TICKS);
  });
  assertEqual(destroyed.screen, "playing", "the screen over the empty field");
  assertEqual(destroyed.wave, 1, "the wave over the empty field");
  assertGreaterThan(destroyed.score, 0, "the destruction still scoring");

  // Back on: the missed event is not caught up.
  h.debug.setWaveAdvance(true);
  const armed = await h.tick(WATCH_TICKS);
  assertEqual(armed.screen, "playing", "the screen after re-arming the switch");
  assertEqual(armed.wave, 1, "the wave after re-arming the switch");

  // The next qualifying destruction is where the clearing resumes.
  const cleared = await shedDestruction(h, 3);
  assertEqual(cleared.screen, "waveclear", "the screen on the next event");
  assertGreaterThan(
    cleared.score,
    destroyed.score,
    "the clearing destruction's own scoring",
  );
});
