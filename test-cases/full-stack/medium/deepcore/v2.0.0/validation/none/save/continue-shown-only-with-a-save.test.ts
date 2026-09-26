// save/continue-shown-only-with-a-save — the title carries CONTINUE only while a
// save exists, and carries it first.
//
// specs/ui.md fixes `TITLE_ITEMS` as `CONTINUE` (present only while a save
// exists, and first when present), `NEW EXPEDITION` and `HOW TO PLAY`. So the
// menu has two items with the slot empty and three with it filled, the extra one
// leads, and it is the one that resumes the save into `in-mine`.
//
// HOW THE MENU IS READ. Two ways, and they answer different halves. Its LENGTH is
// read by stepping the highlight down until it wraps, which specs/controls.md
// fixes as what `down` does on a menu screen. Its COPY is read off the frame the
// build drew, matched by substring because a menu entry is commonly drawn with a
// selection marker beside it. That the extra entry LEADS is read by confirming
// index 0 and seeing the save resume, which is what `CONTINUE` does and what no
// other title entry does.
//
// ISOLATION. One expedition, read twice: once with the slot cleared and once with
// a save banked through the control that stands for the Save Pad. Nothing else in
// the world, and nothing about the mine is touched between the two readings.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS, TITLE_ITEMS_NO_SAVE } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { drewText } from "../case-harness/index";
import {
  bankSave,
  continueFromTitle,
  menuLength,
  openAtCamp,
} from "./expedition";

const CONTINUE = TITLE_ITEMS[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows CONTINUE first with a save and drops it without one", async () => {
  await openAtCamp(h);

  await h.debug.setScreen("title");
  const bare = await h.frameCalls();
  assertEqual(
    await menuLength(h),
    TITLE_ITEMS_NO_SAVE.length,
    "specs/ui.md: the title menu is NEW EXPEDITION and HOW TO PLAY with no save",
  );
  assertEqual(
    drewText(bare, CONTINUE),
    false,
    "specs/ui.md: CONTINUE is absent while no save exists",
  );
  for (const item of TITLE_ITEMS_NO_SAVE) {
    assertEqual(
      drewText(bare, item),
      true,
      `specs/ui.md: the title menu draws ${item}`,
    );
  }

  await h.debug.setScreen("in-mine");
  await bankSave(h);
  await h.debug.setScreen("title");
  const withSave = await h.frameCalls();
  await captureStill(h, "menu");
  assertEqual(
    await menuLength(h),
    TITLE_ITEMS.length,
    "specs/ui.md: the title menu gains CONTINUE while a save exists",
  );
  for (const item of TITLE_ITEMS) {
    assertEqual(
      drewText(withSave, item),
      true,
      `specs/ui.md: the title menu draws ${item} while a save exists`,
    );
  }

  // The first item is the one that resumes the save, which is what "first when
  // present" means and what no other title entry does.
  await continueFromTitle(h);
  assertEqual(
    (await h.snapshot()).screen,
    "in-mine",
    "specs/ui.md: CONTINUE leads the title menu and resumes the save",
  );
});
