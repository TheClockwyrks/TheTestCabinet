// instrumentation/tab-rects-empty-off-almanac — `tabRects()` reports an empty
// list on title, howto, playing, levelup, chest, paused, fallen, and dawn.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, Menus: `tabRects`
// "Reports the rectangles of the almanac's tab bar on `almanac` ... Every other
// screen reports an empty list." The tab bar belongs to the almanac alone:
// specs/ui.md gives no other screen a tab bar.
//
// THE SWEEP. All nine screens, each reached through the surface alone, with
// `almanac` READ AS WELL, so a build that answers empty everywhere fails here
// by name rather than passing a sweep that never looked at the one screen the
// bar exists on. What the four rectangles are WORTH on the almanac is the point
// beside this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  tabRects,
  type Harness,
} from "../harness";
import { SCREEN_ROUTES } from "./helpers";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports nothing on every screen but the almanac", async () => {
  for (const [screen, reach] of SCREEN_ROUTES) {
    await reach(h);
    assertEqual(h.snapshot().screen, screen, `the ${screen} screen, reached`);

    const rects = tabRects(h);
    if (screen === "almanac") {
      assertGreaterThan(rects.length, 0, "tabRects() on almanac");
    } else {
      assertLength(rects, 0, `tabRects() on ${screen}`);
    }
  }

  await h.tick(1);
  captureStill(h, "empty");
});
