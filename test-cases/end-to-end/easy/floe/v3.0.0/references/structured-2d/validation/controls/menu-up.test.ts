// Floe — controls/menu-up: the up action moves a menu's highlight up one item.
//
// `specs/controls.md` reads the four movement actions as PRESS EDGES on every
// screen but `playing`, and gives them a second job there: "move the highlight
// one item that way, wrapping at both ends". `specs/ui.md` says which menu each
// screen carries and that `menuIndex` is the highlighted item, counted from `0`.
//
// THE ACTION IS WHAT THIS POINT DECIDES, NOT THE KEY. Which physical keys drive
// `up` is `controls/arrow-up` and `controls/key-w`, each with its own point, so
// this check reaches for whatever key `BINDINGS` gives the action —
// `tapAction(h, "up")` — and asks only what the action does to a menu. The key
// still travels the whole route: it is dispatched at the event target the engine
// listens on, the engine resolves it to the registered `up` action and arms its
// edge, and the build reads that action back (`specs/controls.md`,
// `specs/instrumentation.md`, which gives the surface no keyboard operation at
// all). Nothing here calls a menu operation.
//
// THE MENU IS THE PAUSE MENU, AND THE START INDEX IS THE MIDDLE ONE. `PAUSE_ITEMS`
// is three items long, so a highlight sitting on the second has an item above it
// and an item below it: up must reach `0` and down would reach `2`. Two things
// follow. The wrap is not exercised at all — it is a rule of its own and belongs
// to the screens the menus are on, not to this point — and a build that read the
// up action as down reads as `2` rather than merely as "not `0`", so the failure
// names which wrong model the build implemented. A build that moved two items, or
// that clamped rather than moved, reads as a third and fourth number.
//
// WHAT IS NOT GRADED HERE. Which items the pause menu shows and what confirming
// one does are `screens.pause-menu` and its neighbours; that the pause key opens
// the menu at all is `controls/pause-p`. The screen is posed straight onto
// `paused` through the surface, so none of those paths is on the route and a build
// that broke one of them keeps this point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  startCrossing,
  tapAction,
  type Harness,
} from "../harness";

/**
 * The highlight the menu is posed with, and the one the up action must reach.
 *
 * The second of `PAUSE_ITEMS` (`RESTART`), so the move is an ordinary step rather
 * than the wrap `specs/controls.md` states separately, and `0` and `2` are two
 * different failures rather than one.
 */
const POSED_INDEX = 1;
const EXPECTED_INDEX = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the pause menu's highlight from the second item to the first", async () => {
  startCrossing(h);
  h.debug.setScreen("paused");
  h.debug.setMenuIndex(POSED_INDEX);

  const posed = h.snapshot();
  assertEqual(posed.screen, "paused", "the pose opened the pause menu");
  assertEqual(
    posed.menuIndex,
    POSED_INDEX,
    `the pose highlighted ${PAUSE_ITEMS[POSED_INDEX]}, the second of the three`,
  );

  await tapAction(h, "up");
  captureStill(h, "menu");

  const after = h.snapshot();
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
