// Refract — screens/title-down-wraps: one down press on the title's last item
// wraps the selection to the first.
//
// One transition of the menu state machine specs/ui.md fixes: `up` and `down`
// move the highlight by one item and wrap at both ends. The highlight is POSED
// onto the last item with `setMenuIndex`, the operation that sets its own field
// alone — stepping to it is `screens/title-down`'s own review item, and a build
// that cannot step must still be graded on whether it wraps. Every press is the
// `down` action's own bound key, dispatched as a real key event at the target
// the engine listens on (menus are keyboard only, specs/ui.md). The still is
// the frame the wrapping press left.

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

  // Pose the highlight onto the last item.
  h.debug.setMenuIndex(TITLE_ITEMS.length - 1);
  await h.advance(1);
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
