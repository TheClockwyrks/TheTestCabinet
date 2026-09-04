// audio/quit-swaps-beds — confirm on QUIT stops the play bed, and the title
// bed resumes on the title screen.
//
// specs/assets.md: "Confirming QUIT stops the play bed and the title bed
// resumes." specs/screens.md, on `paused`: "`confirm` on `QUIT` discards the
// session and returns to `title`."
//
// The pause menu is reached through the surface — a session on `playing`,
// then the pause overlay entered exactly as Escape enters it — because how
// the overlay is opened is the screens category's point. The QUIT entry has
// no direct pose, so the one step down onto it and the confirm are real key
// presses; the highlight is read back before the confirm so it is QUIT, not
// RESUME, that the accept lands on, and the landing screen is read back so
// "resumes on the title screen" is read where the spec puts it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { BINDINGS } from "../constants";
import { BED_PLAY, BED_TITLE } from "./beds";
import {
  advanceTicks,
  captureReplay,
  openHarness,
  tap,
  type Harness,
} from "../harness";

/** The key specs/controls.md binds to `down`. */
const DOWN = BINDINGS.down[0];
/** The key that carries `confirm` alone — `Space` also carries `launch`. */
const CONFIRM = BINDINGS.confirm[1];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("stops the play bed on QUIT and resumes the title bed", async () => {
  h.debug.setScreen("playing");
  await advanceTicks(h, 2);
  h.debug.setScreen("paused");
  const posed = h.snapshot();
  assertEqual(posed.screen, "paused", "the screen the quit is made from");
  assertEqual(posed.menu.index, 0, "the entering highlight, on RESUME");

  await captureReplay(h, "quit", async () => {
    await tap(h, DOWN);
    assertEqual(
      h.snapshot().menu.index,
      1,
      "QUIT highlighted before the confirm",
    );
    await tap(h, CONFIRM);
    await advanceTicks(h, 2);
  });

  assertEqual(h.snapshot().screen, "title", "the screen the quit returned to");
  assertEqual(
    h.looping(BED_PLAY),
    false,
    "the play bed sounding after the quit",
  );
  assertTrue(h.looping(BED_TITLE), "the title bed sounding again on the title");
});
