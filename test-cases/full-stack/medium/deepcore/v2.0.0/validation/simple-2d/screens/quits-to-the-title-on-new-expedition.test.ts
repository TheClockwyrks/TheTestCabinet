// screens/quits-to-the-title-on-new-expedition — quitting an expedition leaves the
// title on NEW EXPEDITION.
//
// `specs/ui.md`, "Returning to a menu": `title` arrived at from `paused` by
// `QUIT TO MENU`, or from `victory` or `game-over` by `MENU`, selects
// `NEW EXPEDITION`. A player who has just abandoned a dig is one key from starting
// the next one.
//
// THE ENTRY IS NAMED, NOT NUMBERED, because `CONTINUE` shifts the list when a
// save exists. The slot is cleared before the quit, so the index read is where
// `NEW EXPEDITION` sits in `TITLE_ITEMS_NO_SAVE`.
//
// ONE ARRIVAL PER POINT. The two arrivals from the mode choice and from the
// how-to screen are `screens/returns-to-the-title-on-new-expedition` and
// `screens/returns-to-the-title-on-how-to-play`. THAT `QUIT TO MENU` reaches the
// title, and that it ends the expedition, is `screens/pause-quit`'s point.
//
// ISOLATION. The pause menu posed directly through the surface, so nothing about
// the title menu, the mine, or the pause key is on the way in.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS, TITLE_ITEMS_NO_SAVE } from "../constants";
import {
  ACTION_KEY,
  captureStill,
  createHarness,
  openScene,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("highlights NEW EXPEDITION on the title quit to from the pause menu", async () => {
  openScene(h);
  h.debug.clearSave();
  h.debug.setScreen("paused");
  h.debug.setMenuIndex(PAUSE_ITEMS.indexOf("QUIT TO MENU"));

  await h.tap(ACTION_KEY.activate);
  captureStill(h, "selected");

  const quit = h.snapshot();
  assertEqual(
    quit.screen,
    "title",
    "specs/ui.md: QUIT TO MENU returns to the title",
  );
  assertEqual(
    quit.menuIndex,
    TITLE_ITEMS_NO_SAVE.indexOf("NEW EXPEDITION"),
    "specs/ui.md: the title arrived at from paused selects NEW EXPEDITION",
  );
});
