// Refract — screens/title-down-wraps: one down press on the title's last item
// wraps the selection to the first.
//
// One transition of the menu state machine specs/ui.md fixes: `up` and `down`
// move the highlight by one item and wrap at both ends. The last item is
// reached the plain way — one down per step from the fresh title's 0, no wrap
// involved — and the arrival is asserted before the press under test, so a
// menu that cannot reach its own last item fails on the precondition it
// breaks, not on the wrap. Every press is the `down` action's own bound key,
// dispatched as a real key event at the target the engine listens on (menus
// are keyboard only, specs/ui.md). The still is the frame the wrapping press
// left.

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

it("wraps the title selection from the last item to the first", async () => {
  await resetTo(h);
  assertEqual(h.snapshot().menuIndex, 0, "the title opens with menuIndex 0");

  // Down to the last item, one press per step.
  for (let step = 1; step < TITLE_ITEMS.length; step += 1) {
    await tapAction(h, "down");
  }
  assertEqual(
    h.snapshot().menuIndex,
    TITLE_ITEMS.length - 1,
    "the selection rests on the last item before the wrapping press",
  );

  await tapAction(h, "down");
  captureStill(h, "menu");

  assertEqual(h.snapshot().screen, "title");
  assertEqual(h.snapshot().menuIndex, 0, "one down press wraps 2 to 0");
});
