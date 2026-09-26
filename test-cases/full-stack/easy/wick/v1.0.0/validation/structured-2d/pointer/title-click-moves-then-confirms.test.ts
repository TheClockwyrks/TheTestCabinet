// Wick — pointer/title-click-moves-then-confirms: a click takes the item it
// landed in, not the one the highlight was on.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, The pointer,
// rule 2, Click: "A primary press edge inside the rectangle of the item at
// `menuIndex` `i` sets `menuIndex` to `i`, playing `menu-move` if that changed
// it, and then takes that item exactly as `confirm` on it does."
// `specs/ui.md`, "`title`", lists `TITLE_ITEMS` as `LIGHT THE LAMP`,
// `THE ALMANAC`, `HOW TO PLAY` "in that order", puts `menuIndex` at `0` on
// arriving, and gives `HOW TO PLAY`: "Sets `screen = howto` and
// `menuIndex = 0`." The third item is therefore `menuIndex` `2`, two items away
// from the highlight the screen opens on.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `screen` after the clicking
// frame. A build that clicks by confirming whatever the highlight already sat
// on lights the lamp instead and reads `playing`; a build that moves the
// highlight and stops there stays on `title`. Only the build that moves and
// then takes reads `howto`. `menuIndex` is read as well, at the `0` the arrival
// at `howto` sets.
//
// THE DRIVE. `reset` to the title screen, the third item's rectangle read off
// `menuRects`, and a primary press and release in its middle before the frame
// that reads the edge. The point is the build's own; the specification fixes no
// layout, so nothing here names a stage coordinate.
//
// THE TOLERANCE. None: a screen name and an index.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  clickRect,
  createHarness,
  menuRects,
  type Harness,
} from "../harness";

/** The index of HOW TO PLAY, the third item of TITLE_ITEMS (specs/ui.md). */
const HOW_TO_PLAY = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("enters howto when a click lands in HOW TO PLAY from menuIndex 0", async () => {
  h.reset();
  const before = h.snapshot();
  assertEqual(before.screen, "title", "the screen the click is made on");
  assertEqual(before.menuIndex, 0, "the highlighted item before the click");

  const rects = menuRects(h);
  assertLength(
    rects,
    TITLE_ITEMS.length,
    "the title menu's rectangles, one per item (specs/controls.md, The pointer)",
  );

  const after = await clickRect(h, rects[HOW_TO_PLAY]);
  captureStill(h, "clicked");

  assertEqual(
    after.screen,
    "howto",
    "the screen after a click on HOW TO PLAY (specs/controls.md, Click)",
  );
  assertEqual(after.menuIndex, 0, "menuIndex on arriving at howto");
});
