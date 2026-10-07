// screens/almanac-down-moves-entry — down moves the almanac's entry highlight.
//
// WHAT THIS DECIDES. One thing: a `down` press on `almanac` raises `menuIndex`
// by one. The wrap past the last entry, and the window the list scrolls to hold
// the highlight, are their own points.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`almanac`): "`up` and `down` move `menuIndex` by one over the
//   tab's entries and wrap at both ends", and "`menuIndex` ... is `0` on
//   arriving".
//   specs/controls.md ("What each screen reads"): on `almanac`, "`up`, `down`
//   move the entry highlight, wrapping".
//   specs/controls.md ("Actions and bindings"): `down` is `ArrowDown`, `KeyS`.
//
// THE DRIVE. The almanac through `setScreen("almanac")`, which enters it
// "exactly as confirming `THE ALMANAC` does" (specs/instrumentation.md), then
// one `ArrowDown` over one frame. The entry it starts from is the `0` the
// screen arrives with, asserted before the press.
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
import { DOWN_KEY } from "./almanac";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("raises menuIndex by one on a down press", async () => {
  const posed = poseScene(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen ArrowDown is pressed on");
  assertEqual(posed.menuIndex, 0, "the entry the almanac opened on");

  const after = await tap(h, DOWN_KEY);
  captureStill(h, "down");

  assertEqual(after.screen, "almanac", "the screen the press left the game on");
  assertEqual(after.menuIndex, 1, "the entry ArrowDown moved onto");
});
