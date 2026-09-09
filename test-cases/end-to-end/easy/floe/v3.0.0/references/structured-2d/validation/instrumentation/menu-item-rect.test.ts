// Floe — instrumentation/menu-item-rect: the build reports a hit region for
// every item of every menu it shows.
//
// `specs/ui.md` leaves each menu's ARRANGEMENT to the build — "Each menu item
// occupies a rectangular hit region the build lays out" — and puts two bounds on
// it: "Every region lies inside the `1280 x 720` stage, and no two items of one
// menu share a point, so a pointer is over at most one entry."
// `specs/instrumentation.md` is what makes the arrangement reachable from
// outside: "`menuItemRect(index)` — A pure read of the hit region of item
// `index` on the menu the current screen shows, as `{ x, y, w, h }`", in logical
// units, "with `x` and `y` the region's top-left corner and `w` and `h` its
// size".
//
// THIS IS THE READ THE SIX POINTER AND TOUCH POINTS STAND ON, which is why it is
// graded on its own: a surface that lacks it, or that reports a region the build
// does not answer on, takes those six with it.
//
// WHERE THE READ ANSWERS `null` IS ITS OWN POINT.
// `instrumentation.menu-item-rect-absent` is the negative half — no menu on
// `howto` and on `playing`, and no region for an index the current menu does not
// have — and the two fail independently: a build can lay every menu out
// correctly and still hand back a rectangle for `menuItemRect(-1)`.
//
// WHAT IS ASSERTED IS WHAT THE SPECIFICATION FIXES, AND NOTHING ELSE. Not where
// a region sits, not how large it is, not how the four menus relate to one
// another — those are the build's own layout. What is fixed is that a region
// exists for every item of every menu, that it is a rectangle of real extent
// inside the `STAGE_W` x `STAGE_H` stage, and that no two items of ONE menu
// share a point.
//
// ALL FOUR MENUS ARE READ. `specs/ui.md` gives `TITLE_ITEMS` to `title`,
// `PAUSE_ITEMS` to `paused` and `ENDING_ITEMS` to `victory` and to `gameover`, so
// a build that laid out one screen's menu and forgot another is caught by the
// screen it forgot rather than by the one it drew.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  ENDING_ITEMS,
  PAUSE_ITEMS,
  STAGE_H,
  STAGE_W,
  TITLE_ITEMS,
} from "../constants";
import {
  captureStill,
  createHarness,
  menuRect,
  resetTo,
  type Harness,
  type MenuRect,
} from "../harness";

/** Each menu screen and the entries `specs/ui.md` gives it. */
const MENUS = [
  { screen: "title", items: TITLE_ITEMS },
  { screen: "paused", items: PAUSE_ITEMS },
  { screen: "victory", items: ENDING_ITEMS },
  { screen: "gameover", items: ENDING_ITEMS },
] as const;

/** Whether two regions share any point at all. */
function overlaps(a: MenuRect, b: MenuRect): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports a well-formed region for every item of every menu", () => {
  resetTo(h);

  for (const menu of MENUS) {
    h.debug.setScreen(menu.screen);
    assertEqual(
      h.snapshot().screen,
      menu.screen,
      `the pose opened the ${menu.screen} screen`,
    );

    const regions: MenuRect[] = [];
    for (const [index, item] of menu.items.entries()) {
      const where =
        `menuItemRect(${index}) on ${menu.screen}, the region ` +
        `${item} is picked from`;
      // A region the build reports as absent fails here, with the screen and
      // the entry named (specs/instrumentation.md).
      const rect = menuRect(h, index);
      assertGreaterThan(rect.w, 0, `${where}: a width a pointer can land in`);
      assertGreaterThan(rect.h, 0, `${where}: a height a pointer can land in`);
      // Inside the stage the build draws on, so the region names somewhere a
      // player can actually put a pointer (specs/ui.md).
      assertGreaterThan(
        rect.x + rect.w,
        0,
        `${where}: right of the stage's left edge`,
      );
      assertGreaterThan(
        rect.y + rect.h,
        0,
        `${where}: below the stage's top edge`,
      );
      assertLessThanOrEqual(
        rect.x + rect.w,
        STAGE_W,
        `${where}: inside ${STAGE_W} wide`,
      );
      assertLessThanOrEqual(
        rect.y + rect.h,
        STAGE_H,
        `${where}: inside ${STAGE_H} tall`,
      );
      regions.push(rect);
    }

    for (const [a, first] of regions.entries()) {
      for (const [b, second] of regions.entries()) {
        if (b <= a) continue;
        assertEqual(
          overlaps(first, second),
          false,
          `${menu.items[a]} and ${menu.items[b]} on ${menu.screen} to be picked ` +
            "from regions that share no point: no two items of one menu share a " +
            "point, so a pointer is over at most one entry (specs/ui.md)",
        );
      }
    }
  }

  // The last menu drawn is the picture the reviewer is handed, so the still is
  // taken here rather than inside the walk.
  captureStill(h, "regions");
});
