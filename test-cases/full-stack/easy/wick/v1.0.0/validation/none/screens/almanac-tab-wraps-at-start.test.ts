// screens/almanac-tab-wraps-at-start — `left` on the first tab reaches the last.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`almanac`"): "`left` and
// `right` move `almanacTab` by one over `ALMANAC_TABS`, wrap at both ends".
// The bar is the four of `ALMANAC_TABS`, "`TOOLS`, `TRINKETS`, `ENEMIES`,
// `PICKUPS`, in that order", so the wrap from index `0` is index `3`.
//
// WHY THE WORLD IS POSED AS IT IS. The almanac is entered through
// `setScreen("almanac")`, which specs/instrumentation.md defines as setting
// `screen` alone, "with `menuIndex`, `almanacTab`, and `almanacScroll`
// all `0`", so the screen stands on `almanacTab` `0` without
// a key having been pressed. The press is a REAL `ArrowLeft` through Chromium's
// input pipeline held across exactly one frame.
//
// THE TOLERANCE. None: a screen name and a tab index are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ALMANAC_TABS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { openAlmanac, pressLeft } from "./almanac";

/** The last of the four `ALMANAC_TABS`. */
const LAST_TAB = ALMANAC_TABS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads the last almanacTab after ArrowLeft on the first tab", async () => {
  const opened = await openAlmanac(h);
  assertEqual(opened.almanacTab, 0, "the tab the press is made on");

  const after = await pressLeft(h);
  await captureStill(h, "wrap");

  assertEqual(after.screen, "almanac", "the screen after ArrowLeft");
  assertEqual(
    after.almanacTab,
    LAST_TAB,
    "almanacTab after ArrowLeft on the first tab (specs/ui.md)",
  );
});
