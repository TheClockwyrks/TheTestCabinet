// Meltdown — screens/menu-wraps-up: moving up off the first row highlights the
// last.
//
// THE RULE. specs/screens.md, Menus: "the highlight wraps at both ends: ... moving
// up from the first row highlights the last. This holds on every menu in the
// game."
//
// THIS IS THE OTHER END, AND IT IS ITS OWN ITEM. A build that wraps downward and
// clamps upward is an ordinary defect — the two ends are separate arithmetic — and
// it must grade differently from a build that wraps both ways and from one that
// wraps neither. So nothing here presses `down`: `screens.menu-wraps-down` owns
// that end.
//
// THE MODE LIST IS THE MENU READ, because it is the longest one in the game: five
// rows, so the wrap lands on `4` from `0`, and every wrong model reads a different
// number. A build that CLAMPS at the top reads `0`; one that runs off the front
// reads `-1`; one that wraps reads `4`.
//
// THE PLAIN STEP IS SOMEBODY ELSE'S ITEM: that `up` moves the highlight back by
// one at all is `controls.menu-up`, which poses a row the step cannot wrap from.
//
// THE ROW IS POSED, NOT WALKED, and the press goes through the `up` action's own
// binding out of the case-fixed `BINDINGS` table.

import { afterEach, beforeEach, it } from "vitest";
import { MODE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";

/** The row the press starts from: the first. */
const FIRST_ROW = 0;

/** The row it must land on: the last of the five `MODE_ITEMS`. */
const LAST_ROW = MODE_ITEMS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("highlights the last row when up is pressed on the first row of a menu", async () => {
  resetTo(h);
  h.debug.setScreen("modeselect");
  h.debug.setMenuIndex(FIRST_ROW);
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(
    before.screen,
    "modeselect",
    "the screen the scenario is posed on",
  );
  assertEqual(before.menuIndex, FIRST_ROW, "the row the scenario is posed on");

  await tapAction(h, "up");
  captureStill(h, "wrapped");

  assertEqual(
    h.snapshot().menuIndex,
    LAST_ROW,
    `the highlighted row after one up press from row ${FIRST_ROW}, the first ` +
      `of the ${MODE_ITEMS.length} the mode list draws`,
  );
});
