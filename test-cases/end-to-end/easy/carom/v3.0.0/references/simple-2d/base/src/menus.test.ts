// The menus' layout is a fact rather than a side effect of drawing, because
// specs/ui.md gives each item a hit region a pointer selects from and
// specs/instrumentation.md has the build report that region. What is checked here
// is that the regions are where the items are drawn, that they do not overlap,
// and that a point resolves to exactly one of them.

import { describe, expect, it } from "vitest";
import {
  FIELD_CX,
  MATCHOVER_ITEMS,
  PAUSE_ITEMS,
  TITLE_ITEMS,
} from "./constants";
import type { Screen } from "./game";
import {
  inside,
  isItem,
  itemAt,
  itemCenterY,
  itemRect,
  menuFor,
} from "./menus";
import { HOWTO_ITEMS } from "./theme";

const MENU_SCREENS: Screen[] = ["title", "howto", "paused", "matchover"];

describe("menuFor", () => {
  it("gives every menu screen the items specs/ui.md names it", () => {
    expect(menuFor("title")?.items).toEqual(TITLE_ITEMS);
    expect(menuFor("howto")?.items).toEqual(HOWTO_ITEMS);
    expect(menuFor("paused")?.items).toEqual(PAUSE_ITEMS);
    expect(menuFor("matchover")?.items).toEqual(MATCHOVER_ITEMS);
  });

  it("gives the two live screens no menu at all", () => {
    expect(menuFor("countdown")).toBeNull();
    expect(menuFor("playing")).toBeNull();
  });

  it("shows one item on the how-to screen, at index 0", () => {
    expect(menuFor("howto")?.items).toHaveLength(1);
  });
});

describe("itemRect", () => {
  it("centers each region on the row its item is drawn on", () => {
    for (const screen of MENU_SCREENS) {
      const menu = menuFor(screen);
      expect(menu).not.toBeNull();
      if (!menu) continue;
      for (let i = 0; i < menu.items.length; i++) {
        const rect = itemRect(menu, i);
        expect(rect).not.toBeNull();
        if (!rect) continue;
        expect(rect.x + rect.w / 2).toBeCloseTo(menu.centerX, 9);
        expect(rect.y + rect.h / 2).toBeCloseTo(itemCenterY(menu, i), 9);
        expect(rect.w).toBeGreaterThan(0);
        expect(rect.h).toBeGreaterThan(0);
      }
    }
  });

  it("never lets two of a menu's regions touch", () => {
    for (const screen of MENU_SCREENS) {
      const menu = menuFor(screen);
      if (!menu) continue;
      expect(menu.hitH).toBeLessThan(menu.spacing);
      for (let i = 1; i < menu.items.length; i++) {
        const above = itemRect(menu, i - 1);
        const below = itemRect(menu, i);
        if (!above || !below) continue;
        expect(above.y + above.h).toBeLessThan(below.y);
      }
    }
  });

  it("names no region for an index the menu does not have", () => {
    const menu = menuFor("title");
    expect(menu).not.toBeNull();
    if (!menu) return;
    expect(itemRect(menu, -1)).toBeNull();
    expect(itemRect(menu, menu.items.length)).toBeNull();
    expect(itemRect(menu, 0.5)).toBeNull();
    expect(isItem(menu, 0)).toBe(true);
  });
});

describe("itemAt", () => {
  it("resolves a point on a row to that row's item", () => {
    const menu = menuFor("title");
    expect(menu).not.toBeNull();
    if (!menu) return;
    for (let i = 0; i < menu.items.length; i++) {
      expect(itemAt(menu, FIELD_CX, itemCenterY(menu, i))).toBe(i);
    }
  });

  it("resolves the corners of a region to the item, and just outside to none", () => {
    const menu = menuFor("paused");
    expect(menu).not.toBeNull();
    if (!menu) return;
    const rect = itemRect(menu, 1);
    expect(rect).not.toBeNull();
    if (!rect) return;
    expect(itemAt(menu, rect.x, rect.y)).toBe(1);
    expect(itemAt(menu, rect.x + rect.w, rect.y + rect.h)).toBe(1);
    expect(itemAt(menu, rect.x - 1, rect.y)).toBeNull();
    expect(itemAt(menu, rect.x, rect.y - 1)).toBeNull();
  });

  it("names no item for a point in the gap between two rows", () => {
    const menu = menuFor("title");
    expect(menu).not.toBeNull();
    if (!menu) return;
    const between = (itemCenterY(menu, 0) + itemCenterY(menu, 1)) / 2;
    expect(itemAt(menu, FIELD_CX, between)).toBeNull();
  });

  it("names no item for a point off in the letterbox", () => {
    const menu = menuFor("title");
    expect(menu).not.toBeNull();
    if (!menu) return;
    expect(itemAt(menu, -40, itemCenterY(menu, 0))).toBeNull();
  });
});

describe("inside", () => {
  it("counts every edge of a region as part of it", () => {
    const rect = { x: 10, y: 20, w: 30, h: 40 };
    expect(inside(rect, 10, 20)).toBe(true);
    expect(inside(rect, 40, 60)).toBe(true);
    expect(inside(rect, 25, 40)).toBe(true);
    expect(inside(rect, 9.5, 40)).toBe(false);
    expect(inside(rect, 25, 60.5)).toBe(false);
  });
});
