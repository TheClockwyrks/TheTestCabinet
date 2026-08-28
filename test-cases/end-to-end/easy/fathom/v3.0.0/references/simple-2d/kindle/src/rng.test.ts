import { describe, expect, it } from "vitest";
import { DEFAULT_SEED } from "./constants";
import { createDraws, nextRandom } from "./rng";

describe("the seeded generator", () => {
  it("draws in [0, 1)", () => {
    let state = DEFAULT_SEED;
    for (let i = 0; i < 5000; i++) {
      const [value, next] = nextRandom(state);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      state = next;
    }
  });

  it("is a function of its state alone, so the same seed replays exactly", () => {
    const run = (seed: number): number[] => {
      let state = seed;
      const drawn: number[] = [];
      for (let i = 0; i < 32; i++) {
        const [value, next] = nextRandom(state);
        drawn.push(value);
        state = next;
      }
      return drawn;
    };
    expect(run(DEFAULT_SEED)).toEqual(run(DEFAULT_SEED));
    expect(run(DEFAULT_SEED)).not.toEqual(run(DEFAULT_SEED + 1));
  });

  it("leaves a cursor's state where a plain draw would leave it", () => {
    const draws = createDraws(DEFAULT_SEED);
    const first = draws.next();
    const [value, next] = nextRandom(DEFAULT_SEED);
    expect(first).toBe(value);
    expect(draws.state).toBe(next);
  });

  it("picks from a list without ever running off its end", () => {
    const draws = createDraws(7);
    const items = ["a", "b", "c"];
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(draws.pick(items));
    expect([...seen].sort()).toEqual(items);
  });
});
