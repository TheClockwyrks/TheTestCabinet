// screens/paused-wraps-at-bottom — the pause highlight wraps past the bottom.
//
// WHAT THIS DECIDES. One edge case, in one direction: on `paused` with the LAST
// item highlighted, one `down` press leaves the highlight on the first item
// rather than off the end of the menu or stuck where it was.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`paused`): "`up` and `down` move the highlight and wrap at
//   both ends"; the menu is `PAUSE_ITEMS`, "`RESUME`, `MAIN MENU`, in that
//   order", so the last item's index is `PAUSE_ITEMS.length − 1`.
//   specs/controls.md ("What each screen reads"): "`paused` | none | `up`,
//   `down` move the highlight, wrapping".
//
// THE DRIVE. An isolated `playing` run paused through `setScreen("paused")`,
// which enters the screen "Exactly as `pause` does"
// (specs/instrumentation.md); then `ArrowDown` pressed to the last item,
// asserted, then the press this point is about. The surface poses no
// `menuIndex`, so the last item is reached with the menu's own key.
//
// THE TOLERANCE. None: a menu index is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  tap,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("wraps the pause highlight from the last item to the first", async () => {
  isolate(h);
  h.debug.setScreen("paused");
  const last = PAUSE_ITEMS.length - 1;
  let staged = h.snapshot();
  for (let press = 0; press < last; press += 1) {
    staged = await tap(h, "ArrowDown");
  }
  assertEqual(staged.screen, "paused", "the screen ArrowDown is pressed on");
  assertEqual(staged.menuIndex, last, "the highlight on the last pause item");

  const after = await tap(h, "ArrowDown");
  captureStill(h, "wrap");

  assertEqual(after.screen, "paused", "the screen ArrowDown left the game on");
  assertEqual(
    after.menuIndex,
    0,
    "the highlight after ArrowDown on the last item",
  );
});
