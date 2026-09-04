// instrumentation/menu-rects-empty-without-menu — `menuRects()` reports an
// empty list on howto, playing, and chest.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, Menus: after naming
// the screens that report rectangles, "`howto`, `playing`, and `chest` report
// an empty list." specs/ui.md, Menu navigation, says the same of the state
// those screens hold: "on a screen with no menu it stays `0`", and those three
// are the screens that show no menu at all.
//
// THE DRIVE. Each of the three is reached through the surface alone: `howto`
// and `playing` are `setScreen` rows, and `chest` has no row, so it is opened
// the real way, by a chest collected under the lamplighter. The reading is
// taken with no frame between the arrival and the read, since it "poses
// nothing".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  menuRects,
  type Harness,
} from "../harness";
import { MENU_FREE_SCREENS, SCREEN_ROUTES } from "./helpers";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports nothing on the three screens that show no menu", async () => {
  for (const [screen, reach] of SCREEN_ROUTES) {
    if (!(MENU_FREE_SCREENS as readonly string[]).includes(screen)) continue;

    await reach(h);
    assertEqual(h.snapshot().screen, screen, `the ${screen} screen, reached`);
    assertLength(menuRects(h), 0, `menuRects() on ${screen}`);
  }

  await h.tick(1);
  captureStill(h, "empty");
});
