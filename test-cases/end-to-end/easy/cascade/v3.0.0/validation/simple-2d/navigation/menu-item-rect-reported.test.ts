// navigation/menu-item-rect-reported — the build reports a usable region for
// every item of the menu each screen shows.
//
// THE RULE. `specs/instrumentation.md`, The core: `menuItemRect(index)` "The hit
// region of item `index` on the menu the current screen shows", and "`menuItemRect`
// returns `{ x, y, w, h }` in logical units, with `x` and `y` the region's
// top-left corner and `w` and `h` its size: the region a pointer selects that item
// from, as `specs/controls.md` states." `specs/controls.md` fixes what the menus
// ARE, screen by screen.
//
// WHY IT IS `broken` WHILE THE POINTS IT SERVES ARE NOT. Six points drive the
// pointer and the finger at what this read answers with, so a read that answers
// nothing leaves all six deciding nothing — which is the `broken` this checklist
// reserves for the surface every suite drives through, rather than a statement
// about what a player loses.
//
// WHAT IS AND IS NOT ASSERTED. That each region is an object of four finite
// numbers with a positive width and height. NOT where it is, and not how big it
// is: `specs/controls.md` leaves the layout to the build — "Each control occupies
// a rectangular hit region the build lays out" — so a check comparing a region
// against a rectangle of its own would fail a build for a decision the
// specification handed it. Whether a region ANSWERS is what the `pointer/` and
// `touch/` points decide, that no two of one screen's regions overlap is
// `navigation/menu-item-rects-do-not-overlap`'s, and the two `null` answers are
// `navigation/menu-item-rect-null-off-menu`'s.
//
// ALL THREE MENUS ARE READ, because they are three different lists and a build
// can lay one out and forget another.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { HUD_ITEMS, TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  openHowto,
  openTable,
  openTitle,
  type Harness,
  type MenuRect,
} from "../harness";

/** The three menus `specs/controls.md` gives a screen, and how to reach each. */
const MENUS: readonly {
  screen: string;
  items: number;
  open: (h: Harness) => void;
}[] = [
  { screen: "title", items: TITLE_ITEMS.length, open: openTitle },
  { screen: "howto", items: 1, open: openHowto },
  { screen: "playing", items: HUD_ITEMS.length, open: openTable },
];

/** How a region reads in a failure message. */
function show(rect: MenuRect | null): string {
  return rect === null
    ? "null"
    : `{ x: ${rect.x}, y: ${rect.y}, w: ${rect.w}, h: ${rect.h} }`;
}
/** Whether every field of a region is a finite number with a positive size. */
function usable(rect: MenuRect | null): boolean {
  if (rect === null) return false;
  const finite = [rect.x, rect.y, rect.w, rect.h].every((n) =>
    Number.isFinite(n),
  );
  return finite && rect.w > 0 && rect.h > 0;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports a usable region for every item of every menu", async () => {
  for (const menu of MENUS) {
    await menu.open(h);
    assertEqual(
      h.snapshot().screen,
      menu.screen,
      `posing: the screen this menu belongs to`,
    );

    for (let index = 0; index < menu.items; index += 1) {
      const rect = h.debug.menuItemRect(index);
      assertTrue(
        usable(rect),
        `menuItemRect(${index}) on the ${menu.screen} screen to report a ` +
          `region of four finite numbers with a positive size, for item ` +
          `${index} of ${menu.items} (specs/instrumentation.md) — reported ` +
          `${show(rect)}`,
      );
    }
  }

  // The last menu read, as the build drew it.
  openTitle(h);
  await h.advance(1);
  captureStill(h, "regions");
});
