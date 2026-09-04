// visibility/text-legible-waveclear — every run of text the waveclear screen
// adds contrasts with what sits behind it.
//
// `specs/screens.md`: "Every piece of text a screen shows is legible against
// whatever sits behind it at the logical stage size of `1000 x 1000`", and the
// `waveclear` screen shows "a banner announcing the cleared wave ... over the
// field". Each of the six screens is its own point. How a run is found, how its
// contrast is read, and why an overlay screen is read on the runs it ADDS is
// `legible.ts`.
//
// THE INTERSTITIAL IS POSED THE WAY THE CLEARING EVENT ENTERS IT, through the
// harness's own sequence of atomic poses, so the banner is read over the screen
// as a cleared wave leaves it.

import { afterEach, beforeEach, it } from "vitest";
import {
  isolate,
  openHarness,
  poseInterstitial,
  type Harness,
} from "../harness";
import { assertOverlayTextLegible } from "./legible";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the waveclear banner's text legibly", async () => {
  isolate(h);
  await assertOverlayTextLegible(h, "waveclear", "waveclear", () =>
    poseInterstitial(h),
  );
});
