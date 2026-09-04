// Floe — controls/menu-up: the up action moves a menu's highlight up one item.
//
// `specs/controls.md` reads the four movement actions as PRESS EDGES on every
// screen but `playing`, and gives them a second job there: "move the highlight
// one item that way, wrapping at both ends". `specs/ui.md` says which menu each
// screen carries and that `menuIndex` is the highlighted item, counted from `0`.
//
// THE MENU IS THE PAUSE MENU, AND THE START INDEX IS THE MIDDLE ONE. `PAUSE_ITEMS`
// is three items long, so a highlight sitting on the second has an item above it
// and an item below it: up must reach `0` and down would reach `2`. Two things
// follow. The wrap is not exercised at all — it is a rule of its own and belongs
// to the screens the menus are on, not to this point — and a build that read the
// up key as down reads as `2` rather than merely as "not `0`", so the failure
// names which wrong model the build implemented. A build that moved two items,
// or that clamped rather than moved, reads as a third and fourth number.
//
// THE KEY IS A REAL KEY, pressed through Chromium's own input pipeline, so what
// reaches the build is a browser-trusted DOM key event on the real page. Under
// this engine the whole keyboard layer is the build's own —
// `specs/instrumentation.md` puts it in the runtime layer an engineless build
// supplies and gives the surface no keyboard operation at all — so the path from
// a physical key to a moved highlight belongs entirely to the build.
//
// WHAT IS NOT GRADED HERE. Which items the pause menu shows and what confirming
// one does are `screens.pause-menu` and its neighbours; that the pause key opens
// the menu at all is `controls/pause-p`. The screen is posed straight onto
// `paused` through the surface, so none of those paths is on the route and a
// build that broke one of them keeps this point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  startCrossing,
  type Harness,
} from "../harness";

/**
 * The highlight the menu is posed with, and the one the up action must reach.
 *
 * The second of `PAUSE_ITEMS` (`RESTART`), so the move is an ordinary step
 * rather than the wrap `specs/controls.md` states separately, and `0` and `2`
 * are two different failures rather than one.
 */
const POSED_INDEX = 1;
const EXPECTED_INDEX = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the pause menu's highlight from the second item to the first", async () => {
  await startCrossing(h);
  await h.debug.setScreen("paused");
  await h.debug.setMenuIndex(POSED_INDEX);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "paused", "the pose opened the pause menu");
  assertEqual(
    posed.menuIndex,
    POSED_INDEX,
    `the pose highlighted ${PAUSE_ITEMS[POSED_INDEX]}, the second of the three`,
  );

  await h.tap("ArrowUp");
  await captureStill(h, "menu");

  const after = await h.snapshot();
  assertEqual(
    after.menuIndex,
    EXPECTED_INDEX,
    "the up action moves the highlight one item up (specs/controls.md)",
  );
  assertEqual(
    after.screen,
    "paused",
    "and moves the highlight rather than leaving the screen",
  );
});
