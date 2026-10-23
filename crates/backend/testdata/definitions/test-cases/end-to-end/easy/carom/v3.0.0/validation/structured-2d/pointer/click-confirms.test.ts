// Carom — pointer/click-confirms: a press and a release inside one item confirms
// it.
//
// specs/ui.md, "Pointer and touch": a pointer pressed and released inside one
// item's region makes `menuIndex` that item's index AND confirms it, and the
// effect is the one the keyboard table gives `confirm` on that screen. On the
// title, `HOW TO PLAY`'s confirm sets `screen = howto` — so the screen the click
// leaves is the whole reading, and it is one the pointer alone can produce.
//
// THE SELECTION IS POSED ON A DIFFERENT ITEM. `openTitle` settles the reset, then
// the highlight is put on `SOLO` and the click lands on `HOW TO PLAY`: a build
// that confirmed its standing selection rather than the item under the pointer
// opens a Solo countdown and fails here, instead of passing because it confirmed
// something.
//
// Both edges fall inside the one region `menuItemRect` reports
// (specs/instrumentation.md), which is what specs/ui.md requires of a confirm, and
// they arrive on one frame — which specs/ui.md explicitly allows, and which is the
// ordinary shape of a click. Nothing here knows a menu coordinate.
//
// What the how-to screen SHOWS is `ui/state-howto`'s point; what is read here is
// that the pointer confirmed at all, and confirmed the item it was on.
//
// Nothing on the field is posed or removed: specs/ui.md advances nothing on the
// title and nothing on the how-to screen. The still is the frame the click left.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  clickMenuItem,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

/** The title's entries, by index (specs/ui.md, `TITLE_ITEMS`). */
const SOLO = TITLE_ITEMS.indexOf("SOLO");
const HOWTO = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("confirms the item a click presses and releases inside", async () => {
  await openTitle(h);
  h.debug.setMenuIndex(SOLO);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title");
  assertEqual(posed.menuIndex, SOLO);

  await clickMenuItem(h, HOWTO);
  captureStill(h, "howto");

  assertEqual(h.snapshot().screen, "howto");
});
