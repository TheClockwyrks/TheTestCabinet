// screens/quit-returns-to-the-title — QUIT TO MENU leaves the game for the title.
//
// THE RULE. `specs/ui.md` gives the pause menu's third entry, `PAUSE_ITEMS[2]`
// (`QUIT TO MENU`), one job: "returns to `title`". `specs/instrumentation.md`
// reports which of the five screens is showing as `screen`, so the reading is that
// field after the entry is taken.
//
// WHY THE THIRD ENTRY IS WORTH ITS OWN ITEM. The three pause entries lead to three
// different places, and only the index separates them. Posing the highlight on the
// third is what catches a build whose confirm ignores the highlight — that build
// resumes or restarts instead, landing on `playing` rather than `title`, and the
// failure names the screen it reached.
//
// THE ENTRY IS ADDRESSED BY ITS INDEX. `specs/ui.md` fixes the ORDER of the pause
// entries but says nothing about which one a pause menu OPENS on, so the highlight
// is posed with `setMenuIndex` rather than driven there with a count of key
// presses; the entry's own copy is asserted first, so a build that reordered its
// menu fails naming what it put third rather than being graded against the wrong
// entry. The confirm itself is a real press of a key `specs/controls.md` binds.
//
// WHAT THIS ITEM DOES NOT DECIDE. The title screen's own contents, which are
// `screens/title-shows-the-title` and `screens/title-menu-entries`, nor the order
// the pause entries are drawn in, which is `screens/pause-menu-entries`.
// `specs/ui.md` also puts the title's highlight back on its first entry after the
// return; the manifest's item is the screen alone, so that is left ungraded here
// rather than folded into this grade.

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  keyFor,
  startPlaying,
  type Harness,
} from "../harness";

/** The entry `specs/ui.md` fixes as the pause menu's third: the one taken here. */
const QUIT = 2;

/** A run that is plainly under way, so quitting it is a real departure. */
const POSED_SCORE = 4260;
const POSED_WAVE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title when QUIT TO MENU is confirmed", async () => {
  assertEqual(
    PAUSE_ITEMS[QUIT],
    "QUIT TO MENU",
    "the third entry of the pause menu specs/ui.md fixes",
  );

  startPlaying(h);
  h.debug.setScore(POSED_SCORE);
  h.debug.setWave(POSED_WAVE);
  h.debug.setScreen("paused");
  h.debug.setMenuIndex(QUIT);

  const stood = h.snapshot();
  assertEqual(stood.screen, "paused", "the screen the entry was taken from");
  assertEqual(stood.menuIndex, QUIT, "the entry the highlight was posed on");

  await h.tap(keyFor("confirm"));
  captureStill(h, "title");

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen confirming QUIT TO MENU returns to (specs/ui.md)",
  );
});
