// The menu layout is one table read by three things — the keyboard's index, the
// pointer's hit test, and `menuItemRect` — so what is checked here is that the
// three cannot disagree: every item has a region, the regions do not overlap, and
// a point inside one names exactly that item.

import { describe, expect, it } from "vitest";
import {
  FIELD_H,
  FIELD_W,
  MATCHOVER_ITEMS,
  PAUSE_ITEMS,
  TITLE_ITEMS,
} from "./constants";
import {
  HOWTO_ITEMS,
  itemCenter,
  MATCHOVER_MENU,
  menuFor,
  menuItemAt,
  menuItemCount,
  menuItemRect,
  PAUSE_MENU,
  rectContains,
  TITLE_MENU,
  type MenuLayout,
} from "./menus";
import type { Screen } from "./game";

const MENU_SCREENS: Screen[] = ["title", "howto", "paused", "matchover"];

describe("which menu a screen shows", () => {
  it("gives each menu screen the items specs/ui.md names", () => {
    expect(TITLE_MENU.items).toEqual(TITLE_ITEMS);
    expect(PAUSE_MENU.items).toEqual(PAUSE_ITEMS);
    expect(MATCHOVER_MENU.items).toEqual(MATCHOVER_ITEMS);
    expect(HOWTO_ITEMS).toHaveLength(1);
  });

  it("shows no menu on the two live screens", () => {
    for (const screen of ["countdown", "playing"] as const) {
      expect(menuFor(screen)).toBeNull();
      expect(menuItemCount(screen)).toBe(0);
      expect(menuItemRect(screen, 0)).toBeNull();
      expect(menuItemAt(screen, 640, 430)).toBe(-1);
    }
  });
});

describe("menuItemRect", () => {
  it("reports a region for every item of every menu, and none beyond", () => {
    for (const screen of MENU_SCREENS) {
      const count = menuItemCount(screen);
      expect(count).toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        const rect = menuItemRect(screen, i);
        expect(rect).not.toBeNull();
        expect(rect?.w).toBeGreaterThan(0);
        expect(rect?.h).toBeGreaterThan(0);
      }
      expect(menuItemRect(screen, count)).toBeNull();
      expect(menuItemRect(screen, -1)).toBeNull();
      expect(menuItemRect(screen, 0.5)).toBeNull();
    }
  });

  it("centers each region on the row that item is drawn at", () => {
    for (const screen of MENU_SCREENS) {
      const layout = menuFor(screen) as MenuLayout;
      for (let i = 0; i < layout.items.length; i++) {
        const rect = menuItemRect(screen, i);
        const center = itemCenter(layout, i);
        expect((rect?.x ?? 0) + (rect?.w ?? 0) / 2).toBeCloseTo(center.x, 9);
        expect((rect?.y ?? 0) + (rect?.h ?? 0) / 2).toBeCloseTo(center.y, 9);
      }
    }
  });

  it("keeps every region on the field", () => {
    for (const screen of MENU_SCREENS) {
      for (let i = 0; i < menuItemCount(screen); i++) {
        const rect = menuItemRect(screen, i);
        expect(rect?.x).toBeGreaterThanOrEqual(0);
        expect(rect?.y).toBeGreaterThanOrEqual(0);
        expect((rect?.x ?? 0) + (rect?.w ?? 0)).toBeLessThanOrEqual(FIELD_W);
        expect((rect?.y ?? 0) + (rect?.h ?? 0)).toBeLessThanOrEqual(FIELD_H);
      }
    }
  });

  it("never lets two regions of one menu overlap", () => {
    for (const screen of MENU_SCREENS) {
      const count = menuItemCount(screen);
      for (let i = 0; i + 1 < count; i++) {
        const a = menuItemRect(screen, i);
        const b = menuItemRect(screen, i + 1);
        expect((a?.y ?? 0) + (a?.h ?? 0)).toBeLessThan(b?.y ?? 0);
      }
    }
  });
});

describe("menuItemAt", () => {
  it("names the item a point inside its region belongs to", () => {
    for (const screen of MENU_SCREENS) {
      for (let i = 0; i < menuItemCount(screen); i++) {
        const rect = menuItemRect(screen, i);
        const x = (rect?.x ?? 0) + (rect?.w ?? 0) / 2;
        const y = (rect?.y ?? 0) + (rect?.h ?? 0) / 2;
        expect(menuItemAt(screen, x, y)).toBe(i);
      }
    }
  });

  it("counts the edges of a region as inside it", () => {
    const rect = menuItemRect("title", 0);
    expect(rect).not.toBeNull();
    expect(menuItemAt("title", rect?.x ?? 0, rect?.y ?? 0)).toBe(0);
    expect(
      menuItemAt(
        "title",
        (rect?.x ?? 0) + (rect?.w ?? 0),
        (rect?.y ?? 0) + (rect?.h ?? 0),
      ),
    ).toBe(0);
  });

  it("names no item for a point outside every region", () => {
    expect(menuItemAt("title", 10, 10)).toBe(-1);
    expect(menuItemAt("title", -50, 430)).toBe(-1);
  });

  it("agrees with rectContains", () => {
    const rect = menuItemRect("paused", 1);
    expect(rect).not.toBeNull();
    if (!rect) return;
    expect(rectContains(rect, rect.x + 1, rect.y + 1)).toBe(true);
    expect(rectContains(rect, rect.x - 1, rect.y + 1)).toBe(false);
  });
});
