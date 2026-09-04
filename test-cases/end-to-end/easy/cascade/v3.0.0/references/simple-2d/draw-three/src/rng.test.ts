// The seeded generator: the same seed replays the same draws.

import { describe, expect, it } from "vitest";
import {
  nextBelow,
  nextRandom,
  nextRange,
  nextSign,
  shuffleInPlace,
} from "./rng";
import { buildDeck } from "./cards";

describe("nextRandom", () => {
  it("draws in [0, 1) and carries its whole state in one number", () => {
    let state = 1;
    for (let i = 0; i < 200; i++) {
      const [value, next] = nextRandom(state);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      expect(Number.isInteger(next)).toBe(true);
      state = next;
    }
  });

  it("repeats exactly from the same state", () => {
    expect(nextRandom(7)).toEqual(nextRandom(7));
    expect(nextRandom(7)[0]).not.toBe(nextRandom(8)[0]);
  });
});

describe("the derived draws", () => {
  it("holds a range draw inside its bounds", () => {
    let state = 3;
    for (let i = 0; i < 100; i++) {
      const [value, next] = nextRange(state, 180, 420);
      expect(value).toBeGreaterThanOrEqual(180);
      expect(value).toBeLessThan(420);
      state = next;
    }
  });

  it("holds a whole draw below its bound", () => {
    let state = 11;
    for (let i = 0; i < 100; i++) {
      const [value, next] = nextBelow(state, 52);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(52);
      state = next;
    }
  });

  it("draws both signs", () => {
    const signs = new Set<number>();
    let state = 5;
    for (let i = 0; i < 100; i++) {
      const [sign, next] = nextSign(state);
      signs.add(sign);
      state = next;
    }
    expect([...signs].sort()).toEqual([-1, 1]);
  });
});

describe("the shuffle", () => {
  it("keeps every card and reorders them", () => {
    const deck = buildDeck();
    shuffleInPlace(deck, 1);
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((c) => `${c.suit}-${String(c.rank)}`)).size).toBe(
      52,
    );
    expect(deck.map((c) => c.rank).join("")).not.toBe(
      buildDeck()
        .map((c) => c.rank)
        .join(""),
    );
  });

  it("repeats from one seed and differs between two", () => {
    const a = buildDeck();
    const b = buildDeck();
    const c = buildDeck();
    shuffleInPlace(a, 42);
    shuffleInPlace(b, 42);
    shuffleInPlace(c, 43);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});
