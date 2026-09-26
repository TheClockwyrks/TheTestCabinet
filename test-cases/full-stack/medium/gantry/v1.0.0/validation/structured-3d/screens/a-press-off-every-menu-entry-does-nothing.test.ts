// screens/a-press-off-every-menu-entry-does-nothing — a press that lands inside
// no entry's region selects nothing and takes nothing.
//
// specs/ui.md § The screens: "A pointer over no entry's region leaves the
// highlight where it is, and a press and release there take nothing." That is
// the edge the rest of the menu-pointer rules imply and none of them decides: a
// build that treated the whole menu screen as one button, or that snapped the
// highlight to the nearest entry, satisfies every other pointer point and fails
// this one.
//
// THE POINT PRESSED IS FOUND FROM THE BUILD'S OWN REGIONS. Where a build draws
// its title menu is the build's, so this walks a grid over the stage and takes
// the first point every region `menuItemRect` reports misses. A build that laid
// its menu out anywhere at all is pressed somewhere it did not put an entry.
//
// THE HIGHLIGHT IS POSED OFF ZERO first, so a build that reset it under any
// press reads `0` here and fails, and the screen is read as well, because the
// other way to fail is to take the highlighted entry on a press that hit
// nothing.
//
// The gesture is a click and never an orbit drag: the pointer does not move
// between the down and the up, so it never reaches `CLICK_SLOP`
// (specs/controls.md).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import { createHarness, offEveryMenuItem, type Harness } from "../harness";

/** `HOW TO PLAY`: a highlight away from `0`, so a reset to `0` is visible. */
const POSED = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the highlight and the screen alone under a press off every entry", async () => {
  await h.debug.setScreen("title");
  await h.debug.setMenuIndex(POSED);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "title", "the menu screen the press lands on");
  assertEqual(posed.menuIndex, POSED, "the highlight the press must not move");

  const away = await offEveryMenuItem(h, TITLE_ITEMS.length);
  await h.click(away.x, away.y);
  const after = await h.snapshot();

  await h.capture("state", "the title menu a press off every entry left alone");

  assertEqual(
    after.menuIndex,
    POSED,
    `the highlight after a press at (${away.x}, ${away.y}), which lies inside ` +
      "no entry's region (specs/ui.md)",
  );
  assertEqual(
    after.screen,
    "title",
    "the screen still showing: a press that hit no entry takes none " +
      "(specs/ui.md)",
  );
});
