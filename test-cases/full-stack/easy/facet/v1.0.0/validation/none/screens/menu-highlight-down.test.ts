// Facet — screens/menu-highlight-down: `down` moves the menu highlight on by one
// item.
//
// specs/ui.md fixes the rule for every screen carrying a vertical menu: "`up`
// and `down` move the highlight by one item". This point is `down`, on its own,
// and `up` is a point of its own beside it: a build that reads one of the two
// keys and not the other must lose one point rather than both.
//
// A STEP THAT DOES NOT WRAP. It is taken from the first item, so it lands inside
// the menu and the answer is the same whether or not the build wraps at the
// ends. The wrap is its own point and nothing here depends on it.
//
// The key is real. specs/controls.md binds `down` to `ArrowDown` and fixes that
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

afterEach(async () => {
  await h.dispose();
});

it("moves the title highlight one item down", async () => {
  await h.debug.reset();
  // The fixture rests on the title carrying more than one item, which is what
  // makes a move of one item observable at all; specs/ui.md gives it two.
  assertEqual(TITLE_ITEMS.length > 1, true, "a title menu of at least 2 items");
  assertEqual((await h.snapshot()).menuIndex, 0, "the item highlighted first");

  // One `down` from the first item: the second is highlighted, and the screen
  // has not moved out from under the menu.
  await h.tapAction("down");
  const moved = await h.snapshot();
  await captureStill(h, "menu");
  assertEqual(moved.screen, "title", "the screen a menu press leaves");
  assertEqual(moved.menuIndex, 1, "the highlight after one down press");
});
