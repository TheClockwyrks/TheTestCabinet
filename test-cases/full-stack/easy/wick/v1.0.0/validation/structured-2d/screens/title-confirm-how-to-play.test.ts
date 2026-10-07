// Wick — screens/title-confirm-how-to-play: confirming the third title item
// opens the how-to screen.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`title`": the item
// `HOW TO PLAY` "Sets `screen = howto` and `menuIndex = 0`", and `TITLE_ITEMS`
// lists `LIGHT THE LAMP`, `THE ALMANAC`, `HOW TO PLAY`, "in that order", so it
// is the third of them. `specs/controls.md` binds `confirm` to `Enter` and
// `Space` and reads it as a press edge on `title`.
//
// THE DRIVE. `reset` to the title screen, one `ArrowDown` edge per item above
// `HOW TO PLAY` to stand on it, read back as the precondition, then the `Enter`
// this point is about. The debug surface carries no operation that poses
// `menuIndex` (`specs/instrumentation.md`), so the menu's own `down` is the
// only way onto the item; its correctness is
// `screens/title-down-moves-highlight`'s point.
//
// THE TOLERANCE. None: a screen name and an index.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, tap, type Harness } from "../harness";

/** The index of HOW TO PLAY in TITLE_ITEMS (specs/ui.md, title). */
const HOW_TO_PLAY = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("enters howto with menuIndex 0 when Enter takes HOW TO PLAY", async () => {
  h.reset();
  let posed = h.snapshot();
  for (let press = 0; press < HOW_TO_PLAY; press += 1) {
    posed = await tap(h, "ArrowDown");
  }
  assertEqual(posed.screen, "title", "the screen the press is made on");
  assertEqual(
    posed.menuIndex,
    HOW_TO_PLAY,
    "the highlighted item, HOW TO PLAY",
  );

  const after = await tap(h, "Enter");
  captureStill(h, "howto");

  assertEqual(after.screen, "howto", "the screen after confirming HOW TO PLAY");
  assertEqual(after.menuIndex, 0, "menuIndex on arriving at howto");
});
