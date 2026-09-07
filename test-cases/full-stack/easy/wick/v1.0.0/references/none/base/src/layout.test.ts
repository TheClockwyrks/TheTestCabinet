import { describe, expect, it } from "vitest";
import {
  ALMANAC,
  almanacRowRects,
  almanacTabRects,
  contains,
  endRects,
  itemAt,
  levelUpLayout,
  menuRects,
  pauseRects,
  tabAt,
  tabRects,
  titleRects,
  type Rect,
} from "./layout";
import {
  ALMANAC_ROWS,
  ALMANAC_TABS,
  END_ITEMS,
  PAUSE_ITEMS,
  STAGE_H,
  STAGE_W,
  TITLE_ITEMS,
} from "./constants";
import { almanacEntries } from "./almanac";
import { initialState, type WickState } from "./state";

function overlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

function disjoint(rects: readonly Rect[]): boolean {
  return rects.every((a, i) =>
    rects.every((b, j) => i === j || !overlap(a, b)),
  );
}

function onStage(rects: readonly Rect[]): boolean {
  return rects.every(
    (rect) =>
      rect.x >= 0 &&
      rect.y >= 0 &&
      rect.x + rect.width <= STAGE_W &&
      rect.y + rect.height <= STAGE_H,
  );
}

function almanac(): WickState {
  const state = initialState();
  state.screen = "almanac";
  return state;
}

describe("the menu boxes", () => {
  it("gives one box per item, on the stage and meeting no other", () => {
    for (const [rects, count] of [
      [titleRects(), TITLE_ITEMS.length],
      [pauseRects(), PAUSE_ITEMS.length],
      [endRects(), END_ITEMS.length],
      [almanacTabRects(), ALMANAC_TABS.length],
      [almanacRowRects(16), ALMANAC_ROWS],
      [levelUpLayout(3).offers, 3],
    ] as const) {
      expect(rects).toHaveLength(count);
      expect(disjoint(rects)).toBe(true);
      expect(onStage(rects)).toBe(true);
    }
  });

  it("shows every row of a tab holding fewer than the window", () => {
    expect(almanacRowRects(6)).toHaveLength(6);
    expect(almanacRowRects(0)).toHaveLength(0);
  });

  it("keeps the level-up offers inside their panel, with room for the line", () => {
    const layout = levelUpLayout(3);
    for (const rect of layout.offers) {
      expect(rect.y).toBeGreaterThan(layout.panel.y);
      expect(rect.y + rect.height).toBeLessThan(layout.descriptionY);
    }
    expect(layout.descriptionY).toBeLessThan(
      layout.panel.y + layout.panel.height,
    );
  });

  it("keeps the almanac's tabs clear of its rows and its pane", () => {
    for (const tab of almanacTabRects()) {
      for (const row of almanacRowRects(16)) {
        expect(overlap(tab, row)).toBe(false);
      }
      expect(tab.y + tab.height).toBeLessThan(ALMANAC.paneY);
    }
    for (const row of almanacRowRects(16)) {
      expect(row.x + row.width).toBeLessThan(ALMANAC.paneX);
    }
  });
});

describe("what the pointer answers", () => {
  it("reports the menu of every screen that shows one, and none otherwise", () => {
    const state = initialState();
    expect(menuRects(state)).toHaveLength(TITLE_ITEMS.length);
    state.screen = "paused";
    expect(menuRects(state)).toHaveLength(PAUSE_ITEMS.length);
    state.screen = "fallen";
    expect(menuRects(state)).toHaveLength(END_ITEMS.length);
    state.screen = "levelup";
    state.run.offers = ["ember", "lure", "lamp-oil"];
    expect(menuRects(state)).toHaveLength(3);
    // `howto` and `chest` show no menu and answer the pointer on one box each.
    for (const screen of ["howto", "chest"] as const) {
      state.screen = screen;
      expect(menuRects(state)).toHaveLength(1);
    }
    state.screen = "playing";
    expect(menuRects(state)).toEqual([]);
  });

  it("reports the almanac's window of rows and its tab bar alone", () => {
    const state = almanac();
    expect(menuRects(state)).toHaveLength(ALMANAC_ROWS);
    expect(tabRects(state)).toHaveLength(ALMANAC_TABS.length);
    state.almanacTab = 3;
    expect(menuRects(state)).toHaveLength(almanacEntries(3).length);
    state.screen = "title";
    expect(tabRects(state)).toEqual([]);
  });

  it("finds the item a point lands in, and none outside every box", () => {
    const state = initialState();
    const rects = titleRects();
    expect(itemAt(state, rects[1].x + 2, rects[1].y + 2)).toBe(1);
    expect(itemAt(state, rects[1].x - 2, rects[1].y + 2)).toBeNull();
    expect(itemAt(state, 0, 0)).toBeNull();
    expect(tabAt(state, 0, 0)).toBeNull();
  });

  it("reads an almanac row through the window it scrolled to", () => {
    const state = almanac();
    state.almanacScroll = 4;
    const rows = almanacRowRects(almanacEntries(0).length);
    expect(itemAt(state, rows[2].x + 1, rows[2].y + 1)).toBe(6);
    const tabs = almanacTabRects();
    expect(tabAt(state, tabs[2].x + 1, tabs[2].y + 1)).toBe(2);
  });

  it("takes a box's top and left edges and leaves its bottom and right", () => {
    const rect = titleRects()[0];
    expect(contains(rect, rect.x, rect.y)).toBe(true);
    expect(contains(rect, rect.x + rect.width, rect.y)).toBe(false);
    expect(contains(rect, rect.x, rect.y + rect.height)).toBe(false);
  });
});
