// Meltdown — screens/menu-wraps-up: the highlight wraps past the first row.
//
// THE RULE. `specs/screens.md`, under Menus: "`up` and `down` move the highlight
// one row, and the highlight wraps at both ends: moving down from the last row
// highlights the first, and moving up from the first row highlights the last. This
// holds on every menu in the game." `specs/instrumentation.md` reports the
// highlighted row as `menuIndex`, "counted from `0`".
//
// WHY THE MODE LIST AND NOT THE TITLE MENU. The mode list has five rows, and five
// is the smallest count in the game that tells a WRAP from a TOGGLE. On a two-row
// menu, wrapping up from the first row and merely swapping rows land on the same
// number, so a build that flipped between two rows would pass. Posed on row `0` of
// five, every wrong model reads a different number: a wrap reads `4`, a clamp reads
// `0`, an unbounded decrement reads `-1`, and a toggle reads `1`.
//
// THE OTHER END OF THE SAME RULE, AND ITS OWN ITEM. `screens.menu-wraps-down`
// reads the step off the last row. Both ends are asserted separately because a
// build commonly guards one and not the other, and the failed grade should name
// which end of the list a player gets stuck at.
//
// ONLY THE STEP OFF THE END IS UNDER TEST. That `up` moves the highlight one row at
// all is `controls.menu-up`'s reading. This item poses the first row outright, so
// what it measures is the wrap and nothing else.
//
// MOVING THE HIGHLIGHT STARTS NOTHING, so the screen is read back as well: a build
// that answered the press by taking the row instead of moving the highlight reads
// `difficultyselect` or `playing` rather than `modeselect`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, MODE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  tapAction,
  type Harness,
} from "../harness";

/** The row the press starts from: the first. */
const FIRST_ROW = 0;

/** Where the wrap lands: the last of the six `MODE_ITEMS`. */
const LAST_ROW = MODE_ITEMS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("highlights the last row when up is pressed on the first row of a menu", async () => {
  const { debug } = h;
  await debug.reset();
  await debug.setScreen("modeselect");
  await debug.setMenuIndex(FIRST_ROW);
  await h.advance(1);

  const posed = await h.snapshot();
  assertEqual(
    posed.screen,
    "modeselect",
    "the screen the scenario is posed on",
  );
  assertEqual(posed.menuIndex, FIRST_ROW, "the row the scenario is posed on");

  await tapAction(h, "up");
  await h.advance(1);
  await captureStill(h, "wrapped");

  const after = await h.snapshot();
  assertEqual(
    after.menuIndex,
    LAST_ROW,
    `${BINDINGS.up}: the highlighted row after one press from row ${FIRST_ROW}, the first of ${MODE_ITEMS.length}`,
  );
  assertEqual(
    after.screen,
    "modeselect",
    "the screen after the press, since moving a highlight starts nothing",
  );
});
