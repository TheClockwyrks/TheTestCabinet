// The deck, and what a foundation and a column accept.

import { describe, expect, it } from "vitest";
import {
  buildDeck,
  cardColor,
  columnAccepts,
  foundationAccepts,
  isOrderedRun,
  isSuit,
  rankLabel,
} from "./cards";
import type { CardState, Suit } from "./game";

let nextId = 1;
function card(suit: Suit, rank: number, faceUp = true): CardState {
  return { id: nextId++, suit, rank, faceUp };
}

describe("the deck", () => {
  it("is one of each of the fifty-two suit-and-rank pairs", () => {
    const deck = buildDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((c) => `${c.suit}-${String(c.rank)}`)).size).toBe(52);
    expect(Math.min(...deck.map((c) => c.rank))).toBe(1);
    expect(Math.max(...deck.map((c) => c.rank))).toBe(13);
  });

  it("colours hearts and diamonds red and the rest black", () => {
    expect(cardColor("hearts")).toBe("red");
    expect(cardColor("diamonds")).toBe("red");
    expect(cardColor("spades")).toBe("black");
    expect(cardColor("clubs")).toBe("black");
  });

  it("names the four suits and nothing else", () => {
    expect(isSuit("spades")).toBe(true);
    expect(isSuit("coins")).toBe(false);
  });

  it("labels the ranks the way a card is drawn", () => {
    expect(rankLabel(1)).toBe("A");
    expect(rankLabel(10)).toBe("10");
    expect(rankLabel(11)).toBe("J");
    expect(rankLabel(12)).toBe("Q");
    expect(rankLabel(13)).toBe("K");
  });
});

describe("an ordered run", () => {
  it("descends in rank and alternates in colour", () => {
    expect(
      isOrderedRun([card("spades", 10), card("hearts", 9), card("clubs", 8)]),
    ).toBe(true);
  });

  it("refuses a repeated colour, a gap and an empty list", () => {
    expect(isOrderedRun([card("spades", 10), card("clubs", 9)])).toBe(false);
    expect(isOrderedRun([card("spades", 10), card("hearts", 8)])).toBe(false);
    expect(isOrderedRun([])).toBe(false);
  });

  it("counts a single card as a run of one", () => {
    expect(isOrderedRun([card("hearts", 4)])).toBe(true);
  });
});

describe("a foundation", () => {
  it("starts on an Ace of any suit and nothing else", () => {
    expect(foundationAccepts([], [card("clubs", 1)])).toBe(true);
    expect(foundationAccepts([], [card("clubs", 2)])).toBe(false);
    expect(foundationAccepts([], [card("clubs", 13)])).toBe(false);
  });

  it("builds up by suit and refuses everything else", () => {
    const pile = [card("spades", 1), card("spades", 2)];
    expect(foundationAccepts(pile, [card("spades", 3)])).toBe(true);
    expect(foundationAccepts(pile, [card("hearts", 3)])).toBe(false);
    expect(foundationAccepts(pile, [card("spades", 4)])).toBe(false);
    expect(foundationAccepts(pile, [card("spades", 1)])).toBe(false);
  });

  it("takes one card at a time", () => {
    expect(
      foundationAccepts([], [card("spades", 1), card("hearts", 13)]),
    ).toBe(false);
  });
});

describe("a column", () => {
  it("takes a King, or a run led by one, onto an empty column", () => {
    expect(columnAccepts([], [card("spades", 13)])).toBe(true);
    expect(
      columnAccepts([], [card("spades", 13), card("hearts", 12)]),
    ).toBe(true);
    expect(columnAccepts([], [card("spades", 12)])).toBe(false);
    expect(columnAccepts([], [card("spades", 1)])).toBe(false);
  });

  it("builds down in alternating colour", () => {
    const pile = [card("hearts", 8)];
    expect(columnAccepts(pile, [card("spades", 7)])).toBe(true);
    expect(columnAccepts(pile, [card("diamonds", 7)])).toBe(false);
    expect(columnAccepts(pile, [card("spades", 9)])).toBe(false);
    expect(columnAccepts(pile, [card("spades", 6)])).toBe(false);
    expect(columnAccepts(pile, [card("spades", 8)])).toBe(false);
  });

  it("accepts nothing onto a face-down lowest card", () => {
    expect(
      columnAccepts([card("hearts", 8, false)], [card("spades", 7)]),
    ).toBe(false);
  });

  it("refuses a slice that is not an ordered run", () => {
    expect(
      columnAccepts([card("hearts", 8)], [card("spades", 7), card("clubs", 6)]),
    ).toBe(false);
  });
});
