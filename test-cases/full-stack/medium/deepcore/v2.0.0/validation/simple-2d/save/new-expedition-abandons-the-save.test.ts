// save/new-expedition-abandons-the-save — starting a new expedition throws the
// old save away.
//
// specs/expedition.md: "There is one save slot, and saving overwrites it. Starting
// a new expedition abandons any existing save." So the save and the new
// expedition never coexist: once the size choice begins a run, `hasSave` is
// false and the title carries no `CONTINUE` back into the abandoned one.
//
// THE NEW EXPEDITION IS STARTED THE WAY A PLAYER STARTS ONE, because that is what
// the requirement is about and there is no operation for it: `NEW EXPEDITION` on
// the title, a mode, then a size, which specs/ui.md says begins the expedition at
// once. The title's items shift with the save — `CONTINUE` leads while one
// exists — so the highlight is put on `NEW EXPEDITION` by index rather than by
// counting presses from a menu whose length is what this check is about.
//
// ISOLATION. One expedition on an empty mine with the slot cleared first, so the
// save that is abandoned is the one this check banked.

import { afterEach, beforeEach, it } from "vitest";
import {
  MODE_ITEMS,
  SIZE_ITEMS,
  TITLE_ITEMS,
  TITLE_ITEMS_NO_SAVE,
} from "../constants";
import { assertEqual } from "../assert";
import {
  ACTION_KEY,
  captureStill,
  createHarness,
  drewText,
  type Harness,
} from "../harness";
import { bankSave, menuLength, openAtCamp } from "./expedition";

/** Where each choice sits on its own menu, as specs/ui.md lists them. */
const NEW_EXPEDITION = TITLE_ITEMS.indexOf("NEW EXPEDITION");
const STANDARD_MODE = MODE_ITEMS.indexOf("STANDARD");
const STANDARD_SIZE = SIZE_ITEMS.indexOf("STANDARD");

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ storage: true });
});

afterEach(() => {
  h?.dispose();
});

it("leaves no save behind once a new expedition has begun", async () => {
  await openAtCamp(h);
  bankSave(h);

  h.debug.setScreen("title");
  h.debug.setMenuIndex(NEW_EXPEDITION);
  await h.tap(ACTION_KEY.activate);
  assertEqual(
    h.snapshot().screen,
    "mode-select",
    "specs/ui.md: NEW EXPEDITION goes to mode-select",
  );

  h.debug.setMenuIndex(STANDARD_MODE);
  await h.tap(ACTION_KEY.activate);
  h.debug.setMenuIndex(STANDARD_SIZE);
  await h.tap(ACTION_KEY.activate);

  const started = h.snapshot();
  captureStill(h, "abandon");
  assertEqual(
    started.screen,
    "in-mine",
    "specs/ui.md: choosing a size begins the expedition",
  );
  assertEqual(
    started.hasSave,
    false,
    "specs/expedition.md: starting a new expedition abandons any existing save",
  );

  h.debug.setScreen("title");
  const calls = await h.frameCalls();
  assertEqual(
    await menuLength(h),
    TITLE_ITEMS_NO_SAVE.length,
    "specs/ui.md: the title carries no CONTINUE once the save is abandoned",
  );
  assertEqual(
    drewText(calls, TITLE_ITEMS[0]),
    false,
    "specs/ui.md: CONTINUE is absent while no save exists",
  );
});
