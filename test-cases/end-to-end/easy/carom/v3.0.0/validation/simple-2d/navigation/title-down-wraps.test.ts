// Carom — navigation/title-down-wraps: ArrowDown on the last title item wraps to
// the first.
//
// One transition of the menu state machine specs/ui.md fixes, in one direction:
// the down edge's wrap, which is its own edge case and so its own point.
//
// The selection starts on the LAST item, and it is put there by `setMenuIndex`
// rather than by pressing down to it. That is the precondition this point names,
// and posing it is what keeps the point about the wrap alone: a build whose down
// edge does not move at all fails `navigation/title-down`, and pressing the way
// here would fail this one for that same defect.
//
// The field is left exactly as the title state holds it. Nothing advances on
// `title` (specs/ui.md) and what is read is `screen` and `menuIndex`, which no
// ball and no obstacle can touch, so there is no bystander to remove. No paddle
// is taken: a menu is not driven through one.
//
// The key is a real key event dispatched at the target the runtime listens on,
// so the action is raised by the binding the case declares. The still is the
// frame the press left.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

const LAST = TITLE_ITEMS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("wraps the title selection from the last item to the first", async () => {
  assertGreaterThan(TITLE_ITEMS.length, 1);
  openTitle(h);
  h.debug.setMenuIndex(LAST);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title");
  assertEqual(posed.menuIndex, LAST);

  await h.tap("ArrowDown");
  captureStill(h, "menu");

  const wrapped = h.snapshot();
  assertEqual(wrapped.screen, "title");
  assertEqual(wrapped.menuIndex, 0);
});
