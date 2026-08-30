// The rules of Klondike as pure questions about cards: what a foundation takes,
// what a column takes, and what makes a run (specs/foundations.md,
// specs/tableau.md).

import { describe, expect, it } from "vitest";
import type { CardState, Suit } from "./game";
import {
  boardComplete,
  columnAccepts,
  foundationAccepts,
  foundationFor,
  isRunOrdered,
} from "./rules";
import { colorOf, opposite } from "./deck";

let nextId = 1;

function card(suit: Suit, rank: number, faceUp = true): CardState {
  nextId += 1;
  return { id: nextId, suit, rank, faceUp };
}

function upTo(suit: Suit, rank: number): CardState[] {
  return Array.from({ length: rank }, (_, i) => card(suit, i + 1));
}

describe("colors", () => {
  it("puts hearts and diamonds on one side and spades and clubs on the other", () => {
    expect(colorOf("hearts")).toBe("red");
    expect(colorOf("diamonds")).toBe("red");
    expect(colorOf("spades")).toBe("black");
    expect(colorOf("clubs")).toBe("black");
    expect(opposite("hearts", "spades")).toBe(true);
    expect(opposite("hearts", "diamonds")).toBe(false);
  });
});

describe("a run", () => {
  it("descends one rank at a time and alternates color", () => {
    expect(isRunOrdered([card("spades", 8)])).toBe(true);
    expect(
      isRunOrdered([card("spades", 8), card("hearts", 7), card("clubs", 6)]),
    ).toBe(true);
  });

  it("is not a run when the color repeats or the rank skips", () => {
    expect(isRunOrdered([card("spades", 8), card("clubs", 7)])).toBe(false);
    expect(isRunOrdered([card("spades", 8), card("hearts", 6)])).toBe(false);
    expect(isRunOrdered([card("spades", 8), card("hearts", 9)])).toBe(false);
    expect(isRunOrdered([])).toBe(false);
  });
});

describe("a foundation", () => {
  it("starts on an Ace of any suit and builds up in that suit", () => {
    expect(foundationAccepts([], [card("hearts", 1)])).toBe(true);
    expect(foundationAccepts([], [card("clubs", 1)])).toBe(true);
    expect(foundationAccepts(upTo("hearts", 1), [card("hearts", 2)])).toBe(true);
    expect(foundationAccepts(upTo("hearts", 12), [card("hearts", 13)])).toBe(true);
  });

  it("refuses everything else", () => {
    expect(foundationAccepts([], [card("hearts", 2)])).toBe(false);
    expect(foundationAccepts([], [card("spades", 13)])).toBe(false);
    expect(foundationAccepts(upTo("hearts", 3), [card("spades", 4)])).toBe(false);
    expect(foundationAccepts(upTo("hearts", 3), [card("hearts", 5)])).toBe(false);
    expect(foundationAccepts(upTo("hearts", 3), [card("hearts", 2)])).toBe(false);
    expect(foundationAccepts(upTo("hearts", 13), [card("hearts", 13)])).toBe(false);
  });

  it("takes one card at a time, refusing a run whose leader alone would go", () => {
    expect(
      foundationAccepts(upTo("hearts", 1), [card("hearts", 2), card("spades", 1)]),
    ).toBe(false);
  });
});

describe("a column", () => {
  it("takes a King, or a King-led run, on an empty column", () => {
    expect(columnAccepts([], [card("spades", 13)])).toBe(true);
    expect(columnAccepts([], [card("spades", 13), card("hearts", 12)])).toBe(true);
    expect(columnAccepts([], [card("spades", 12)])).toBe(false);
    expect(columnAccepts([], [card("spades", 1)])).toBe(false);
  });

  it("builds down in alternating color on its lowest card", () => {
    const column = [card("clubs", 8)];
    expect(columnAccepts(column, [card("hearts", 7)])).toBe(true);
    expect(columnAccepts(column, [card("spades", 7)])).toBe(false);
    expect(columnAccepts(column, [card("hearts", 9)])).toBe(false);
    expect(columnAccepts(column, [card("hearts", 6)])).toBe(false);
    expect(columnAccepts(column, [card("hearts", 8)])).toBe(false);
  });

  it("takes nothing while its lowest card is face-down", () => {
    const column = [card("clubs", 8, false)];
    expect(columnAccepts(column, [card("hearts", 7)])).toBe(false);
    expect(columnAccepts(column, [card("spades", 13)])).toBe(false);
  });

  it("refuses a slice that is not an ordered run", () => {
    const column = [card("clubs", 8)];
    expect(columnAccepts(column, [card("hearts", 7), card("diamonds", 6)])).toBe(
      false,
    );
  });
});

describe("the foundation a card belongs on", () => {
  it("is the one already holding the next-lower card of its suit", () => {
    const state = {
      foundations: [upTo("spades", 3), upTo("hearts", 5), [], []],
    } as unknown as Parameters<typeof foundationFor>[0];
    expect(foundationFor(state, card("spades", 4))).toBe(0);
    expect(foundationFor(state, card("hearts", 6))).toBe(1);
    expect(foundationFor(state, card("clubs", 1))).toBe(2);
    expect(foundationFor(state, card("clubs", 5))).toBeNull();
  });
});

describe("a complete board", () => {
  it("is four foundations of thirteen and nothing less", () => {
    const full = {
      foundations: [
        upTo("spades", 13),
        upTo("hearts", 13),
        upTo("diamonds", 13),
        upTo("clubs", 13),
      ],
    } as unknown as Parameters<typeof boardComplete>[0];
    expect(boardComplete(full)).toBe(true);
    full.foundations[3].pop();
    expect(boardComplete(full)).toBe(false);
  });
});
