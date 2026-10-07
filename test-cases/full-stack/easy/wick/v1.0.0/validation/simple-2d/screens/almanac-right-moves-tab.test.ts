// screens/almanac-right-moves-tab — right moves the almanac's tab right.
//
// WHAT THIS DECIDES. One thing: a `right` press on `almanac` raises
// `almanacTab` by one. The wrap past the last tab, and what a tab change does
// to the list, are their own points.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`almanac`): "`left` and `right` move `almanacTab` by one over
//   `ALMANAC_TABS`", and "`almanacTab` ... is `0` on arriving".
//   specs/controls.md ("What each screen reads"): on `almanac`, "`left`,
//   `right` move the tab, wrapping".
//   specs/controls.md ("Actions and bindings"): `right` is `ArrowRight`, `KeyD`.
//
// THE DRIVE. The almanac through `setScreen("almanac")`, which enters it
// "exactly as confirming `THE ALMANAC` does" (specs/instrumentation.md), then
// one `ArrowRight` over one frame. The tab it starts from is the `0` the screen
// arrives with, asserted before the press.
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
import { RIGHT_KEY } from "./almanac";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("raises almanacTab by one on a right press", async () => {
  const posed = poseScene(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen ArrowRight is pressed on");
  assertEqual(posed.almanacTab, 0, "the tab the almanac opened on");

  const after = await tap(h, RIGHT_KEY);
  captureStill(h, "right");

  assertEqual(after.screen, "almanac", "the screen the press left the game on");
  assertEqual(after.almanacTab, 1, "the tab ArrowRight moved onto");
});
