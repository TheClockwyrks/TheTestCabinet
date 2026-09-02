// Meltdown — controls/menu-up: ArrowUp moves a menu highlight back by one.
//
// THE RULE. specs/controls.md binds `up` to `ArrowUp` (The bindings) and gives it
// the effect "Moves the highlighted row of the current menu back one" (The
// actions). specs/screens.md states the rule under Menus, and
// specs/instrumentation.md reports the highlighted row as `menuIndex`.
//
// THIS IS THE OTHER DIRECTION, AND IT IS ITS OWN ITEM. A build that wired one
// arrow and not the other is a real and ordinary defect, and it must grade
// differently from a build with both arrows working and from one with neither. So
// nothing here reads `down`: `controls.menu-down` owns that direction.
//
// POSED ON THE LAST ROW, SO THE STEP UNDER TEST NEVER REACHES THE WRAP.
// specs/screens.md has the highlight wrap at both ends — "moving up from the first
// row highlights the last" — and that is `screens.menu-wraps-up`'s requirement. The
// title menu holds the two rows of `TITLE_ITEMS`, so its last row is the only start
// from which moving back is a plain step, and it is posed outright.
//
// ArrowUp ALONE, BECAUSE THAT IS WHAT THE BINDING SAYS. specs/controls.md gives
// `up` one key and gives `left` its own, `ArrowLeft`, with the same effect on a
// menu; they are separate actions on separate keys, and this item names the `up`
// binding.
//
// THE TITLE MENU, from a reset, with the screen and the row both posed outright.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, resetTo, type Harness } from "../harness";

/** The key specs/controls.md binds `up` to, as a `KeyboardEvent.code`. */
const KEY = "ArrowUp";

/**
 * The row the press starts from: the last of the `TITLE_ITEMS`.
 *
 * The step under test therefore lands on row `0`, and the wrap
 * `screens.menu-wraps-up` owns is never reached.
 */
const FROM_ROW = TITLE_ITEMS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the title menu's highlight back by one when ArrowUp is pressed", async () => {
  resetTo(h);
  h.debug.setScreen("title");
  h.debug.setMenuIndex(FROM_ROW);
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(before.screen, "title", "the screen the scenario is posed on");
  assertEqual(before.menuIndex, FROM_ROW, "the row the scenario is posed on");

  await h.tap(KEY);
  captureStill(h, "up");

  assertEqual(
    h.snapshot().menuIndex,
    FROM_ROW - 1,
    `${KEY}: the highlighted row after one press, posed on row ${FROM_ROW} of ${TITLE_ITEMS.length}`,
  );
});
