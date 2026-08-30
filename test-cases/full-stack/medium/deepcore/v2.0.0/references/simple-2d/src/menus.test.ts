// What each screen's menu lists, and the generator every draw runs off
// (specs/ui.md, specs/instrumentation.md).

import { describe, expect, it } from "vitest";
import {
  GAME_OVER_ITEMS,
  GAME_OVER_SAVE_ITEMS,
  MODE_ITEMS,
  PAUSE_ITEMS,
  SIZE_ITEMS,
  TITLE_ITEMS,
  VICTORY_ITEMS,
} from "./constants";
import { menuFor } from "./menus";
import { Draws, nextFloat } from "./rng";

const labels = (
  screen: Parameters<typeof menuFor>[0],
  mode: Parameters<typeof menuFor>[1],
  saved: boolean,
): string[] => menuFor(screen, mode, saved).map((item) => item.label);

describe("the menus", () => {
  it("leads the title with CONTINUE only while a save exists", () => {
    expect(labels("title", "standard", false)).toEqual([
      TITLE_ITEMS[1],
      TITLE_ITEMS[2],
    ]);
    expect(labels("title", "standard", true)).toEqual([...TITLE_ITEMS]);
  });

  it("lists the mode, size, pause, and victory menus as the copy fixes them", () => {
    expect(labels("mode-select", "standard", false)).toEqual([...MODE_ITEMS]);
    expect(labels("size-select", "standard", false)).toEqual([...SIZE_ITEMS]);
    expect(labels("paused", "standard", false)).toEqual([...PAUSE_ITEMS]);
    expect(labels("victory", "standard", true)).toEqual([...VICTORY_ITEMS]);
  });

  it("offers the save at Game Over in Standard alone, and only while one exists", () => {
    expect(labels("game-over", "standard", true)).toEqual([
      ...GAME_OVER_SAVE_ITEMS,
    ]);
    expect(labels("game-over", "standard", false)).toEqual([
      ...GAME_OVER_ITEMS,
    ]);
    expect(labels("game-over", "hardcore", true)).toEqual([...GAME_OVER_ITEMS]);
  });

  it("lists nothing on the screen that is the live game", () => {
    expect(menuFor("in-mine", "standard", true)).toEqual([]);
  });
});

describe("the generator", () => {
  it("is a pure function of its state, so a replay reproduces a draw", () => {
    const [first, next] = nextFloat(1);
    expect(nextFloat(1)).toEqual([first, next]);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(1);
  });

  it("draws the same sequence from the same seed and a different one otherwise", () => {
    const run = (seed: number): number[] => {
      const draws = new Draws(seed);
      return [draws.float(), draws.float(), draws.float()];
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
  });

  it("draws whole numbers, chances, picks, and weighted picks in range", () => {
    const draws = new Draws(99);
    for (let i = 0; i < 200; i += 1) {
      const n = draws.int(3, 6);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(6);
      expect(["a", "b", "c"]).toContain(draws.pick(["a", "b", "c"]));
      expect(typeof draws.chance(0.5)).toBe("boolean");
      expect(draws.range(2, 4)).toBeGreaterThanOrEqual(2);
    }
    // A weight of zero is never drawn, however many draws are taken.
    const picked = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      picked.add(draws.weighted(["kept", "never"], [1, 0]));
    }
    expect([...picked]).toEqual(["kept"]);
  });

  it("hands its state back so the caller can carry it", () => {
    const draws = new Draws(5);
    draws.float();
    const carried = draws.state;
    const resumed = new Draws(carried);
    expect(resumed.float()).toBe(new Draws(carried).float());
  });
});
