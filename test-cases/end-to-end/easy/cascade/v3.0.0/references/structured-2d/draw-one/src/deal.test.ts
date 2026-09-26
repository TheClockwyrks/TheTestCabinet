// The deck and the deal: that a new game arrives as the exact arrangement
// `specs/deal.md` describes, and that it leaves clean felt behind it.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEAL_STOCK_CARDS,
  DECK_SIZE,
  RANK_MAX,
  RANK_MIN,
  SUITS,
  TABLEAU_COLUMNS,
} from "./constants";
import { buildDeck, rankLabel, suitGlyph } from "./deck";
import { createHarness, poseNearlyWon, type Harness } from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

describe("the deck", () => {
  it("holds each of the fifty-two suit-and-rank pairs exactly once", () => {
    const deck = buildDeck();
    expect(deck).toHaveLength(DECK_SIZE);
    const seen = new Set(deck.map((entry) => `${entry.suit}${entry.rank}`));
    expect(seen.size).toBe(DECK_SIZE);
    for (const suit of SUITS) {
      for (let rank = RANK_MIN; rank <= RANK_MAX; rank += 1) {
        expect(seen.has(`${suit}${rank}`)).toBe(true);
      }
    }
  });

  it("labels the court cards and the Ace", () => {
    expect(rankLabel(1)).toBe("A");
    expect(rankLabel(10)).toBe("10");
    expect(rankLabel(11)).toBe("J");
    expect(rankLabel(12)).toBe("Q");
    expect(rankLabel(13)).toBe("K");
    expect(new Set(SUITS.map(suitGlyph)).size).toBe(4);
  });
});

describe("the deal", () => {
  it("deals seven columns of one to seven cards", () => {
    const { debug } = h;
    debug.reset();
    debug.deal();
    const shot = debug.snapshot();
    expect(shot.tableau).toHaveLength(TABLEAU_COLUMNS);
    expect(shot.tableau.map((column) => column.length)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it("turns each column's lowest card face-up and leaves the rest face-down", () => {
    const { debug } = h;
    debug.reset();
    debug.deal();
    for (const column of debug.snapshot().tableau) {
      expect(column[column.length - 1].faceUp).toBe(true);
      expect(column.slice(0, -1).every((card) => !card.faceUp)).toBe(true);
    }
  });

  it("leaves twenty-four face-down cards in the stock", () => {
    const { debug } = h;
    debug.reset();
    debug.deal();
    const shot = debug.snapshot();
    expect(shot.stock).toHaveLength(DEAL_STOCK_CARDS);
    expect(shot.stock.every((card) => !card.faceUp)).toBe(true);
  });

  it("starts the waste, its set memory and the four foundations empty", () => {
    const { debug } = h;
    debug.reset();
    debug.deal();
    const shot = debug.snapshot();
    expect(shot.waste).toEqual([]);
    expect(shot.wasteSets).toEqual([]);
    expect(shot.foundations.every((pile) => pile.length === 0)).toBe(true);
  });

  it("uses one full deck", () => {
    const { debug } = h;
    debug.reset();
    debug.deal();
    const shot = debug.snapshot();
    const dealt = [...shot.stock, ...shot.tableau.flat()];
    expect(dealt).toHaveLength(DECK_SIZE);
    expect(new Set(dealt.map((card) => `${card.suit}${card.rank}`)).size).toBe(
      DECK_SIZE,
    );
  });

  it("shuffles afresh, so two deals lay out different columns", () => {
    const { debug } = h;
    const columns = (): string => {
      debug.reset();
      debug.deal();
      return JSON.stringify(
        debug
          .snapshot()
          .tableau.map((column) =>
            column.map((card) => `${card.suit}${card.rank}`),
          ),
      );
    };
    expect(columns()).not.toBe(columns());
  });

  it("changes no other field, the screen included", () => {
    const { debug } = h;
    debug.reset();
    debug.setScreen("howto");
    debug.setAutoFlip(false);
    debug.addFlyer("spades", 3, 10, 20, 5, 5);
    debug.deal();
    const shot = debug.snapshot();
    expect(shot.screen).toBe("howto");
    expect(shot.autoFlip).toBe(false);
    expect(shot.flyers).toHaveLength(1);
  });

  it("clears the painted table", async () => {
    const { debug } = h;
    debug.reset();
    debug.setScreen("playing");
    poseNearlyWon(debug);
    debug.move("tableau", 0, 0, "foundation", 3);
    await h.seconds(1, 1 / 240);
    expect(debug.snapshot().trailStamps).toBeGreaterThan(0);

    debug.deal();
    expect(debug.snapshot().trailStamps).toBe(0);
    expect(debug.snapshot().launched).toBe(0);
  });
});
