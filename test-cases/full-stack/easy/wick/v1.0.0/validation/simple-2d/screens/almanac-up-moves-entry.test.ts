// screens/almanac-up-moves-entry — up moves the almanac's entry highlight up.
//
// WHAT THIS DECIDES. One thing: an `up` press on `almanac` lowers `menuIndex`
// by one. The wrap past the first entry is its own point.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`almanac`): "`up` and `down` move `menuIndex` by one over the
//   tab's entries and wrap at both ends".
//   specs/controls.md ("What each screen reads"): on `almanac`, "`up`, `down`
//   move the entry highlight, wrapping".
//   specs/controls.md ("Actions and bindings"): `up` is `ArrowUp`, `KeyW`.
//
// THE DRIVE. The almanac through `setScreen("almanac")`, then one `ArrowDown`
// to bring `menuIndex` to `1`, which is `almanac-down-moves-entry`'s point and
// is asserted here as the precondition it is, then the `ArrowUp` this point is
// about. The surface poses no `menuIndex`, so the screen's own key is the only
// way onto the second entry.
//
// THE TOLERANCE. None: a menu index is an exact figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseScene,
  tap,
  type Harness,
} from "../harness";
import { DOWN_KEY, UP_KEY } from "./almanac";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lowers menuIndex by one on an up press", async () => {
  const posed = poseScene(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen the keys are pressed on");

  const staged = await tap(h, DOWN_KEY);
  assertEqual(staged.menuIndex, 1, "the entry ArrowUp is pressed from");

  const after = await tap(h, UP_KEY);
  captureStill(h, "up");

  assertEqual(after.screen, "almanac", "the screen the press left the game on");
  assertEqual(after.menuIndex, 0, "the entry ArrowUp moved onto");
});
