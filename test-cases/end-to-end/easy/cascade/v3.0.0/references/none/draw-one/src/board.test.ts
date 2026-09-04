import { describe, expect, it } from "vitest";
import {
  autoMove,
  dealCards,
  isWin,
  moveRun,
  pileAt,
  playableCard,
  runAt,
  startNewGame,
  takeFromWasteSets,
  turnStock,
  wasteTopCard,
  wasteVisibleCount,
} from "./board";
import { CUES, DEAL_STOCK_CARDS, TURN_COUNT } from "./constants";
import { put, testState } from "./harness.test-support";
import type { Suit } from "./types";

const SUITS: Suit[] = ["spades", "hearts", "diamonds", "clubs"];

/** A board whose foundations hold every card but one named club. */
function almostWon(hold: number) {
  const state = testState();
  state.screen = "playing";
  for (let f = 0; f < 4; f += 1) {
    for (let rank = 1; rank <= 13; rank += 1) {
      if (f === 3 && rank === hold) continue;
      put(state, "foundation", f, SUITS[f], rank, true);
    }
  }
  return state;
}

describe("the deal", () => {
  it("lays seven columns of one to seven, each showing its lowest card", () => {
    const state = testState();
    dealCards(state);
    expect(state.tableau.map((column) => column.length)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
    for (const column of state.tableau) {
      expect(column[column.length - 1].faceUp).toBe(true);
      for (const card of column.slice(0, -1)) expect(card.faceUp).toBe(false);
    }
  });

  it("leaves twenty-four face-down cards in the stock and both other piles empty", () => {
    const state = testState();
    dealCards(state);
    expect(state.stock).toHaveLength(DEAL_STOCK_CARDS);
    expect(state.stock.every((card) => !card.faceUp)).toBe(true);
    expect(state.waste).toHaveLength(0);
    expect(state.wasteSets).toHaveLength(0);
    expect(state.foundations.every((pile) => pile.length === 0)).toBe(true);
  });

  it("uses one full deck, with fifty-two distinct ids", () => {
    const state = testState();
    dealCards(state);
    const cards = [...state.tableau.flat(), ...state.stock];
    expect(cards).toHaveLength(52);
    expect(new Set(cards.map((c) => `${c.suit}:${c.rank}`)).size).toBe(52);
    expect(new Set(cards.map((c) => c.id)).size).toBe(52);
  });

  it("repeats under one seed and differs under two", () => {
    const one = testState(11);
    const two = testState(11);
    const other = testState(12);
    dealCards(one);
    dealCards(two);
    dealCards(other);
    const shape = (s: typeof one) =>
      s.tableau.map((c) =>
        c.map((card) => `${card.suit}${card.rank}`).join(","),
      );
    expect(shape(one)).toEqual(shape(two));
    expect(shape(one)).not.toEqual(shape(other));
  });

  it("clears the painted table and raises the deal cue", () => {
    const state = testState();
    state.trailStamps = 40;
    dealCards(state);
    expect(state.trailStamps).toBe(0);
    expect(state.cues.peek()).toContain(CUES.deal);
  });

  it("leaves the screen alone, while a new game enters play", () => {
    const state = testState();
    dealCards(state);
    expect(state.screen).toBe("title");
    startNewGame(state);
    expect(state.screen).toBe("playing");
  });
});

describe("the stock and the waste", () => {
  it("turns the deal mode's count onto the waste, face-up, as one set", () => {
    const state = testState();
    dealCards(state);
    turnStock(state);
    expect(state.stock).toHaveLength(DEAL_STOCK_CARDS - TURN_COUNT);
    expect(state.waste).toHaveLength(TURN_COUNT);
    expect(state.waste.every((card) => card.faceUp)).toBe(true);
    expect(state.wasteSets).toEqual([TURN_COUNT]);
    expect(wasteVisibleCount(state)).toBe(TURN_COUNT);
  });

  it("takes the stock's top card first, so it ends deepest of the turned group", () => {
    const state = testState();
    for (let i = 1; i <= 4; i += 1) put(state, "stock", 0, "spades", i, false);
    const top = state.stock[state.stock.length - 1];
    turnStock(state);
    expect(state.waste[state.waste.length - 1].id).toBe(top.id);
  });

  it("falls back to the set turned before once a set is played off", () => {
    const state = testState();
    for (let i = 1; i <= 4; i += 1) put(state, "stock", 0, "spades", i, false);
    turnStock(state);
    const earlier = wasteTopCard(state);
    turnStock(state);
    const newer = wasteTopCard(state);
    expect(newer?.id).not.toBe(earlier?.id);
    takeFromWasteSets(state);
    state.waste.pop();
    expect(wasteVisibleCount(state)).toBe(1);
    expect(wasteTopCard(state)?.id).toBe(earlier?.id);
  });

  it("shows nothing while its set memory is empty, whatever it holds", () => {
    const state = testState();
    put(state, "waste", 0, "hearts", 5, true);
    expect(state.waste).toHaveLength(1);
    expect(wasteVisibleCount(state)).toBe(0);
    expect(wasteTopCard(state)).toBeNull();
    expect(runAt(state, { pile: "waste", index: 0, row: 0 })).toBeNull();
  });

  it("recycles an empty stock, keeping the order for another pass", () => {
    const state = testState();
    for (let i = 1; i <= 3; i += 1) put(state, "stock", 0, "spades", i, false);
    const order: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      turnStock(state);
      order.push(state.waste[state.waste.length - 1].id);
    }
    turnStock(state);
    expect(state.waste).toHaveLength(0);
    expect(state.wasteSets).toHaveLength(0);
    expect(state.stock).toHaveLength(3);
    expect(state.stock.every((card) => !card.faceUp)).toBe(true);
    const again: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      turnStock(state);
      again.push(state.waste[state.waste.length - 1].id);
    }
    expect(again).toEqual(order);
  });

  it("leaves an empty stock and an empty waste alone", () => {
    const state = testState();
    turnStock(state);
    expect(state.stock).toHaveLength(0);
    expect(state.waste).toHaveLength(0);
    expect(state.cues.peek()).toEqual([]);
  });

  it("raises turn on a turn and recycle on a recycle", () => {
    const state = testState();
    put(state, "stock", 0, "spades", 1, false);
    turnStock(state);
    expect(state.cues.peek()).toEqual([CUES.turn]);
    const other = testState();
    put(other, "waste", 0, "spades", 1, true);
    other.wasteSets.push(1);
    turnStock(other);
    expect(other.cues.peek()).toEqual([CUES.recycle]);
  });
});

