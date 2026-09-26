// screens/dawn-wraps-at-bottom — the dawn highlight wraps past the bottom.
//
// WHAT THIS DECIDES. One edge case, in one direction: on `dawn` with the LAST
// menu item highlighted, one `down` press leaves the highlight on the first
// rather than off the end of the menu or stuck where it was.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md ("`fallen` and `dawn`"): "`up` and `down` move the highlight
//   and wrap", over `END_ITEMS`, "`TRY AGAIN`, `TITLE`, in that order", so the
//   last item's index is `END_ITEMS.length − 1`.
//   specs/controls.md ("What each screen reads"): "`up`, `down` move the
//   highlight, wrapping".
//
// THE DRIVE. An isolated `playing` run ended through `setScreen`, which "Ends
// the run exactly as that ending does, the run kept for the end screen to
// report" (specs/instrumentation.md), so the ending's own rules are not on the
// way in and a build whose ending is broken fails the ending's points rather
// than this one. The last item is then reached with the
// menu's own key, which the surface poses no other way, and asserted before the
// press this point is about.
//
// THE TOLERANCE. None: a menu index is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { END_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  endDawn,
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

it("wraps the dawn highlight from the last item to the first", async () => {
  isolate(h);
  await endDawn(h);
  const last = END_ITEMS.length - 1;
  let staged = h.snapshot();
  for (let press = 0; press < last; press += 1) {
    staged = await tap(h, "ArrowDown");
  }
  assertEqual(staged.screen, "dawn", "the screen ArrowDown is pressed on");
  assertEqual(staged.menuIndex, last, "the highlight on the last item");

  const after = await tap(h, "ArrowDown");
  captureStill(h, "wrap");

  assertEqual(after.screen, "dawn", "the screen ArrowDown left the game on");
  assertEqual(
    after.menuIndex,
    0,
    "the highlight after ArrowDown on the last item",
  );
});
