// The random source: every draw lies in the unit interval, spreads across it,
// and a shuffle is a permutation drawn afresh.

import { describe, expect, it } from "vitest";
import { nextRandom, shuffled } from "./rng";
import { buildDeck, shuffledDeck } from "./deck";

describe("a draw", () => {
  it("lies in [0, 1)", () => {
    for (let i = 0; i < 500; i += 1) {
      const value = nextRandom();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("spreads across the unit interval", () => {
    const buckets = new Array<number>(10).fill(0);
    for (let i = 0; i < 5000; i += 1) {
      buckets[Math.min(9, Math.floor(nextRandom() * 10))] += 1;
    }
    for (const count of buckets) {
      expect(count).toBeGreaterThan(300);
      expect(count).toBeLessThan(800);
    }
  });
});

describe("a shuffle", () => {
  it("reorders a list into a permutation of itself, leaving the input alone", () => {
    const items = Array.from({ length: 52 }, (_, i) => i);
    const once = shuffled(items);
    expect(once).toHaveLength(52);
    expect([...once].sort((x, y) => x - y)).toEqual(items);
    expect(once).not.toEqual(items);
    expect(items[0]).toBe(0);
  });

  it("reorders differently from one call to the next", () => {
    const items = Array.from({ length: 52 }, (_, i) => i);
    expect(shuffled(items)).not.toEqual(shuffled(items));
  });
});

describe("the shuffled deck", () => {
  it("is one whole deck, dealt afresh each time", () => {
    const deck = shuffledDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((c) => `${c.suit}${c.rank}`)).size).toBe(52);
    expect(shuffledDeck()).not.toEqual(deck);
    expect(buildDeck()).toHaveLength(52);
  });
});
