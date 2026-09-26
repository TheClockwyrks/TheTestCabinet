import { describe, expect, it } from "vitest";
import {
  GAMEOVER_ITEMS,
  PAUSE_ITEMS,
  STAGE_H,
  STAGE_W,
  TITLE_ITEMS,
} from "./constants";
import { itemAt, itemBaseline, itemRect } from "./menu";

describe("itemRect", () => {
  it("reports a region for every item of every menu that has one", () => {
    const menus = [
      ["title", TITLE_ITEMS.length],
      ["paused", PAUSE_ITEMS.length],
      ["gameover", GAMEOVER_ITEMS.length],
    ] as const;
    for (const [screen, count] of menus) {
      for (let index = 0; index < count; index += 1) {
        const rect = itemRect(screen, index);
        expect(rect).not.toBeNull();
        expect(rect?.x).toBeGreaterThanOrEqual(0);
        expect(rect?.y).toBeGreaterThanOrEqual(0);
        expect((rect?.x ?? 0) + (rect?.w ?? 0)).toBeLessThanOrEqual(STAGE_W);
        expect((rect?.y ?? 0) + (rect?.h ?? 0)).toBeLessThanOrEqual(STAGE_H);
      }
    }
  });

  it("straddles the baseline the item's own text is drawn on", () => {
    for (let index = 0; index < TITLE_ITEMS.length; index += 1) {
      const rect = itemRect("title", index);
      const baseline = itemBaseline("title", index);
      expect(rect?.y).toBeLessThanOrEqual(baseline);
      expect((rect?.y ?? 0) + (rect?.h ?? 0)).toBeGreaterThanOrEqual(baseline);
      expect(rect?.x).toBeLessThanOrEqual(STAGE_W / 2);
      expect((rect?.x ?? 0) + (rect?.w ?? 0)).toBeGreaterThanOrEqual(
        STAGE_W / 2,
      );
    }
  });

  it("leaves a gap between one item's region and the next", () => {
    const first = itemRect("gameover", 0);
    const second = itemRect("gameover", 1);
    expect((first?.y ?? 0) + (first?.h ?? 0)).toBeLessThan(second?.y ?? 0);
  });

  it("reports nothing on a screen that shows no menu", () => {
    for (const screen of [
      "howto",
      "countdown",
      "playing",
      "cleared",
    ] as const) {
      expect(itemRect(screen, 0)).toBeNull();
      expect(itemAt(screen, STAGE_W / 2, STAGE_H / 2)).toBeNull();
    }
  });

  it("reports nothing for an index the menu does not hold", () => {
    expect(itemRect("title", TITLE_ITEMS.length)).toBeNull();
    expect(itemRect("title", -1)).toBeNull();
    expect(itemRect("title", 0.5)).toBeNull();
  });
});

describe("itemAt", () => {
  it("finds the item a point inside its region belongs to", () => {
    for (let index = 0; index < PAUSE_ITEMS.length; index += 1) {
      const rect = itemRect("paused", index);
      const x = (rect?.x ?? 0) + (rect?.w ?? 0) / 2;
      const y = (rect?.y ?? 0) + (rect?.h ?? 0) / 2;
      expect(itemAt("paused", x, y)).toBe(index);
    }
  });

  it("finds nothing outside every region", () => {
    expect(itemAt("title", 4, 4)).toBeNull();
    const rect = itemRect("title", 0);
    expect(itemAt("title", (rect?.x ?? 0) - 8, (rect?.y ?? 0) + 4)).toBeNull();
  });
});
