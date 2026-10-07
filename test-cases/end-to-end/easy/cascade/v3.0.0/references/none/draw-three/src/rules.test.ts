// What a foundation and a column accept, as specs/foundations.md and
// specs/tableau.md fix it.

import { describe, expect, it } from "vitest";
import type { Card } from "./cards";
import type { Suit } from "./constants";
import {
  allHome,
  columnAccepts,
  foundationAccepts,
  foundationFor,
  isRun,
} from "./rules";

let id = 0;
function card(suit: Suit, rank: number, faceUp = true): Card {
  id += 1;
  return { id, suit, rank, faceUp };
}

describe("isRun", () => {
  it("takes a single face-up card as a run of one", () => {
    expect(isRun([card("spades", 7)])).toBe(true);
  });

  it("takes cards descending in rank and alternating in color", () => {
    expect(
      isRun([card("spades", 7), card("hearts", 6), card("clubs", 5)]),
    ).toBe(true);
  });

  it("refuses a break in rank", () => {
    expect(isRun([card("spades", 7), card("hearts", 5)])).toBe(false);
  });

  it("refuses two cards of the same color", () => {
    expect(isRun([card("spades", 7), card("clubs", 6)])).toBe(false);
  });

  it("refuses a run carrying a face-down card", () => {
    expect(isRun([card("spades", 7), card("hearts", 6, false)])).toBe(false);
  });

  it("refuses nothing at all", () => {
    expect(isRun([])).toBe(false);
  });
});

describe("foundationAccepts", () => {
  it("starts an empty foundation with an Ace of any suit", () => {
    expect(foundationAccepts([], [card("hearts", 1)])).toBe(true);
    expect(foundationAccepts([], [card("clubs", 1)])).toBe(true);
  });

  it("refuses anything but an Ace on an empty foundation", () => {
    expect(foundationAccepts([], [card("hearts", 2)])).toBe(false);
  });

  it("takes the next-higher card of its own suit", () => {
    const pile = [card("hearts", 1)];
    expect(foundationAccepts(pile, [card("hearts", 2)])).toBe(true);
    expect(foundationAccepts(pile, [card("hearts", 3)])).toBe(false);
    expect(foundationAccepts(pile, [card("diamonds", 2)])).toBe(false);
  });

  it("takes nothing on its King", () => {
    const pile = Array.from({ length: 13 }, (_, i) => card("spades", i + 1));
    expect(foundationAccepts(pile, [card("spades", 13)])).toBe(false);
  });

  it("refuses a run of two even when its leading card would be taken", () => {
    expect(
      foundationAccepts(
        [card("hearts", 1)],
        [card("hearts", 2), card("spades", 1)],
      ),
    ).toBe(false);
  });
});

describe("columnAccepts", () => {
  it("takes a King, and only a King, onto an empty column", () => {
    expect(columnAccepts([], [card("spades", 13)])).toBe(true);
    expect(columnAccepts([], [card("spades", 12)])).toBe(false);
  });

  it("takes a run led by a King onto an empty column", () => {
    expect(columnAccepts([], [card("spades", 13), card("hearts", 12)])).toBe(
      true,
    );
  });

  it("builds down in rank and alternates in color", () => {
    const column = [card("spades", 8)];
    expect(columnAccepts(column, [card("hearts", 7)])).toBe(true);
    expect(columnAccepts(column, [card("clubs", 7)])).toBe(false);
    expect(columnAccepts(column, [card("hearts", 6)])).toBe(false);
  });

  it("accepts nothing when its lowest card is face-down", () => {
    expect(columnAccepts([card("spades", 8, false)], [card("hearts", 7)])).toBe(
      false,
    );
  });

  it("refuses a list that is not in run order", () => {
    expect(
      columnAccepts(
        [card("spades", 8)],
        [card("hearts", 7), card("diamonds", 6)],
      ),
    ).toBe(false);
  });
});

describe("foundationFor", () => {
  it("finds the foundation already holding the next-lower card of the suit", () => {
    const foundations = [[card("hearts", 1)], [], [card("spades", 1)], []];
    expect(foundationFor(foundations, card("spades", 2))).toBe(2);
  });

  it("sends an Ace to the first empty foundation", () => {
    const foundations = [[card("hearts", 1)], [], [], []];
    expect(foundationFor(foundations, card("clubs", 1))).toBe(1);
  });

  it("reports none when no foundation would take the card", () => {
    const foundations = [[card("hearts", 1)], [card("spades", 1)], [], []];
    expect(foundationFor(foundations, card("hearts", 5))).toBe(-1);
  });
});

describe("allHome", () => {
  it("is true only when every foundation holds thirteen", () => {
    const full = () =>
      Array.from({ length: 13 }, (_, i) => card("spades", i + 1));
    expect(allHome([full(), full(), full(), full()])).toBe(true);
    expect(allHome([full(), full(), full(), full().slice(0, 12)])).toBe(false);
  });
});
