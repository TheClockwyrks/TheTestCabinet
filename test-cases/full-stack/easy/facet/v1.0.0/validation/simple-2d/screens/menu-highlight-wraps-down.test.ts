// Facet — screens/menu-highlight-wraps-down: `down` from the last menu item
// highlights the first.
//
// specs/ui.md states the rule three times, once for each screen carrying a menu:
// "`up` and `down` move the highlight by one item and wrap at both ends". The
// two ends are two different mistakes — a build that clamps at the top and one
// that clamps at the bottom each pass the other half — so each end is a point of
// its own, and this one is the bottom.
//
// THE HIGHLIGHT IS POSED ON THE LAST ITEM, NOT DRIVEN THERE. `setMenuIndex`
// highlights `TITLE_ITEMS.length - 1` — the menu specs/ui.md fixes, rather than
// any number a build chose — and specs/instrumentation.md has it change nothing
// else and take no item. So a build whose `up` never worked, or whose wrap at
// the top is broken, is still asked this question.
//
// `down` off the bottom end must come back to item `0`. A build that clamped
// instead of wrapping leaves the highlight where it stood.
//
// The key is real: specs/controls.md binds `down` to `ArrowDown` and fixes that
// table for a build of every engine, so `tapAction` delivers the action's first
// binding as one press the frame reads as an edge.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

/** The last item of the title menu specs/ui.md fixes: `PLAY`, `HOW TO PLAY`. */
const LAST_ITEM = TITLE_ITEMS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("wraps down from the last item to the first", async () => {
  h.debug.reset();
  // A menu of one item would wrap onto itself and decide nothing; specs/ui.md
  // gives the title two, and the fixture says so rather than assuming it.
  assertEqual(LAST_ITEM > 0, true, "a title menu of at least 2 items");
  h.debug.setMenuIndex(LAST_ITEM);
  assertEqual(
    h.snapshot().menuIndex,
    LAST_ITEM,
    "the item posed as highlighted",
  );

  // Down off the bottom end: the highlight comes back to the top of the menu.
  await h.tapAction("down");
  const around = h.snapshot();
  captureStill(h, "menu");
  assertEqual(around.screen, "title", "the screen a menu press leaves");
  assertEqual(
    around.menuIndex,
    0,
    "the highlight after down from the last item",
  );
});
