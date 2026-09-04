import { describe, expect, it } from "vitest";
import {
  ALMANAC_ROWS,
  ALMANAC_TABS,
  END_ITEMS,
  PAUSE_ITEMS,
  STAGE_H,
  STAGE_W,
  TITLE_ITEMS,
} from "./constants";
import { entriesOf } from "./almanac";
import type { Screen, WickRect } from "./game";
import { hitRect, menuRects, tabRects } from "./menus";
import { initialState, type Draft } from "./state";

function on(screen: Screen): Draft {
  const state = initialState();
  state.screen = screen;
  return state;
}

function overlaps(a: WickRect, b: WickRect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

function middle(rect: WickRect): [number, number] {
  return [rect.x + rect.width / 2, rect.y + rect.height / 2];
}

/** Every rectangle sits on the stage and meets no other. */
function disjointOnStage(rects: readonly WickRect[]): void {
  for (const rect of rects) {
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(STAGE_W);
    expect(rect.y + rect.height).toBeLessThanOrEqual(STAGE_H);
  }
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      expect(overlaps(rects[i], rects[j])).toBe(false);
    }
  }
}

describe("the menu rectangles", () => {
  it("reports one per item of every screen that shows a menu", () => {
    expect(menuRects(on("title"))).toHaveLength(TITLE_ITEMS.length);
    expect(menuRects(on("paused"))).toHaveLength(PAUSE_ITEMS.length);
    expect(menuRects(on("fallen"))).toHaveLength(END_ITEMS.length);
    expect(menuRects(on("dawn"))).toHaveLength(END_ITEMS.length);
    const overlay = on("levelup");
    overlay.run.offers = ["ember", "lure", "lamp-oil"];
    expect(menuRects(overlay)).toHaveLength(3);
  });

  it("reports one box on howto and chest, and none on playing", () => {
    // Neither shows a menu; each answers the pointer on the box its way out is
    // taken in (specs/controls.md).
    for (const screen of ["howto", "chest"] as const) {
      expect(menuRects(on(screen))).toHaveLength(1);
    }
    expect(menuRects(on("playing"))).toEqual([]);
  });

  it("stacks them down the stage, disjoint, in menu order", () => {
    for (const screen of ["title", "paused", "fallen"] as const) {
      const rects = menuRects(on(screen));
      disjointOnStage(rects);
      for (let i = 1; i < rects.length; i += 1) {
        expect(rects[i].y).toBeGreaterThan(rects[i - 1].y);
      }
    }
  });

  it("reports the almanac's visible rows, from the window's first entry", () => {
    const state = on("almanac");
    expect(menuRects(state)).toHaveLength(ALMANAC_ROWS);
    disjointOnStage(menuRects(state));
    state.almanacScroll = 4;
    expect(menuRects(state)).toHaveLength(ALMANAC_ROWS);
    state.almanacScroll = entriesOf(0).length - 3;
    expect(menuRects(state)).toHaveLength(3);
    state.almanacTab = 3;
    state.almanacScroll = 0;
    expect(menuRects(state)).toHaveLength(entriesOf(3).length);
  });
});

describe("the tab rectangles", () => {
  it("reports one per tab on the almanac and none elsewhere", () => {
    const rects = tabRects(on("almanac"));
    expect(rects).toHaveLength(ALMANAC_TABS.length);
    disjointOnStage(rects);
    for (const screen of [
      "title",
      "howto",
      "playing",
      "levelup",
      "chest",
      "paused",
      "fallen",
      "dawn",
    ] as const) {
      expect(tabRects(on(screen))).toEqual([]);
    }
  });

  it("meets no entry row", () => {
    const state = on("almanac");
    for (const tab of tabRects(state)) {
      for (const row of menuRects(state)) {
        expect(overlaps(tab, row)).toBe(false);
      }
    }
  });
});

describe("the hit test", () => {
  it("finds the rectangle a point is inside, and none outside them all", () => {
    const rects = menuRects(on("title"));
    rects.forEach((rect, i) => {
      const [x, y] = middle(rect);
      expect(hitRect(rects, x, y)).toBe(i);
      expect(hitRect(rects, rect.x, rect.y)).toBe(i);
    });
    expect(hitRect(rects, 0, 0)).toBe(-1);
    expect(hitRect(rects, STAGE_W - 1, STAGE_H - 1)).toBe(-1);
    // A point on the far edge belongs to the next rectangle, not this one.
    const first = rects[0];
    expect(hitRect(rects, first.x + first.width, first.y)).toBe(-1);
  });
});
