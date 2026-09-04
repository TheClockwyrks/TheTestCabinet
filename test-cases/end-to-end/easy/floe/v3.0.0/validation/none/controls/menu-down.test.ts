// Floe — controls/menu-down: the down action moves a menu's highlight down one item.
//
// `specs/controls.md` reads the four movement actions as PRESS EDGES on every
// screen but `playing`, and gives them a second job there: "move the highlight
// one item that way, wrapping at both ends". `specs/ui.md` says which menu each
// screen carries and that `menuIndex` is the highlighted item, counted from `0`.
//
// THE MENU IS THE PAUSE MENU, AND THE START INDEX IS THE FIRST ONE. `PAUSE_ITEMS`
// is three items long, so a highlight on the first has two items below it: down
// must reach `1`, and neither end of the menu is touched, so the wrap — a rule of
// its own, belonging to the screens the menus are on rather than to this point —
// is not exercised. A build that read the down key as up would wrap to `2` rather
// than merely miss `1`, and one that moved two items reads `2` as well from the
// other direction; either way the number the check reports names the wrong model
// rather than only rejecting the right one.
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
 * The highlight the menu is posed with, and the one the down action must reach.
 *
 * The first of `PAUSE_ITEMS` (`RESUME`), so the move is an ordinary step rather
 * than the wrap `specs/controls.md` states separately.
 */
const POSED_INDEX = 0;
const EXPECTED_INDEX = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the pause menu's highlight from the first item to the second", async () => {
  await startCrossing(h);
  await h.debug.setScreen("paused");
  await h.debug.setMenuIndex(POSED_INDEX);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "paused", "the pose opened the pause menu");
  assertEqual(
    posed.menuIndex,
    POSED_INDEX,
    `the pose highlighted ${PAUSE_ITEMS[POSED_INDEX]}, the first of the three`,
  );

  await h.tap("ArrowDown");
  await captureStill(h, "menu");

  const after = await h.snapshot();
  assertEqual(
    after.menuIndex,
    EXPECTED_INDEX,
    "the down action moves the highlight one item down (specs/controls.md)",
  );
  assertEqual(
    after.screen,
    "paused",
    "and moves the highlight rather than leaving the screen",
  );
});
