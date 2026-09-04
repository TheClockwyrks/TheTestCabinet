import { describe, expect, it } from "vitest";
import {
  foundationAccepts,
  foundationFor,
  isRun,
  tableauAccepts,
} from "./rules";
import type { Card, Suit } from "./types";

let next = 0;
function card(suit: Suit, rank: number, faceUp = true): Card {
  next += 1;
  return { id: next, suit, rank, faceUp };
}

describe("an ordered run", () => {
  it("is one card, or a descending alternating sequence", () => {
    expect(isRun([card("spades", 5)])).toBe(true);
    expect(
      isRun([card("spades", 5), card("hearts", 4), card("clubs", 3)]),
    ).toBe(true);
  });

  it("is broken by a repeated colour or a rank gap", () => {
    expect(isRun([card("spades", 5), card("clubs", 4)])).toBe(false);
    expect(isRun([card("spades", 5), card("hearts", 3)])).toBe(false);
    expect(isRun([card("spades", 5), card("hearts", 6)])).toBe(false);
  });
});

describe("a foundation", () => {
  it("starts on an Ace of any suit and refuses everything else", () => {
    expect(foundationAccepts([], [card("hearts", 1)])).toBe(true);
    expect(foundationAccepts([], [card("hearts", 2)])).toBe(false);
    expect(foundationAccepts([], [card("hearts", 13)])).toBe(false);
  });

  it("builds up by one in its own suit", () => {
    const pile = [card("spades", 1)];
    expect(foundationAccepts(pile, [card("spades", 2)])).toBe(true);
    expect(foundationAccepts(pile, [card("clubs", 2)])).toBe(false);
    expect(foundationAccepts(pile, [card("spades", 3)])).toBe(false);
    expect(foundationAccepts(pile, [card("spades", 1)])).toBe(false);
  });

  it("accepts nothing once it holds its King", () => {
    const pile = [card("spades", 12), card("spades", 13)];
    for (const suit of ["spades", "hearts", "diamonds", "clubs"] as Suit[]) {
      expect(foundationAccepts(pile, [card(suit, 1)])).toBe(false);
    }
  });

  it("refuses a run of two even when its leading card would go", () => {
    const pile = [card("spades", 1)];
    expect(
      foundationAccepts(pile, [card("spades", 2), card("hearts", 1)]),
    ).toBe(false);
  });

  it("names the one foundation a card belongs on", () => {
    const foundations = [
      [card("spades", 1)],
      [],
      [card("hearts", 1), card("hearts", 2)],
      [],
    ];
    expect(foundationFor(foundations, card("hearts", 3))).toBe(2);
    expect(foundationFor(foundations, card("spades", 2))).toBe(0);
    // An Ace starts the first empty foundation there is.
    expect(foundationFor(foundations, card("clubs", 1))).toBe(1);
    expect(foundationFor(foundations, card("clubs", 5))).toBe(-1);
  });
});

describe("a column", () => {
  it("takes a King, and only a King, onto an empty one", () => {
    expect(tableauAccepts([], [card("spades", 13)])).toBe(true);
    expect(tableauAccepts([], [card("spades", 12)])).toBe(false);
    expect(tableauAccepts([], [card("spades", 1)])).toBe(false);
  });

  it("builds down in rank and alternates in colour", () => {
    const column = [card("spades", 8)];
    expect(tableauAccepts(column, [card("hearts", 7)])).toBe(true);
    expect(tableauAccepts(column, [card("clubs", 7)])).toBe(false);
    expect(tableauAccepts(column, [card("hearts", 9)])).toBe(false);
    expect(tableauAccepts(column, [card("hearts", 6)])).toBe(false);
    expect(tableauAccepts(column, [card("hearts", 8)])).toBe(false);
  });

  it("accepts nothing while its lowest card is face-down", () => {
    const column = [card("spades", 8, false)];
    expect(tableauAccepts(column, [card("hearts", 7)])).toBe(false);
  });

  it("refuses a slice that is not an ordered run", () => {
    const column = [card("spades", 8)];
    expect(
      tableauAccepts(column, [card("hearts", 7), card("diamonds", 6)]),
    ).toBe(false);
    expect(tableauAccepts(column, [card("hearts", 7), card("clubs", 6)])).toBe(
      true,
    );
  });

  it("refuses an empty run", () => {
    expect(tableauAccepts([], [])).toBe(false);
  });
});
