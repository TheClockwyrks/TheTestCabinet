// screens/fallen-down-moves-highlight — down moves the fallen highlight down.
//
// WHAT THIS DECIDES. One thing, in one direction: on `fallen` with the first
// menu item highlighted, one `down` press leaves the highlight on the second.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md ("`fallen` and `dawn`"): "`menuIndex` is `0` on arriving. `up`
//   and `down` move the highlight and wrap", over `END_ITEMS`, "`TRY AGAIN`,
//   `TITLE`, in that order".
//   specs/controls.md ("What each screen reads"): "`fallen`, `dawn` | none |
//   `up`, `down` move the highlight, wrapping", and `down` is `ArrowDown`,
//   `KeyS`.
//
// THE DRIVE. An isolated `playing` run ended through `setScreen`, which "Ends
// the run exactly as that ending does, the run kept for the end screen to
// report" (specs/instrumentation.md), so the ending's own rules are not on the
// way in and a build whose ending is broken fails the ending's points rather
// than this one. One real `ArrowDown` is then pressed over
// one frame, which ticks nothing, since an end screen advances nothing
// (specs/ui.md, "What advances on each screen").
//
// THE TOLERANCE. None: a menu index and a screen name are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
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

it("moves the fallen highlight from the first item to the second", async () => {
  isolate(h);
  h.debug.setScreen("fallen");
  const before = h.snapshot();
  assertEqual(before.screen, "fallen", "the screen ArrowDown is pressed on");
  assertEqual(before.menuIndex, 0, "the highlight before ArrowDown");

  const after = await tap(h, "ArrowDown");
  captureStill(h, "down");

  assertEqual(after.screen, "fallen", "the screen ArrowDown left the game on");
  assertEqual(after.menuIndex, 1, "the highlight after one ArrowDown");
});
