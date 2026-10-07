// Facet — screens/menu-highlight-up: `up` moves the menu highlight back by one
// item.
//
// specs/ui.md fixes the rule for every screen carrying a vertical menu: "`up`
// and `down` move the highlight by one item". This point is `up`, on its own,
// and `down` is a point of its own beside it: a build that reads one of the two
// keys and not the other must lose one point rather than both.
//
// THE HIGHLIGHT IS POSED, NOT DRIVEN THERE. The step has to start on an item
// that is not the first, and `setMenuIndex` puts it there — specs/instrumentation.md
// has it highlight an item and change nothing else, and it takes no item. So a
// build whose `down` never worked is still asked this question, which is what
// keeps the two points independent.
//
// A STEP THAT DOES NOT WRAP. It is taken from the second item down to the first,
// so it lands inside the menu and the answer is the same whether or not the
// build wraps at the ends. The wrap is its own point.
//
// The key is real. specs/controls.md binds `up` to `ArrowUp` and fixes that
// whole table for a build of every engine, so `tapAction` delivers the action's
// first binding as one press the frame reads as an edge. Driving through the
// keyboard rather than through a pose is the point: the specification says a
// menu is keyboard-only, so what is being decided is that the key really reaches
// the highlight.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the title highlight one item up", async () => {
  h.debug.reset();
  // The fixture rests on the title carrying more than one item, which is what
  // makes a move of one item observable at all; specs/ui.md gives it two.
  assertEqual(TITLE_ITEMS.length > 1, true, "a title menu of at least 2 items");
  h.debug.setMenuIndex(1);
  assertEqual(h.snapshot().menuIndex, 1, "the item posed as highlighted");

  // One `up` from the second item: the first is highlighted, and the screen has
  // not moved out from under the menu.
  await h.tapAction("up");
  const moved = h.snapshot();
  captureStill(h, "menu");
  assertEqual(moved.screen, "title", "the screen a menu press leaves");
  assertEqual(moved.menuIndex, 0, "the highlight after one up press");
});
