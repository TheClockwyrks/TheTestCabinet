// The seeded generator: that a draw is a pure function of the state it is given,
// and that the whole of that state travels in one number
// (specs/instrumentation.md, A deterministic core).

import { describe, expect, it } from "vitest";
import { cursor, nextRandom } from "./rng";
import { buildDeck, shuffledDeck } from "./deck";

describe("a draw", () => {
  it("lies in [0, 1) and follows only the state it was given", () => {
    let state = 1;
    for (let i = 0; i < 500; i += 1) {
      const [value, next] = nextRandom(state);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      state = next;
    }
    expect(nextRandom(1)).toEqual(nextRandom(1));
    expect(nextRandom(1)[0]).not.toBe(nextRandom(2)[0]);
  });

  it("spreads across the unit interval", () => {
    const buckets = new Array<number>(10).fill(0);
    let state = 12345;
    for (let i = 0; i < 5000; i += 1) {
      const [value, next] = nextRandom(state);
      buckets[Math.min(9, Math.floor(value * 10))] += 1;
      state = next;
    }
    for (const count of buckets) {
      expect(count).toBeGreaterThan(300);
      expect(count).toBeLessThan(800);
    }
  });
});

describe("a cursor", () => {
  it("replays exactly from one state, and carries the state it reached", () => {
    const a = cursor(99);
    const b = cursor(99);
    const drawsA = Array.from({ length: 20 }, () => a.draw());
    const drawsB = Array.from({ length: 20 }, () => b.draw());
    expect(drawsA).toEqual(drawsB);
    expect(a.state).toBe(b.state);
    expect(a.state).not.toBe(99);
  });

  it("shuffles a list into a permutation of itself", () => {
    const items = Array.from({ length: 52 }, (_, i) => i);
    const shuffled = cursor(3).shuffle(items);
    expect(shuffled).toHaveLength(52);
    expect([...shuffled].sort((x, y) => x - y)).toEqual(items);
    expect(shuffled).not.toEqual(items);
    expect(items[0]).toBe(0);
  });
});

describe("the shuffled deck", () => {
  it("is one whole deck, and the same deck from the same seed", () => {
    const [deck, after] = shuffledDeck(1);
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((c) => `${c.suit}${c.rank}`)).size).toBe(52);
    expect(after).not.toBe(1);
    const [again] = shuffledDeck(1);
    expect(again).toEqual(deck);
    const [other] = shuffledDeck(2);
    expect(other).not.toEqual(deck);
    expect(buildDeck()).toHaveLength(52);
  });
});
