// Carom — navigation/title-up-wraps: ArrowUp on the first title item wraps to the last.
//
// One transition of the menu state machine specs/ui.md fixes. It starts from
// the title, which `reset()` restores with `menuIndex` at 0; the reset is
// settled with one advanced frame before the first press, so a tap's edge
// cannot be consumed by a world the reset is leaving. Every key is a real key
// event dispatched at the target the engine listens on, so the action is raised
// by the binding the case declares, and the result is read back off the game's
// own state. The still is the frame the press left.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../../src/constants";
import { assertEqual } from "../assert";
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

it("wraps the title selection from the first item to the last", async () => {
  h.debug.reset();
  await h.advance(1);
  await h.tap("ArrowUp");
  captureStill(h, "menu");

  assertEqual(h.snapshot().screen, "title");
  assertEqual(menuIndex0(h), TITLE_ITEMS.length - 1);
});
