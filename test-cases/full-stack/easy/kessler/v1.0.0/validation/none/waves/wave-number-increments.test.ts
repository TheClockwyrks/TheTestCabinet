// waves/wave-number-increments — when the interstitial ends the wave number
// rises by one.
//
// specs/rings.md: "When it ends, ... the wave number rises by one". The
// interstitial itself still belongs to the cleared wave — specs/screens.md
// has it "announcing the cleared wave" — so the counter is read holding still
// through tick 179 and risen after tick 180. The session is posed to wave 3
// first, so the reading is a rise by one rather than a hardcoded 2.
//
// THE WORLD IS THE INTERSTITIAL AT A POSED WAVE: a fresh session, its wave
// posed to 3, entered into waveclear "for the wave the counter holds"
// (specs/instrumentation.md) and run out.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { WAVECLEAR_TICKS } from "../constants";
import { captureStill, openHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises the wave counter by one when the interstitial ends", async () => {
  await h.reset();
  await h.debug.setScreen("playing");
  await h.debug.setWave(3);
  await h.debug.setScreen("waveclear");

  const during = await h.tick(WAVECLEAR_TICKS - 1);
  assertEqual(during.screen, "waveclear", "the screen after 179 ticks");
  assertEqual(during.wave, 3, "the interstitial's wave is the cleared one");

  const after = await h.tick(1);
  await captureStill(h, "next-wave");

  assertEqual(after.screen, "playing", "the interstitial ran out");
  assertEqual(after.wave, 4, "the wave number rose by one");
});
