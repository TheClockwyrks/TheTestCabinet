import { describe, expect, it } from "vitest";
import {
  CUES,
  DEAL_STOCK_CARDS,
  DECK_SIZE,
  LAUNCH_INTERVAL,
  RANK_MAX,
  SUITS,
  TABLEAU_COLUMNS,
  TURN_COUNT,
} from "./constants";
import { makeCard } from "./deck";
import { openingState } from "./flow";
import {
  accepts,
  autoMove,
  deal,
  detachRun,
  liftableRun,
  moveRun,
  newGame,
  playableCard,
  turnStock,
} from "./moves";
import { allCards, withPile, wasteVisibleCount } from "./piles";
import type { CardState, CascadeState, Suit } from "./game";

let ids = 100;
const card = (suit: Suit, rank: number, faceUp = true): CardState =>
  makeCard(ids++, suit, rank, faceUp);

function table(): CascadeState {
  return { ...openingState(), screen: "playing" };
}

function withCards(
  state: CascadeState,
  pile: "stock" | "waste" | "foundation" | "tableau",
  index: number,
  cards: readonly CardState[],
): CascadeState {
  return withPile(state, pile, index, cards);
}

describe("the deal", () => {
  it("lays seven columns of one to seven, lowest card face-up", () => {
    const dealt = deal(table()).state;
    expect(dealt.tableau).toHaveLength(TABLEAU_COLUMNS);
    expect(dealt.tableau.map((c) => c.length)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const column of dealt.tableau) {
      expect(column[column.length - 1].faceUp).toBe(true);
      for (const above of column.slice(0, column.length - 1)) {
        expect(above.faceUp).toBe(false);
      }
    }
  });

  it("leaves twenty-four face-down cards in the stock and nothing elsewhere", () => {
    const dealt = deal(table()).state;
    expect(dealt.stock).toHaveLength(DEAL_STOCK_CARDS);
    expect(dealt.stock.every((c) => !c.faceUp)).toBe(true);
    expect(dealt.waste).toEqual([]);
    expect(dealt.wasteSets).toEqual([]);
    expect(dealt.foundations.every((f) => f.length === 0)).toBe(true);
  });

  it("uses one full deck, each card once and each with its own id", () => {
    const dealt = deal(table()).state;
    const cards = allCards(dealt);
    expect(cards).toHaveLength(DECK_SIZE);
    expect(new Set(cards.map((c) => `${c.suit}-${c.rank}`)).size).toBe(
      DECK_SIZE,
    );
    expect(new Set(cards.map((c) => c.id)).size).toBe(DECK_SIZE);
  });

  it("deals afresh, so two deals lay out different columns", () => {
    const key = (state: CascadeState) =>
      state.tableau
        .flat()
        .map((c) => `${c.suit}${c.rank}`)
        .join(",");
    expect(key(deal(table()).state)).not.toBe(key(deal(table()).state));
  });

  it("winds the cascade back and clears the painted table", () => {
    const painted: CascadeState = {
      ...table(),
      launched: 12,
      trailStamps: 400,
    };
    const dealt = deal(painted).state;
    expect(dealt.launched).toBe(0);
    expect(dealt.trailStamps).toBe(0);
    expect(deal(painted).cues).toEqual([CUES.deal]);
  });

  it("puts a fresh game on the table when a control asks for one", () => {
    const held: CascadeState = {
      ...table(),
      screen: "won",
      flyers: [{ id: 1, suit: "spades", rank: 1, x: 0, y: 0, vx: 0, vy: 0 }],
      cascadeDone: true,
      launchClock: 3,
    };
    const fresh = newGame(held).state;
    expect(fresh.screen).toBe("playing");
    expect(fresh.flyers).toEqual([]);
    expect(fresh.cascadeDone).toBe(false);
    expect(fresh.launchClock).toBe(0);
    expect(fresh.drag).toBeNull();
  });
});

describe("turning the stock", () => {
  it("moves the turn count onto the waste, face-up, in one set", () => {
    const state = withCards(table(), "stock", 0, [
      card("spades", 3, false),
      card("hearts", 4, false),
    ]);
    const turned = turnStock(state);
    expect(turned.cues).toEqual([CUES.turn]);
    expect(turned.state.stock).toHaveLength(2 - TURN_COUNT);
    expect(turned.state.waste).toHaveLength(TURN_COUNT);
    expect(turned.state.waste.every((c) => c.faceUp)).toBe(true);
    expect(turned.state.wasteSets).toEqual([TURN_COUNT]);
  });

  it("takes cards off the top of the stock, so the last taken is the top", () => {
    const state = withCards(table(), "stock", 0, [
      card("spades", 3, false),
      card("hearts", 4, false),
    ]);
    const once = turnStock(state).state;
    expect(once.waste[once.waste.length - 1].rank).toBe(4);
    const twice = turnStock(once).state;
    expect(twice.waste.map((c) => c.rank)).toEqual([4, 3]);
    expect(twice.wasteSets).toEqual([1, 1]);
  });

  it("recycles an empty stock and empties the set memory with the waste", () => {
    const state = {
      ...withCards(table(), "waste", 0, [card("spades", 3), card("hearts", 4)]),
      wasteSets: [1, 1],
    };
    const recycled = turnStock(state);
    expect(recycled.cues).toEqual([CUES.recycle]);
    expect(recycled.state.waste).toEqual([]);
    expect(recycled.state.wasteSets).toEqual([]);
    expect(recycled.state.stock.every((c) => !c.faceUp)).toBe(true);
    // The waste's bottom card is the stock's top, so the next pass repeats.
    expect(recycled.state.stock[recycled.state.stock.length - 1].rank).toBe(3);
  });

  it("leaves an empty stock and an empty waste alone", () => {
    const state = table();
    expect(turnStock(state).state).toBe(state);
    expect(turnStock(state).cues).toEqual([]);
  });
});

