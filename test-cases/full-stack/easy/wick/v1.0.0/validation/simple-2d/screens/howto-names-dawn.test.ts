// screens/howto-names-dawn — the how-to screen names dawn at 10:00.
//
// WHAT THIS DECIDES. One thing: the how-to frame carries the clock reading the
// night ends at, so a player knows what winning is before they play.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`howto`): the screen covers "that the night ends at dawn,
//   `10:00` on the clock, and that reaching it is the win".
//   specs/world.md ("Fallen and dawn"): "`DAWN_TIME` (`600`) seconds is the
//   length of the night", and specs/ui.md draws a clock as "`m:ss` ... the
//   seconds always two digits", so `600` seconds reads `10:00`, which
//   `clockText(DAWN_TICK)` spells.
//
// THE DRIVE. The how-to screen through `setScreen("howto")`, which enters it
// "exactly as confirming `HOW TO PLAY` does" (specs/instrumentation.md), and
// one frame.
//
// THE TOLERANCE. The reading is the clock's own spelling, matched as a whole
// token of the frame's text through `hasToken`, so a build that writes it
// inside a sentence passes and one that writes another figure, or this one
// inside a longer figure, fails.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DAWN_TICK, clockText } from "../constants";
import {
  captureStill,
  createHarness,
  hasToken,
  poseScene,
  textReadings,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("names the clock the night ends at", async () => {
  const posed = poseScene(h, "howto");
  assertEqual(posed.screen, "howto", "the screen the frame is read from");

  const { calls } = await h.frameDraw();
  captureStill(h, "dawn");

  assertEqual(
    hasToken(textReadings(calls), clockText(DAWN_TICK)),
    true,
    `the how-to frame draws ${clockText(DAWN_TICK)}, the clock the night ends at`,
  );
});
