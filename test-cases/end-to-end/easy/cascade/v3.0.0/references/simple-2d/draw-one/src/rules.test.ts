import { describe, expect, it } from "vitest";
import { makeCard } from "./deck";
import {
  boardComplete,
  foundationAccepts,
  foundationFor,
  isRed,
  isRun,
  tableauAccepts,
} from "./rules";
import type { CardState } from "./game";

const card = (suit: CardState["suit"], rank: number, faceUp = true) =>
  makeCard(rank * 10 + suit.length, suit, rank, faceUp);

describe("a run", () => {
  it("is one card, or cards descending and alternating in color", () => {
    expect(isRun([card("spades", 5)])).toBe(true);
    expect(isRun([card("spades", 5), card("hearts", 4)])).toBe(true);
    expect(isRun([card("spades", 5), card("clubs", 4)])).toBe(false);
    expect(isRun([card("spades", 5), card("hearts", 3)])).toBe(false);
    expect(isRun([])).toBe(false);
  });
});

describe("a foundation", () => {
  it("starts on an Ace alone", () => {
    expect(foundationAccepts([], [card("spades", 1)])).toBe(true);
    expect(foundationAccepts([], [card("spades", 2)])).toBe(false);
    expect(foundationAccepts([], [card("spades", 13)])).toBe(false);
  });

  it("builds up in its own suit", () => {
    const started = [card("spades", 1)];
    expect(foundationAccepts(started, [card("spades", 2)])).toBe(true);
    expect(foundationAccepts(started, [card("clubs", 2)])).toBe(false);
    expect(foundationAccepts(started, [card("spades", 3)])).toBe(false);
    expect(foundationAccepts([card("spades", 5)], [card("spades", 4)])).toBe(
      false,
    );
  });

  it("refuses a run of two, whatever leads it", () => {
    expect(foundationAccepts([], [card("spades", 1), card("hearts", 1)])).toBe(
      false,
    );
  });

  it("refuses everything once it holds its King", () => {
    const complete = Array.from({ length: 13 }, (_, i) =>
      card("spades", i + 1),
    );
    expect(foundationAccepts(complete, [card("hearts", 1)])).toBe(false);
  });
});

describe("a column", () => {
  it("takes only a King-headed run when empty", () => {
    expect(tableauAccepts([], [card("spades", 13)])).toBe(true);
    expect(tableauAccepts([], [card("spades", 12)])).toBe(false);
    expect(tableauAccepts([], [card("spades", 13), card("hearts", 12)])).toBe(
      true,
    );
    expect(tableauAccepts([], [card("spades", 10), card("hearts", 9)])).toBe(
      false,
    );
  });

  it("builds down in alternating color", () => {
    const pile = [card("spades", 7)];
    expect(tableauAccepts(pile, [card("hearts", 6)])).toBe(true);
    expect(tableauAccepts(pile, [card("clubs", 6)])).toBe(false);
    expect(tableauAccepts(pile, [card("hearts", 8)])).toBe(false);
    expect(tableauAccepts(pile, [card("hearts", 5)])).toBe(false);
    expect(tableauAccepts(pile, [card("hearts", 7)])).toBe(false);
  });

  it("accepts nothing when its lowest card is face-down", () => {
    const pile = [card("spades", 7, false)];
    expect(tableauAccepts(pile, [card("hearts", 6)])).toBe(false);
  });

  it("refuses a slice that is not a run", () => {
    const pile = [card("spades", 7)];
    expect(tableauAccepts(pile, [card("hearts", 6), card("diamonds", 3)])).toBe(
      false,
    );
  });
});

describe("the foundation a card belongs on", () => {
  it("is the one already holding the next-lower card of its suit", () => {
    const foundations = [
      [card("spades", 1)],
      [card("hearts", 1), card("hearts", 2)],
      [],
      [],
    ];
    expect(foundationFor(foundations, card("hearts", 3))).toBe(1);
    expect(foundationFor(foundations, card("spades", 2))).toBe(0);
    expect(foundationFor(foundations, card("spades", 4))).toBe(-1);
  });

  it("is the first empty one for an Ace", () => {
    expect(
      foundationFor([[card("spades", 1)], [], [], []], card("hearts", 1)),
    ).toBe(1);
    expect(foundationFor([[], [], [], []], card("clubs", 5))).toBe(-1);
  });
});

describe("the board", () => {
  it("is complete when every foundation holds thirteen", () => {
    const full = Array.from({ length: 13 }, (_, i) => card("spades", i + 1));
    expect(boardComplete([full, full, full, full])).toBe(true);
    expect(boardComplete([full, full, full, full.slice(0, 12)])).toBe(false);
  });

  it("reads a card's color from its suit", () => {
    expect(isRed(card("hearts", 3))).toBe(true);
    expect(isRed(card("clubs", 3))).toBe(false);
  });
});
