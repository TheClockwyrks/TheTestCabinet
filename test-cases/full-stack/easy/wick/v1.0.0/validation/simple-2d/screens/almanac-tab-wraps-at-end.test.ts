// screens/almanac-tab-wraps-at-end — the tab bar wraps past its last tab.
//
// WHAT THIS DECIDES. One thing: a `right` press with the last of the four
// `ALMANAC_TABS` shown reaches the first, rather than stopping at the end.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`almanac`): "`left` and `right` move `almanacTab` by one over
//   `ALMANAC_TABS`, wrap at both ends", with the bar "`TOOLS`, `TRINKETS`,
//   `ENEMIES`, `PICKUPS`, in that order".
//   specs/controls.md ("What each screen reads"): on `almanac`, "`left`,
//   `right` move the tab, wrapping".
//
// THE DRIVE. The almanac through `setScreen("almanac")`, then `ArrowRight`
// pressed once for each tab past the first, which walks `almanacTab` to the
// last tab through the screen's own key; the count comes from the length of
// `ALMANAC_TABS` rather than from a written-in index. The last tab is asserted
// before the press this point is about.
//
// THE TOLERANCE. None: a tab index is an exact figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ALMANAC_TABS } from "../constants";
import {
  captureStill,
  createHarness,
  poseScene,
  tap,
  type Harness,
} from "../harness";
import { RIGHT_KEY, tapTimes } from "./almanac";

let h: Harness;

/** The index of the last tab: three, for the four tabs specs/ui.md names. */
const LAST = ALMANAC_TABS.length - 1;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reaches the first tab from the last on a right press", async () => {
  const posed = poseScene(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen the keys are pressed on");

  const staged = await tapTimes(h, RIGHT_KEY, LAST);
  assertEqual(staged.almanacTab, LAST, "the tab the wrap is pressed from");

  const after = await tap(h, RIGHT_KEY);
  captureStill(h, "wrap");

  assertEqual(after.screen, "almanac", "the screen the press left the game on");
  assertEqual(after.almanacTab, 0, "the tab the wrap reached");
});
