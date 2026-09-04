import { describe, expect, it } from "vitest";
import { createRng, nextFloat, nextInt } from "./rng";

describe("the seeded generator", () => {
  it("replays the same sequence from the same seed", () => {
    const a = createRng(7);
    const b = createRng(7);
    const first = Array.from({ length: 40 }, () => nextFloat(a));
    const second = Array.from({ length: 40 }, () => nextFloat(b));
    expect(first).toEqual(second);
  });

  it("takes a different course from a different seed", () => {
    const a = Array.from({ length: 20 }, (_v, i) => nextFloat(createRng(i)));
    expect(new Set(a).size).toBeGreaterThan(1);
  });

  it("stays inside [0, 1)", () => {
    const rng = createRng(1);
    for (let i = 0; i < 500; i += 1) {
      const value = nextFloat(rng);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("draws two outcomes about evenly, which is what a vent draw needs", () => {
    const rng = createRng(1);
    let left = 0;
    for (let i = 0; i < 4000; i += 1) if (nextInt(rng, 2) === 0) left += 1;
    expect(left).toBeGreaterThan(1800);
    expect(left).toBeLessThan(2200);
  });

  it("keeps its whole state in one field, so it can be restored", () => {
    const rng = createRng(11);
    nextFloat(rng);
    const saved = rng.seed;
    const after = [nextFloat(rng), nextFloat(rng)];
    const restored = { seed: saved };
    expect([nextFloat(restored), nextFloat(restored)]).toEqual(after);
  });
});
