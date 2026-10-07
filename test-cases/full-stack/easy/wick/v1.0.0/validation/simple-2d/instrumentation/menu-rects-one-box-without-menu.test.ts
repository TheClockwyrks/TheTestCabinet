// instrumentation/menu-rects-one-box-without-menu — `menuRects()` reports
// exactly one rectangle on `howto` and on `chest`.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, Menus: "`howto` and
// `chest` report exactly one rectangle, the area the screen's way out is taken
// in." specs/controls.md, The pointer and touch, says the same from the rules'
// side: "`howto` and `chest` show no menu, and each answers the pointer and
// touch on one rectangle instead ... It is that screen's rectangle at position
// `0`."
//
// WHAT IS READ. The length of the list on each of the two, and that the box has
// a positive extent lying on the stage: a box of no width answers no gesture, so
// a build reporting one would satisfy the count and still leave a player with no
// way out. What the box DOES is the Pointer category's.
//
// THE DRIVE. Each screen through its own route: `howto` is a `setScreen` row,
// and `chest` has none, so it is opened the real way, by a chest collected under
// the lamplighter.
//
// THE TOLERANCE. None: a count, and an extent that is above zero or is not.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertLessThan,
} from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import {
  captureStill,
  createHarness,
  menuRects,
  type Harness,
  type WickRect,
} from "../harness";
import { ONE_BOX_SCREENS, SCREEN_ROUTES } from "./helpers";

/** The box lies on the stage with an area a finger can land in. */
function assertUsable(rect: WickRect, screen: string): void {
  assertGreaterThan(rect.width, 0, `the width of the box on ${screen}`);
  assertGreaterThan(rect.height, 0, `the height of the box on ${screen}`);
  assertGreaterThan(
    rect.x + rect.width,
    0,
    `the right edge of the box on ${screen}, on the stage`,
  );
  assertLessThan(
    rect.x,
    STAGE_W,
    `the left edge of the box on ${screen}, on the stage`,
  );
  assertGreaterThan(
    rect.y + rect.height,
    0,
    `the bottom edge of the box on ${screen}, on the stage`,
  );
  assertLessThan(
    rect.y,
    STAGE_H,
    `the top edge of the box on ${screen}, on the stage`,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports one usable box on each screen that shows no menu", async () => {
  for (const [screen, reach] of SCREEN_ROUTES) {
    if (!(ONE_BOX_SCREENS as readonly string[]).includes(screen)) continue;

    await reach(h);
    assertEqual(h.snapshot().screen, screen, `the ${screen} screen, reached`);
    const rects = menuRects(h);
    assertLength(rects, 1, `menuRects() on ${screen}`);
    assertUsable(rects[0], screen);
  }

  await h.tick(1);
  captureStill(h, "boxes");
});
