// Where each menu-bearing screen puts its items, and which item a point lands on.
//
// The layout itself is this build's to choose (specs/ui.md); what is checked here
// is that the region reported for an item is the region that item is selected
// from, which is what `specs/instrumentation.md` has `menuItemRect` report.

import { describe, expect, it } from "vitest";
import { menuItemAt, menuItemRect, menuItems, menuLayout } from "./menus";
import type { Screen } from "./game";

/** Every screen that carries a menu (specs/ui.md). */
const MENU_SCREENS: readonly Screen[] = [
  "title",
  "howto",
  "paused",
  "gameover",
  "cleared",
];

/** The region of item `index`, which every screen above has one of. */
function rectOf(screen: Screen, index: number) {
  const rect = menuItemRect(screen, index);
  if (rect === null) throw new Error(`no item ${index} on ${screen}`);
  return rect;
}

describe("menuItemRect", () => {
  it("reports a region for every item of every menu-bearing screen", () => {
    for (const screen of MENU_SCREENS) {
      const items = menuItems(screen);
      expect(items.length).toBeGreaterThan(0);
      for (let index = 0; index < items.length; index++) {
        const rect = rectOf(screen, index);
        expect(rect.w).toBeGreaterThan(0);
        expect(rect.h).toBeGreaterThan(0);
      }
    }
  });

  it("stacks the regions down the screen, leaving no two overlapping", () => {
    for (const screen of MENU_SCREENS) {
      const rects = menuItems(screen).map((_, index) => rectOf(screen, index));
      for (let index = 1; index < rects.length; index++) {
        const above = rects[index - 1]!;
        expect(rects[index]!.y).toBeGreaterThanOrEqual(above.y + above.h);
      }
    }
  });

  it("answers null on playing, which shows no menu", () => {
    expect(menuLayout("playing")).toBeNull();
    expect(menuItemRect("playing", 0)).toBeNull();
  });

  it("answers null for an index the menu holds no item at", () => {
    expect(menuItemRect("title", menuItems("title").length)).toBeNull();
    expect(menuItemRect("title", -1)).toBeNull();
    expect(menuItemRect("title", 0.5)).toBeNull();
  });
});

describe("menuItemAt", () => {
  it("finds the item whose region holds the point", () => {
    for (const screen of MENU_SCREENS) {
      const items = menuItems(screen);
      for (let index = 0; index < items.length; index++) {
        const rect = rectOf(screen, index);
        const x = rect.x + rect.w / 2;
        const y = rect.y + rect.h / 2;
        expect(menuItemAt(screen, x, y)).toBe(index);
      }
    }
  });

  it("finds nothing outside every region", () => {
    const rect = rectOf("title", 0);
    expect(menuItemAt("title", rect.x - 1, rect.y + rect.h / 2)).toBeNull();
    expect(menuItemAt("title", rect.x + rect.w / 2, rect.y - 1)).toBeNull();
    expect(menuItemAt("playing", rect.x, rect.y)).toBeNull();
  });
});
