// Facet — screens/menu-highlight-wraps: the menu highlight wraps at both ends.
//
// specs/ui.md states the rule three times, once for each screen carrying a
// menu: "`up` and `down` move the highlight by one item and wrap at both ends".
// The wrap is the whole of this point, and both ends are asked, because they
// are two different mistakes: a build that clamps at the top and one that
// clamps at the bottom each pass the other half.
//
// The title is the screen it is asked on, because `reset()` leaves the game
// there with item `0` highlighted, so the first press is taken from the exact
// end specs/ui.md names. `up` from the first item must reach the LAST item —
// `TITLE_ITEMS.length - 1`, computed from the menu specs/ui.md fixes rather
// than from any number a build chose — and `down` from that last item must come
// back to the first. A build that clamped instead of wrapping leaves the
// highlight where it stood, which is a different index in both directions.
//
// The keys are real: specs/controls.md binds `up` to `ArrowUp` and `down` to
// `ArrowDown` and fixes that table for a build of every engine, so `tapAction`
// delivers each action's first binding as one press the frame reads as an edge.

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

it("wraps up from the first item to the last, and down from the last to the first", async () => {
  h.debug.reset();
  // A menu of one item would wrap onto itself and decide nothing; specs/ui.md
  // gives the title two, and the fixture says so rather than assuming it.
  assertEqual(LAST_ITEM > 0, true, "a title menu of at least 2 items");
  assertEqual(h.snapshot().menuIndex, 0, "the item highlighted first");

  // Up off the top end: the highlight appears at the bottom of the menu.
  await h.tapAction("up");
  const wrapped = h.snapshot();
  captureStill(h, "menu");
  assertEqual(wrapped.screen, "title", "the screen a menu press leaves");
  assertEqual(
    wrapped.menuIndex,
    LAST_ITEM,
    "the highlight after up from item 0",
  );

  // And down off the bottom end comes back to the top, which is the other half
  // of "wrap at both ends" and the half a build clamping downward fails.
  await h.tapAction("down");
  const around = h.snapshot();
  assertEqual(around.screen, "title", "the screen a menu press leaves");
  assertEqual(
    around.menuIndex,
    0,
    "the highlight after down from the last item",
  );
});
