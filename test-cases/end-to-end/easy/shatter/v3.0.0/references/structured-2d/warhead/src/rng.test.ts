import { describe, expect, it } from "vitest";
import { nextAngle, nextFloat, nextIndex, nextRange, nextSign } from "./rng";

describe("the seeded generator", () => {
  it("keeps its whole state in the holder, so a replay reproduces the draws", () => {
    const first = { rngState: 7 };
    const second = { rngState: 7 };
    const a = Array.from({ length: 20 }, () => nextFloat(first));
    const b = Array.from({ length: 20 }, () => nextFloat(second));
    expect(a).toEqual(b);
  });

  it("draws a different sequence from a different seed", () => {
    const seven = { rngState: 7 };
    const eight = { rngState: 8 };
    const a = Array.from({ length: 20 }, () => nextFloat(seven));
    const b = Array.from({ length: 20 }, () => nextFloat(eight));
    expect(a).not.toEqual(b);
  });

  it("stays inside the unit interval", () => {
    const holder = { rngState: 1 };
    for (let draw = 0; draw < 500; draw += 1) {
      const value = nextFloat(holder);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("stays inside a stated range", () => {
    const holder = { rngState: 3 };
    for (let draw = 0; draw < 300; draw += 1) {
      const value = nextRange(holder, 60, 110);
      expect(value).toBeGreaterThanOrEqual(60);
      expect(value).toBeLessThan(110);
    }
  });

  it("draws whole indices inside the count", () => {
    const holder = { rngState: 5 };
    const seen = new Set<number>();
    for (let draw = 0; draw < 400; draw += 1) seen.add(nextIndex(holder, 4));
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it("draws both signs and both angles of the turn", () => {
    const holder = { rngState: 11 };
    const signs = new Set<number>();
    for (let draw = 0; draw < 100; draw += 1) signs.add(nextSign(holder));
    expect([...signs].sort()).toEqual([-1, 1]);

    const angle = nextAngle(holder);
    expect(angle).toBeGreaterThanOrEqual(0);
    expect(angle).toBeLessThan(Math.PI * 2);
  });
});
