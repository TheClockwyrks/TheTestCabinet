// screens/waveclear-returns-to-playing — the interstitial returns to play by
// itself.
//
// specs/screens.md, on `waveclear`: "A banner announcing the cleared wave, shown
// over the field for `180` ticks. That count is the interstitial timer the
// snapshot reports as `interstitialTicks` ... Only that timer advances during
// the interstitial, and no input is read. When it lapses, `screen` returns to
// `playing`."
//
// THE INTERSTITIAL IS POSED THE WAY THE CLEARING EVENT ENTERS IT, through the
// harness's own sequence of atomic poses, which sets the timer to the `180` the
// clearing event sets — and the sweep presses nothing. Whether the entering tick
// counts against the 180 is the build's design choice, so the lapse is read with
// a one-tick tolerance either side.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import { WAVECLEAR_TICKS } from "../constants";
import {
  captureReplay,
  openHarness,
  poseInterstitial,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to playing when the 180-tick timer lapses", async () => {
  const posed = await poseInterstitial(h);
  assertEqual(posed.screen, "waveclear", "the screen the timer is watched on");
  assertEqual(
    posed.interstitialTicks,
    WAVECLEAR_TICKS,
    "the timer the clearing event sets",
  );

  // The banner holds still for almost the whole span, so the recorder is armed
  // for the run-out rather than for three seconds of a frozen picture.
  await h.tick(WAVECLEAR_TICKS - 20);

  const swept = await captureReplay(h, "interstitial", () =>
    h.until((s) => s.screen === "playing", { maxTicks: 40 }),
  );

  assertEqual(
    swept.snapshot.screen,
    "playing",
    "the screen the interstitial returned to with no input pressed",
  );
  assertBetween(
    swept.ticks + WAVECLEAR_TICKS - 20,
    WAVECLEAR_TICKS - 1,
    WAVECLEAR_TICKS + 1,
    "the ticks the interstitial held before returning",
  );
});
