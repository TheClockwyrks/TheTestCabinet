import { describe, expect, it } from "vitest";
import { createDraws } from "./rng";

describe("the draws cursor", () => {
  it("draws in [0, 1)", () => {
    const draws = createDraws();
    for (let i = 0; i < 5000; i++) {
      const value = draws.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("reads the source it is opened over", () => {
    const values = [0.25, 0.5, 0.75];
    const draws = createDraws(() => values.shift() ?? 0);
    expect(draws.next()).toBe(0.25);
    expect(draws.next()).toBe(0.5);
    expect(draws.next()).toBe(0.75);
  });

  it("picks from a list without ever running off its end", () => {
    const draws = createDraws();
    const items = ["a", "b", "c"];
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(draws.pick(items));
    expect([...seen].sort()).toEqual(items);
  });

  it("maps a draw onto the item at its share of the list", () => {
    const items = ["a", "b", "c", "d"];
    expect(createDraws(() => 0).pick(items)).toBe("a");
    expect(createDraws(() => 0.26).pick(items)).toBe("b");
    expect(createDraws(() => 0.999).pick(items)).toBe("d");
  });
});
