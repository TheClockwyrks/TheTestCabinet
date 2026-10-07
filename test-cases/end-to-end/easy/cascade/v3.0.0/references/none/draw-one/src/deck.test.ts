import { describe, expect, it } from "vitest";
import { isFullDeck, orderedDeck } from "./deck";
import { DECK_SIZE, RANK_MAX, RANK_MIN, SUITS } from "./constants";

describe("the deck", () => {
  it("holds each of the fifty-two suit-and-rank pairs exactly once", () => {
    const deck = orderedDeck();
    expect(deck).toHaveLength(DECK_SIZE);
    expect(isFullDeck(deck)).toBe(true);
    for (const suit of SUITS) {
      const ranks = deck
        .filter((entry) => entry.suit === suit)
        .map((entry) => entry.rank)
        .sort((a, b) => a - b);
      expect(ranks).toHaveLength(13);
      expect(ranks[0]).toBe(RANK_MIN);
      expect(ranks[12]).toBe(RANK_MAX);
    }
  });

  it("knows a deck that is short or doubled up", () => {
    expect(isFullDeck(orderedDeck().slice(1))).toBe(false);
    const doubled = orderedDeck();
    doubled[0] = doubled[1];
    expect(isFullDeck(doubled)).toBe(false);
  });
});
