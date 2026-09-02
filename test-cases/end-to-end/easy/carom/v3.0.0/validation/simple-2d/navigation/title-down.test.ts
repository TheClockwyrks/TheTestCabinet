// Carom — navigation/title-down: one ArrowDown on the title moves the selection down one.
//
// One transition of the menu state machine specs/ui.md fixes. It starts from
// the title, which `reset()` restores with `menuIndex` at 0. Every key is a
// real key event dispatched at the target the engine listens on, so the action
// is raised by the binding the case declares, and the result is read back off
// the game's own state. The still is the frame the press left.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  menuIndex0,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the title selection from the first item to the second", async () => {
  h.debug.reset();
  assertGreaterThan(TITLE_ITEMS.length, 1);
  await h.tap("ArrowDown");
  captureStill(h, "menu");

  assertEqual(h.snapshot().screen, "title");
  assertEqual(menuIndex0(h), 1);
});
