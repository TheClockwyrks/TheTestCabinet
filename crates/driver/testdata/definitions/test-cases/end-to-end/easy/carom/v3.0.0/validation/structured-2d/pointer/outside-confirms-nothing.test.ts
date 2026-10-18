// Carom — pointer/outside-confirms-nothing: a press and a release outside every
// item confirms nothing.
//
// specs/ui.md, "Pointer and touch": two edges that fall in different regions,
// AND an edge that falls outside every region, confirm no item.
// `slide-off-cancels` reads the first half; this reads the second, which is the
// edge a build that hit-tests by NEAREST item rather than by containment gets
// wrong.
//
// The three title regions are read back through `menuItemRect` first, and the
// click lands on a point of the field inside none of them, with a few units to
// spare so a rounding at a boundary cannot decide the point. Where the items sit
// is the build's own, so the empty point is FOUND rather than assumed: a grid of
// the field is walked and the first point clear of every region is taken.
//
// Nothing moved and nothing opened is the whole reading: `screen` still `title`
// says no item was confirmed, and `menuIndex` where it was posed says none was
// selected either.
//
// Nothing on the field is posed or removed: nothing advances on `title`
// (specs/ui.md), so the gesture runs over a world that cannot move under it, and
// no paddle is taken — a menu is not driven through one. The still is the frame
// the gesture left.

import { afterEach, beforeEach, it } from "vitest";
import { FIELD_H, FIELD_W, TITLE_ITEMS } from "../constants";
import { assertEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  menuRect,
  openTitle,
  type Harness,
  type MenuRect,
} from "../harness";

/** VERSUS, the entry the selection is posed on (specs/ui.md, `TITLE_ITEMS`). */
const VERSUS = TITLE_ITEMS.indexOf("VERSUS");

/** How far clear of every region the clicked point has to be, in units. */
const CLEARANCE = 4;

/** A point of the field inside none of `rects`, with `CLEARANCE` to spare. */
function outsideEvery(rects: readonly MenuRect[]): { x: number; y: number } {
  for (let y = 20; y < FIELD_H; y += 20) {
    for (let x = 20; x < FIELD_W; x += 20) {
      const clear = rects.every(
        (rect) =>
          x < rect.x - CLEARANCE ||
          x > rect.x + rect.w + CLEARANCE ||
          y < rect.y - CLEARANCE ||
          y > rect.y + rect.h + CLEARANCE,
      );
      if (clear) return { x, y };
    }
  }
  return fail("a point of the field inside no title item's region", rects);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("confirms nothing when a click falls outside every item", async () => {
  await openTitle(h);
  h.debug.setMenuIndex(VERSUS);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title");
  assertEqual(posed.menuIndex, VERSUS);

  const rects = TITLE_ITEMS.map((_item, index) => menuRect(h, index));
  const empty = outsideEvery(rects);

  await h.pointerTap(empty.x, empty.y);
  captureStill(h, "title");

  const after = h.snapshot();
  assertEqual(after.screen, "title");
  assertEqual(after.menuIndex, VERSUS);
});
