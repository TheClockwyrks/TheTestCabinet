import { describe, expect, it } from "vitest";
import { CHARGE_IDS } from "./constants";
import { nextInt, pick } from "./rng";

describe("the random source", () => {
  it("draws whole numbers inside the bound, and covers it", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 500; i += 1) {
      const drawn = nextInt(5);
      expect(Number.isInteger(drawn)).toBe(true);
      expect(drawn).toBeGreaterThanOrEqual(0);
      expect(drawn).toBeLessThan(5);
      seen.add(drawn);
    }
    expect(seen.size).toBe(5);
  });

  it("returns the only member of a bound of one", () => {
    expect(nextInt(1)).toBe(0);
    expect(nextInt(0)).toBe(0);
  });

  it("picks a member of the set it is given, and reaches every member", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const drawn = pick(CHARGE_IDS);
      expect(CHARGE_IDS).toContain(drawn);
      seen.add(drawn);
    }
    expect(seen.size).toBe(CHARGE_IDS.length);
  });

  it("returns the only member of a set of one", () => {
    expect(pick(["halide"])).toBe("halide");
  });

  it("refuses to draw from an empty set", () => {
    expect(() => pick([])).toThrow(RangeError);
  });
});
