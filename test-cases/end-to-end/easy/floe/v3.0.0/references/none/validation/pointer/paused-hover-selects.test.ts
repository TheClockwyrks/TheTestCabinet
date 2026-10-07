// Floe — pointer/paused-hover-selects:
// a pointer moved onto an item's region selects that item, on the pause menu.
//
// `specs/ui.md` drives ALL FOUR of this game's menus with a pointer — "All four
// menus are driven this way: `TITLE_ITEMS` on `title`, `PAUSE_ITEMS` on
// `paused`, and `ENDING_ITEMS` on `victory` and on `gameover`" — so a build that
// answers the mouse on the title screen alone has honoured one of four. This
// point is the second menu, read for the first of the pointer's three effects.
//
// THE TITLE'S OWN COPY IS `pointer/hover-selects`. The two fail independently:
// the pause menu is drawn over a live crossing and reached from a different
// screen, so a build that hit-tests the title's regions and not the pause menu's
// is caught here rather than there.
//
// THE REGION IS THE BUILD'S OWN. "Each menu item occupies a rectangular hit
// region the build lays out", and `menuItemRect(index)`
// (`specs/instrumentation.md`) answers where it put it, for the menu the CURRENT
// screen shows — which on `paused` is `PAUSE_ITEMS`. Every layout passes.
//
// WHAT IS NOT GRADED HERE. That the pause menu opens at all is
// `screens.pause-menu`; that a crossing under it is held still is
// `screens.pause-freezes`. This point is the pointer's own effect on this menu.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  menuRect,
  mouseGlide,
  rectCenter,
  startCrossing,
  type Harness,
} from "../harness";

/** The entry the pose highlights: `RESUME`, the first of the three. */
const RESUME_ITEM = 0;

/** The entry the gesture aims at: `RESTART`, the second. */
const RESTART_ITEM = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("selects the pause-menu item the pointer is moved onto", async () => {
  await startCrossing(h);
  await h.debug.setScreen("paused");
  await h.debug.setMenuIndex(RESUME_ITEM);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "paused", "the pose opened the pause menu");
  assertEqual(
    posed.menuIndex,
    RESUME_ITEM,
    `the pose highlighted ${PAUSE_ITEMS[RESUME_ITEM]}, the first of the three`,
  );

  const target = rectCenter(await menuRect(h, RESTART_ITEM));
  await mouseGlide(h, target.x, target.y);
  await captureStill(h, "menu");

  const after = await h.snapshot();
  assertEqual(
    after.menuIndex,
    RESTART_ITEM,
    `moving the pointer onto ${PAUSE_ITEMS[RESTART_ITEM]}'s region selects it ` +
      "(specs/ui.md)",
  );
  assertEqual(
    after.screen,
    "paused",
    "and selects it rather than confirming it: a move confirms nothing",
  );
});
