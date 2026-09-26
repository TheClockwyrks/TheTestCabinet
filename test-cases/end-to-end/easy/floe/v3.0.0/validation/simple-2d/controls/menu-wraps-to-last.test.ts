// Floe — controls/menu-wraps-to-last: the up action on the first item of a menu
// wraps the highlight to the last.
//
// `specs/controls.md` gives the four movement actions a second job on every
// screen but `playing`: "move the highlight one item that way, wrapping at both
// ends", and `specs/ui.md` says the same of each menu, "Moves `menuIndex` over
// `PAUSE_ITEMS`, wrapping both ways".
//
// THE WRAP IS ITS OWN REQUIREMENT, SEPARATE FROM THE MOVE. `controls.menu-up` and
// `controls.menu-down` are graded from the MIDDLE entry of the pause menu, where
// no wrap is involved, so a build that moves the highlight correctly inside the
// list and stops dead at the ends passes both of them and fails here. That is the
// build this point exists to separate: every entry is still reachable the long way
// round, so nothing is unplayable, but the menu does not behave the way the
// specification says it does.
//
// THE MENU IS THE PAUSE MENU, three items long, so the wrap crosses two entries
// rather than one and a build that merely failed to move reads as the index it was
// posed at rather than as the neighbour.
//
// THE SCREEN IS POSED, NOT PAUSED WITH A KEY, so a build whose pause key never
// opens the menu loses `controls.pause-p` and keeps this point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  startCrossing,
  type Harness,
} from "../harness";

/** The highlight the menu is posed with: the first entry, where up must wrap. */
const POSED_INDEX = 0;

/** The entry the wrap must reach: the last of `PAUSE_ITEMS`. */
const EXPECTED_INDEX = PAUSE_ITEMS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("wraps the pause menu's highlight from the first item to the last", async () => {
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

  await h.tap(BINDINGS.up[0]);
  captureStill(h, "menu");

  const after = h.snapshot();
  assertEqual(
    after.menuIndex,
    EXPECTED_INDEX,
    `the up action on the first entry wraps to ${PAUSE_ITEMS[EXPECTED_INDEX]}, ` +
      "the last (specs/controls.md)",
  );
  assertEqual(
    after.screen,
    "paused",
    "and moves the highlight rather than leaving the screen",
  );
});
