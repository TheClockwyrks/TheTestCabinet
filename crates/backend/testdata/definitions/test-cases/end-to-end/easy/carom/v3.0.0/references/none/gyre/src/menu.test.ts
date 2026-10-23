// The menus, as layout. `specs/ui.md` gives a pointer the power to select the
// item whose region it moves onto and `specs/instrumentation.md` makes that
// region a READING, so the regions have to be real: separated, inside the field,
// and answering the two `null` cases the reading fixes.

import { describe, expect, it } from "vitest";
import {
  FIELD_H,
  FIELD_W,
  MATCHOVER_ITEMS,
  PAUSE_ITEMS,
  TITLE_ITEMS,
} from "./constants";
import {
  MENU_ITEM_H,
  MENU_ITEM_W,
  menuItemAt,
  menuItemCount,
  menuItemRect,
  menuLayout,
  rectContains,
} from "./menu";
import type { Screen } from "./game";

/** Every screen that shows a menu, with the number of items it shows. */
const MENUS: readonly [Screen, number][] = [
  ["title", TITLE_ITEMS.length],
  ["howto", 1],
  ["paused", PAUSE_ITEMS.length],
  ["matchover", MATCHOVER_ITEMS.length],
];

describe("menuItemCount", () => {
  it("counts the items each menu screen shows", () => {
    for (const [screen, count] of MENUS) {
      expect(menuItemCount(screen)).toBe(count);
    }
  });

  it("counts none on the two screens that show the live field", () => {
    expect(menuItemCount("countdown")).toBe(0);
    expect(menuItemCount("playing")).toBe(0);
    expect(menuLayout("playing")).toBeNull();
  });
});

describe("menuItemRect", () => {
  it("reports one region per item, of the size the layout fixes", () => {
    for (const [screen, count] of MENUS) {
      for (let index = 0; index < count; index++) {
        const rect = menuItemRect(screen, index);
        expect(rect).not.toBeNull();
        expect(rect!.w).toBe(MENU_ITEM_W);
        expect(rect!.h).toBe(MENU_ITEM_H);
      }
    }
  });

  it("keeps every region inside the field", () => {
    for (const [screen, count] of MENUS) {
      for (let index = 0; index < count; index++) {
        const rect = menuItemRect(screen, index)!;
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.w).toBeLessThanOrEqual(FIELD_W);
        expect(rect.y + rect.h).toBeLessThanOrEqual(FIELD_H);
      }
    }
  });

  it("never lets two items claim one point", () => {
    for (const [screen, count] of MENUS) {
      for (let index = 1; index < count; index++) {
        const above = menuItemRect(screen, index - 1)!;
        const below = menuItemRect(screen, index)!;
        expect(above.y + above.h).toBeLessThan(below.y);
      }
    }
  });

  it("answers null on a screen with no menu", () => {
    expect(menuItemRect("countdown", 0)).toBeNull();
    expect(menuItemRect("playing", 0)).toBeNull();
  });

  it("answers null for an index that names no item", () => {
    expect(menuItemRect("title", TITLE_ITEMS.length)).toBeNull();
    expect(menuItemRect("title", -1)).toBeNull();
    expect(menuItemRect("title", 0.5)).toBeNull();
  });
});

describe("menuItemAt", () => {
  it("finds the item a point inside its region belongs to", () => {
    for (const [screen, count] of MENUS) {
      for (let index = 0; index < count; index++) {
        const rect = menuItemRect(screen, index)!;
        const center = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
        expect(menuItemAt(screen, center.x, center.y)).toBe(index);
      }
    }
  });

  it("claims the corners of a region as well as its middle", () => {
    const rect = menuItemRect("title", 0)!;
    expect(menuItemAt("title", rect.x, rect.y)).toBe(0);
    expect(menuItemAt("title", rect.x + rect.w, rect.y + rect.h)).toBe(0);
  });

  it("finds nothing outside every region", () => {
    expect(menuItemAt("title", 5, 5)).toBeNull();
    expect(menuItemAt("title", FIELD_W - 5, FIELD_H - 5)).toBeNull();
  });

  it("finds nothing at all on a screen that shows no menu", () => {
    const rect = menuItemRect("title", 0)!;
    expect(menuItemAt("playing", rect.x + 1, rect.y + 1)).toBeNull();
  });
});

describe("rectContains", () => {
  it("includes the edges and excludes what is beyond them", () => {
    const rect = { x: 10, y: 20, w: 100, h: 40 };
    expect(rectContains(rect, 10, 20)).toBe(true);
    expect(rectContains(rect, 110, 60)).toBe(true);
    expect(rectContains(rect, 9.9, 40)).toBe(false);
    expect(rectContains(rect, 60, 60.1)).toBe(false);
  });
});