describe("moving a run", () => {
  it("takes the grabbed card and every card below it, leaving the rest above", () => {
    const state = testState();
    put(state, "tableau", 0, "clubs", 13);
    put(state, "tableau", 0, "hearts", 12);
    put(state, "tableau", 0, "spades", 11);
    put(state, "tableau", 1, "spades", 13);
    // The Queen and the Jack move together; the King stays where it was.
    expect(
      moveRun(
        state,
        { pile: "tableau", index: 0, row: 1 },
        { pile: "tableau", index: 1 },
      ),
    ).toBe(true);
    expect(state.tableau[0].map((c) => c.rank)).toEqual([13]);
    expect(state.tableau[1].map((c) => c.rank)).toEqual([13, 12, 11]);
  });

  it("refuses a run whose leading card does not fit the target", () => {
    const state = testState();
    put(state, "tableau", 0, "clubs", 13);
    put(state, "tableau", 0, "hearts", 12);
    put(state, "tableau", 1, "hearts", 13);
    expect(
      moveRun(
        state,
        { pile: "tableau", index: 0, row: 1 },
        { pile: "tableau", index: 1 },
      ),
    ).toBe(false);
    expect(state.tableau[0]).toHaveLength(2);
    expect(state.tableau[1]).toHaveLength(1);
  });

  it("moves a valid run onto a legal column, in order, leaving the rest", () => {
    const state = testState();
    put(state, "tableau", 0, "clubs", 9, false);
    put(state, "tableau", 0, "spades", 8);
    put(state, "tableau", 0, "hearts", 7);
    put(state, "tableau", 0, "clubs", 6);
    put(state, "tableau", 1, "diamonds", 9);
    const moved = moveRun(
      state,
      { pile: "tableau", index: 0, row: 1 },
      { pile: "tableau", index: 1 },
    );
    expect(moved).toBe(true);
    expect(state.tableau[1].map((c) => c.rank)).toEqual([9, 8, 7, 6]);
    expect(state.tableau[0]).toHaveLength(1);
    // The card the move exposed turns, and only that one.
    expect(state.tableau[0][0].faceUp).toBe(true);
    expect(state.cues.peek()).toContain(CUES.flip);
  });

  it("refuses a face-down source and leaves the board alone", () => {
    const state = testState();
    put(state, "tableau", 0, "clubs", 9, false);
    put(state, "tableau", 1, "diamonds", 10);
    expect(
      moveRun(
        state,
        { pile: "tableau", index: 0, row: 0 },
        { pile: "tableau", index: 1 },
      ),
    ).toBe(false);
    expect(state.tableau[0]).toHaveLength(1);
    expect(state.tableau[1]).toHaveLength(1);
  });

  it("plays the waste's top card and shrinks its set", () => {
    const state = testState();
    put(state, "stock", 0, "hearts", 1, false);
    turnStock(state);
    expect(wasteVisibleCount(state)).toBe(1);
    expect(
      moveRun(
        state,
        { pile: "waste", index: 0, row: 0 },
        { pile: "foundation", index: 0 },
      ),
    ).toBe(true);
    expect(state.waste).toHaveLength(0);
    expect(state.wasteSets).toEqual([]);
    expect(state.cues.peek()).toContain(CUES.home);
  });

  it("refuses a waste card below the top", () => {
    const state = testState();
    put(state, "waste", 0, "hearts", 1);
    put(state, "waste", 0, "spades", 1);
    state.wasteSets.push(2);
    expect(
      moveRun(
        state,
        { pile: "waste", index: 0, row: 0 },
        { pile: "foundation", index: 0 },
      ),
    ).toBe(false);
  });

  it("pulls a foundation's top card back onto a legal column", () => {
    const state = testState();
    put(state, "foundation", 0, "spades", 1);
    put(state, "foundation", 0, "spades", 2);
    put(state, "tableau", 3, "hearts", 3);
    expect(
      moveRun(
        state,
        { pile: "foundation", index: 0, row: 1 },
        { pile: "tableau", index: 3 },
      ),
    ).toBe(true);
    expect(state.foundations[0]).toHaveLength(1);
    expect(state.tableau[3].map((c) => c.rank)).toEqual([3, 2]);
  });

  it("names no pile for an index outside the table", () => {
    const state = testState();
    expect(pileAt(state, "tableau", 9)).toBeNull();
    expect(pileAt(state, "foundation", 4)).toBeNull();
    expect(pileAt(state, "stock", 1)).toBeNull();
  });
});

