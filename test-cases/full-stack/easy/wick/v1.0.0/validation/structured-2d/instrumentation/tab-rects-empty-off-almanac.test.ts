// Wick — instrumentation/tab-rects-empty-off-almanac: `tabRects()` reports an
// empty list on every screen but `almanac`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// "Menus", `tabRects()`: "Reports the rectangles of the almanac's tab bar on
// `almanac` ... Every other screen reports an empty list." The eight other
// screens are the rest of `specs/state.md`'s `Screen` values: `title`,
// `howto`, `playing`, `levelup`, `chest`, `paused`, `fallen`, and `dawn`.
//
// WHAT IS READ, AND WHY. The length of the reported list on each of the eight,
// and on `almanac` for the contrast, so a reading that is empty everywhere
// cannot pass this by reporting nothing at all.
//
// THE DRIVE. Each screen is reached through the surface and the real ticks
// (`reset`, `setScreen`, and the harness's `openLevelUp`, `openChest`,
// `endFallen`, `endDawn`, which run the one tick that opens or ends), from an
// isolated run.
//
// THE TOLERANCE. None: a list is empty or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  endDawn,
  endFallen,
  isolate,
  openChest,
  openLevelUp,
  poseScreen,
  tabRects,
  type Harness,
  type Screen,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** The reported list is empty on the screen just reached. */
function assertEmptyOn(screen: Screen): void {
  assertEqual(h.snapshot().screen, screen, `screen reached for ${screen}`);
  assertLength(tabRects(h), 0, `tabRects() on ${screen}`);
}

it("reports no tab rectangles on the eight screens that are not the almanac", async () => {
  poseScreen(h, "almanac");
  assertGreaterThan(
    tabRects(h).length,
    0,
    "tabRects() on almanac, the screen that has a tab bar",
  );

  h.reset();
  assertEmptyOn("title");

  poseScreen(h, "howto");
  assertEmptyOn("howto");

  isolate(h);
  assertEmptyOn("playing");

  isolate(h);
  await openLevelUp(h, 1);
  assertEmptyOn("levelup");

  isolate(h);
  await openChest(h);
  assertEmptyOn("chest");

  isolate(h);
  poseScreen(h, "paused");
  assertEmptyOn("paused");

  isolate(h);
  await endFallen(h);
  assertEmptyOn("fallen");

  isolate(h);
  await endDawn(h);
  await h.frameDraw();
  captureStill(h, "empty");
  assertEmptyOn("dawn");
});
