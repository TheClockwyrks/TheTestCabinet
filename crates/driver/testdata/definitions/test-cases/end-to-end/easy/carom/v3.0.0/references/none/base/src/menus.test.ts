// The menus, as items and regions. specs/ui.md gives each menu screen its items
// and leaves the layout to the build; specs/instrumentation.md then requires the
// build to report the region each item occupies. What is checked here is that the
// two agree: every item a screen shows has a region, the regions never overlap,
// and a point inside one names that item and no other.

import { describe, expect, it } from "vitest";
import { MATCHOVER_ITEMS, PAUSE_ITEMS, TITLE_ITEMS } from "./constants";
import {
  highlightedItem,
  itemAt,
  itemCenterY,
  itemRect,
  menuItemRect,
  menuOf,
  rectContains,
} from "./menus";
import type { Screen } from "./state";
import { HOWTO_ITEMS } from "./theme";

/** The four screens that show a menu, and the items each one shows. */
const MENU_SCREENS: [Screen, readonly string[]][] = [
  ["title", TITLE_ITEMS],
  ["howto", HOWTO_ITEMS],
  ["paused", PAUSE_ITEMS],
  ["matchover", MATCHOVER_ITEMS],
];

describe("menuOf", () => {
  it("gives each menu screen the items specs/ui.md names", () => {
    for (const [screen, items] of MENU_SCREENS) {
      expect(menuOf(screen)?.items).toEqual(items);
    }
  });

  it("gives the two live screens no menu, because they show none", () => {
    expect(menuOf("countdown")).toBeNull();
    expect(menuOf("playing")).toBeNull();
  });
});

describe("menuItemRect", () => {
  it("reports a region for every item of every menu", () => {
    for (const [screen, items] of MENU_SCREENS) {
      for (let index = 0; index < items.length; index += 1) {
        const rect = menuItemRect(screen, index);
        expect(rect?.w).toBeGreaterThan(0);
        expect(rect?.h).toBeGreaterThan(0);
      }
    }
  });

  it("centers each region on the item the renderer draws there", () => {
    const menu = menuOf("title");
    if (menu === null) throw new Error("the title screen shows a menu");
    for (let index = 0; index < menu.items.length; index += 1) {
      const rect = itemRect(menu, index);
      expect((rect?.y ?? 0) + (rect?.h ?? 0) / 2).toBeCloseTo(
        itemCenterY(menu.style, index),
        9,
      );
      expect((rect?.x ?? 0) + (rect?.w ?? 0) / 2).toBeCloseTo(
        menu.style.centerX,
        9,
      );
    }
  });

  it("stacks the regions without overlapping, so a point names one item", () => {
    for (const [screen, items] of MENU_SCREENS) {
      for (let index = 1; index < items.length; index += 1) {
        const above = menuItemRect(screen, index - 1);
        const below = menuItemRect(screen, index);
        expect(below?.y).toBeGreaterThanOrEqual(
          (above?.y ?? 0) + (above?.h ?? 0),
        );
      }
    }
  });

  it("keeps every region on the field", () => {
    for (const [screen, items] of MENU_SCREENS) {
      for (let index = 0; index < items.length; index += 1) {
        const rect = menuItemRect(screen, index);
        expect(rect?.x).toBeGreaterThanOrEqual(0);
        expect(rect?.y).toBeGreaterThanOrEqual(0);
        expect((rect?.x ?? 0) + (rect?.w ?? 0)).toBeLessThanOrEqual(1280);
        expect((rect?.y ?? 0) + (rect?.h ?? 0)).toBeLessThanOrEqual(720);
      }
    }
  });

  it("reports nothing on a screen with no menu, or past the last item", () => {
    expect(menuItemRect("playing", 0)).toBeNull();
    expect(menuItemRect("countdown", 0)).toBeNull();
    expect(menuItemRect("title", TITLE_ITEMS.length)).toBeNull();
    expect(menuItemRect("title", -1)).toBeNull();
    expect(menuItemRect("title", 0.5)).toBeNull();
  });
});

describe("itemAt", () => {
  it("names the item whose region a point is inside", () => {
    for (const [screen, items] of MENU_SCREENS) {
      const menu = menuOf(screen);
      if (menu === null) throw new Error(`${screen} shows a menu`);
      for (let index = 0; index < items.length; index += 1) {
        const rect = menuItemRect(screen, index);
        const at = {
          x: (rect?.x ?? 0) + (rect?.w ?? 0) / 2,
          y: (rect?.y ?? 0) + (rect?.h ?? 0) / 2,
        };
        expect(itemAt(menu, at.x, at.y)).toBe(index);
      }
    }
  });

  it("names nothing off the menu", () => {
    const menu = menuOf("title");
    if (menu === null) throw new Error("the title screen shows a menu");
    expect(itemAt(menu, 10, 10)).toBeNull();
    const rect = menuItemRect("title", 0);
    expect(itemAt(menu, (rect?.x ?? 0) - 4, rect?.y ?? 0)).toBeNull();
  });
});

describe("rectContains", () => {
  it("counts the edges as inside, so a region has no dead border", () => {
    const rect = { x: 10, y: 20, w: 100, h: 40 };
    expect(rectContains(rect, 10, 20)).toBe(true);
    expect(rectContains(rect, 110, 60)).toBe(true);
    expect(rectContains(rect, 9, 40)).toBe(false);
    expect(rectContains(rect, 60, 61)).toBe(false);
  });
});

describe("highlightedItem", () => {
  it("is the selection itself while it names an item", () => {
    const menu = menuOf("title");
    if (menu === null) throw new Error("the title screen shows a menu");
    expect(highlightedItem(menu, 0)).toBe(0);
    expect(highlightedItem(menu, 2)).toBe(2);
  });

  it("is the nearest item to a selection that names none", () => {
    // A menu on screen always shows which item a confirm would take, whatever
    // the surface has set the selection to.
    const menu = menuOf("howto");
    if (menu === null) throw new Error("the how-to screen shows one item");
    expect(highlightedItem(menu, 4)).toBe(0);
    expect(highlightedItem(menu, -2)).toBe(0);
    expect(highlightedItem(menu, Number.NaN)).toBe(0);
  });
});
