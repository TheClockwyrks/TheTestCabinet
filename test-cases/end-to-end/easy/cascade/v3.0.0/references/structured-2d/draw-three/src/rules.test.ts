import { describe, expect, it } from "vitest";
import type { CardState, Suit } from "./game";
import {
  columnAccepts,
  foundationAccepts,
  foundationFor,
  isRun,
} from "./rules";

let next = 1;
function card(suit: Suit, rank: number, faceUp = true): CardState {
  next += 1;
  return { id: next, suit, rank, faceUp };
}

describe("what a run is", () => {
  it("counts one face-up card as a run of one", () => {
    expect(isRun([card("spades", 7)])).toBe(true);
  });

  it("wants each card one lower and the opposite colour", () => {
    expect(isRun([card("spades", 7), card("hearts", 6)])).toBe(true);
    expect(isRun([card("spades", 7), card("clubs", 6)])).toBe(false);
    expect(isRun([card("spades", 7), card("hearts", 5)])).toBe(false);
    expect(isRun([card("spades", 7), card("hearts", 8)])).toBe(false);
  });

  it("refuses a slice carrying a face-down card, which is never moved", () => {
    expect(isRun([card("spades", 7, false)])).toBe(false);
    expect(isRun([card("spades", 7), card("hearts", 6, false)])).toBe(false);
  });

  it("refuses an empty slice", () => {
    expect(isRun([])).toBe(false);
  });
});

describe("what a foundation accepts", () => {
  it("starts on an Ace of any suit and nothing else", () => {
    expect(foundationAccepts([], card("hearts", 1))).toBe(true);
    expect(foundationAccepts([], card("hearts", 2))).toBe(false);
    expect(foundationAccepts([], card("hearts", 13))).toBe(false);
  });

  it("builds up by one, in its own suit", () => {
    const pile = [card("spades", 1)];
    expect(foundationAccepts(pile, card("spades", 2))).toBe(true);
    expect(foundationAccepts(pile, card("clubs", 2))).toBe(false);
    expect(foundationAccepts(pile, card("spades", 3))).toBe(false);
    expect(foundationAccepts(pile, card("spades", 1))).toBe(false);
  });

  it("takes nothing once it holds its King", () => {
    const pile = [card("spades", 13)];
    for (const suit of ["spades", "hearts", "diamonds", "clubs"] as Suit[]) {
      expect(foundationAccepts(pile, card(suit, 1))).toBe(false);
    }
  });
});

describe("what a column accepts", () => {
  it("takes a King, or a King-headed run, onto an empty column", () => {
    expect(columnAccepts([], [card("spades", 13)])).toBe(true);
    expect(columnAccepts([], [card("spades", 13), card("hearts", 12)])).toBe(
      true,
    );
    expect(columnAccepts([], [card("spades", 12)])).toBe(false);
  });

  it("builds down in rank and alternating in colour", () => {
    const column = [card("spades", 8)];
    expect(columnAccepts(column, [card("hearts", 7)])).toBe(true);
    expect(columnAccepts(column, [card("clubs", 7)])).toBe(false);
    expect(columnAccepts(column, [card("hearts", 6)])).toBe(false);
    expect(columnAccepts(column, [card("hearts", 9)])).toBe(false);
    expect(columnAccepts(column, [card("hearts", 8)])).toBe(false);
  });

  it("takes nothing when its lowest card is face-down", () => {
    const column = [card("spades", 8, false)];
    expect(columnAccepts(column, [card("hearts", 7)])).toBe(false);
  });

  it("refuses a slice that is not an ordered run", () => {
    const column = [card("spades", 8)];
    expect(columnAccepts(column, [card("hearts", 7), card("hearts", 6)])).toBe(
      false,
    );
  });
});

describe("the foundation a card belongs on", () => {
  it("finds the one already holding the next-lower card of its suit", () => {
    const foundations = [
      [card("spades", 1)],
      [card("hearts", 1), card("hearts", 2)],
      [],
      [],
    ];
    expect(foundationFor(foundations, card("hearts", 3))).toBe(1);
    expect(foundationFor(foundations, card("spades", 2))).toBe(0);
  });

  it("sends an Ace to the first empty foundation", () => {
    const foundations = [[card("spades", 1)], [], [], []];
    expect(foundationFor(foundations, card("clubs", 1))).toBe(1);
  });

  it("reports none when no foundation accepts the card", () => {
    const foundations = [[card("spades", 1)], [], [], []];
    expect(foundationFor(foundations, card("spades", 5))).toBe(-1);
  });
});
