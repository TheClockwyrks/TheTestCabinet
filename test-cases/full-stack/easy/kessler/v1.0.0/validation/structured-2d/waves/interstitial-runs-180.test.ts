// waves/interstitial-runs-180 — the waveclear interstitial runs for 180 ticks,
// only its timer advancing, and then hands back to playing.
//
// specs/screens.md, `waveclear`: "A banner announcing the cleared wave, shown
// over the field for `180` ticks. That count is the interstitial timer the
// snapshot reports as `interstitialTicks`, and the clearing event sets it to
// `180`. Only that timer advances during the interstitial", and the
// what-advances table gives waveclear "the interstitial's `180`-tick timer, and
// nothing else". The two readings bracket the duration exactly: still waveclear
// after 179 ticks, playing after the 180th. "Nothing else" is read off the
// moving rings, whose angles must hold through the whole span.
//
// THE WORLD IS THE INTERSTITIAL ITSELF: a fresh session (ring angles 0) posed
// into waveclear exactly as the clearing event enters it, through the harness's
// own sequence of atomic poses.
//
// THE RECORDER IS ARMED FOR THE HAND-BACK, not for the banner. Almost the whole
// interstitial is a frozen picture, and a written recording holds three hundred
// frames, so the 160 ticks that show nothing are driven OUTSIDE the bracket and
// what is recorded is the last twenty ticks and the tick that hands play back.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { WAVECLEAR_TICKS } from "../constants";
import {
  captureReplay,
  openHarness,
  poseInterstitial,
  type Harness,
} from "../harness";

/** Ticks of the run-out the recorder is armed for. */
const RECORDED_TICKS = 20;

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
  const entered = poseInterstitial(h);
  assertEqual(entered.screen, "waveclear", "the posed interstitial");
  assertEqual(
    entered.interstitialTicks,
    WAVECLEAR_TICKS,
    "the timer the clearing event sets",
  );

  // The frozen stretch, outside the bracket: nothing here is worth recording.
  const early = await h.tick(WAVECLEAR_TICKS - 1 - RECORDED_TICKS);
  assertEqual(early.screen, "waveclear", "the screen through the frozen span");

  const { almost, after } = await captureReplay(h, "interstitial", async () => {
    const beforeLast = await h.tick(RECORDED_TICKS);
    const handedBack = await h.tick(1);
    return { almost: beforeLast, after: handedBack };
  });

  assertEqual(almost.screen, "waveclear", "the screen after 179 ticks");
  assertEqual(almost.rings[1].angleDeg, 0, "ring 2 held while frozen");
  assertEqual(almost.rings[2].angleDeg, 0, "ring 3 held while frozen");
  assertEqual(after.screen, "playing", "the screen after the 180th tick");
});
