// Carom — navigation/title-down-wraps: ArrowDown on the last title item wraps to the first.
//
// One transition of the menu state machine specs/ui.md fixes. It starts from
// the title, which `reset()` restores with `menuIndex` at 0. Every key is a
// real key event dispatched at the target the engine listens on, so the action
// is raised by the binding the case declares, and the result is read back off
// the game's own state. The still is the frame the press left.

import { afterEach, beforeEach, expect, it } from "vitest";
import { TITLE_ITEMS } from "../../src/constants";
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

it("wraps the title selection from the last item to the first", async () => {
  h.debug.reset();
  // Down to the last item first, one press per step.
  for (let i = 1; i < TITLE_ITEMS.length; i += 1) await h.tap("ArrowDown");
  expect(menuIndex0(h)).toBe(TITLE_ITEMS.length - 1);

  await h.tap("ArrowDown");
  captureStill(h, "menu");

  expect(h.snapshot().screen).toBe("title");
  expect(menuIndex0(h)).toBe(0);
});
