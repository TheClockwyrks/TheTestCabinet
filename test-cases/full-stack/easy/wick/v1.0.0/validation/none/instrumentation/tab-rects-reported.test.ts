// Wick — instrumentation/tab-rects-reported: on `almanac`, `tabRects()` reports
// one rectangle per tab in `ALMANAC_TABS` order, each carrying `x`, `y`,
// `width` and `height` in stage coordinates.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `tabRects()`):
// "Reports the rectangles of the almanac's tab bar on `almanac`, one per tab in
// `ALMANAC_TABS` order, each a plain object carrying `x`, `y`, `width`, and
// `height` in the same stage coordinates", and "Each rectangle is the area a
// click selects that tab inside." specs/ui.md gives the bar its four tabs, "the
// tab bar `ALMANAC_TABS` (`TOOLS`, `TRINKETS`, `ENEMIES`, `PICKUPS`, in that
// order) across the top".
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. How many rectangles came back, the
// four numbers each carries, and which tab each position belongs to. The last is
// read the only way the specification defines it: a rectangle is the area a
// click selects its tab inside, and specs/controls.md has "a click inside the
// rectangle of a tab the almanac is not showing selects that tab exactly as
// `right` reaching it does", so the tab a position belongs to is the
// `almanacTab` a click there leaves. Where the bar sits on the stage is not
// read; specs/ui.md fixes "no layout".
//
// WHY THE WORLD IS POSED AS IT IS. The almanac opens on `almanacTab` `0`, and
// the four positions are clicked in the order `1, 2, 3, 0`, so every click falls
// on a tab the almanac is not showing and none of them meets the rule that "a
// click inside the shown tab's rectangle changes nothing". The bar is read again
// before each click, so a build that lays its tabs out differently per tab is
// read as it stands rather than against a stale reading.
//
// A FRAME RUNS BETWEEN ONE CLICK AND THE NEXT. specs/controls.md reads the
// primary button the way it reads a key: "a press edge, true once for the frame
// in which the held value went from `0` to `1`". A build that samples the button
// once a frame and compares it with the frame before sees an edge only when a
// frame ran while the button was up, so each pass of the loop runs one frame
// before it presses again. Without it the button would go up and back down
// entirely between two frames, and only a build latching the event would read
// the second click at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, fail } from "../assert";
import { ALMANAC_TABS } from "../constants";
import {
  captureStill,
  centerOf,
  clickAt,
  createHarness,
  poseScreen,
  tabRects,
  type Harness,
} from "../harness";
import { assertRects, movingOrder } from "./rects";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports one rectangle per tab, in ALMANAC_TABS order", async () => {
  const opened = await poseScreen(h, "almanac");
  assertEqual(opened.almanacTab, 0, "the tab the almanac opens on");

  const bar = await tabRects(h);
  await captureStill(h, "tabs");
  assertLength(bar, ALMANAC_TABS.length, "tabRects() on almanac");
  assertRects(bar, "tabRects() on almanac");

  for (const position of movingOrder(ALMANAC_TABS.length)) {
    // The frame that reads the previous click's release, which is what makes
    // the next press an edge under a build sampling the button once a frame.
    await h.step(1);
    const rects = await tabRects(h);
    assertLength(rects, ALMANAC_TABS.length, "tabRects() on almanac");
    const rect = rects[position];
    if (rect === undefined) fail(`a rectangle at position ${position}`, rects);
    const clicked = await clickAt(h, centerOf(rect));
    assertEqual(
      clicked.almanacTab,
      position,
      `the tab tabRects()[${position}] belongs to, ${ALMANAC_TABS[position]}`,
    );
  }
});
