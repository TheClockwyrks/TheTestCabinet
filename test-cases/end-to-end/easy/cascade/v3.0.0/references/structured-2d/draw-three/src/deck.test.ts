import { describe, expect, it } from "vitest";
import { DECK_SIZE, RANK_MAX, RANK_MIN } from "./constants";
import {
  buildDeck,
  colorOf,
  makeCard,
  oppositeColors,
  rankLabel,
} from "./deck";

describe("the deck", () => {
  it("reads hearts and diamonds red, spades and clubs black", () => {
    expect(colorOf("hearts")).toBe("red");
    expect(colorOf("diamonds")).toBe("red");
    expect(colorOf("spades")).toBe("black");
    expect(colorOf("clubs")).toBe("black");
    expect(oppositeColors("hearts", "spades")).toBe(true);
    expect(oppositeColors("hearts", "diamonds")).toBe(false);
  });

  it("labels Ace, the pips and the court cards", () => {
    expect(rankLabel(RANK_MIN)).toBe("A");
    expect(rankLabel(10)).toBe("10");
    expect(rankLabel(11)).toBe("J");
    expect(rankLabel(12)).toBe("Q");
    expect(rankLabel(RANK_MAX)).toBe("K");
  });

  it("builds one full deck, each pair once, every card face-down", () => {
    const identity = { nextId: 1 };
    const deck = buildDeck(identity);
    expect(deck).toHaveLength(DECK_SIZE);
    expect(deck.every((card) => !card.faceUp)).toBe(true);
    const pairs = new Set(deck.map((card) => `${card.suit}${card.rank}`));
    expect(pairs.size).toBe(DECK_SIZE);
    const ids = new Set(deck.map((card) => card.id));
    expect(ids.size).toBe(DECK_SIZE);
  });

  it("gives every card a distinct id from the counter it is handed", () => {
    const identity = { nextId: 4 };
    const first = makeCard(identity, "spades", 1, true);
    const second = makeCard(identity, "spades", 2, true);
    expect(first.id).toBe(4);
    expect(second.id).toBe(5);
    expect(identity.nextId).toBe(6);
  });
});
