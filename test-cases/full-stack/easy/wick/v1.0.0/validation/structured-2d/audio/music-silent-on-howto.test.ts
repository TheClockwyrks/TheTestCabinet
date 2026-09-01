// Wick — audio/music-silent-on-howto: no bed loops on the how-to screen.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, The loops: "`music` is
// looping on every frame exactly when `screen` is `playing`, `levelup`,
// `chest`, or `paused` ... `title` and `howto` carry no music." "Exactly
// when" makes the rule two-sided, and `howto` falls on the silent side, so
// the threshold is `false` on every frame of it.
//
// WHY THE WORLD IS POSED AS IT IS. `reset` to the title, then `howto` posed,
// which `specs/instrumentation.md` makes the screen's own real entry:
// "`howto` from any: Enters the how-to screen exactly as confirming
// `HOW TO PLAY` does: the idle run." Posing it keeps the title menu out of an
// audio point, so a build with a broken menu fails the menu points and is
// decided here on its audio alone.
//
// `howto` is driven as well as `title` because the two are separate screens
// with separate entries, and a build that starts the bed on the way into the
// how-to screen has left one of the two the rule names carrying music. The
// screen is then held for `FRAMES` frames with no key pressed, so nothing
// returns to the title.
//
// THE TOLERANCE. None beyond the one frame the specification itself grants
// for the reconciliation, and the reading is a boolean. `FRAMES` (60, one
// second of frames) is a drive length rather than a threshold.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CUES } from "../constants";
import {
  captureReplay,
  createHarness,
  poseScreen,
  type Harness,
} from "../harness";
import { loopTrace } from "./cues";

/** One second of frames on the how-to screen. */
const FRAMES = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("has music not looping on any frame of the how-to screen", async () => {
  h.reset();
  const entered = poseScreen(h, "howto");
  assertEqual(entered.screen, "howto", "the screen the entry left");

  const trace = await captureReplay(h, "silent", () =>
    loopTrace(h, CUES.music, FRAMES),
  );

  assertEqual(
    h.snapshot().screen,
    "howto",
    "the screen the how-to held for the whole span",
  );
  assertEqual(
    trace.filter((looping) => looping).length,
    0,
    `frames of the how-to screen on which music was looping, of ${FRAMES} (specs/ui.md, The loops)`,
  );
});
