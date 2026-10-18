// The menus' layout: what each screen shows, where it puts each item, and what
// a point on the field hits.
//
// specs/ui.md leaves the layout to the build and specs/instrumentation.md makes
// the build REPORT it through `menuItemRect`, so what is checked here is that
// the reported regions are self-consistent: one per item, in the order the case
// fixes the copy, none overlapping its neighbour, all on the field, and the
// point-to-item lookup the pointer and touch handling runs on agreeing with
// them exactly.

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
  menuItemAt,
  menuItemCount,
  menuItemRect,
  menuLayout,
} from "./menus";
import { SCREENS, type Screen } from "./state";

/** The screens that show a menu, and the copy each one shows. */
const MENUS: [Screen, readonly string[]][] = [
  ["title", TITLE_ITEMS],
  ["howto", HOWTO_ITEMS],
  ["paused", PAUSE_ITEMS],
  ["matchover", MATCHOVER_ITEMS],
];

describe("which screens show a menu", () => {
  it("shows one on every screen but the two live ones", () => {
    for (const [screen, items] of MENUS) {
      expect(menuLayout(screen)?.items).toEqual(items);
      expect(menuItemCount(screen)).toBe(items.length);
    }
    for (const screen of ["countdown", "playing"] as const) {
      expect(menuLayout(screen)).toBeNull();
      expect(menuItemCount(screen)).toBe(0);
    }
  });

  it("covers every screen the state machine has", () => {
    expect(SCREENS.length).toBe(6);
    for (const screen of SCREENS) {
      // Every screen answers, with a layout or with null — none throws.
      expect(() => menuLayout(screen)).not.toThrow();
    }
  });
});

describe("menuItemRect", () => {
  it("reports one region per item, on the field, in menu order", () => {
    for (const [screen, items] of MENUS) {
      let previousBottom = -Infinity;
      for (let index = 0; index < items.length; index++) {
        const rect = menuItemRect(screen, index);
        expect(rect).not.toBeNull();
        if (rect === null) continue;
        expect(rect.w).toBeGreaterThan(0);
        expect(rect.h).toBeGreaterThan(0);
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.w).toBeLessThanOrEqual(FIELD_W);
        expect(rect.y + rect.h).toBeLessThanOrEqual(FIELD_H);
        // Items run down the screen and no two regions touch, so a point can
        // never name two items.
        expect(rect.y).toBeGreaterThan(previousBottom);
        previousBottom = rect.y + rect.h;
      }
    }
  });

  it("reports nothing for an index that names no item", () => {
    for (const [screen, items] of MENUS) {
      expect(menuItemRect(screen, -1)).toBeNull();
      expect(menuItemRect(screen, items.length)).toBeNull();
      expect(menuItemRect(screen, 0.5)).toBeNull();
    }
  });

  it("reports nothing on the screens that show no menu", () => {
    for (const screen of ["countdown", "playing"] as const) {
      expect(menuItemRect(screen, 0)).toBeNull();
    }
  });
});

describe("menuItemAt", () => {
  it("finds the item whose region holds the point", () => {
    for (const [screen, items] of MENUS) {
      for (let index = 0; index < items.length; index++) {
        const rect = menuItemRect(screen, index);
        if (rect === null) throw new Error("no region");
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        expect(menuItemAt(screen, cx, cy)).toBe(index);
        // The corners are inside too: the region is closed.
        expect(menuItemAt(screen, rect.x, rect.y)).toBe(index);
        expect(menuItemAt(screen, rect.x + rect.w, rect.y + rect.h)).toBe(
          index,
        );
      }
    }
  });

  it("finds nothing outside every region", () => {
    for (const [screen] of MENUS) {
      const rect = menuItemRect(screen, 0);
      if (rect === null) throw new Error("no region");
      expect(menuItemAt(screen, rect.x - 1, rect.y + rect.h / 2)).toBeNull();
      expect(menuItemAt(screen, rect.x + rect.w / 2, rect.y - 1)).toBeNull();
      expect(menuItemAt(screen, 0, 0)).toBeNull();
    }
  });

  it("finds nothing on a screen with no menu", () => {
    expect(menuItemAt("playing", FIELD_W / 2, FIELD_H / 2)).toBeNull();
    expect(menuItemAt("countdown", FIELD_W / 2, FIELD_H / 2)).toBeNull();
  });
});
