// Wick — instrumentation/menu-rects-empty-without-menu: `menuRects()` reports an
// empty list on `howto`, `playing` and `chest`.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `menuRects()`):
// "`howto`, `playing`, and `chest` report an empty list." specs/controls.md
// ("The pointer") names the screens that do answer the pointer — "`title`,
// `almanac`, `levelup`, `paused`, `fallen`, and `dawn`" — and these three are
// the rest, which `MENULESS_SCREENS` restates and this check sweeps.
//
// WHY THE WORLD IS POSED AS IT IS. Each of the three is entered by its own real
// route: `howto` through its `setScreen` row, `playing` as an isolated night,
// and `chest` through "`spawnPickup("chest", x, y)` at the lamplighter's center
// and one tick, which is the real collection path", so the overlay stands over a
// run that was played rather than over a posed screen name. The screen is read
// back before each reading, so an empty list from a build that never left
// `title` is not read as a pass.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, fail } from "../assert";
import { MENULESS_SCREENS, type ScreenName } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  menuRects,
  openChest,
  poseScreen,
  type Harness,
} from "../harness";

/** How each menuless screen is reached, by the route the specification gives it. */
const ROUTES: Readonly<
  Partial<Record<ScreenName, (h: Harness) => Promise<unknown>>>
> = {
  howto: (harness) => poseScreen(harness, "howto"),
  playing: (harness) => isolate(harness),
  chest: async (harness) => {
    await isolate(harness);
    return openChest(harness);
  },
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports no rectangles on a screen carrying no menu", async () => {
  for (const screen of MENULESS_SCREENS) {
    const route = ROUTES[screen];
    if (route === undefined)
      fail(`a route into ${screen}`, Object.keys(ROUTES));
    await route(h);
    const standing = await h.snapshot();
    assertEqual(standing.screen, screen, "the screen the reading is taken on");
    assertLength(await menuRects(h), 0, `menuRects() on ${screen}`);
  }
  await captureStill(h, "empty");
});
