// waves/interstitial-runs-180 — the waveclear interstitial runs for 180 ticks,
// only its timer advancing, and then hands back to playing.
//
// specs/screens.md, `waveclear`: "A banner announcing the cleared wave, shown
// over the field for `180` ticks. Only the interstitial's timer advances
// during it ... When the timer lapses, `screen` returns to `playing`", and the
// what-advances table gives waveclear "the interstitial's `180`-tick timer,
// and nothing else". The two readings bracket the duration exactly: still
// waveclear after 179 ticks, playing after the 180th. "Nothing else" is read
// off the moving rings, whose angles must hold through the whole span.
//
// THE WORLD IS THE INTERSTITIAL ITSELF: a fresh session (ring angles 0) posed
// straight into waveclear through the surface, exactly as the clearing event
// enters it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { WAVECLEAR_TICKS } from "../constants";
import { captureReplay, openHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds waveclear for exactly 180 ticks, rings frozen", async () => {
  h.reset();
  h.debug.setScreen("playing");
  h.debug.setScreen("waveclear");
  const entered = h.snapshot();
  assertEqual(entered.screen, "waveclear", "the posed interstitial");

  const { almost, after } = await captureReplay(h, "interstitial", async () => {
    const beforeLast = await h.tick(WAVECLEAR_TICKS - 1);
    const handedBack = await h.tick(1);
    return { almost: beforeLast, after: handedBack };
  });

  assertEqual(almost.screen, "waveclear", "the screen after 179 ticks");
  assertEqual(almost.rings[1].angleDeg, 0, "ring 2 held while frozen");
  assertEqual(almost.rings[2].angleDeg, 0, "ring 3 held while frozen");
  assertEqual(after.screen, "playing", "the screen after the 180th tick");
});
