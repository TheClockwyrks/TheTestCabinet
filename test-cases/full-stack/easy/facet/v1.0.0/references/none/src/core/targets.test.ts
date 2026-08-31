// The pointer targets: their ids, their order, and the four requirements
// specs/controls.md makes of every rectangle on every screen.
//
// The renderer and the pointer both read this module, so a target being the
// right size and clear of its neighbors is what makes what is drawn and what is
// hit-tested the same thing.

import { describe, expect, it } from "vitest";
import {
  GAMEOVER_ITEMS,
  GEM_R,
  LEVELCLEAR_ITEMS,
  PAUSED_ITEMS,
  STAGE_H,
  STAGE_W,
  TARGET_MIN_H,
  TARGET_MIN_W,
  TITLE_ITEMS,
} from "../constants";
import { cellX, cellY } from "./board";
import { menuIndexOf, targetAt, targetsFor, type TargetRect } from "./targets";
import type { Screen } from "./state";

const SCREENS: readonly Screen[] = [
  "title",
  "howto",
  "playing",
  "paused",
  "levelclear",
  "gameover",
];

/** Whether two rectangles share any area at all. */
function overlap(a: TargetRect, b: TargetRect): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

describe("the target set each screen carries", () => {
  it("names one menu-<i> per menu item, in the order the menu is drawn", () => {
    for (const [screen, items] of [
      ["title", TITLE_ITEMS],
      ["paused", PAUSED_ITEMS],
      ["levelclear", LEVELCLEAR_ITEMS],
      ["gameover", GAMEOVER_ITEMS],
    ] as const) {
      expect(targetsFor(screen).map((target) => target.id)).toEqual(
        items.map((_item, index) => `menu-${index}`),
      );
    }
  });

  it("gives how to play its one way out, and the board its pause control", () => {
    expect(targetsFor("howto").map((target) => target.id)).toEqual(["back"]);
    expect(targetsFor("playing").map((target) => target.id)).toEqual(["pause"]);
  });

  it("stacks a menu's rows down the screen, in menuIndex order", () => {
    const rows = targetsFor("title");
    expect(rows[0].y).toBeLessThan(rows[1].y);
    expect(rows[0].x).toBe(rows[1].x);
  });
});

describe("the four requirements every target satisfies", () => {
  it("measures at least TARGET_MIN_W by TARGET_MIN_H", () => {
    for (const screen of SCREENS) {
      for (const target of targetsFor(screen)) {
        expect(target.w).toBeGreaterThanOrEqual(TARGET_MIN_W);
        expect(target.h).toBeGreaterThanOrEqual(TARGET_MIN_H);
      }
    }
  });

  it("lies wholly within the stage", () => {
    for (const screen of SCREENS) {
      for (const target of targetsFor(screen)) {
        expect(target.x).toBeGreaterThanOrEqual(0);
        expect(target.y).toBeGreaterThanOrEqual(0);
        expect(target.x + target.w).toBeLessThanOrEqual(STAGE_W);
        expect(target.y + target.h).toBeLessThanOrEqual(STAGE_H);
      }
    }
  });

  it("leaves no two targets on one screen overlapping", () => {
    for (const screen of SCREENS) {
      const targets = targetsFor(screen);
      for (let i = 0; i < targets.length; i++) {
        for (let j = i + 1; j < targets.length; j++) {
          expect(overlap(targets[i], targets[j])).toBe(false);
        }
      }
    }
  });

  it("keeps the pause control wholly clear of the board's extent", () => {
    // Cell centers run x 388..892 and y 144..648, and every gem's drawn form
    // fits inside GEM_R of its center, so the board reaches x 358..922 by
    // y 114..678 (specs/board.md).
    const left = cellX(0) - GEM_R;
    const right = cellX(7) + GEM_R;
    const top = cellY(0) - GEM_R;
    const bottom = cellY(7) + GEM_R;
    for (const target of targetsFor("playing")) {
      const clear =
        target.x + target.w <= left ||
        target.x >= right ||
        target.y + target.h <= top ||
        target.y >= bottom;
      expect(clear).toBe(true);
    }
  });
});

describe("the hit test", () => {
  it("finds the target a position lies in, and nothing outside every one", () => {
    const second = targetsFor("title")[1];
    const middle = { x: second.x + second.w / 2, y: second.y + second.h / 2 };
    expect(targetAt("title", middle.x, middle.y)?.id).toBe("menu-1");
    expect(targetAt("title", second.x - 1, middle.y)).toBeNull();
    expect(targetAt("title", 20, 20)).toBeNull();
  });

  it("counts a target's own edges as inside it", () => {
    const first = targetsFor("title")[0];
    expect(targetAt("title", first.x, first.y)?.id).toBe("menu-0");
    expect(targetAt("title", first.x + first.w, first.y + first.h)?.id).toBe(
      "menu-0",
    );
  });

  it("finds no target of one screen on another", () => {
    const pause = targetsFor("playing")[0];
    const center = { x: pause.x + pause.w / 2, y: pause.y + pause.h / 2 };
    expect(targetAt("playing", center.x, center.y)?.id).toBe("pause");
    expect(targetAt("title", center.x, center.y)).toBeNull();
    expect(targetAt("howto", center.x, center.y)).toBeNull();
  });

  it("never puts a target over a cell of the board on playing", () => {
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        expect(targetAt("playing", cellX(col), cellY(row))).toBeNull();
      }
    }
  });
});

describe("the id reader", () => {
  it("reads the menu index off a menu-<i> id and nothing else", () => {
    expect(menuIndexOf("menu-0")).toBe(0);
    expect(menuIndexOf("menu-12")).toBe(12);
    expect(menuIndexOf("back")).toBeNull();
    expect(menuIndexOf("pause")).toBeNull();
    expect(menuIndexOf("menu-")).toBeNull();
  });
});
