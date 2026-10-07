// Every way a card moves: the deal, the stock's turn, a run landing or being
// refused, the auto-move, the turning of an exposed card, and the win.

import { beforeEach, describe, expect, it } from "vitest";
import type { Card } from "./cards";
import {
  CUES,
  DEAL_STOCK_CARDS,
  DEAL_TABLEAU_CARDS,
  DECK_SIZE,
  LAUNCH_INTERVAL,
  RANK_MAX,
  SUITS,
  TABLEAU_COLUMNS,
  TURN_COUNT,
  type Suit,
} from "./constants";
import {
  applyMove,
  autoMove,
  deal,
  landRun,
  liftRun,
  playableCard,
  returnRun,
  turnStock,
} from "./moves";
import { createState, type CascadeState } from "./state";
import { wasteVisibleCount } from "./waste";

let state: CascadeState;

function card(suit: Suit, rank: number, faceUp = true): Card {
  state.nextId += 1;
  return { id: state.nextId, suit, rank, faceUp };
}

/** A full board, every card home but the one named, which sits on column 0. */
function nearlyWon(missing: { suit: Suit; rank: number }): void {
  for (let i = 0; i < SUITS.length; i += 1) {
    for (let rank = 1; rank <= RANK_MAX; rank += 1) {
      if (SUITS[i] === missing.suit && rank === missing.rank) continue;
      state.foundations[i].push(card(SUITS[i], rank));
    }
  }
  state.tableau[0].push(card(missing.suit, missing.rank));
}

beforeEach(() => {
  state = createState(() => null);
});

