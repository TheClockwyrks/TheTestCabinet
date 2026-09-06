// screens/waveclear-banner — the interstitial draws its banner.
//
// specs/screens.md, on `waveclear`: "A banner announcing the cleared wave,
// shown over the field for `180` ticks." The banner's copy is the build's to
// write, so announcing the cleared wave is read as the frame drawing text that
// speaks of the wave or of the clear.
//
// THE INTERSTITIAL IS POSED THE WAY THE CLEARING EVENT ENTERS IT, through the
// harness's own sequence of atomic poses — `setScreen` sets the screen and
// nothing else — so the banner is read over a screen a cleared wave would leave.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertMatches } from "../assert";
import { drawnTextLines } from "../case-harness/text";
import {
  captureStill,
  openHarness,
  poseInterstitial,
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
  const posed = poseInterstitial(h);
  assertEqual(posed.screen, "waveclear", "the screen the banner is read from");

  const { calls } = await h.frameDraw();
  captureStill(h, "banner");

  // Off the logical runs the frame spells, not the raw calls: a banner that
  // is letter-spaced is drawn one glyph per call, and only the coalesced run
  // (`case-harness/text.ts`) reads as the word. Every raw string is a
  // substring of its run, so this can only add a match.
  const text = drawnTextLines(calls).join(" ").toLowerCase();
  assertMatches(
    text,
    /wave|clear/,
    "banner text announcing the cleared wave on the waveclear frame",
  );
});
