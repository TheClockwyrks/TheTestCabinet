// Refract — screens/title-down: one down press on the title moves the
// selection from the first item to the second.
//
// One transition of the menu state machine specs/ui.md fixes: `up` and `down`
// move the highlight by one item. It starts from a fresh title, which
// `resetTo` restores with `menuIndex` at 0 and settles with one advanced
// frame, so a tap's edge cannot be consumed by a world the reset is leaving.
// The press is the `down` action's own bound key, dispatched as a real key
// event at the target the engine listens on — menus are keyboard only, driven
// by the registered actions (specs/ui.md) — and the result is read back off
// the game's own state. The still is the frame the press left.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../../src/constants";
import { assertEqual, assertGreaterThan } from "../assert";
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

it("moves the title selection from the first item to the second", async () => {
  await resetTo(h);
  assertEqual(h.snapshot().menuIndex, 0, "the title opens with menuIndex 0");
  assertGreaterThan(TITLE_ITEMS.length, 1);

  await tapAction(h, "down");
  captureStill(h, "menu");

  assertEqual(h.snapshot().screen, "title");
  assertEqual(h.snapshot().menuIndex, 1, "one down press moves 0 to 1");
});
