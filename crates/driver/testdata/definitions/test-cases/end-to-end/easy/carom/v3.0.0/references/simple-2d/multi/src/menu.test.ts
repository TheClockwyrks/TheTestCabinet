// The menus' layout is one fact, read by the renderer, by the pointer, and by
// `menuItemRect` alike (specs/ui.md, specs/instrumentation.md). What is checked
// here is the geometry itself: which screens show a menu, where each item's hit
// region sits, and that a point lands on at most one of them.

import { describe, expect, it } from "vitest";
import {
  FIELD_H,
  FIELD_W,
  MATCHOVER_ITEMS,
  PAUSE_ITEMS,
  TITLE_ITEMS,
} from "./constants";
import {
  inRect,
  itemCenterY,
  layoutItemRect,
  menuFor,
  menuItemAt,
  menuItemRect,
} from "./menu";
import { HOWTO_ITEMS } from "./theme";
import type { Screen } from "./game";

const MENU_SCREENS: readonly Screen[] = [
  "title",
  "howto",
  "paused",
  "matchover",
];

describe("menuFor", () => {
  it("gives every menu screen the items that screen shows", () => {
    expect(menuFor("title")?.items).toBe(TITLE_ITEMS);
    expect(menuFor("howto")?.items).toBe(HOWTO_ITEMS);
    expect(menuFor("paused")?.items).toBe(PAUSE_ITEMS);
    expect(menuFor("matchover")?.items).toBe(MATCHOVER_ITEMS);
  });

  it("gives the two live screens no menu at all", () => {
    expect(menuFor("countdown")).toBeNull();
    expect(menuFor("playing")).toBeNull();
  });
});

describe("menuItemRect", () => {
  it("reports a region for every item of every menu screen", () => {
    for (const screen of MENU_SCREENS) {
      const layout = menuFor(screen);
      expect(layout).not.toBeNull();
      for (let index = 0; index < (layout?.items.length ?? 0); index++) {
        const rect = menuItemRect(screen, index);
        expect(rect).not.toBeNull();
        expect(rect?.w).toBeGreaterThan(0);
        expect(rect?.h).toBeGreaterThan(0);
      }
    }
  });

  it("centers each region on the column and on the item it belongs to", () => {
    const layout = menuFor("paused");
    if (layout === null) throw new Error("the pause screen shows a menu");
    const rect = layoutItemRect(layout, 2);
    expect(rect).toEqual({
      x: layout.centerX - layout.hitW / 2,
      y: itemCenterY(layout, 2) - layout.hitH / 2,
      w: layout.hitW,
      h: layout.hitH,
    });
  });

  it("reports none for an index the menu has no item at", () => {
    for (const screen of MENU_SCREENS) {
      const count = menuFor(screen)?.items.length ?? 0;
      expect(menuItemRect(screen, count)).toBeNull();
      expect(menuItemRect(screen, -1)).toBeNull();
      expect(menuItemRect(screen, 0.5)).toBeNull();
      expect(menuItemRect(screen, NaN)).toBeNull();
    }
  });

  it("reports none on the screens that show no menu", () => {
    expect(menuItemRect("countdown", 0)).toBeNull();
    expect(menuItemRect("playing", 0)).toBeNull();
  });

  it("keeps every region inside the field", () => {
    for (const screen of MENU_SCREENS) {
      const count = menuFor(screen)?.items.length ?? 0;
      for (let index = 0; index < count; index++) {
        const rect = menuItemRect(screen, index);
        expect(rect?.x).toBeGreaterThanOrEqual(0);
        expect(rect?.y).toBeGreaterThanOrEqual(0);
        expect((rect?.x ?? 0) + (rect?.w ?? 0)).toBeLessThanOrEqual(FIELD_W);
        expect((rect?.y ?? 0) + (rect?.h ?? 0)).toBeLessThanOrEqual(FIELD_H);
      }
    }
  });

  it("keeps consecutive regions apart, with a gap between them", () => {
    for (const screen of MENU_SCREENS) {
      const count = menuFor(screen)?.items.length ?? 0;
      for (let index = 1; index < count; index++) {
        const above = menuItemRect(screen, index - 1);
        const below = menuItemRect(screen, index);
        expect((above?.y ?? 0) + (above?.h ?? 0)).toBeLessThan(below?.y ?? 0);
      }
    }
  });
});

describe("menuItemAt", () => {
  it("finds the item a point inside its region belongs to", () => {
    for (const screen of MENU_SCREENS) {
      const count = menuFor(screen)?.items.length ?? 0;
      for (let index = 0; index < count; index++) {
        const rect = menuItemRect(screen, index);
        if (rect === null) throw new Error("every item has a region");
        expect(menuItemAt(screen, rect.x + rect.w / 2, rect.y + 1)).toBe(index);
        expect(menuItemAt(screen, rect.x, rect.y)).toBe(index); // edges included
      }
    }
  });

  it("finds none for a point in the gap between two items", () => {
    const above = menuItemRect("title", 0);
    const below = menuItemRect("title", 1);
    const gap = ((above?.y ?? 0) + (above?.h ?? 0) + (below?.y ?? 0)) / 2;
    expect(menuItemAt("title", (above?.x ?? 0) + 10, gap)).toBe(-1);
  });

  it("finds none for a point outside the field, as a letterbox bar is", () => {
    expect(menuItemAt("title", -40, -40)).toBe(-1);
    expect(menuItemAt("title", FIELD_W + 40, FIELD_H / 2)).toBe(-1);
  });

  it("finds none on a screen that shows no menu", () => {
    expect(menuItemAt("playing", 640, 430)).toBe(-1);
  });
});

describe("inRect", () => {
  it("takes the edges as inside and anything past them as outside", () => {
    const rect = { x: 10, y: 20, w: 100, h: 40 };
    expect(inRect(rect, 10, 20)).toBe(true);
    expect(inRect(rect, 110, 60)).toBe(true);
    expect(inRect(rect, 9.5, 40)).toBe(false);
    expect(inRect(rect, 60, 60.5)).toBe(false);
  });
});
