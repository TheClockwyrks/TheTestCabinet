// instrumentation/set-interstitial-ticks — the pose sets the interstitial timer,
// and the interstitial runs out from exactly the posed figure.
//
// specs/instrumentation.md, `setInterstitialTicks(ticks)`: "Sets the
// interstitial timer to `ticks`, a whole number of at least `0`. The timer
// counts down only on `waveclear`, where each tick lowers it by `1` and the
// tick that takes it to `0` ends the interstitial, laying the next wave out and
// returning `screen` to `playing`". The snapshot reports it as
// `interstitialTicks`.
//
// THE POSED FIGURE IS SMALL AND NOT 180, so what is read back is the pose
// rather than the figure the clearing event happens to set, and so the run-out
// is a handful of ticks rather than a banner held still for three seconds. The
// countdown is read one tick in, and the hand-back on the tick that reaches
// zero; that the interstitial the CLEARING EVENT starts runs 180 ticks is
// `waves/interstitial-runs-180`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  openHarness,
  poseInterstitial,
  type Harness,
} from "../harness";

/** A short interstitial, deliberately not the 180 the clearing event sets. */
const POSED_TICKS = 12;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads the posed timer back and runs the interstitial out from it", async () => {
  const entered = poseInterstitial(h, POSED_TICKS);
  assertEqual(entered.screen, "waveclear", "the interstitial, entered");
  assertEqual(
    entered.interstitialTicks,
    POSED_TICKS,
    "the timer after the pose",
  );

  const after = await captureReplay(h, "posed-timer", async () => {
    const oneIn = await h.tick(1);
    assertEqual(
      oneIn.interstitialTicks,
      POSED_TICKS - 1,
      "the timer one tick into the interstitial",
    );
    return h.tick(POSED_TICKS - 1);
  });

  assertEqual(after.screen, "playing", "the screen the posed timer ran out to");
  assertEqual(after.interstitialTicks, 0, "the timer at the hand-back");
});
