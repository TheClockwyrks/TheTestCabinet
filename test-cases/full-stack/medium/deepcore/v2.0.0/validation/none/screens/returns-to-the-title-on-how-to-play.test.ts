// screens/returns-to-the-title-on-how-to-play — the title arrives on HOW TO PLAY.
//
// `specs/ui.md`, "Returning to a menu": "Arriving at a menu by going back selects
// the entry that led away from it", and its table's first row is `title` arrived
// at from `how-to-play`, selecting `HOW TO PLAY`. What that buys a player is a
// menu that does not throw away where they were: opening the how-to screen and
// coming back leaves the cursor on the entry they opened it from.
//
// THE ENTRY IS NAMED, NOT NUMBERED. `specs/ui.md` says why: "`CONTINUE` is
// present on `title` only while a save exists and shifts the ones below it when it
// is". The slot is cleared first, so the menu the title shows is
// `TITLE_ITEMS_NO_SAVE`, and the index this reads is where `HOW TO PLAY` sits in
// that list rather than a number written down here.
//
// ONE ARRIVAL PER POINT. `screens/returns-to-the-title-on-new-expedition` and
// `screens/quits-to-the-title-on-new-expedition` decide the other two arrivals at
// the title, and `screens/returns-to-the-mode-choice-on-the-mode` the arrival at
// the mode choice. THAT the screen changes is `screens/how-to-play-back`'s point;
// this one is only about which entry is highlighted when it does.
//
// ISOLATION. The how-to screen posed directly through the surface on a cleared
// slot, so a build with a broken title menu fails its own points rather than this.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOW_TO_PLAY_ITEMS, TITLE_ITEMS_NO_SAVE } from "../constants";
import {
  ACTION_KEY,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("highlights HOW TO PLAY on the title left from the how-to screen", async () => {
  await h.debug.setAutoStep(false);
  await h.debug.clearSave();
  await h.debug.reset();
  await h.debug.setScreen("how-to-play");
  await h.debug.setMenuIndex(HOW_TO_PLAY_ITEMS.indexOf("BACK"));

  await h.tap(ACTION_KEY.activate);
  await captureStill(h, "selected");

  const back = await h.snapshot();
  assertEqual(back.screen, "title", "specs/ui.md: BACK returns to the title");
  assertEqual(
    back.menuIndex,
    TITLE_ITEMS_NO_SAVE.indexOf("HOW TO PLAY"),
    "specs/ui.md: the title arrived at from how-to-play selects HOW TO PLAY",
  );
});