describe("deal", () => {
  beforeEach(() => {
    deal(state);
  });

  it("lays one to seven cards into the seven columns", () => {
    expect(state.tableau.map((column) => column.length)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
    const dealt = state.tableau.reduce((n, column) => n + column.length, 0);
    expect(dealt).toBe(DEAL_TABLEAU_CARDS);
  });

  it("shows exactly one face-up card per column, the lowest one", () => {
    for (const column of state.tableau) {
      expect(column.filter((entry) => entry.faceUp)).toHaveLength(1);
      expect(column[column.length - 1].faceUp).toBe(true);
    }
  });

  it("leaves the rest face-down in the stock, and both draw piles empty", () => {
    expect(state.stock).toHaveLength(DEAL_STOCK_CARDS);
    expect(state.stock.every((entry) => !entry.faceUp)).toBe(true);
    expect(state.waste).toEqual([]);
    expect(state.wasteSets).toEqual([]);
    expect(state.foundations.every((pile) => pile.length === 0)).toBe(true);
  });

  it("deals every one of the fifty-two cards exactly once", () => {
    const all = [...state.stock, ...state.tableau.flat()];
    expect(all).toHaveLength(DECK_SIZE);
    expect(
      new Set(all.map((entry) => `${entry.suit}-${entry.rank}`)).size,
    ).toBe(DECK_SIZE);
    expect(new Set(all.map((entry) => entry.id)).size).toBe(DECK_SIZE);
  });

  it("clears the painted table and zeroes the launch count", () => {
    state.trailStamps = 40;
    state.launched = 12;
    deal(state);
    expect(state.trailStamps).toBe(0);
    expect(state.launched).toBe(0);
  });

  it("leaves the screen alone", () => {
    state.screen = "won";
    deal(state);
    expect(state.screen).toBe("won");
  });

  it("shuffles afresh, so two deals lay out different columns", () => {
    deal(state);
    const first = state.tableau.map((c) => c.map((e) => `${e.suit}${e.rank}`));
    deal(state);
    expect(
      state.tableau.map((c) => c.map((e) => `${e.suit}${e.rank}`)),
    ).not.toEqual(first);
  });

  it("sounds the deal cue", () => {
    expect(state.pendingCues.has(CUES.deal)).toBe(true);
  });
});

describe("turnStock", () => {
  it("moves the turn count of cards, one at a time from the top", () => {
    for (let i = 1; i <= 5; i += 1) state.stock.push(card("spades", i, false));
    const top = state.stock[state.stock.length - 1];
    turnStock(state);
    expect(state.waste).toHaveLength(TURN_COUNT);
    expect(state.waste[0]).toBe(top);
    expect(state.waste.every((entry) => entry.faceUp)).toBe(true);
    expect(state.stock).toHaveLength(2);
    expect(state.wasteSets).toEqual([TURN_COUNT]);
    expect(state.pendingCues.has(CUES.turn)).toBe(true);
  });

  it("moves all that remain when the stock holds fewer", () => {
    state.stock.push(card("spades", 1, false), card("spades", 2, false));
    turnStock(state);
    expect(state.waste).toHaveLength(2);
    expect(state.wasteSets).toEqual([2]);
  });

  it("appends one set per turn, in the order they were turned", () => {
    for (let i = 1; i <= 9; i += 1) state.stock.push(card("hearts", i, false));
    turnStock(state);
    turnStock(state);
    expect(state.wasteSets).toEqual([3, 3]);
    expect(wasteVisibleCount(state)).toBe(3);
  });

  it("recycles an empty stock, in reverse, and empties the set memory", () => {
    for (let i = 1; i <= 6; i += 1) state.stock.push(card("hearts", i, false));
    turnStock(state);
    turnStock(state);
    const order = state.waste.map((entry) => entry.id);
    turnStock(state);
    expect(state.waste).toEqual([]);
    expect(state.wasteSets).toEqual([]);
    expect(state.stock.every((entry) => !entry.faceUp)).toBe(true);
    expect(state.stock[state.stock.length - 1].id).toBe(order[0]);
    expect(state.pendingCues.has(CUES.recycle)).toBe(true);
    // A further pass turns the same cards up in the same order.
    turnStock(state);
    expect(state.waste.map((entry) => entry.id)).toEqual(order.slice(0, 3));
  });

  it("leaves both empty when both are empty", () => {
    turnStock(state);
    expect(state.stock).toEqual([]);
    expect(state.waste).toEqual([]);
    expect(state.pendingCues.size).toBe(0);
  });
});

describe("lifting and returning", () => {
  it("takes a column's card and every card below it", () => {
    state.tableau[0] = [
      card("spades", 9, false),
      card("clubs", 8),
      card("hearts", 7),
      card("spades", 6),
    ];
    const run = liftRun(state, { pile: "tableau", index: 0 }, 1);
    expect(run?.map((entry) => entry.rank)).toEqual([8, 7, 6]);
    expect(state.tableau[0]).toHaveLength(1);
    returnRun(state, run as Card[], { pile: "tableau", index: 0 });
    expect(state.tableau[0].map((entry) => entry.rank)).toEqual([9, 8, 7, 6]);
  });

  it("refuses a face-down card", () => {
    state.tableau[0] = [card("spades", 9, false), card("clubs", 8, false)];
    expect(liftRun(state, { pile: "tableau", index: 0 }, 1)).toBeNull();
  });

  it("takes only the waste's top card, and only when the waste shows one", () => {
    state.waste = [card("spades", 3), card("hearts", 4)];
    state.wasteSets = [2];
    expect(liftRun(state, { pile: "waste", index: 0 }, 0)).toBeNull();
    state.wasteSets = [];
    expect(liftRun(state, { pile: "waste", index: 0 }, 1)).toBeNull();
    state.wasteSets = [2];
    expect(liftRun(state, { pile: "waste", index: 0 }, 1)).not.toBeNull();
  });

  it("leaves the set memory untouched while the card is in hand", () => {
    state.waste = [card("spades", 3), card("hearts", 4)];
    state.wasteSets = [2];
    const run = liftRun(state, { pile: "waste", index: 0 }, 1) as Card[];
    expect(state.wasteSets).toEqual([2]);
    returnRun(state, run, { pile: "waste", index: 0 });
    expect(state.wasteSets).toEqual([2]);
    expect(state.waste).toHaveLength(2);
  });
});

describe("landRun", () => {
  it("takes the card off the waste's newest set once it lands", () => {
    state.waste = [card("spades", 3), card("hearts", 1)];
    state.wasteSets = [2];
    const run = liftRun(state, { pile: "waste", index: 0 }, 1) as Card[];
    expect(
      landRun(
        state,
        run,
        { pile: "waste", index: 0 },
        { pile: "foundation", index: 0 },
      ),
    ).toBe(true);
    expect(state.wasteSets).toEqual([1]);
    expect(state.pendingCues.has(CUES.home)).toBe(true);
  });

  it("turns a column's newly exposed lowest card, and only that one", () => {
    state.tableau[0] = [
      card("spades", 9, false),
      card("clubs", 8, false),
      card("hearts", 1),
    ];
    expect(applyMove(state, "tableau", 0, 2, "foundation", 0)).toBe(true);
    expect(state.tableau[0][1].faceUp).toBe(true);
    expect(state.tableau[0][0].faceUp).toBe(false);
    expect(state.pendingCues.has(CUES.flip)).toBe(true);
  });

  it("leaves the exposed card face-down while autoFlip is off", () => {
    state.autoFlip = false;
    state.tableau[0] = [card("clubs", 8, false), card("hearts", 1)];
    expect(applyMove(state, "tableau", 0, 1, "foundation", 0)).toBe(true);
    expect(state.tableau[0][0].faceUp).toBe(false);
  });
});

describe("applyMove", () => {
  it("refuses a move the rules refuse, leaving the board as it was", () => {
    state.tableau[0] = [card("spades", 9)];
    state.tableau[1] = [card("clubs", 5)];
    expect(applyMove(state, "tableau", 0, 0, "tableau", 1)).toBe(false);
    expect(state.tableau[0]).toHaveLength(1);
    expect(state.tableau[1]).toHaveLength(1);
  });

  it("refuses a move out of the stock and a move onto the stock", () => {
    state.stock = [card("spades", 1, false)];
    state.tableau[0] = [card("hearts", 2)];
    expect(applyMove(state, "stock", 0, 0, "foundation", 0)).toBe(false);
    expect(applyMove(state, "tableau", 0, 0, "stock", 0)).toBe(false);
  });

  it("moves a run onto an empty column only when a King leads it", () => {
    state.tableau[0] = [card("spades", 13), card("hearts", 12)];
    expect(applyMove(state, "tableau", 0, 1, "tableau", 1)).toBe(false);
    expect(applyMove(state, "tableau", 0, 0, "tableau", 1)).toBe(true);
    expect(state.tableau[0]).toEqual([]);
    expect(state.tableau[1].map((entry) => entry.rank)).toEqual([13, 12]);
  });

  it("brings a foundation's top card back onto a column that takes it", () => {
    state.foundations[0] = [card("hearts", 1), card("hearts", 2)];
    state.tableau[0] = [card("spades", 3)];
    expect(applyMove(state, "foundation", 0, 1, "tableau", 0)).toBe(true);
    expect(state.foundations[0]).toHaveLength(1);
    expect(state.tableau[0]).toHaveLength(2);
  });

  it("wins the game when the last card goes home", () => {
    nearlyWon({ suit: "clubs", rank: RANK_MAX });
    expect(applyMove(state, "tableau", 0, 0, "foundation", 3)).toBe(true);
    expect(state.screen).toBe("won");
    expect(state.launchClock).toBe(LAUNCH_INTERVAL);
    expect(state.launched).toBe(0);
    expect(state.pendingCues.has(CUES.win)).toBe(true);
  });

  it("stays on the table when winDetect is off", () => {
    state.screen = "playing";
    state.winDetect = false;
    nearlyWon({ suit: "clubs", rank: RANK_MAX });
    expect(applyMove(state, "tableau", 0, 0, "foundation", 3)).toBe(true);
    expect(state.screen).toBe("playing");
  });
});

describe("autoMove", () => {
  it("sends the waste's top card home", () => {
    state.waste = [card("hearts", 1)];
    state.wasteSets = [1];
    expect(autoMove(state, "waste", 0)).toBe(true);
    expect(state.foundations[0]).toHaveLength(1);
    expect(state.wasteSets).toEqual([]);
  });

  it("sends a column's lowest face-up card home", () => {
    state.tableau[2] = [card("spades", 4, false), card("diamonds", 1)];
    expect(autoMove(state, "tableau", 2)).toBe(true);
    expect(state.tableau[2][0].faceUp).toBe(true);
  });

  it("does nothing when the foundations refuse the card", () => {
    state.tableau[2] = [card("diamonds", 9)];
    expect(autoMove(state, "tableau", 2)).toBe(false);
    expect(state.tableau[2]).toHaveLength(1);
  });

  it("sends nothing from an empty pile, a face-down column, or a foundation", () => {
    expect(autoMove(state, "tableau", 4)).toBe(false);
    state.tableau[4] = [card("hearts", 1, false)];
    expect(autoMove(state, "tableau", 4)).toBe(false);
    state.foundations[0] = [card("hearts", 1)];
    expect(autoMove(state, "foundation", 0)).toBe(false);
    expect(autoMove(state, "stock", 0)).toBe(false);
  });

  it("reports the playable card of each pile kind", () => {
    state.waste = [card("hearts", 5)];
    state.wasteSets = [1];
    expect(playableCard(state, "waste", 0)?.row).toBe(0);
    expect(playableCard(state, "foundation", 0)).toBeNull();
    expect(playableCard(state, "stock", 0)).toBeNull();
  });
});

describe("the whole table", () => {
  it("keeps fifty-two cards across a deal and every column", () => {
    deal(state);
    let total = state.stock.length + state.waste.length;
    for (const pile of state.foundations) total += pile.length;
    for (let i = 0; i < TABLEAU_COLUMNS; i += 1)
      total += state.tableau[i].length;
    expect(total).toBe(DECK_SIZE);
  });
});
