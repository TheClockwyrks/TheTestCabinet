// The deck: fifty-two cards, four suits, thirteen ranks, two colors.

import { describe, expect, it } from "vitest";
import {
  cardColor,
  isRank,
  isSuit,
  makeDeck,
  opposite,
  RANK_LABEL,
} from "./cards";
import { DECK_SIZE, RANK_MAX, RANK_MIN, SUITS } from "./constants";

describe("makeDeck", () => {
  it("builds fifty-two cards, every suit-and-rank pair once", () => {
    let next = 1;
    const deck = makeDeck(() => next++);
    expect(deck).toHaveLength(DECK_SIZE);
    const pairs = new Set(deck.map((card) => `${card.suit}-${card.rank}`));
    expect(pairs.size).toBe(DECK_SIZE);
    for (const suit of SUITS) {
      for (let rank = RANK_MIN; rank <= RANK_MAX; rank += 1) {
        expect(pairs.has(`${suit}-${rank}`)).toBe(true);
      }
    }
  });

  it("deals every card face-down, with a distinct id", () => {
    let next = 1;
    const deck = makeDeck(() => next++);
    expect(deck.every((card) => !card.faceUp)).toBe(true);
    expect(new Set(deck.map((card) => card.id)).size).toBe(DECK_SIZE);
  });
});

describe("cardColor", () => {
  it("makes hearts and diamonds red and spades and clubs black", () => {
    expect(cardColor("hearts")).toBe("red");
    expect(cardColor("diamonds")).toBe("red");
    expect(cardColor("spades")).toBe("black");
    expect(cardColor("clubs")).toBe("black");
  });

  it("tells opposite colors apart", () => {
    expect(opposite("hearts", "spades")).toBe(true);
    expect(opposite("hearts", "diamonds")).toBe(false);
  });
});

describe("labels and validity", () => {
  it("labels the Ace, the ten and the King", () => {
    expect(RANK_LABEL[1]).toBe("A");
    expect(RANK_LABEL[10]).toBe("10");
    expect(RANK_LABEL[13]).toBe("K");
  });

  it("accepts only the thirteen ranks and the four suits", () => {
    expect(isRank(1)).toBe(true);
    expect(isRank(13)).toBe(true);
    expect(isRank(0)).toBe(false);
    expect(isRank(14)).toBe(false);
    expect(isRank(1.5)).toBe(false);
    expect(isSuit("spades")).toBe(true);
    expect(isSuit("swords")).toBe(false);
  });
});
