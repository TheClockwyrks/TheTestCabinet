// waves/clear-targets-never-clears — a field emptied by clearTargets() is not
// a clearing: the screen stays in playing and play carries on over the empty
// field.
//
// specs/instrumentation.md, `clearTargets()`: "It is not a destruction and not
// a clearing: nothing scores, no pod draw is made, no cue plays, and the
// screen stays where it stands, so a field emptied this way plays on in
// `playing`." The clearing event needs "a hit from a ball" (specs/rings.md),
// and this pose is no hit.
//
// THE WORLD IS THE FRESH SESSION ITSELF. The session is entered through the
// surface with its full field and both driver switches on — waveAdvance
// deliberately left on, because the requirement is that even with the clearing
// event armed, this pose never fires it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { captureReplay, openHarness, type Harness } from "../harness";
import { FULL_FIELD, totalTargets } from "./rig";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("stays in playing over a field emptied by clearTargets", async () => {
  h.reset();
  h.debug.setScreen("playing");
  const posed = h.snapshot();
  assertEqual(totalTargets(posed), FULL_FIELD, "the fresh session's field");
  assertEqual(posed.waveAdvance, true, "the fresh session's waveAdvance");

  h.debug.clearTargets();
  const emptied = h.snapshot();
  assertEqual(totalTargets(emptied), 0, "the emptied field");
  assertEqual(emptied.screen, "playing", "the screen at the call");

  const later = await captureReplay(h, "empty-field", () => h.tick(90));

  assertEqual(later.screen, "playing", "the screen 90 ticks on");
  assertEqual(later.wave, posed.wave, "no wave transition ran");
  assertGreaterThan(later.ticks, emptied.ticks, "play carried on");
});
