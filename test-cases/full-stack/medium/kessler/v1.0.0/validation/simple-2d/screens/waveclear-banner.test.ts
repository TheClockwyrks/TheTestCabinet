// screens/waveclear-banner — the interstitial draws its banner.
//
// specs/screens.md, on `waveclear`: "A banner announcing the cleared wave,
// shown over the field for `180` ticks." The banner's copy is the build's to
// write, so announcing the cleared wave is read as the frame drawing text that
// speaks of the wave or of the clear.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertMatches } from "../assert";
import {
  captureStill,
  drawnText,
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

it("draws a banner announcing the cleared wave", async () => {
  const posed = poseScene(h, "waveclear");
  assertEqual(posed.screen, "waveclear", "the screen the banner is read from");

  const { calls } = await h.frameDraw();
  captureStill(h, "banner");

  const text = drawnText(calls).join(" ").toLowerCase();
  assertMatches(
    text,
    /wave|clear/,
    "banner text announcing the cleared wave on the waveclear frame",
  );
});
