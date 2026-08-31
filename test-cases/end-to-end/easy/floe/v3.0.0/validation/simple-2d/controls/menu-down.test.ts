// Floe — controls/menu-down: the down action moves a menu's highlight down one
// item.
//
// `specs/controls.md` reads the four movement actions as PRESS EDGES on every
// screen but `playing`, and gives them a second job there: "move the highlight
// one item that way, wrapping at both ends". `specs/ui.md` says which menu each
// screen carries and that `menuIndex` is the highlighted item, counted from `0`.
//
// THE ACTION IS WHAT THIS POINT DECIDES, NOT THE KEY. Which physical keys drive
// `down` is `controls/arrow-down` and `controls/key-s`, each with its own point,
// so this check reaches for whatever key `BINDINGS` gives the action —
// `keyFor("down")` — and asks only what the action does to a menu. The key still
// travels the whole route: it is dispatched at the target the engine listens on,
// the engine resolves it to the registered `down` action, and the build reads that
// action back (`specs/controls.md`, `specs/instrumentation.md`, which gives the
// surface no keyboard operation at all). Nothing here calls a menu operation.
//
// THE MENU IS THE PAUSE MENU, AND THE START INDEX IS THE FIRST ONE. `PAUSE_ITEMS`
// is three items long, so a highlight on the first has two items below it: down
// must reach `1`, and neither end of the menu is touched, so the wrap — a rule of
// its own, belonging to the screens the menus are on rather than to this point —
// is not exercised. A build that read the down action as up would wrap to `2`
// rather than merely miss `1`, and one that moved two items reads `2` as well from
// the other direction; either way the number the check reports names the wrong
// model rather than only rejecting the right one.
//
// WHAT IS NOT GRADED HERE. Which items the pause menu shows and what confirming
// one does are `screens.pause-menu` and its neighbours; that the pause key opens
// the menu at all is `controls/pause-p`. The screen is posed straight onto
// `paused` through the surface, so none of those paths is on the route and a build
// that broke one of them keeps this point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../../src/constants";
import {
  captureStill,
  createHarness,
  keyFor,
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

afterEach(() => {
  h?.dispose();
});

it("moves the pause menu's highlight from the first item to the second", async () => {
  startCrossing(h);
  h.debug.setScreen("paused");
  h.debug.setMenuIndex(POSED_INDEX);

  const posed = h.snapshot();
  assertEqual(posed.screen, "paused", "the pose opened the pause menu");
  assertEqual(
    posed.menuIndex,
    POSED_INDEX,
    `the pose highlighted ${PAUSE_ITEMS[POSED_INDEX]}, the first of the three`,
  );

  await h.tap(keyFor("down"));
  captureStill(h, "menu");

  const after = h.snapshot();
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
