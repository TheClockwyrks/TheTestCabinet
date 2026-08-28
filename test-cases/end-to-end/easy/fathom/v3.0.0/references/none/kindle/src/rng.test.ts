import { describe, expect, it } from "vitest";

import { Rng } from "./rng";

describe("Rng", () => {
  it("returns values in [0, 1)", () => {
    const rng = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("reproduces the same sequence from the same seed", () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    const left = Array.from({ length: 50 }, () => a.next());
    const right = Array.from({ length: 50 }, () => b.next());
    expect(left).toEqual(right);
  });

  it("produces a different sequence from a different seed", () => {
    const a = Array.from(
      { length: 20 },
      (
        (rng) => () =>
          rng.next()
      )(new Rng(1)),
    );
    const b = Array.from(
      { length: 20 },
      (
        (rng) => () =>
          rng.next()
      )(new Rng(2)),
    );
    expect(a).not.toEqual(b);
  });

  it("restarts the sequence on reseed", () => {
    const rng = new Rng(99);
    const first = Array.from({ length: 10 }, () => rng.next());
    rng.reseed(99);
    const again = Array.from({ length: 10 }, () => rng.next());
    expect(again).toEqual(first);
  });

  it("draws whole numbers inside the count", () => {
    const rng = new Rng(3);
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

  it("picks every item of a list often enough to be uniform", () => {
    const rng = new Rng(11);
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
