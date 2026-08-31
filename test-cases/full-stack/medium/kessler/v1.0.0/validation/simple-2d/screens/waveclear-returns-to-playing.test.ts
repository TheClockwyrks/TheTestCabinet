// screens/waveclear-returns-to-playing — the interstitial returns to play by
// itself.
//
// specs/screens.md, on `waveclear`: "A banner announcing the cleared wave,
// shown over the field for `180` ticks. Only the interstitial's timer advances
// during it, and no input is read. When the timer lapses, `screen` returns to
// `playing`."
//
// The interstitial is entered through the surface — `setScreen('waveclear')`
// begins a fresh interstitial that "runs out into the next wave exactly as a
// played one does" (specs/instrumentation.md) — and the sweep presses nothing.
// Whether the entering tick counts against the 180 is the build's design
// choice, so the lapse is read with a one-tick tolerance either side.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import { WAVECLEAR_TICKS } from "../constants";
import {
  captureReplay,
  openHarness,
  poseScene,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to playing when the 180-tick timer lapses", async () => {
  const posed = poseScene(h, "waveclear");
  assertEqual(posed.screen, "waveclear", "the screen the timer is watched on");

  const swept = await captureReplay(h, "interstitial", () =>
    h.until((s) => s.screen === "playing", { maxTicks: WAVECLEAR_TICKS + 20 }),
  );

  assertEqual(
    swept.snapshot.screen,
    "playing",
    "the screen the interstitial returned to with no input pressed",
  );
  assertBetween(
    swept.ticks,
    WAVECLEAR_TICKS - 1,
    WAVECLEAR_TICKS + 1,
    "the ticks the interstitial held before returning",
  );
});
