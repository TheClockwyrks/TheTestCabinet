import { describe, expect, it } from "vitest";
import { nextRandom, nextRange, nextSign, shuffle } from "./rng";

describe("the seeded generator", () => {
  it("keeps its whole state in the one field, so a seed replays exactly", () => {
    const a = { rngState: 7 };
    const b = { rngState: 7 };
    const first = Array.from({ length: 20 }, () => nextRandom(a));
    const second = Array.from({ length: 20 }, () => nextRandom(b));
    expect(second).toEqual(first);
  });

  it("draws different sequences from different seeds", () => {
    const a = { rngState: 1 };
    const b = { rngState: 2 };
    const first = Array.from({ length: 20 }, () => nextRandom(a));
    const second = Array.from({ length: 20 }, () => nextRandom(b));
    expect(second).not.toEqual(first);
  });

  it("draws inside the unit interval", () => {
    const source = { rngState: 99 };
    for (let i = 0; i < 500; i += 1) {
      const draw = nextRandom(source);
      expect(draw).toBeGreaterThanOrEqual(0);
      expect(draw).toBeLessThan(1);
    }
  });

  it("draws a range inside its bounds, and both signs", () => {
    const source = { rngState: 3 };
    const signs = new Set<number>();
    for (let i = 0; i < 200; i += 1) {
      const value = nextRange(source, 180, 420);
      expect(value).toBeGreaterThanOrEqual(180);
      expect(value).toBeLessThan(420);
      signs.add(nextSign(source));
    }
    expect([...signs].sort()).toEqual([-1, 1]);
  });

  it("shuffles every entry exactly once, and reproduces a seed's order", () => {
    const items = Array.from({ length: 52 }, (_, i) => i);
    const a = { rngState: 5 };
    const b = { rngState: 5 };
    const first = shuffle(a, [...items]);
    const second = shuffle(b, [...items]);
    expect([...first].sort((x, y) => x - y)).toEqual(items);
    expect(second).toEqual(first);
    expect(first).not.toEqual(items);
  });
});
