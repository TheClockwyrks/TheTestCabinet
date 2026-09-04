import { describe, expect, it } from "vitest";

import { SITE_COUNT, STAGE_H, STAGE_W, TITLE_ITEMS } from "./constants";
import { GantryState, type Screen } from "./game";
import { menuHit, menuRects } from "./menus";
import { resultsItems, setScreen } from "./state";

/** The state showing `screen`, with nothing else posed. */
function on(screen: Screen): GantryState {
  const state = new GantryState();
  setScreen(state, screen);
  return state;
}

/** The middle of a region: where a gesture aimed at that entry lands. */
const middle = (rect: {
  x: number;
  y: number;
  w: number;
  h: number;
}): [number, number] => [rect.x + rect.w / 2, rect.y + rect.h / 2];

describe("the menu layout", () => {
  it("gives one region per entry on each of the three menu screens", () => {
    expect(menuRects(on("title"))).toHaveLength(TITLE_ITEMS.length);
    expect(menuRects(on("select"))).toHaveLength(SITE_COUNT);
    expect(menuRects(on("results"))).toHaveLength(resultsItems(0).length);
  });

  it("gives no region on the four screens showing no menu", () => {
    for (const screen of ["howto", "build", "program", "run"] as const) {
      expect(menuRects(on(screen))).toEqual([]);
    }
  });

  it("keeps every region inside the stage and apart from its neighbours", () => {
    for (const screen of ["title", "select", "results"] as const) {
      const rects = menuRects(on(screen));
      for (const rect of rects) {
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.w).toBeLessThanOrEqual(STAGE_W);
        expect(rect.y + rect.h).toBeLessThanOrEqual(STAGE_H);
      }
      for (let i = 1; i < rects.length; i += 1) {
        const above = rects[i - 1]!;
        const below = rects[i]!;
        expect(below.y).toBeGreaterThan(above.y + above.h);
      }
    }
  });
});

describe("what a stage point lands on", () => {
  it("names the entry whose region holds the point", () => {
    for (const screen of ["title", "select", "results"] as const) {
      const state = on(screen);
      menuRects(state).forEach((rect, i) => {
        expect(menuHit(state, ...middle(rect))).toBe(i);
      });
    }
  });

  it("names nothing for a point inside no region", () => {
    const state = on("title");
    const first = menuRects(state)[0]!;
    expect(menuHit(state, first.x - 20, first.y - 20)).toBeNull();
    expect(menuHit(state, STAGE_W - 4, STAGE_H - 4)).toBeNull();
  });

  it("names nothing on a screen showing no menu", () => {
    expect(menuHit(on("build"), STAGE_W / 2, STAGE_H / 2)).toBeNull();
  });
});
