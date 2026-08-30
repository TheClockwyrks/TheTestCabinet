// The pointer targets: their ids, their order, and the geometry
// specs/controls.md requires of them.
//
// The renderer and the pointer both read this module, so a target's rectangle
// being the right size and clear of its neighbours is what makes what is drawn
// and what is hit-tested the same thing.

import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_LENGTH,
  STAGE_H,
  STAGE_W,
  TARGET_MIN_H,
  TARGET_MIN_W,
  TITLE_ITEMS,
} from "./constants";
import { startMode } from "./flow";
import { RefractState } from "./game";
import { boardIndexOf, menuIndexOf, targetAt, targetsFor } from "./layout";
import type { PointerTarget } from "./layout";

/** A state on `screen`, built the way the game reaches it. */
function on(screen: RefractState["screen"]): RefractState {
  const state = new RefractState();
  if (screen === "select") {
    startMode(state, "campaign");
    return state;
  }
  state.screen = screen;
  return state;
}

const SCREENS = [
  "title",
  "howto",
  "select",
  "playing",
  "solved",
  "complete",
] as const;

/** Whether two rectangles share any area. */
function overlap(a: PointerTarget, b: PointerTarget): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

describe("the target set", () => {
  it("names the title's items menu-0 upward, one per TITLE_ITEMS entry", () => {
    expect(targetsFor(on("title")).map((target) => target.id)).toEqual(
      TITLE_ITEMS.map((_item, index) => `menu-${index}`),
    );
  });

  it("gives how-to a single back target", () => {
    expect(targetsFor(on("howto")).map((target) => target.id)).toEqual(["back"]);
  });

  it("gives select every board and then back", () => {
    expect(targetsFor(on("select")).map((target) => target.id)).toEqual([
      ...Array.from({ length: CAMPAIGN_LENGTH }, (_v, i) => `board-${i + 1}`),
      "back",
    ]);
  });

  it("gives playing clear and then back", () => {
    expect(targetsFor(on("playing")).map((target) => target.id)).toEqual([
      "clear",
      "back",
    ]);
  });

  it("gives the campaign's solved screen one target per choice offered", () => {
    const solved = on("solved");
    expect(targetsFor(solved).map((target) => target.id)).toEqual([
      "menu-0",
      "menu-1",
      "menu-2",
    ]);
    // The last board offers no next board, so the menu is two long.
    solved.boardIndex = CAMPAIGN_LENGTH - 1;
    expect(targetsFor(solved).map((target) => target.id)).toEqual([
      "menu-0",
      "menu-1",
    ]);
  });

  it("gives cascade's solved screen its two items", () => {
    const solved = on("solved");
    solved.mode = "cascade";
    expect(targetsFor(solved).map((target) => target.id)).toEqual([
      "menu-0",
      "menu-1",
    ]);
  });

  it("gives complete its two choices", () => {
    expect(targetsFor(on("complete")).map((target) => target.id)).toEqual([
      "menu-0",
      "menu-1",
    ]);
  });
});

describe("the target geometry", () => {
  it("is at least TARGET_MIN_W by TARGET_MIN_H, inside the stage, on every screen", () => {
    for (const screen of SCREENS) {
      for (const target of targetsFor(on(screen))) {
        expect(target.w).toBeGreaterThanOrEqual(TARGET_MIN_W);
        expect(target.h).toBeGreaterThanOrEqual(TARGET_MIN_H);
        expect(target.x).toBeGreaterThanOrEqual(0);
        expect(target.y).toBeGreaterThanOrEqual(0);
        expect(target.x + target.w).toBeLessThanOrEqual(STAGE_W);
        expect(target.y + target.h).toBeLessThanOrEqual(STAGE_H);
      }
    }
  });

  it("leaves no two targets on a screen overlapping", () => {
    for (const screen of SCREENS) {
      const targets = targetsFor(on(screen));
      for (let i = 0; i < targets.length; i++) {
        for (let j = i + 1; j < targets.length; j++) {
          const a = targets[i];
          const b = targets[j];
          if (a === undefined || b === undefined) continue;
          expect(overlap(a, b)).toBe(false);
        }
      }
    }
  });

  it("keeps the playing controls clear of the largest board's extent", () => {
    // Cell centers span x 352..928 and every node's form fits inside NODE_R,
    // so the widest board reaches x 322..958 (specs/board.md).
    for (const target of targetsFor(on("playing"))) {
      expect(target.x + target.w <= 322 || target.x >= 958).toBe(true);
    }
  });
});

describe("targetAt", () => {
  it("finds the target a point lies in, and nothing outside every one", () => {
    const title = on("title");
    const second = targetsFor(title)[1];
    expect(second).toBeDefined();
    if (second === undefined) return;
    const middle = { x: second.x + second.w / 2, y: second.y + second.h / 2 };
    expect(targetAt(title, middle.x, middle.y)?.id).toBe("menu-1");
    expect(targetAt(title, second.x - 1, middle.y)?.id).toBe(undefined);
  });

  it("includes a target's own edges, so a press on the border still lands", () => {
    const title = on("title");
    const first = targetsFor(title)[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(targetAt(title, first.x, first.y)?.id).toBe("menu-0");
    expect(targetAt(title, first.x + first.w, first.y + first.h)?.id).toBe(
      "menu-0",
    );
  });
});

describe("the id readers", () => {
  it("reads a menu index and a board index off their ids", () => {
    expect(menuIndexOf("menu-0")).toBe(0);
    expect(menuIndexOf("menu-12")).toBe(12);
    expect(menuIndexOf("board-3")).toBeNull();
    expect(menuIndexOf("back")).toBeNull();
    expect(boardIndexOf("board-1")).toBe(0);
    expect(boardIndexOf("board-24")).toBe(23);
    expect(boardIndexOf("menu-1")).toBeNull();
    expect(boardIndexOf("clear")).toBeNull();
  });
});
