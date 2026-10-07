// screens/title-menu-items — the title menu carries its stated items and nothing
// else, and each index takes the entry beside it.
//
// specs/ui.md fixes `TITLE_ITEMS` as `CONTINUE` (present only while a save
// exists, and first when present), `NEW EXPEDITION` and `HOW TO PLAY`, and fixes
// where each one goes: `CONTINUE` resumes the save into `in-mine`,
// `NEW EXPEDITION` goes to `mode-select`, `HOW TO PLAY` goes to `how-to-play`.
//
// SO THE MENU IS READ BY WHAT ITS INDICES DO. Its length comes from stepping the
// highlight down until it wraps, which specs/controls.md fixes as what `down`
// does on a menu screen; each index is then confirmed and the screen it reached
// is read. That is a stronger reading than the copy alone, because it catches a
// menu that draws the right words against the wrong actions, and it is what
// "and nothing else" means: a fourth entry would have to go somewhere.
//
// ISOLATION. One expedition, read twice — once with the slot cleared and once
// with a save banked at the camp through the control that stands for the Save Pad
// — because the menu specs/ui.md fixes is two menus, and both are its subject.
// The harness is given a save slot, since Node has none and the second half of
// the requirement is about a save existing.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  ACTION_KEY,
  captureStill,
  createHarness,
  type Harness,
  type Screen,
} from "../harness";
import { bankSave, menuLength, openAtCamp } from "./expedition";

/** The main menu with no save banked: `TITLE_ITEMS` without its first entry. */
const ITEMS_NO_SAVE = TITLE_ITEMS.slice(1);

/** Where each title entry leads, as specs/ui.md fixes it. */
const DESTINATION: Readonly<Record<string, Screen>> = {
  CONTINUE: "in-mine",
  "NEW EXPEDITION": "mode-select",
  "HOW TO PLAY": "how-to-play",
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ storage: true });
});

afterEach(() => {
  h?.dispose();
});

/** Confirm the entry at `index` from the title, and report where it went. */
async function takeIndex(index: number): Promise<Screen> {
  h.debug.setScreen("title");
  h.debug.setMenuIndex(index);
  await h.tap(ACTION_KEY.activate);
  return h.snapshot().screen;
}

it("carries NEW EXPEDITION and HOW TO PLAY, led by CONTINUE while a save exists", async () => {
  await openAtCamp(h);

  h.debug.setScreen("title");
  assertEqual(
    await menuLength(h),
    ITEMS_NO_SAVE.length,
    "specs/ui.md: the title menu has two entries with no save",
  );
  for (const [index, item] of ITEMS_NO_SAVE.entries()) {
    assertEqual(
      await takeIndex(index),
      DESTINATION[item],
      `specs/ui.md: index ${index} of the title menu is ${item}`,
    );
  }

  h.debug.setScreen("in-mine");
  bankSave(h);
  h.debug.setScreen("title");
  captureStill(h, "items");
  assertEqual(
    await menuLength(h),
    TITLE_ITEMS.length,
    "specs/ui.md: the title menu has three entries while a save exists",
  );
  for (const [index, item] of TITLE_ITEMS.entries()) {
    assertEqual(
      await takeIndex(index),
      DESTINATION[item],
      `specs/ui.md: index ${index} of the title menu is ${item} while a save exists`,
    );
  }
});
