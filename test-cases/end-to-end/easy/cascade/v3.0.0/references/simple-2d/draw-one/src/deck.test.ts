import { describe, expect, it } from "vitest";
import { DECK_SIZE } from "./constants";
import {
  buildDeck,
  colorOf,
  isRank,
  isSuit,
  oppositeColor,
  rankLabel,
  shuffledDeck,
  suitGlyph,
} from "./deck";

describe("the deck", () => {
  it("holds each of the fifty-two suit-and-rank pairs once", () => {
    const deck = buildDeck();
    expect(deck).toHaveLength(DECK_SIZE);
    const keys = new Set(deck.map((card) => `${card.suit}-${card.rank}`));
    expect(keys.size).toBe(DECK_SIZE);
  });

  it("shuffles a full deck and moves the generator on", () => {
    const [deck, state] = shuffledDeck(1);
    expect(deck).toHaveLength(DECK_SIZE);
    expect(state).not.toBe(1);
    const keys = new Set(deck.map((card) => `${card.suit}-${card.rank}`));
    expect(keys.size).toBe(DECK_SIZE);
  });

  it("colors hearts and diamonds red and the rest black", () => {
    expect(colorOf("hearts")).toBe("red");
    expect(colorOf("diamonds")).toBe("red");
    expect(colorOf("spades")).toBe("black");
    expect(colorOf("clubs")).toBe("black");
    expect(oppositeColor("hearts", "spades")).toBe(true);
    expect(oppositeColor("hearts", "diamonds")).toBe(false);
  });

  it("labels the court cards and the Ace", () => {
    expect(rankLabel(1)).toBe("A");
    expect(rankLabel(10)).toBe("10");
    expect(rankLabel(11)).toBe("J");
    expect(rankLabel(12)).toBe("Q");
    expect(rankLabel(13)).toBe("K");
  });

  it("carries a distinct symbol per suit", () => {
    const glyphs = new Set(
      (["spades", "hearts", "diamonds", "clubs"] as const).map(suitGlyph),
    );
    expect(glyphs.size).toBe(4);
  });

  it("recognizes the ranks and suits of this deck", () => {
    expect(isRank(1)).toBe(true);
    expect(isRank(13)).toBe(true);
    expect(isRank(0)).toBe(false);
    expect(isRank(14)).toBe(false);
    expect(isRank(1.5)).toBe(false);
    expect(isSuit("spades")).toBe(true);
    expect(isSuit("swords")).toBe(false);
  });
});