describe("the auto-move", () => {
  it("sends the waste's top card and a column's lowest face-up card home", () => {
    const state = testState();
    put(state, "stock", 0, "hearts", 1, false);
    turnStock(state);
    expect(autoMove(state, "waste", 0)).toBe(true);
    put(state, "tableau", 2, "hearts", 2);
    expect(autoMove(state, "tableau", 2)).toBe(true);
    expect(state.foundations[0].map((c) => c.rank)).toEqual([1, 2]);
  });

  it("does nothing from an empty pile, a face-down column, or a foundation", () => {
    const state = testState();
    expect(autoMove(state, "tableau", 0)).toBe(false);
    put(state, "tableau", 1, "hearts", 1, false);
    expect(autoMove(state, "tableau", 1)).toBe(false);
    put(state, "foundation", 0, "hearts", 1);
    expect(autoMove(state, "foundation", 0)).toBe(false);
    expect(playableCard(state, "stock", 0)).toBeNull();
  });

  it("takes one card and turns the one it exposes", () => {
    const state = testState();
    put(state, "tableau", 0, "clubs", 9, false);
    put(state, "tableau", 0, "hearts", 1);
    expect(autoMove(state, "tableau", 0)).toBe(true);
    expect(state.tableau[0]).toHaveLength(1);
    expect(state.tableau[0][0].faceUp).toBe(true);
  });

  it("can win the game", () => {
    const state = almostWon(13);
    put(state, "tableau", 0, "clubs", 13);
    expect(isWin(state)).toBe(false);
    expect(autoMove(state, "tableau", 0)).toBe(true);
    expect(isWin(state)).toBe(true);
    expect(state.screen).toBe("won");
    expect(state.cues.peek()).toContain(CUES.win);
  });
});

describe("winning", () => {
  it("stays on playing while one card is still out", () => {
    const state = almostWon(13);
    expect(state.screen).toBe("playing");
    expect(isWin(state)).toBe(false);
  });

  it("is not detected while the gate is off", () => {
    const state = almostWon(13);
    state.winDetect = false;
    put(state, "tableau", 0, "clubs", 13);
    expect(
      moveRun(
        state,
        { pile: "tableau", index: 0, row: 0 },
        { pile: "foundation", index: 3 },
      ),
    ).toBe(true);
    expect(isWin(state)).toBe(true);
    expect(state.screen).toBe("playing");
  });

  it("leaves an exposed card face-down while the flip gate is off", () => {
    const state = testState();
    state.autoFlip = false;
    put(state, "tableau", 0, "clubs", 9, false);
    put(state, "tableau", 0, "hearts", 1);
    expect(autoMove(state, "tableau", 0)).toBe(true);
    expect(state.tableau[0][0].faceUp).toBe(false);
  });
});
