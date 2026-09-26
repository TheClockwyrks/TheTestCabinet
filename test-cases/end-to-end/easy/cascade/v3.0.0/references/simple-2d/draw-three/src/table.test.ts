// The deal, the stock and the waste, and every move.

import { beforeEach, describe, expect, it } from "vitest";
import { CUES, DECK_SIZE, TURN_COUNT } from "./constants";
import { openingState } from "./flow";
import {
  autoMoveFrom,
  cardsHome,
  clearTable,
  dealFresh,
  dropFromWasteSets,
  grabbableRun,
  moveCards,
  newGame,
  turnStock,
} from "./table";
import { takeId, toSim, visibleCount, type MutCard, type Sim } from "./sim";
import type { PileKind, Suit } from "./game";

function newSim(): Sim {
  return toSim(openingState());
}

function put(
  sim: Sim,
  pile: PileKind,
  index: number,
  suit: Suit,
  rank: number,
  faceUp = true,
): MutCard {
  const card: MutCard = { id: takeId(sim), suit, rank, faceUp };
  const target =
    pile === "stock"
      ? sim.stock
      : pile === "waste"
        ? sim.waste
        : pile === "foundation"
          ? (sim.foundations[index] as MutCard[])
          : (sim.tableau[index] as MutCard[]);
  target.push(card);
  return card;
}

let sim: Sim;
beforeEach(() => {
  sim = newSim();
});

