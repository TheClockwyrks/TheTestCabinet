// screens/almanac-tab-wraps-at-start — the tab bar wraps past its first tab.
//
// WHAT THIS DECIDES. One thing: a `left` press with the first of the four
// `ALMANAC_TABS` shown reaches the last, rather than stopping at the start.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`almanac`): "`left` and `right` move `almanacTab` by one over
//   `ALMANAC_TABS`, wrap at both ends", with the bar "`TOOLS`, `TRINKETS`,
//   `ENEMIES`, `PICKUPS`, in that order", and "`almanacTab` ... is `0` on
//   arriving".
//   specs/controls.md ("What each screen reads"): on `almanac`, "`left`,
//   `right` move the tab, wrapping".
//
// THE DRIVE. The almanac through `setScreen("almanac")`, whose `almanacTab` is
// the `0` the screen arrives with, then one `ArrowLeft` over one frame. The
// tab it must reach comes from the length of `ALMANAC_TABS`.
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
import { LEFT_KEY } from "./almanac";

let h: Harness;

/** The index of the last tab: three, for the four tabs specs/ui.md names. */
const LAST = ALMANAC_TABS.length - 1;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reaches the last tab from the first on a left press", async () => {
  const posed = poseScene(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen ArrowLeft is pressed on");
  assertEqual(posed.almanacTab, 0, "the tab the wrap is pressed from");

  const after = await tap(h, LEFT_KEY);
  captureStill(h, "wrap");

  assertEqual(after.screen, "almanac", "the screen the press left the game on");
  assertEqual(after.almanacTab, LAST, "the tab the wrap reached");
});
