import { describe, expect, it } from "vitest";

import {
  HEADING_H,
  READOUT_X0,
  SOLVED_ITEMS,
  STAGE_H,
  STAGE_W,
  TAPE_Y0,
  TITLE_ITEMS,
  TRAY_REGION_W,
} from "./constants";
import {
  howtoItemRect,
  insideRect,
  insideTapePanel,
  menuItemRectOf,
  rectHolds,
  regionAt,
  selectRowRect,
  solvedItemRect,
  titleItemRect,
  type MenuItemRect,
  type MenuKind,
} from "./regions";

describe("the editor's five regions (specs/editor.md)", () => {
  it("places a point well inside each region", () => {
    expect(regionAt(640, 20)).toBe("heading");
    expect(regionAt(100, 300)).toBe("tray");
    expect(regionAt(616, 304)).toBe("field");
    expect(regionAt(1100, 300)).toBe("readout");
    expect(regionAt(700, 600)).toBe("tape");
  });

  it("includes a rectangle's lower bound and excludes its upper", () => {
    // A press at x 223 within the tray's y span is a tray press.
    expect(regionAt(TRAY_REGION_W - 1, 300)).toBe("tray");
    // A press at (TRAY_REGION_W, HEADING_H) is a field press.
    expect(regionAt(TRAY_REGION_W, HEADING_H)).toBe("field");
    expect(regionAt(TRAY_REGION_W, HEADING_H - 1)).toBe("heading");
    expect(regionAt(READOUT_X0 - 1, TAPE_Y0 - 1)).toBe("field");
    expect(regionAt(READOUT_X0, TAPE_Y0 - 1)).toBe("readout");
  });

  it("gives the shared corner to the tape panel", () => {
    expect(regionAt(TRAY_REGION_W, TAPE_Y0)).toBe("tape");
    expect(regionAt(TRAY_REGION_W - 1, TAPE_Y0)).toBe("tray");
    expect(regionAt(TRAY_REGION_W, TAPE_Y0 - 1)).toBe("field");
  });

  it("names no region off the stage", () => {
    expect(regionAt(-1, 300)).toBeNull();
    expect(regionAt(STAGE_W, 300)).toBeNull();
    expect(regionAt(300, -1)).toBeNull();
    expect(regionAt(300, STAGE_H)).toBeNull();
  });

  it("reads the focus rule over the tape panel's extent", () => {
    expect(insideTapePanel(TRAY_REGION_W, TAPE_Y0)).toBe(true);
    expect(insideTapePanel(TRAY_REGION_W - 1, TAPE_Y0)).toBe(false);
    expect(insideTapePanel(TRAY_REGION_W, TAPE_Y0 - 1)).toBe(false);
  });

  it("tests a half-open rectangle on each of its four edges", () => {
    expect(insideRect(0, 0, 0, 0, 10, 10)).toBe(true);
    expect(insideRect(9.99, 9.99, 0, 0, 10, 10)).toBe(true);
    expect(insideRect(10, 5, 0, 0, 10, 10)).toBe(false);
    expect(insideRect(5, 10, 0, 0, 10, 10)).toBe(false);
    expect(insideRect(-0.01, 5, 0, 0, 10, 10)).toBe(false);
  });
});

/** Every rectangle a menu of `count` items lays out. */
function menuRects(kind: MenuKind, count: number): MenuItemRect[] {
  return Array.from({ length: count }, (_entry, index) =>
    menuItemRectOf(kind, index, count),
  );
}

/** Whether two rectangles share so much as a point. */
function overlap(a: MenuItemRect, b: MenuItemRect): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

describe("the menus' hit regions (specs/ui.md, specs/instrumentation.md)", () => {
  it("gives every item a region of its own, on the stage", () => {
    const menus: [MenuKind, number][] = [
      ["title", TITLE_ITEMS.length],
      ["howto", 1],
      ["select", 13],
      ["select", 10],
      ["solved", SOLVED_ITEMS.length],
    ];
    for (const [kind, count] of menus) {
      const rects = menuRects(kind, count);
      for (const rect of rects) {
        expect(rect.w, kind).toBeGreaterThan(0);
        expect(rect.h, kind).toBeGreaterThan(0);
        expect(rect.x, kind).toBeGreaterThanOrEqual(0);
        expect(rect.y, kind).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.w, kind).toBeLessThanOrEqual(STAGE_W);
        expect(rect.y + rect.h, kind).toBeLessThanOrEqual(STAGE_H);
      }
      for (let a = 0; a < rects.length; a += 1) {
        for (let b = a + 1; b < rects.length; b += 1) {
          expect(overlap(rects[a], rects[b]), `${kind} ${a} and ${b}`).toBe(
            false,
          );
        }
      }
    }
  });

  it("stacks each menu's items in the order the screen lists them", () => {
    const title = menuRects("title", TITLE_ITEMS.length);
    expect(title[1].y).toBeGreaterThan(title[0].y);
    expect(title[2].y).toBeGreaterThan(title[1].y);
    const solved = menuRects("solved", SOLVED_ITEMS.length);
    expect(solved[1].y).toBeGreaterThan(solved[0].y);
    expect(solved[2].y).toBeGreaterThan(solved[1].y);
  });

  it("draws a long select list on the tighter pitch, so it still fits", () => {
    const short = selectRowRect(1, 10).y - selectRowRect(0, 10).y;
    const long = selectRowRect(1, 13).y - selectRowRect(0, 13).y;
    expect(long).toBeLessThan(short);
    expect(selectRowRect(12, 13).y + selectRowRect(12, 13).h).toBeLessThan(
      STAGE_H,
    );
  });

  it("holds the center of the region it reports, and nothing outside it", () => {
    const rect = titleItemRect(1);
    expect(rectHolds(rect, rect.x + rect.w / 2, rect.y + rect.h / 2)).toBe(
      true,
    );
    // The half-open rule again: the top-left corner is the region's, the
    // bottom-right corner belongs to whatever lies past it.
    expect(rectHolds(rect, rect.x, rect.y)).toBe(true);
    expect(rectHolds(rect, rect.x + rect.w, rect.y)).toBe(false);
    expect(rectHolds(rect, rect.x, rect.y + rect.h)).toBe(false);
    expect(rectHolds(rect, rect.x - 1, rect.y + 1)).toBe(false);
  });

  it("routes each menu to the layout that menu is drawn with", () => {
    expect(menuItemRectOf("title", 2, TITLE_ITEMS.length)).toEqual(
      titleItemRect(2),
    );
    expect(menuItemRectOf("howto", 0, 1)).toEqual(howtoItemRect());
    expect(menuItemRectOf("select", 3, 10)).toEqual(selectRowRect(3, 10));
    expect(menuItemRectOf("solved", 1, 3)).toEqual(solvedItemRect(1));
  });
});
