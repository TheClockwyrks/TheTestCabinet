// Meltdown — screens/menu-wraps-down: the highlight wraps past the last row.
//
// THE RULE. `specs/screens.md`, under Menus: "`up` and `down` move the highlight
// one row, and the highlight wraps at both ends: moving down from the last row
// highlights the first, and moving up from the first row highlights the last. This
// holds on every menu in the game." `specs/instrumentation.md` reports the
// highlighted row as `menuIndex`, "counted from `0`".
//
// WHY THE MODE LIST AND NOT THE TITLE MENU. The mode list has five rows, and five
// is the smallest count in the game that tells a WRAP from a TOGGLE. On a two-row
// menu, wrapping down from the last row and merely swapping rows land on the same
// number, so a build that flipped between two rows would pass. Posed on row `4` of
// five, every wrong model reads a different number: a wrap reads `0`, a clamp reads
// `4`, an unbounded increment reads `5`, and a toggle reads `3`.
//
// ONLY THE STEP OFF THE END IS UNDER TEST. That `down` moves the highlight one row
// at all is `controls.menu-down`'s reading, taken from the first row where the step
// never reaches an end. This item poses the last row outright, so what it measures
// is the wrap and nothing else.
//
// THE ROW IS POSED, NOT WALKED THERE. `setMenuIndex` sets the highlighted row
// outright (`specs/instrumentation.md`), so a build that cannot walk to the last
// row still gets a fair reading of what happens when it steps off it.
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

/** The row the press starts from: the last of the five `MODE_ITEMS`. */
const LAST_ROW = MODE_ITEMS.length - 1;

/** Where the wrap lands: the first row. */
const FIRST_ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("highlights the first row when down is pressed on the last row of a menu", async () => {
  const { debug } = h;
  await debug.reset();
  await debug.setScreen("modeselect");
  await debug.setMenuIndex(LAST_ROW);
  await h.advance(1);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "modeselect", "the screen the scenario is posed on");
  assertEqual(posed.menuIndex, LAST_ROW, "the row the scenario is posed on");

  await tapAction(h, "down");
  await h.advance(1);
  await captureStill(h, "wrapped");

  const after = await h.snapshot();
  assertEqual(
    after.menuIndex,
    FIRST_ROW,
    `${BINDINGS.down}: the highlighted row after one press from row ${LAST_ROW}, the last of ${MODE_ITEMS.length}`,
  );
  assertEqual(
    after.screen,
    "modeselect",
    "the screen after the press, since moving a highlight starts nothing",
  );
});
