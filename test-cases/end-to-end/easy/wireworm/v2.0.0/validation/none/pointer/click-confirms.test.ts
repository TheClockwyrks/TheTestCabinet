// Wireworm — pointer/click-confirms: a press and a release inside one item
// confirms it.
//
// specs/ui.md, "Pointer and touch on the menus": a pointer pressed and released
// inside one item's region makes `menuIndex` that item's index AND confirms it,
// with the effect this file's table for that screen gives `confirm`. On the
// title, `HOW TO PLAY` moves the game to `howto` — so the screen the click
// leaves is the whole reading, and it is one the pointer alone can produce.
//
// THE SELECTION IS POSED ON A DIFFERENT ITEM. The title is posed with the
// highlight on `DESCEND` and the click lands on `HOW TO PLAY`, so a build that
// confirmed its standing selection rather than the item under the pointer opens
// a run and fails here instead of passing because it confirmed something.
//
// Both edges fall inside the one region `menuItemRect` reports
// (specs/instrumentation.md), which is what specs/ui.md requires of a confirm.
// Nothing here knows a menu coordinate.
//
// What the how-to screen SHOWS is `screens/howto-copy`'s point, and the route
// the keyboard takes to it is `screens/title-howto`'s; what is read here is that
// the pointer confirmed at all, and confirmed the item it was on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  clickItem,
  createHarness,
  type Harness,
} from "../harness";

/** The title's entries, by index (specs/ui.md, `TITLE_ITEMS`). */
const DESCEND = TITLE_ITEMS.indexOf("DESCEND");
const HOWTO = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("confirms the item a click presses and releases inside", async () => {
  await h.debug.reset();
  await h.debug.setMenuIndex(DESCEND);
  const posed = await h.snapshot();
  assertEqual(posed.screen, "title", "reset leaves the game on the title");
  assertEqual(posed.menuIndex, DESCEND, "the posed title highlight");

  await clickItem(h, HOWTO);
  await captureStill(h, "howto");

  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    "the screen a click inside HOW TO PLAY's region confirms to " +
      "(specs/ui.md)",
  );
});
