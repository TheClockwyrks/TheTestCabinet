// Refract — screens/title-up-wraps: one up press on the title's first item
// wraps the selection to the last.
//
// One transition of the menu state machine specs/ui.md fixes: `up` and `down`
// move the highlight by one item and wrap at both ends. It starts from a fresh
// title, which `resetTo` restores with `menuIndex` at 0 and settles with one
// advanced frame, so a tap's edge cannot be consumed by a world the reset is
// leaving. The press is the `up` action's own bound key, dispatched as a real
// key event at the target the engine listens on — menus are keyboard only,
// driven by the registered actions (specs/ui.md) — and the result is read back
// off the game's own state. The still is the frame the press left.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
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
  await resetTo(h);
  assertEqual(h.snapshot().menuIndex, 0, "the title opens with menuIndex 0");
  assertEqual(TITLE_ITEMS.length, 3, "the title menu holds three items");

  await tapAction(h, "up");
  captureStill(h, "menu");

  assertEqual(h.snapshot().screen, "title");
  assertEqual(h.snapshot().menuIndex, 2, "one up press wraps 0 to 2");
});
