// The random source: every draw stays inside its range and is drawn afresh.

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
  it("draws in [0, 1)", () => {
    for (let i = 0; i < 200; i++) {
      const value = nextRandom();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("does not hand back one value over and over", () => {
    const draws = new Set(Array.from({ length: 32 }, () => nextRandom()));
    expect(draws.size).toBeGreaterThan(1);
  });
});

describe("the derived draws", () => {
  it("holds a range draw inside its bounds", () => {
    for (let i = 0; i < 100; i++) {
      const value = nextRange(180, 420);
      expect(value).toBeGreaterThanOrEqual(180);
      expect(value).toBeLessThan(420);
    }
  });

  it("holds a whole draw below its bound", () => {
    for (let i = 0; i < 100; i++) {
      const value = nextBelow(52);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(52);
    }
  });

  it("draws both signs", () => {
    const signs = new Set<number>();
    for (let i = 0; i < 100; i++) signs.add(nextSign());
    expect([...signs].sort()).toEqual([-1, 1]);
  });
});

describe("the shuffle", () => {
  it("keeps every card and reorders them", () => {
    const deck = buildDeck();
    shuffleInPlace(deck);
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

  it("reorders differently from one shuffle to the next", () => {
    const a = buildDeck();
    const b = buildDeck();
    shuffleInPlace(a);
    shuffleInPlace(b);
    expect(a).not.toEqual(b);
  });
});
