import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEAL_STOCK_CARDS,
  DECK_SIZE,
  FOUNDATION_COUNT,
  TABLEAU_COLUMNS,
} from "./constants";
import { createHarness, openTable, type Harness } from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

describe("the deal", () => {
  it("lays out seven columns of one to seven cards", () => {
    h.debug.reset();
    h.debug.deal();
    const { tableau } = h.debug.snapshot();
    expect(tableau).toHaveLength(TABLEAU_COLUMNS);
    expect(tableau.map((column) => column.length)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it("turns each column's lowest card face-up and leaves the rest face-down", () => {
    h.debug.reset();
    h.debug.deal();
    for (const column of h.debug.snapshot().tableau) {
      expect(column[column.length - 1].faceUp).toBe(true);
      for (const card of column.slice(0, -1)) expect(card.faceUp).toBe(false);
    }
  });

  it("leaves twenty-four cards in the stock, all face-down", () => {
    h.debug.reset();
    h.debug.deal();
    const { stock } = h.debug.snapshot();
    expect(stock).toHaveLength(DEAL_STOCK_CARDS);
    expect(stock.every((card) => !card.faceUp)).toBe(true);
  });

  it("starts the waste and the four foundations empty", () => {
    h.debug.reset();
    h.debug.deal();
    const shot = h.debug.snapshot();
    expect(shot.waste).toEqual([]);
    expect(shot.wasteSets).toEqual([]);
    expect(shot.wasteVisibleCount).toBe(0);
    expect(shot.foundations).toHaveLength(FOUNDATION_COUNT);
    for (const pile of shot.foundations) expect(pile).toEqual([]);
  });

  it("uses one full deck, each of the fifty-two pairs exactly once", () => {
    h.debug.reset();
    h.debug.deal();
    const shot = h.debug.snapshot();
    const all = [...shot.stock, ...shot.tableau.flat()];
    expect(all).toHaveLength(DECK_SIZE);
    expect(new Set(all.map((card) => `${card.suit}${card.rank}`)).size).toBe(
      DECK_SIZE,
    );
    expect(new Set(all.map((card) => card.id)).size).toBe(DECK_SIZE);
  });

  it("deals the same board twice from one seed", () => {
    h.debug.reset({ seed: 42 });
    h.debug.deal();
    const first = JSON.stringify(h.debug.snapshot().tableau);
    h.debug.reset({ seed: 42 });
    h.debug.deal();
    expect(JSON.stringify(h.debug.snapshot().tableau)).toBe(first);
  });

  it("deals a different board from a different seed", () => {
    h.debug.reset({ seed: 1 });
    h.debug.deal();
    const first = h.debug
      .snapshot()
      .tableau.flat()
      .map((card) => `${card.suit}${card.rank}`)
      .join(",");
    h.debug.reset({ seed: 2 });
    h.debug.deal();
    const second = h.debug
      .snapshot()
      .tableau.flat()
      .map((card) => `${card.suit}${card.rank}`)
      .join(",");
    expect(second).not.toBe(first);
  });

  it("clears the painted table, so a deal after a cascade leaves clean felt", async () => {
    openTable(h);
    h.debug.addFlyer("hearts", 5, 400, 300, 60, 0);
    await h.advance(20);
    expect(h.debug.snapshot().trailStamps).toBeGreaterThan(0);
    h.debug.deal();
    expect(h.debug.snapshot().trailStamps).toBe(0);
  });

  it("changes no other field, the screen included", () => {
    openTable(h);
    h.debug.setScreen("howto");
    h.debug.setAutoFlip(false);
    h.debug.deal();
    const shot = h.debug.snapshot();
    expect(shot.screen).toBe("howto");
    expect(shot.autoFlip).toBe(false);
  });

  it("plays the deal cue on the frame it happens", () => {
    h.cues.length = 0;
    h.debug.deal();
    expect(h.cues.map((play) => play.cue)).toContain("deal");
  });
});
