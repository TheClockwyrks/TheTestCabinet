// instrumentation/menu-item-rect-reports-regions — every entry reports where it
// was drawn.
//
// specs/instrumentation.md, `menuItemRect(index)`: it "returns the hit region of
// entry `index` on the current screen's menu, as `{ x, y, width, height }`, in
// the stage's logical units, with `(x, y)` the region's top-left corner".
// specs/controls.md fixes what the region is for and the constraint on the set
// of them: "each entry occupies its own rectangular hit region on the stage,
// measured in logical units. No two regions of one menu overlap". specs/screens.md
// requires one for every entry: both menu-bearing screens "report a hit region
// for every entry" they show.
//
// THE LAYOUT IS THE BUILD'S, so nothing here compares a position against a
// figure: what is read is that a region exists for each entry, that it is a
// real rectangle inside the 1000 x 1000 stage specs/overview.md fixes, and that
// the two regions of one menu are disjoint. That the pointer ACTS over the
// region is the `controls` points' business.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  assertNotNull,
  assertTrue,
} from "../assert";
import { PAUSE_ITEMS, STAGE_H, STAGE_W, TITLE_ITEMS } from "../constants";
import { captureStill, menuRect, openHarness, type Harness } from "../harness";
import { type MenuItemRect } from "../surface";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Whether two regions share any area. */
function overlap(a: MenuItemRect, b: MenuItemRect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

it("reports a distinct on-stage region for every entry of both menus", async () => {
  h.debug.reset();

  for (const [screen, entries] of [
    ["title", TITLE_ITEMS],
    ["paused", PAUSE_ITEMS],
  ] as const) {
    h.debug.setScreen(screen);
    const regions: MenuItemRect[] = [];
    for (let index = 0; index < entries.length; index += 1) {
      const rect = menuRect(h, index);
      assertNotNull(rect, `${screen}: a region for entry ${index}`);
      const at = rect as MenuItemRect;
      assertGreaterThan(at.width, 0, `${screen}: entry ${index}'s width`);
      assertGreaterThan(at.height, 0, `${screen}: entry ${index}'s height`);
      assertGreaterThanOrEqual(at.x, 0, `${screen}: entry ${index}'s left`);
      assertGreaterThanOrEqual(at.y, 0, `${screen}: entry ${index}'s top`);
      assertLessThanOrEqual(
        at.x + at.width,
        STAGE_W,
        `${screen}: entry ${index}'s right, inside the stage`,
      );
      assertLessThanOrEqual(
        at.y + at.height,
        STAGE_H,
        `${screen}: entry ${index}'s bottom, inside the stage`,
      );
      regions.push(at);
    }
    for (let i = 0; i < regions.length; i += 1) {
      for (let j = i + 1; j < regions.length; j += 1) {
        assertTrue(
          !overlap(regions[i], regions[j]),
          `${screen}: entries ${i} and ${j} occupying separate regions`,
        );
      }
    }
  }
  captureStill(h, "regions");
});