describe("what a pile offers a move", () => {
  it("gives a column its face-up card and everything below it", () => {
    const state = withCards(table(), "tableau", 0, [
      card("clubs", 9, false),
      card("spades", 8),
      card("hearts", 7),
      card("clubs", 6),
    ]);
    expect(
      liftableRun(state, { pile: "tableau", index: 0, row: 1 })?.map(
        (c) => c.rank,
      ),
    ).toEqual([8, 7, 6]);
    expect(
      liftableRun(state, { pile: "tableau", index: 0, row: 0 }),
    ).toBeNull();
    expect(
      liftableRun(state, { pile: "tableau", index: 0, row: 9 }),
    ).toBeNull();
  });

  it("gives the waste its top card only, and only while it shows one", () => {
    const cards = [card("spades", 3), card("hearts", 4)];
    const bare = withCards(table(), "waste", 0, cards);
    expect(liftableRun(bare, { pile: "waste", index: 0, row: 1 })).toBeNull();
    const shown = { ...bare, wasteSets: [1] };
    expect(
      liftableRun(shown, { pile: "waste", index: 0, row: 1 })?.map(
        (c) => c.rank,
      ),
    ).toEqual([4]);
    expect(liftableRun(shown, { pile: "waste", index: 0, row: 0 })).toBeNull();
  });

  it("offers the stock nothing", () => {
    const state = withCards(table(), "stock", 0, [card("spades", 3, false)]);
    expect(liftableRun(state, { pile: "stock", index: 0, row: 0 })).toBeNull();
  });

  it("takes a run off its pile without touching the set memory", () => {
    const state = {
      ...withCards(table(), "waste", 0, [card("spades", 3)]),
      wasteSets: [1],
    };
    const detached = detachRun(state, { pile: "waste", index: 0, row: 0 }, 1);
    expect(detached.waste).toEqual([]);
    expect(detached.wasteSets).toEqual([1]);
  });

  it("refuses the stock and the waste as targets", () => {
    const state = table();
    expect(
      accepts(state, [card("spades", 1)], { pile: "stock", index: 0 }),
    ).toBe(false);
    expect(
      accepts(state, [card("spades", 1)], { pile: "waste", index: 0 }),
    ).toBe(false);
  });
});

