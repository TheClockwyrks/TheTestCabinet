// instrumentation/tab-rects-reported — on `almanac`, `tabRects()` reports one
// rectangle per tab in ALMANAC_TABS order, each carrying x, y, width, and
// height in stage coordinates.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, Menus: "Reports the
// rectangles of the almanac's tab bar on `almanac`, one per tab in
// `ALMANAC_TABS` order, each a plain object carrying `x`, `y`, `width`, and
// `height` in the same stage coordinates." specs/ui.md (`almanac`): "the tab
// bar `ALMANAC_TABS` (`TOOLS`, `TRINKETS`, `ENEMIES`, `PICKUPS`, in that order)
// across the top". specs/controls.md, The pointer: "no two of a screen's
// rectangles overlap".
//
// WHAT IS READ. The four rectangles the reading hands back: that there are as
// many as `ALMANAC_TABS` holds, that each carries the four fields as finite
// numbers with an inside, that each lies on the stage, and that no two of them
// overlap. `ALMANAC_TABS` order is the order of the ARRAY, which is what
// specs/instrumentation.md fixes; where across the top the bar runs, and in
// which direction, is not read, since specs/ui.md places no tab relative to
// another. Which tab a rectangle then selects for a click is a pointer point.
//
// THE DRIVE. `setScreen('almanac')` alone: the bar is the same four tabs
// whatever the highlight, and the reading "poses nothing", so no frame runs
// between the arrival and the read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ALMANAC_TABS } from "../constants";
import {
  captureStill,
  createHarness,
  poseScene,
  tabRects,
  type Harness,
} from "../harness";
import { assertRects } from "./rects";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports one rectangle per tab, each on the stage and disjoint", async () => {
  const entered = poseScene(h, "almanac");
  assertEqual(entered.screen, "almanac", "the almanac, reached");

  const rects = tabRects(h);
  await h.tick(1);
  captureStill(h, "tabs");

  assertRects(rects, ALMANAC_TABS.length, "tabRects() on almanac");
});
