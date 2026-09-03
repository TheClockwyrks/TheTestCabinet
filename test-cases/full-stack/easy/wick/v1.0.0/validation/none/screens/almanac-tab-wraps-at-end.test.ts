// screens/almanac-tab-wraps-at-end — `right` on the last tab reaches the first.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`almanac`"): "`left` and
// `right` move `almanacTab` by one over `ALMANAC_TABS`, wrap at both ends".
// The bar is the four of `ALMANAC_TABS`, "`TOOLS`, `TRINKETS`, `ENEMIES`,
// `PICKUPS`, in that order", so the last tab is index `3` and the wrap from it
// is `0`.
//
// WHY THE WORLD IS POSED AS IT IS. The surface carries no pose for `almanacTab`,
// so the last tab is reached the only way it can be: one `ArrowRight` per tab
// from the `0` the almanac is entered on, read back before the press that wraps
// so that a build whose `right` is broken fails the point that owns it rather
// than this one. Every press is a REAL key through Chromium's input pipeline,
// held across exactly one frame.
//
// THE TOLERANCE. None: a screen name and a tab index are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ALMANAC_TABS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { openAlmanac, poseTab, pressRight } from "./almanac";

/** The last of the four `ALMANAC_TABS`. */
const LAST_TAB = ALMANAC_TABS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads almanacTab 0 after ArrowRight on the last tab", async () => {
  await openAlmanac(h);
  const posed = await poseTab(h, LAST_TAB);
  assertEqual(posed.almanacTab, LAST_TAB, "the tab the press is made on");

  const after = await pressRight(h);
  await captureStill(h, "wrap");

  assertEqual(after.screen, "almanac", "the screen after ArrowRight");
  assertEqual(
    after.almanacTab,
    0,
    "almanacTab after ArrowRight on the last tab (specs/ui.md)",
  );
});
