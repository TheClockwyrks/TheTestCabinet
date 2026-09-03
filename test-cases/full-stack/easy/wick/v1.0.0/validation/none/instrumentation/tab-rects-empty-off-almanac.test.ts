// Wick — instrumentation/tab-rects-empty-off-almanac: `tabRects()` reports an
// empty list on `title`, `howto`, `playing`, `levelup`, `chest`, `paused`,
// `fallen` and `dawn` — every screen but `almanac`.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `tabRects()`):
// "Reports the rectangles of the almanac's tab bar on `almanac` ... Every other
// screen reports an empty list." The eight are the nine of `SCREENS` less
// `almanac`, and specs/ui.md gives the tab bar to the almanac alone.
//
// WHY THE WORLD IS POSED AS IT IS. Every screen is swept, each entered by its
// own real route: `title` by a reset, `howto` and the two endings through their
// `setScreen` rows, `playing` as an isolated night, `levelup` by the tick that a
// queued level-up opens, `chest` by the tick that collects a chest, and `paused`
// through its own row. The screen is read back before each reading, so an empty
// list from a build that never left the screen before it is not read as a pass.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, fail } from "../assert";
import { SCREENS, type ScreenName } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openChest,
  openLevelUp,
  poseScreen,
  tabRects,
  type Harness,
} from "../harness";

/** How each screen is reached, by the route the specification gives it. */
const ROUTES: Readonly<Record<ScreenName, (h: Harness) => Promise<unknown>>> = {
  title: (harness) => harness.debug.reset(),
  howto: (harness) => poseScreen(harness, "howto"),
  almanac: (harness) => poseScreen(harness, "almanac"),
  playing: (harness) => isolate(harness),
  levelup: async (harness) => {
    await isolate(harness);
    return openLevelUp(harness);
  },
  chest: async (harness) => {
    await isolate(harness);
    return openChest(harness);
  },
  paused: async (harness) => {
    await isolate(harness);
    return poseScreen(harness, "paused");
  },
  fallen: async (harness) => {
    await isolate(harness);
    return poseScreen(harness, "fallen");
  },
  dawn: async (harness) => {
    await isolate(harness);
    return poseScreen(harness, "dawn");
  },
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports no tab rectangles on any screen but the almanac", async () => {
  for (const screen of SCREENS) {
    if (screen === "almanac") continue;
    const route = ROUTES[screen];
    if (route === undefined)
      fail(`a route into ${screen}`, Object.keys(ROUTES));
    await route(h);
    const standing = await h.snapshot();
    assertEqual(standing.screen, screen, "the screen the reading is taken on");
    assertLength(await tabRects(h), 0, `tabRects() on ${screen}`);
  }
  await captureStill(h, "empty");
});
