// Wick — screens/title-confirm-how-to-play: confirming the second title item
// opens the how-to screen.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`title`": the item
// `HOW TO PLAY` "Sets `screen = howto` and `menuIndex = 0`", and `TITLE_ITEMS`
// lists it second. `specs/controls.md` binds `confirm` to `Enter` and `Space`
// and reads it as a press edge on `title`.
//
// THE DRIVE. `reset` to the title screen, one `ArrowDown` onto the second
// item, read back as the precondition, then the `Enter` this point is about.
// The debug surface carries no operation that poses `menuIndex`
// (`specs/instrumentation.md`), so the menu's own `down` is the only way onto
// the item; its correctness is `screens/title-down-moves-highlight`'s point.
//
// THE TOLERANCE. None: a screen name and an index.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, tap, type Harness } from "../harness";

/** The index of HOW TO PLAY in TITLE_ITEMS (specs/ui.md). */
const HOW_TO_PLAY = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("enters howto with menuIndex 0 when Enter takes HOW TO PLAY", async () => {
  h.reset();
  const posed = await tap(h, "ArrowDown");
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