describe("the deal", () => {
  beforeEach(() => {
    dealFresh(sim);
  });

  it("deals seven columns of one to seven cards", () => {
    expect(sim.tableau).toHaveLength(7);
    expect(sim.tableau.map((c) => c.length)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("turns each column's lowest card face-up and no other", () => {
    for (const cards of sim.tableau) {
      expect((cards[cards.length - 1] as MutCard).faceUp).toBe(true);
      expect(cards.slice(0, -1).every((card) => !card.faceUp)).toBe(true);
    }
  });

  it("leaves twenty-four face-down cards in the stock", () => {
    expect(sim.stock).toHaveLength(24);
    expect(sim.stock.every((card) => !card.faceUp)).toBe(true);
  });

  it("starts the waste, its sets and the four foundations empty", () => {
    expect(sim.waste).toHaveLength(0);
    expect(sim.wasteSets).toEqual([]);
    expect(sim.foundations.map((f) => f.length)).toEqual([0, 0, 0, 0]);
  });

  it("uses one full deck, with a distinct id on every card", () => {
    const all = [...sim.stock, ...sim.tableau.flat()];
    expect(all).toHaveLength(DECK_SIZE);
    expect(new Set(all.map((c) => `${c.suit}-${String(c.rank)}`)).size).toBe(
      52,
    );
    expect(new Set(all.map((c) => c.id)).size).toBe(52);
  });

  it("clears the painted table and plays the deal cue", () => {
    expect(sim.trailStamps).toBe(0);
    expect(sim.pendingCues).toContain(CUES.deal);
  });

  it("shuffles afresh on every deal", () => {
    const other = newSim();
    dealFresh(other);
    expect(other.tableau.map((c) => c.map((k) => k.rank).join())).not.toEqual(
      sim.tableau.map((c) => c.map((k) => k.rank).join()),
    );
  });
});

describe("turning the stock", () => {
  beforeEach(() => {
    dealFresh(sim);
    sim.pendingCues = [];
  });

  it("moves the turn count onto the waste, face-up, in one set", () => {
    const top = sim.stock[sim.stock.length - 1] as MutCard;
    turnStock(sim);
    expect(sim.stock).toHaveLength(24 - TURN_COUNT);
    expect(sim.waste).toHaveLength(TURN_COUNT);
    expect(sim.waste.every((card) => card.faceUp)).toBe(true);
    expect(sim.wasteSets).toEqual([TURN_COUNT]);
    expect(visibleCount(sim.wasteSets)).toBe(TURN_COUNT);
    expect(sim.pendingCues).toContain(CUES.turn);
    // The stock's top card is the deepest of the group the turn moved.
    expect(sim.waste[0]?.id).toBe(top.id);
  });

  it("turns all that remain when the stock holds fewer", () => {
    clearTable(sim);
    put(sim, "stock", 0, "spades", 2, false);
    put(sim, "stock", 0, "hearts", 3, false);
    turnStock(sim);
    expect(sim.stock).toHaveLength(0);
    expect(sim.waste).toHaveLength(2);
    expect(sim.wasteSets).toEqual([2]);
  });

  it("recycles an empty stock and clears the sets", () => {
    while (sim.stock.length > 0) turnStock(sim);
    const order = sim.waste.map((card) => card.id);
    sim.pendingCues = [];
    turnStock(sim);
    expect(sim.waste).toHaveLength(0);
    expect(sim.wasteSets).toEqual([]);
    expect(sim.stock).toHaveLength(24);
    expect(sim.stock.every((card) => !card.faceUp)).toBe(true);
    expect(sim.pendingCues).toContain(CUES.recycle);
    // A further pass turns the same cards up in the same order.
    const replayed: number[] = [];
    while (sim.stock.length > 0) {
      const before = sim.waste.length;
      turnStock(sim);
      replayed.push(...sim.waste.slice(before).map((card) => card.id));
    }
    expect(replayed).toEqual(order);
  });

  it("leaves an empty stock and an empty waste alone", () => {
    clearTable(sim);
    sim.pendingCues = [];
    turnStock(sim);
    expect(sim.stock).toHaveLength(0);
    expect(sim.waste).toHaveLength(0);
    expect(sim.pendingCues).toEqual([]);
  });

  it("passes through the stock without limit", () => {
    for (let pass = 0; pass < 4; pass++) {
      while (sim.stock.length > 0) turnStock(sim);
      expect(sim.waste).toHaveLength(24);
      turnStock(sim);
      expect(sim.stock).toHaveLength(24);
    }
  });
});

describe("the waste's set memory", () => {
  it("falls back to the set turned before it once a set is played off", () => {
    // Turn, turn, play one card off, turn, play all three off
    // (specs/stock.md). Two cards of the second turn are left showing.
    clearTable(sim);
    for (let i = 0; i < 9; i++) put(sim, "stock", 0, "spades", 1, false);
    turnStock(sim);
    turnStock(sim);
    const secondTurn = sim.waste.slice(3).map((card) => card.id);
    dropFromWasteSets(sim, 1);
    sim.waste.pop();
    expect(sim.wasteSets).toEqual([3, 2]);
    turnStock(sim);
    expect(sim.wasteSets).toEqual([3, 2, 3]);
    for (let i = 0; i < 3; i++) {
      dropFromWasteSets(sim, 1);
      sim.waste.pop();
    }
    expect(sim.wasteSets).toEqual([3, 2]);
    expect(visibleCount(sim.wasteSets)).toBe(2);
    expect(sim.waste).toHaveLength(5);
    expect(sim.waste[sim.waste.length - 1]?.id).toBe(secondTurn[1]);
  });

  it("empties the memory when every set has been played off", () => {
    sim.wasteSets = [1];
    dropFromWasteSets(sim, 3);
    expect(sim.wasteSets).toEqual([]);
    expect(visibleCount(sim.wasteSets)).toBe(0);
  });
});

describe("what a grab may take", () => {
  it("takes nothing off the stock", () => {
    put(sim, "stock", 0, "spades", 5, false);
    expect(grabbableRun(sim, "stock", 0, 0)).toBeNull();
  });

  it("takes only the waste's top card, and only while a set shows", () => {
    put(sim, "waste", 0, "spades", 5);
    put(sim, "waste", 0, "hearts", 6);
    sim.wasteSets = [2];
    expect(grabbableRun(sim, "waste", 0, 1)).toHaveLength(1);
    expect(grabbableRun(sim, "waste", 0, 0)).toBeNull();
    sim.wasteSets = [];
    expect(grabbableRun(sim, "waste", 0, 1)).toBeNull();
  });

  it("takes only a foundation's top card", () => {
    put(sim, "foundation", 0, "spades", 1);
    put(sim, "foundation", 0, "spades", 2);
    expect(grabbableRun(sim, "foundation", 0, 1)).toHaveLength(1);
    expect(grabbableRun(sim, "foundation", 0, 0)).toBeNull();
  });

  it("takes a column card and every card below it, and never a face-down one", () => {
    put(sim, "tableau", 0, "spades", 5, false);
    put(sim, "tableau", 0, "hearts", 9);
    put(sim, "tableau", 0, "clubs", 8);
    put(sim, "tableau", 0, "diamonds", 7);
    expect(grabbableRun(sim, "tableau", 0, 1)).toHaveLength(3);
    expect(grabbableRun(sim, "tableau", 0, 0)).toBeNull();
    expect(grabbableRun(sim, "tableau", 0, 9)).toBeNull();
  });
});

describe("a move", () => {
  it("applies a legal move and reports it", () => {
    put(sim, "tableau", 0, "hearts", 8);
    put(sim, "tableau", 1, "spades", 7);
    expect(moveCards(sim, "tableau", 1, 0, "tableau", 0)).toBe(true);
    expect(sim.tableau[0]).toHaveLength(2);
    expect(sim.tableau[1]).toHaveLength(0);
  });

  it("refuses an illegal move and leaves the board alone", () => {
    put(sim, "tableau", 0, "hearts", 8);
    put(sim, "tableau", 1, "diamonds", 7);
    expect(moveCards(sim, "tableau", 1, 0, "tableau", 0)).toBe(false);
    expect(sim.tableau[0]).toHaveLength(1);
    expect(sim.tableau[1]).toHaveLength(1);
  });

  it("refuses a move onto the pile it came from", () => {
    put(sim, "tableau", 0, "hearts", 8);
    put(sim, "tableau", 0, "spades", 7);
    expect(moveCards(sim, "tableau", 0, 1, "tableau", 0)).toBe(false);
  });

  it("moves a run as a unit and keeps its order", () => {
    put(sim, "tableau", 0, "hearts", 10);
    const nine = put(sim, "tableau", 1, "spades", 9);
    const eight = put(sim, "tableau", 1, "diamonds", 8);
    const seven = put(sim, "tableau", 1, "clubs", 7);
    expect(moveCards(sim, "tableau", 1, 0, "tableau", 0)).toBe(true);
    expect((sim.tableau[0] as MutCard[]).map((c) => c.id)).toEqual([
      (sim.tableau[0] as MutCard[])[0]?.id,
      nine.id,
      eight.id,
      seven.id,
    ]);
  });

  it("refuses a slice that is not an ordered run", () => {
    put(sim, "tableau", 0, "hearts", 10);
    put(sim, "tableau", 1, "spades", 9);
    put(sim, "tableau", 1, "clubs", 8);
    expect(moveCards(sim, "tableau", 1, 0, "tableau", 0)).toBe(false);
  });

  it("turns the card an accepted move exposes, and only that one", () => {
    put(sim, "tableau", 0, "hearts", 8);
    const buried = put(sim, "tableau", 1, "diamonds", 4, false);
    const covered = put(sim, "tableau", 1, "clubs", 5, false);
    put(sim, "tableau", 1, "spades", 7);
    expect(moveCards(sim, "tableau", 1, 2, "tableau", 0)).toBe(true);
    expect(covered.faceUp).toBe(true);
    expect(buried.faceUp).toBe(false);
    expect(sim.pendingCues).toContain(CUES.flip);
  });

  it("leaves the exposed card face-down while the flip is gated off", () => {
    sim.autoFlip = false;
    put(sim, "tableau", 0, "hearts", 8);
    const covered = put(sim, "tableau", 1, "clubs", 5, false);
    put(sim, "tableau", 1, "spades", 7);
    expect(moveCards(sim, "tableau", 1, 1, "tableau", 0)).toBe(true);
    expect(covered.faceUp).toBe(false);
  });

  it("takes the waste's top card off its set as it leaves", () => {
    put(sim, "waste", 0, "spades", 5);
    put(sim, "waste", 0, "hearts", 1);
    sim.wasteSets = [2];
    expect(moveCards(sim, "waste", 0, 1, "foundation", 0)).toBe(true);
    expect(sim.wasteSets).toEqual([1]);
    expect(sim.pendingCues).toContain(CUES.home);
  });
});

describe("the auto-move", () => {
  it("sends the waste's top card to the foundation it belongs on", () => {
    put(sim, "foundation", 1, "spades", 1);
    put(sim, "waste", 0, "spades", 2);
    sim.wasteSets = [1];
    expect(autoMoveFrom(sim, "waste", 0)).toBe(true);
    expect(sim.foundations[1]).toHaveLength(2);
    expect(sim.waste).toHaveLength(0);
  });

  it("sends a column's lowest face-up card home and turns what it exposes", () => {
    const buried = put(sim, "tableau", 3, "clubs", 9, false);
    put(sim, "tableau", 3, "hearts", 1);
    expect(autoMoveFrom(sim, "tableau", 3)).toBe(true);
    expect(buried.faceUp).toBe(true);
  });

  it("sends nothing when no foundation accepts the card", () => {
    put(sim, "tableau", 0, "hearts", 9);
    expect(autoMoveFrom(sim, "tableau", 0)).toBe(false);
    expect(sim.tableau[0]).toHaveLength(1);
  });

  it("sends nothing from an empty pile, a face-down column or a foundation", () => {
    expect(autoMoveFrom(sim, "tableau", 5)).toBe(false);
    put(sim, "tableau", 6, "hearts", 1, false);
    expect(autoMoveFrom(sim, "tableau", 6)).toBe(false);
    put(sim, "foundation", 0, "spades", 1);
    expect(autoMoveFrom(sim, "foundation", 0)).toBe(false);
    expect(autoMoveFrom(sim, "stock", 0)).toBe(false);
  });

  it("takes exactly one card, leaving the cards above it", () => {
    put(sim, "tableau", 2, "spades", 5);
    put(sim, "tableau", 2, "hearts", 1);
    expect(autoMoveFrom(sim, "tableau", 2)).toBe(true);
    expect(sim.tableau[2]).toHaveLength(1);
  });
});

describe("winning", () => {
  function fillFoundations(target: Sim, missing: number): void {
    const suits: Suit[] = ["spades", "hearts", "diamonds", "clubs"];
    suits.forEach((suit, index) => {
      for (let rank = 1; rank <= 13; rank++) {
        put(target, "foundation", index, suit, rank);
      }
    });
    for (let i = 0; i < missing; i++) {
      (target.foundations[3] as MutCard[]).pop();
    }
  }

  it("wins the instant the fifty-second card lands", () => {
    sim.screen = "playing";
    fillFoundations(sim, 1);
    put(sim, "tableau", 0, "clubs", 13);
    expect(cardsHome(sim)).toBe(51);
    expect(moveCards(sim, "tableau", 0, 0, "foundation", 3)).toBe(true);
    expect(sim.screen).toBe("won");
    expect(sim.launched).toBe(0);
    expect(sim.pendingCues).toContain(CUES.win);
  });

  it("is not a win at fifty-one", () => {
    sim.screen = "playing";
    fillFoundations(sim, 2);
    put(sim, "tableau", 0, "clubs", 12);
    expect(moveCards(sim, "tableau", 0, 0, "foundation", 3)).toBe(true);
    expect(sim.screen).toBe("playing");
  });

  it("stays on the table while win detection is gated off", () => {
    sim.screen = "playing";
    sim.winDetect = false;
    fillFoundations(sim, 1);
    put(sim, "tableau", 0, "clubs", 13);
    expect(moveCards(sim, "tableau", 0, 0, "foundation", 3)).toBe(true);
    expect(sim.screen).toBe("playing");
    expect(cardsHome(sim)).toBe(DECK_SIZE);
  });
});

describe("a fresh game", () => {
  it("clears the flight, the counters and the table, and enters play", () => {
    sim.flyers.push({
      id: takeId(sim),
      suit: "spades",
      rank: 1,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
    });
    sim.launched = 12;
    sim.cascadeDone = true;
    newGame(sim);
    expect(sim.flyers).toHaveLength(0);
    expect(sim.launched).toBe(0);
    expect(sim.cascadeDone).toBe(false);
    expect(sim.screen).toBe("playing");
    expect(sim.stock).toHaveLength(24);
  });
});
