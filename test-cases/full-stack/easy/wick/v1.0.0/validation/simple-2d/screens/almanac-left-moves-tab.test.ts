// screens/almanac-left-moves-tab — left moves the almanac's tab left.
//
// WHAT THIS DECIDES. One thing: a `left` press on `almanac` lowers
// `almanacTab` by one. The wrap past the first tab is its own point.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`almanac`): "`left` and `right` move `almanacTab` by one over
//   `ALMANAC_TABS`".
//   specs/controls.md ("What each screen reads"): on `almanac`, "`left`,
//   `right` move the tab, wrapping".
//   specs/controls.md ("Actions and bindings"): `left` is `ArrowLeft`, `KeyA`.
//
// THE DRIVE. The almanac through `setScreen("almanac")`, then one `ArrowRight`
// to bring `almanacTab` to `1`, which is `almanac-right-moves-tab`'s point and
// is asserted here as the precondition it is, then the `ArrowLeft` this point is
// about. The surface poses no `almanacTab`, so the screen's own key is the only
// way onto the second tab.
//
// THE TOLERANCE. None: a tab index is an exact figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseScene,
  tap,
  type Harness,
} from "../harness";
import { LEFT_KEY, RIGHT_KEY } from "./almanac";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lowers almanacTab by one on a left press", async () => {
  const posed = poseScene(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen the keys are pressed on");

  const staged = await tap(h, RIGHT_KEY);
  assertEqual(staged.almanacTab, 1, "the tab ArrowLeft is pressed from");

  const after = await tap(h, LEFT_KEY);
  captureStill(h, "left");

  assertEqual(after.screen, "almanac", "the screen the press left the game on");
  assertEqual(after.almanacTab, 0, "the tab ArrowLeft moved onto");
});
