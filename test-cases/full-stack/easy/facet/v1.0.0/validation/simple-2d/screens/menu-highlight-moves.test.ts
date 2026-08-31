// Facet — screens/menu-highlight-moves: `up` and `down` move the menu highlight
// by one item.
//
// specs/ui.md fixes the rule for every screen carrying a vertical menu: "`up`
// and `down` move the highlight by one item". This point is that single step in
// both directions, on the title, which specs/ui.md and
// specs/instrumentation.md agree `reset()` leaves highlighted at item `0`.
//
// TWO STEPS THAT NEITHER OF THEM WRAPS. `down` is taken from the first item and
// `up` from the second, so both land inside the menu and the answer is the
// same whether or not the build wraps at the ends — the wrap is a point of its
// own and nothing here depends on it.
//
// The keys are real. specs/controls.md binds `up` to `ArrowUp` and `down` to
// `ArrowDown`, and fixes that whole table for a build of every engine, so
// `tapAction` delivers each action's first binding as one press the frame reads
// as an edge. Driving through the keyboard rather than through a pose is the
// point: the specification says a menu is keyboard-only, so what is being
// decided is that the key really reaches the highlight.

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

it("moves the title highlight one item down, and one item back up", async () => {
  h.debug.reset();
  // The fixture rests on the title carrying more than one item, which is what
  // makes a move of one item observable at all; specs/ui.md gives it two.
  assertEqual(TITLE_ITEMS.length > 1, true, "a title menu of at least 2 items");
  assertEqual(h.snapshot().menuIndex, 0, "the item highlighted first");

  // One `down` from the first item: the second is highlighted, and the screen
  // has not moved out from under the menu.
  await h.tapAction("down");
  const moved = h.snapshot();
  captureStill(h, "menu");
  assertEqual(moved.screen, "title", "the screen a menu press leaves");
  assertEqual(moved.menuIndex, 1, "the highlight after one down press");

  // And one `up` from the second item comes back to the first.
  await h.tapAction("up");
  const back = h.snapshot();
  assertEqual(back.screen, "title", "the screen a menu press leaves");
  assertEqual(back.menuIndex, 0, "the highlight after one up press");
});
