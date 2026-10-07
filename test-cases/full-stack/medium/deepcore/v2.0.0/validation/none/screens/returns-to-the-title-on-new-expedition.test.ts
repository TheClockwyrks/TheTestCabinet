// screens/returns-to-the-title-on-new-expedition — BACK out of the mode choice
// leaves the title on NEW EXPEDITION.
//
// `specs/ui.md`, "Returning to a menu": `title` arrived at from `mode-select`, by
// `BACK` or `pause`, selects `NEW EXPEDITION` — the entry that opened the mode
// choice in the first place. A player who changes their mind about starting an
// expedition comes back to the entry they were on rather than to the top.
//
// THE ENTRY IS NAMED, NOT NUMBERED, because `CONTINUE` shifts the list when a
// save exists. The slot is cleared, so the index read is where `NEW EXPEDITION`
// sits in `TITLE_ITEMS_NO_SAVE`.
//
// ONE ARRIVAL PER POINT. `screens/returns-to-the-title-on-how-to-play` and
// `screens/quits-to-the-title-on-new-expedition` decide the other two arrivals at
// the title. THAT `BACK` reaches the title, and that it starts nothing, is
// `screens/mode-select-back`'s point.
//
// ISOLATION. The mode choice posed directly through the surface, so a build with
// a broken title menu fails its own points rather than this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MODE_ITEMS, TITLE_ITEMS_NO_SAVE } from "../constants";
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

it("highlights NEW EXPEDITION on the title left from the mode choice", async () => {
  await h.debug.setAutoStep(false);
  await h.debug.clearSave();
  await h.debug.reset();
  await h.debug.setScreen("mode-select");
  await h.debug.setMenuIndex(MODE_ITEMS.indexOf("BACK"));

  await h.tap(ACTION_KEY.activate);
  await captureStill(h, "selected");

  const back = await h.snapshot();
  assertEqual(back.screen, "title", "specs/ui.md: BACK returns to the title");
  assertEqual(
    back.menuIndex,
    TITLE_ITEMS_NO_SAVE.indexOf("NEW EXPEDITION"),
    "specs/ui.md: the title arrived at from mode-select selects NEW EXPEDITION",
  );
});
