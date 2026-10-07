// instrumentation/menu-rects-empty-on-playing — `menuRects()` reports an empty
// list on `playing`.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, Menus: after naming
// the screens that report rectangles, "`playing` reports an empty list."
// specs/controls.md, The pointer and touch, closes its list of answering
// screens with "`playing` answers neither", so the run screen is the one screen
// a gesture reaches nothing on.
//
// THE DRIVE. `playing` is reached as a fresh run through the surface alone. The
// reading is taken with no frame between the arrival and the read, since it
// "poses nothing". That `howto` and `chest` report their one box each is
// `menu-rects-one-box-without-menu`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  menuRects,
  type Harness,
} from "../harness";
import { RECTLESS_SCREENS, SCREEN_ROUTES } from "./helpers";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports nothing on the run screen", async () => {
  for (const [screen, reach] of SCREEN_ROUTES) {
    if (!(RECTLESS_SCREENS as readonly string[]).includes(screen)) continue;

    await reach(h);
    assertEqual(h.snapshot().screen, screen, `the ${screen} screen, reached`);
    assertLength(menuRects(h), 0, `menuRects() on ${screen}`);
  }

  await h.tick(1);
  captureStill(h, "empty");
});
