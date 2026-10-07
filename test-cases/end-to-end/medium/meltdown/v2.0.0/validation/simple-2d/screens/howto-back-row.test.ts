// screens/howto-back-row — the how-to screen draws one row, and confirming it
// returns to the title.
//
// THE RULE. `specs/screens.md`, on `howto`: the screen "draws the one row of
// `HOWTO_ITEMS`: `BACK`", and the row table sends it to `title`.
//
// TWO READINGS, ONE REQUIREMENT. That the screen offers exactly one row is the
// precondition the requirement is stated over — a how-to page with no row at all
// is the defect this item exists to catch — and where confirming it leads is the
// requirement itself. The row count is read off `menu`, the rectangles
// `specs/instrumentation.md` has the build report for "every row of the menu the
// current screen shows"; that those rectangles are big enough to tap is
// `screens.menu-rows-are-touch-targets`'s, and that every screen reports them at
// all is `screens.menu-rows-reported`'s.
//
// WHY THE ROW EXISTS AND WHY IT IS GRADED. `specs/controls.md` makes the game
// fully playable on a touchscreen, so a page a player can only leave with a key
// strands a player who has no keyboard. That `back` reaches the same screen is
// `screens.back-from-howto`'s requirement.
//
// WHAT THE PAGE SAYS IS NOT THIS ITEM'S. `screens.howto-content` reads the topics
// it covers; this one reads its one row.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOWTO_ITEMS, BINDINGS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { poseMenu } from "./menu";

/** The key specs/controls.md binds `confirm` to. */
const CONFIRM = BINDINGS.confirm[0];

/** The one row the how-to screen draws, and the only index it has. */
const BACK_ROW = HOWTO_ITEMS.indexOf("BACK");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws one row and returns to the title when it is confirmed", async () => {
  poseMenu(h, "howto", BACK_ROW);
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(before.screen, "howto", "the screen the row is confirmed on");
  assertEqual(
    before.menu.length,
    HOWTO_ITEMS.length,
    "the rows the how-to screen reports it drew (specs/screens.md, howto)",
  );
  assertEqual(before.menuIndex, BACK_ROW, "the row the confirm is made on");

  await h.tap(CONFIRM);
  captureStill(h, "title");

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen confirming the how-to screen's BACK row leads to",
  );
});
