// screens/paused-wraps-at-top — the pause highlight wraps past the top.
//
// WHAT THIS DECIDES. One edge case, in one direction: on `paused` with the
// FIRST item highlighted, one `up` press leaves the highlight on the last item
// rather than off the top of the menu or stuck where it was.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`paused`): "`menuIndex` is `0` on arriving. `up` and `down`
//   move the highlight and wrap at both ends"; the menu is `PAUSE_ITEMS`,
//   "`RESUME`, `MAIN MENU`, in that order", so the last item's index is
//   `PAUSE_ITEMS.length − 1`.
//   specs/controls.md ("What each screen reads"): "`paused` | none | `up`,
//   `down` move the highlight, wrapping".
//
// THE DRIVE. An isolated `playing` run paused through `setScreen("paused")`,
// which enters the screen "Exactly as `pause` does"
// (specs/instrumentation.md). The screen is arrived at with the highlight
// already on the first item, so the one `ArrowUp` this point is about is the
// only key pressed.
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

it("wraps the pause highlight from the first item to the last", async () => {
  isolate(h);
  h.debug.setScreen("paused");
  const before = h.snapshot();
  assertEqual(before.screen, "paused", "the screen ArrowUp is pressed on");
  assertEqual(before.menuIndex, 0, "the highlight before ArrowUp");

  const after = await tap(h, "ArrowUp");
  captureStill(h, "wrap");

  assertEqual(after.screen, "paused", "the screen ArrowUp left the game on");
  assertEqual(
    after.menuIndex,
    PAUSE_ITEMS.length - 1,
    "the highlight after ArrowUp on the first item",
  );
});
