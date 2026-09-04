// audio/bed-loops-on-howto — the bed keeps looping on the how-to screen.
//
// THE RULE. "`music` is looping on every frame the game runs, on `title`,
// `howto`, `select`, and `editor` alike, in every sim status" (`specs/ui.md`,
// Audio), which the cue table states as "Loops from the first frame, on every
// screen". The how-to is one of the four screens `specs/ui.md` names, and
// `specs/ui.md`'s own table of what advances there is "Nothing" — so a build that
// only sounds the bed where something is moving is exactly what this reads for.
//
// THE WORLD. The title screen, the audio unlocked, and the bed given the frames
// it takes to come up; then `setScreen("howto")`, which "Shows the how-to,
// `howtoPage` at `0`" and "Enters the screen exactly as the real transition into
// it enters it" (`specs/instrumentation.md`). Nothing is placed and no run is
// live, so the bed is the only thing on this screen that can make a sound, which
// is what makes the reading below the bed's rather than some other cue's.
//
// THE VERDICT. Over every frame of the how-to the build is running the bed: a
// looping source is live on each of them, or — on a build that re-schedules its
// buffer end to end instead of setting the loop flag, which `specs/ui.md` leaves
// open — the build sounded within the window. The screen never left `howto`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  openHowto,
  openTitle,
  type Harness,
} from "../harness";
import { screensOf, watchBed } from "./bed";
import { openSilence } from "./silence";

/** Frames the how-to is read over. */
const FRAMES = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the bed running on every frame of the how-to screen", async () => {
  await openTitle(h);
  await openSilence(h);

  await openHowto(h);
  const entered = await h.snapshot();
  assertEqual(
    entered.screen,
    "howto",
    "the world this point reads is the how-to screen",
  );
  assertNull(
    entered.sim,
    "no run is live on the how-to, so the bed is the only thing that can sound",
  );

  const window = await watchBed(h, FRAMES);

  await captureStill(h, "howto");

  assertDeepEqual(
    window.stopped,
    [],
    "the bed is looping on every frame of the howto screen",
  );
  assertDeepEqual(
    screensOf(window),
    ["howto"],
    "and every frame it was read on was a frame of the how-to",
  );
});