describe("a move", () => {
  it("accepts a legal run and reports it", () => {
    const state = withCards(
      withCards(table(), "tableau", 0, [card("spades", 13)]),
      "tableau",
      1,
      [card("hearts", 12), card("clubs", 11)],
    );
    const outcome = moveRun(
      state,
      { pile: "tableau", index: 1, row: 0 },
      { pile: "tableau", index: 0 },
    );
    expect(outcome.accepted).toBe(true);
    expect(outcome.state.tableau[0].map((c) => c.rank)).toEqual([13, 12, 11]);
    expect(outcome.state.tableau[1]).toEqual([]);
  });

  it("refuses an illegal run and leaves the board exactly as it was", () => {
    const state = withCards(
      withCards(table(), "tableau", 0, [card("spades", 13)]),
      "tableau",
      1,
      [card("clubs", 12)],
    );
    const outcome = moveRun(
      state,
      { pile: "tableau", index: 1, row: 0 },
      { pile: "tableau", index: 0 },
    );
    expect(outcome.accepted).toBe(false);
    expect(outcome.state).toBe(state);
  });

  it("turns the card an accepted move exposes, and only that one", () => {
    const state = withCards(
      withCards(table(), "tableau", 0, [card("spades", 13)]),
      "tableau",
      1,
      [card("clubs", 5, false), card("diamonds", 7, false), card("hearts", 12)],
    );
    const outcome = moveRun(
      state,
      { pile: "tableau", index: 1, row: 2 },
      { pile: "tableau", index: 0 },
    );
    expect(outcome.accepted).toBe(true);
    expect(outcome.state.tableau[1].map((c) => c.faceUp)).toEqual([
      false,
      true,
    ]);
    expect(outcome.cues).toContain(CUES.flip);
  });

  it("leaves the exposed card face-down while the gate is off", () => {
    const state = {
      ...withCards(
        withCards(table(), "tableau", 0, [card("spades", 13)]),
        "tableau",
        1,
        [card("clubs", 5, false), card("hearts", 12)],
      ),
      autoFlip: false,
    };
    const outcome = moveRun(
      state,
      { pile: "tableau", index: 1, row: 1 },
      { pile: "tableau", index: 0 },
    );
    expect(outcome.state.tableau[1][0].faceUp).toBe(false);
    expect(outcome.cues).not.toContain(CUES.flip);
  });

  it("shrinks the waste's newest set when its card leaves for good", () => {
    const state = {
      ...withCards(table(), "waste", 0, [card("spades", 5), card("hearts", 1)]),
      wasteSets: [1, 1],
    };
    const outcome = moveRun(
      state,
      { pile: "waste", index: 0, row: 1 },
      { pile: "foundation", index: 0 },
    );
    expect(outcome.accepted).toBe(true);
    expect(outcome.state.wasteSets).toEqual([1]);
    expect(wasteVisibleCount(outcome.state)).toBe(1);
    expect(outcome.state.waste.map((c) => c.rank)).toEqual([5]);
    expect(outcome.cues).toContain(CUES.home);
  });

  it("wins the game the instant the fifty-second card lands", () => {
    let state = table();
    for (let f = 0; f < 4; f++) {
      const suit = SUITS[f];
      const cards: CardState[] = [];
      for (let r = 1; r <= RANK_MAX; r++) {
        if (f === 0 && r === RANK_MAX) continue;
        cards.push(card(suit, r));
      }
      state = withCards(state, "foundation", f, cards);
    }
    const nearly = withCards(state, "tableau", 0, [card(SUITS[0], RANK_MAX)]);
    expect(nearly.screen).toBe("playing");

    const outcome = moveRun(
      nearly,
      { pile: "tableau", index: 0, row: 0 },
      { pile: "foundation", index: 0 },
    );
    expect(outcome.accepted).toBe(true);
    expect(outcome.state.screen).toBe("won");
    expect(outcome.state.launchClock).toBe(LAUNCH_INTERVAL);
    expect(outcome.state.launched).toBe(0);
    expect(outcome.cues).toContain(CUES.win);
  });

  it("stays on the table while win detection is off", () => {
    let state: CascadeState = { ...table(), winDetect: false };
    for (let f = 0; f < 4; f++) {
      const cards: CardState[] = [];
      for (let r = 1; r <= RANK_MAX; r++) {
        if (f === 0 && r === RANK_MAX) continue;
        cards.push(card(SUITS[f], r));
      }
      state = withCards(state, "foundation", f, cards);
    }
    state = withCards(state, "tableau", 0, [card(SUITS[0], RANK_MAX)]);
    const outcome = moveRun(
      state,
      { pile: "tableau", index: 0, row: 0 },
      { pile: "foundation", index: 0 },
    );
    expect(outcome.accepted).toBe(true);
    expect(outcome.state.screen).toBe("playing");
  });
});

describe("the auto-move", () => {
  it("sends the waste's top card to the foundation it belongs on", () => {
    const state = {
      ...withCards(
        withCards(table(), "foundation", 1, [card("hearts", 1)]),
        "waste",
        0,
        [card("hearts", 2)],
      ),
      wasteSets: [1],
    };
    const outcome = autoMove(state, "waste", 0);
    expect(outcome.accepted).toBe(true);
    expect(outcome.state.foundations[1].map((c) => c.rank)).toEqual([1, 2]);
    expect(outcome.state.waste).toEqual([]);
  });

  it("takes one card and leaves the rest of the column", () => {
    const state = withCards(table(), "tableau", 0, [
      card("clubs", 9),
      card("spades", 1),
    ]);
    const outcome = autoMove(state, "tableau", 0);
    expect(outcome.accepted).toBe(true);
    expect(outcome.state.tableau[0].map((c) => c.rank)).toEqual([9]);
  });

  it("does nothing from an empty pile, a foundation, or a face-down column", () => {
    const empty = table();
    expect(autoMove(empty, "tableau", 0).accepted).toBe(false);
    const home = withCards(table(), "foundation", 0, [card("spades", 1)]);
    expect(autoMove(home, "foundation", 0).accepted).toBe(false);
    const down = withCards(table(), "tableau", 0, [card("spades", 1, false)]);
    expect(autoMove(down, "tableau", 0).accepted).toBe(false);
    expect(playableCard(down, "tableau", 0)).toBeNull();
  });

  it("does nothing when no foundation would accept the card", () => {
    const state = withCards(table(), "tableau", 0, [card("clubs", 9)]);
    const outcome = autoMove(state, "tableau", 0);
    expect(outcome.accepted).toBe(false);
    expect(outcome.state).toBe(state);
  });
});
