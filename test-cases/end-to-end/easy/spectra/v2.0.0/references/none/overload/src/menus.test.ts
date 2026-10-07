// The menus: the items each screen shows, and the regions they occupy.
//
// One layout serves three readers — the renderer draws each item at it, the debug
// surface reports it through `menuItemRect`, and the pointer selects on it — so
// what is worth testing is the layout's own invariants rather than any one
// reader's use of it: the regions are ordered and disjoint, a point inside one
// finds exactly that item, and the reading is null exactly where
// `specs/instrumentation.md` says it is.

import { describe, expect, it } from "vitest";

import { GAME_OVER_ITEMS, PAUSE_ITEMS, TITLE_ITEMS } from "./constants";
import {
  highlightedItem,
  itemAt,
  itemRect,
  menuItemRect,
  menuOf,
  rectContains,
} from "./menus";

/** The three screens that show a menu, with the items each one lists. */
const MENUS = [
  ["title", TITLE_ITEMS],
  ["paused", PAUSE_ITEMS],
  ["gameOver", GAME_OVER_ITEMS],
] as const;

/** The four screens that show none, so `menuItemRect` is null on every index. */
const NO_MENU = ["howto", "stageIntro", "inWave", "stageCleared"] as const;

describe("the menu each screen shows", () => {
  it("lists the items the specification gives that screen", () => {
    for (const [screen, items] of MENUS) {
      expect(menuOf(screen)?.items).toEqual([...items]);
    }
  });

  it("shows none on the four screens that carry no menu", () => {
    for (const screen of NO_MENU) {
      expect(menuOf(screen)).toBeNull();
      expect(menuItemRect(screen, 0)).toBeNull();
    }
  });
});

describe("the hit regions", () => {
  it("reports one for every item of every menu", () => {
    for (const [screen, items] of MENUS) {
      for (let index = 0; index < items.length; index += 1) {
        const rect = menuItemRect(screen, index);
        expect(rect).not.toBeNull();
        expect(rect?.w).toBeGreaterThan(0);
        expect(rect?.h).toBeGreaterThan(0);
      }
    }
  });

  it("reports none for an index the menu has no item at", () => {
    for (const [screen, items] of MENUS) {
      expect(menuItemRect(screen, -1)).toBeNull();
      expect(menuItemRect(screen, items.length)).toBeNull();
      expect(menuItemRect(screen, 0.5)).toBeNull();
    }
  });

  it("stacks them down the screen without overlapping", () => {
    for (const [screen, items] of MENUS) {
      for (let index = 1; index < items.length; index += 1) {
        const above = menuItemRect(screen, index - 1);
        const below = menuItemRect(screen, index);
        expect(above).not.toBeNull();
        expect(below).not.toBeNull();
        expect(below!.y).toBeGreaterThan(above!.y + above!.h);
      }
    }
  });
});

describe("the item under a point", () => {
  it("finds the item whose region covers it, and none outside every region", () => {
    for (const [screen, items] of MENUS) {
      const menu = menuOf(screen);
      expect(menu).not.toBeNull();
      for (let index = 0; index < items.length; index += 1) {
        const rect = itemRect(menu!, index);
        expect(rect).not.toBeNull();
        const middle = {
          x: rect!.x + rect!.w / 2,
          y: rect!.y + rect!.h / 2,
        };
        expect(rectContains(rect!, middle.x, middle.y)).toBe(true);
        expect(itemAt(menu!, middle.x, middle.y)).toBe(index);
      }
      // Well clear of the column the items are stacked in.
      const first = itemRect(menu!, 0);
      expect(itemAt(menu!, first!.x - 1, first!.y - 1)).toBeNull();
    }
  });
});

describe("the highlighted item", () => {
  it("takes the nearest item, so a menu on screen always shows one", () => {
    const menu = menuOf("title");
    expect(menu).not.toBeNull();
    const last = TITLE_ITEMS.length - 1;
    expect(highlightedItem(menu!, 0)).toBe(0);
    expect(highlightedItem(menu!, last)).toBe(last);
    expect(highlightedItem(menu!, -3)).toBe(0);
    expect(highlightedItem(menu!, last + 5)).toBe(last);
    expect(highlightedItem(menu!, Number.NaN)).toBe(0);
  });
});
