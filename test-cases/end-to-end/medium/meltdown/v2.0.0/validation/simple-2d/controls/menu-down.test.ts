// Meltdown — controls/menu-down: ArrowDown moves a menu highlight on by one.
//
// THE RULE. specs/controls.md binds `down` to `ArrowDown` and gives it the effect
// "Moves the highlighted row of the current menu on one." specs/screens.md states
// it under Menus — "`up` and `down` move the highlight one row" — and
// specs/instrumentation.md reports the highlighted row as `menuIndex`, "counted
// from `0`".
//
// THE HIGHLIGHT IS READ, NOT THE PICTURE. Which row is drawn plainly apart from
// the others is `screens.title-screen`'s reading; `menuIndex` is the number this
// key moves.
//
// POSED ON THE FIRST ROW, SO THE STEP UNDER TEST NEVER REACHES THE WRAP.
// specs/screens.md has the highlight wrap at both ends — "moving down from the
// last row highlights the first" — and that is `screens.menu-wraps-down`'s
// requirement, not this one's. The title menu holds the two rows of `TITLE_ITEMS`,
// so row `0` is the only start from which moving on is a plain step, and it is
// posed outright.
//
// `ArrowDown` ALONE, BECAUSE THAT IS WHAT THE BINDING SAYS. specs/controls.md
// gives `down` one key and gives `right` its own, `ArrowRight`, with the same
// effect on a menu — but they are separate actions on separate keys, and this item
// names the `down` binding. A build that wired only `right` fails here, which is
// exactly right: a player pressing the down arrow on a vertical list must be
// answered.
//
// THE TITLE MENU, from a reset, because it is the menu a player meets first and
// needs nothing posed to reach. The screen and the row are both posed outright, so
// the precondition rests on the pose rather than on `reset` being right.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/** The key specs/controls.md binds `down` to. */
const KEY = BINDINGS.down[0];

/**
 * The row the press starts from: the first.
 *
 * The step under test therefore lands on the last of the two `TITLE_ITEMS`, and
 * the wrap `screens.menu-wraps-down` owns is never reached.
 */
const FROM_ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the title menu's highlight on by one when ArrowDown is pressed", async () => {
  h.debug.reset();
  h.debug.setScreen("title");
  h.debug.setMenuIndex(FROM_ROW);
  await h.advance(1);
  const before = h.snapshot();
  assertEqual(
    before.screen,
    "title",
    "posing: the screen the scenario is posed on (specs/screens.md)",
  );
  assertEqual(
    before.menuIndex,
    FROM_ROW,
    "posing: the row the scenario is posed on (specs/screens.md, Menus)",
  );

  await h.tap(KEY);
  captureStill(h, "down");

  assertEqual(
    h.snapshot().menuIndex,
    FROM_ROW + 1,
    `${KEY}: the highlighted row after one press, posed on row ${FROM_ROW} of ` +
      `${TITLE_ITEMS.length} (specs/controls.md, specs/screens.md)`,
  );
});
