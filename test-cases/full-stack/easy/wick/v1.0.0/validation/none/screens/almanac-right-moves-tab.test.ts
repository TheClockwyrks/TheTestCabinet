// screens/almanac-right-moves-tab — `right` moves the almanac's tab one to the
// right.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`almanac`"): "`left` and
// `right` move `almanacTab` by one over `ALMANAC_TABS`, wrap at both ends, and
// set `menuIndex` and `almanacScroll` to `0`." specs/controls.md ("What each
// screen reads"), the `almanac` row: "`left`, `right` move the tab, wrapping",
// and the action table reads `right` as an EDGE on this screen: "`right` |
// `ArrowRight`, `KeyD` | held on `playing`, edge on `almanac`".
//
// WHY THE WORLD IS POSED AS IT IS. The almanac is entered through
// `setScreen("almanac")`, which specs/instrumentation.md defines as setting
// `screen` alone, "with `menuIndex`, `almanacTab`, and `almanacScroll`
// all `0`", so the screen stands on `almanacTab` `0` without
// a key having been pressed. The press is a REAL `ArrowRight` through
// Chromium's input pipeline held across exactly one frame, which is one press
// edge whichever of the two conformant ways a build reads one. What a tab change
// does to the highlight and the list is `almanac-tab-change-resets-entry`.
//
// THE TOLERANCE. None: a screen name and a tab index are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { openAlmanac, pressRight } from "./almanac";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads almanacTab 1 after ArrowRight on the first tab", async () => {
  const opened = await openAlmanac(h);
  assertEqual(opened.almanacTab, 0, "the tab the press is made on");

  const after = await pressRight(h);
  await captureStill(h, "right");

  assertEqual(after.screen, "almanac", "the screen after ArrowRight");
  assertEqual(
    after.almanacTab,
    1,
    "almanacTab after ArrowRight on the first tab (specs/ui.md)",
  );
});
