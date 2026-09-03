// screens/fallen-wraps-at-top — the fallen highlight wraps past the top.
//
// WHAT THIS DECIDES. One edge case, in one direction: on `fallen` with the
// first menu item highlighted, one `up` press leaves the highlight on the LAST
// item rather than off the top of the menu or stuck where it was.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md ("`fallen` and `dawn`"): "`menuIndex` is `0` on arriving. `up`
//   and `down` move the highlight and wrap", over `END_ITEMS`, so the last
//   item's index is `END_ITEMS.length − 1`.
//   specs/controls.md ("What each screen reads"): "`up`, `down` move the
//   highlight, wrapping".
//
// THE DRIVE. An isolated `playing` run ended through `setScreen`, which "Ends
// the run exactly as that ending does, the run kept for the end screen to
// report" (specs/instrumentation.md), so the ending's own rules are not on the
// way in and a build whose ending is broken fails the ending's points rather
// than this one. The screen is arrived at with the highlight
// already on the first item, so the one `ArrowUp` this point is about is the
// only key pressed.
//
// THE TOLERANCE. None: a menu index is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { END_ITEMS } from "../constants";
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

it("wraps the fallen highlight from the first item to the last", async () => {
  isolate(h);
  h.debug.setScreen("fallen");
  const before = h.snapshot();
  assertEqual(before.screen, "fallen", "the screen ArrowUp is pressed on");
  assertEqual(before.menuIndex, 0, "the highlight before ArrowUp");

  const after = await tap(h, "ArrowUp");
  captureStill(h, "wrap");

  assertEqual(after.screen, "fallen", "the screen ArrowUp left the game on");
  assertEqual(
    after.menuIndex,
    END_ITEMS.length - 1,
    "the highlight after ArrowUp on the first item",
  );
});
