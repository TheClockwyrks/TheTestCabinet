// screens/almanac-left-moves-tab — `left` moves the almanac's tab one to the
// left.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`almanac`"): "`left` and
// `right` move `almanacTab` by one over `ALMANAC_TABS`, wrap at both ends, and
// set `menuIndex` and `almanacScroll` to `0`." specs/controls.md ("What each
// screen reads"), the `almanac` row: "`left`, `right` move the tab, wrapping",
// and the action table reads `left` as an EDGE on this screen: "`left` |
// `ArrowLeft`, `KeyA` | held on `playing`, edge on `almanac`".
//
// WHY THE WORLD IS POSED AS IT IS. The surface carries no pose for `almanacTab`,
// so the second tab is reached the only way it can be: one `ArrowRight` from the
// `0` the almanac is entered on, read back before the press so that a build
// whose `right` is broken fails the point that owns it rather than this one.
// Both presses are REAL keys through Chromium's input pipeline, each held across
// exactly one frame.
//
// THE TOLERANCE. None: a screen name and a tab index are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { openAlmanac, poseTab, pressLeft } from "./almanac";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads almanacTab 0 after ArrowLeft on the second tab", async () => {
  await openAlmanac(h);
  const posed = await poseTab(h, 1);
  assertEqual(posed.almanacTab, 1, "the tab the press is made on");

  const after = await pressLeft(h);
  await captureStill(h, "left");

  assertEqual(after.screen, "almanac", "the screen after ArrowLeft");
  assertEqual(
    after.almanacTab,
    0,
    "almanacTab after ArrowLeft on the second tab (specs/ui.md)",
  );
});
