// Carom — navigation/space-confirms: Space confirms a menu item.
//
// One transition of the menu state machine specs/ui.md fixes. It starts from
// the title, which `reset()` restores with `menuIndex` at 0; `openTitle` settles
// that reset with one advanced frame before the first press, so a tap's edge
// cannot be consumed by a world the reset is leaving. `confirm` is bound to
// both Enter and Space (BINDINGS), and this drives the second. Every key is a
// real key event dispatched at the target the engine listens on, so the action
// is raised by the binding the case declares, and the result is read back off
// the game's own state. The still is the frame the press left.
//
// The entry this point confirms is POSED with `setMenuIndex` rather than walked
// to with arrow presses. Walking there would put the movement edges inside a
// check about a confirm, so a build with a broken down edge would fail this
// point as well as `title-down`; the ground a check presses its one key from is
// its ground rather than its subject.
//
// Nothing on the field is posed or removed: specs/ui.md advances nothing on the
// title and nothing on the how-to screen, so this transition runs over a world
// that cannot move under it either way.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, TITLE_ITEMS } from "../constants";
import { assertContains, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the how-to screen when Space confirms the third title item", async () => {
  await openTitle(h);
  assertContains(BINDINGS.confirm, "Space");
  assertEqual(TITLE_ITEMS[2], "HOW TO PLAY");
  h.debug.setMenuIndex(2);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title");
  assertEqual(posed.menuIndex, 2);

  await h.tap("Space");
  captureStill(h, "howto");

  assertEqual(h.snapshot().screen, "howto");
});
