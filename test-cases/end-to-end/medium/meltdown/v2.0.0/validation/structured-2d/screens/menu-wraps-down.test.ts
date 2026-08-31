// Meltdown — screens/menu-wraps-down: moving down off the last row highlights the
// first.
//
// THE RULE. specs/screens.md, Menus: "the highlight wraps at both ends: moving
// down from the last row highlights the first ... This holds on every menu in the
// game." specs/instrumentation.md reports the highlighted row as `menuIndex`,
// "counted from `0`".
//
// THE MODE LIST IS THE MENU READ, because it is the longest one in the game: five
// rows, so the wrap lands on `0` from `4` and every wrong model reads a different
// number. A build that CLAMPS at the end reads `4`; one that runs off the list
// reads `5`; one that steps by more than a row reads something else again; one
// that wraps reads `0`. On a two-row menu a clamp and a step are one apart and
// several of those wrong models collide.
//
// THE OTHER END IS ITS OWN ITEM. `screens.menu-wraps-up` reads the wrap past the
// FIRST row, because a build that wired one end of the list and not the other is
// an ordinary defect and must grade differently from one with neither end wired.
// Nothing here presses `up`.
//
// THE PLAIN STEP IS SOMEBODY ELSE'S ITEM. That `down` moves the highlight on by
// one at all is `controls.menu-down`, which poses a row the step cannot wrap from;
// this item poses the one row it can only wrap from.
//
// THE ROW IS POSED, NOT WALKED, so a build whose arrow keys move the highlight
// wrongly is still asked exactly one question here: what one press from the last
// row does.
//
// THE ACTION, NOT THE KEY: the press goes through the `down` action's own binding
// out of the case-fixed `BINDINGS` table, since this item is about the wrap and
// `controls.menu-down` is about the binding.

import { afterEach, beforeEach, it } from "vitest";
import { MODE_ITEMS } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";

/** The row the press starts from: the last of the five `MODE_ITEMS`. */
const LAST_ROW = MODE_ITEMS.length - 1;

/** The row it must land on: the first. */
const FIRST_ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("highlights the first row when down is pressed on the last row of a menu", async () => {
  resetTo(h);
  h.debug.setScreen("modeselect");
  h.debug.setMenuIndex(LAST_ROW);
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(
    before.screen,
    "modeselect",
    "the screen the scenario is posed on",
  );
  assertEqual(before.menuIndex, LAST_ROW, "the row the scenario is posed on");

  await tapAction(h, "down");
  captureStill(h, "wrapped");

  assertEqual(
    h.snapshot().menuIndex,
    FIRST_ROW,
    `the highlighted row after one down press from row ${LAST_ROW}, the last ` +
      `of the ${MODE_ITEMS.length} the mode list draws`,
  );
});
