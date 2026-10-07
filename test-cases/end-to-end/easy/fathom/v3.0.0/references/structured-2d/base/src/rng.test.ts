import { describe, expect, it } from "vitest";

import { Rng } from "./rng";

describe("Rng", () => {
  it("returns values in [0, 1)", () => {
    const rng = new Rng();
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("reads the source it is opened over", () => {
    const values = [0.25, 0.5, 0.75];
    const rng = new Rng(() => values.shift() ?? 0);
    expect(rng.next()).toBe(0.25);
    expect(rng.next()).toBe(0.5);
    expect(rng.next()).toBe(0.75);
  });

  it("draws whole numbers inside the count", () => {
    const rng = new Rng();
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const v = rng.int(4);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(4);
      seen.add(v);
    }
    expect(seen.size).toBe(4);
  });

  it("maps a draw onto the item at its share of the list", () => {
    const items = ["a", "b", "c", "d"] as const;
    expect(new Rng(() => 0).pick(items)).toBe("a");
    expect(new Rng(() => 0.26).pick(items)).toBe("b");
    expect(new Rng(() => 0.999).pick(items)).toBe("d");
  });

  it("picks every item of a list often enough to be uniform", () => {
    const rng = new Rng();
    const items = ["a", "b", "c"] as const;
    const counts = new Map<string, number>(items.map((i) => [i, 0]));
    for (let i = 0; i < 3000; i++) {
      const item = rng.pick(items);
      counts.set(item, (counts.get(item) as number) + 1);
    }
    for (const item of items) {
      expect(counts.get(item)).toBeGreaterThan(800);
    }
  });
});
