import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TURN_COUNT } from "./constants";
import {
  createHarness,
  openTable,
  poseStock,
  poseWaste,
  type Harness,
  type PosedCard,
} from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  openTable(h);
});

afterEach(() => {
  h.dispose();
});

/** `count` distinct cards, in ascending rank, for posing a pile with. */
function cards(count: number, faceUp = false): PosedCard[] {
  return Array.from({ length: count }, (_, i) => ({
    suit: "spades" as const,
    rank: i + 1,
    faceUp,
  }));
}

describe("turning the stock", () => {
  it("moves this build's turn count onto the waste", () => {
    poseStock(h, cards(8));
    h.debug.turnStock();
    const shot = h.debug.snapshot();
    expect(shot.stock).toHaveLength(8 - TURN_COUNT);
    expect(shot.waste).toHaveLength(TURN_COUNT);
  });

  it("turns every card it moved face-up", () => {
    poseStock(h, cards(5));
    h.debug.turnStock();
    expect(h.debug.snapshot().waste.every((card) => card.faceUp)).toBe(true);
  });

  it("takes them one at a time from the top, so the stock's top ends deepest", () => {
    const ids = poseStock(h, cards(4));
    h.debug.turnStock();
    const waste = h.debug.snapshot().waste.map((card) => card.id);
    // The stock's top card was the last id posed, and it lies deepest of the
    // three the turn moved; the last card taken is the waste's top.
    expect(waste).toEqual([ids[3], ids[2], ids[1]]);
  });

  it("appends exactly one set, holding the cards it turned", () => {
    poseStock(h, cards(9));
    h.debug.turnStock();
    expect(h.debug.snapshot().wasteSets).toEqual([TURN_COUNT]);
    h.debug.turnStock();
    expect(h.debug.snapshot().wasteSets).toEqual([TURN_COUNT, TURN_COUNT]);
  });

  it("turns all that remain when the stock holds fewer", () => {
    poseStock(h, cards(2));
    h.debug.turnStock();
    const shot = h.debug.snapshot();
    expect(shot.stock).toHaveLength(0);
    expect(shot.waste).toHaveLength(2);
    expect(shot.wasteSets).toEqual([2]);
    expect(shot.wasteVisibleCount).toBe(2);
  });

  it("drains the stock exactly, with none lost and none duplicated", () => {
    const ids = poseStock(h, cards(12));
    for (let i = 0; i < 4; i += 1) h.debug.turnStock();
    const shot = h.debug.snapshot();
    expect(shot.stock).toHaveLength(0);
    expect(new Set(shot.waste.map((card) => card.id))).toEqual(new Set(ids));
  });

  it("plays the turn cue", () => {
    poseStock(h, cards(4));
    h.cues.length = 0;
    h.debug.turnStock();
    expect(h.cues.map((play) => play.cue)).toContain("turn");
  });
});

describe("the waste's set memory", () => {
  it("shows the newest set, and falls back when a set is played off", () => {
    poseStock(h, cards(6));
    h.debug.turnStock();
    h.debug.turnStock();
    expect(h.debug.snapshot().wasteSets).toEqual([3, 3]);

    const waste = h.debug.snapshot().waste;
    h.debug.removeCard(waste[waste.length - 1].id);
    expect(h.debug.snapshot().wasteSets).toEqual([3, 2]);
    expect(h.debug.snapshot().wasteVisibleCount).toBe(2);

    for (let i = 0; i < 2; i += 1) {
      const rest = h.debug.snapshot().waste;
      h.debug.removeCard(rest[rest.length - 1].id);
    }
    // The newest set is played off entirely, so the waste falls back to what is
    // left of the set turned before it.
    expect(h.debug.snapshot().wasteSets).toEqual([3]);
    expect(h.debug.snapshot().wasteVisibleCount).toBe(3);
  });

  it("shrinks the shown set as its cards are played, refilling from nothing", () => {
    // Two turns, so cards lie beneath the set being played off: the count falls
    // 3, 2, 1 within the newest set and never draws on the buried ones.
    poseStock(h, [
      { suit: "spades", rank: 2 },
      { suit: "spades", rank: 3 },
      { suit: "spades", rank: 4 },
      { suit: "clubs", rank: 1 },
      { suit: "diamonds", rank: 1 },
      { suit: "hearts", rank: 1 },
      { suit: "spades", rank: 5 },
      { suit: "spades", rank: 6 },
      { suit: "spades", rank: 7 },
    ]);
    h.debug.turnStock();
    h.debug.turnStock();
    expect(h.debug.snapshot().wasteVisibleCount).toBe(3);

    expect(h.debug.autoMove("waste", 0)).toBe(true);
    expect(h.debug.snapshot().wasteVisibleCount).toBe(2);
    expect(h.debug.autoMove("waste", 0)).toBe(true);

    const shot = h.debug.snapshot();
    expect(shot.wasteVisibleCount).toBe(1);
    expect(shot.wasteSets).toEqual([3, 1]);
    // Four cards still lie on the waste, and the one card of the newest set is
    // all it shows.
    expect(shot.waste).toHaveLength(4);
    expect(shot.waste[shot.waste.length - 1]).toMatchObject({
      suit: "hearts",
      rank: 1,
    });
  });

  it("falls back to the set turned before it once a set is played off", () => {
    // The state the set memory is for: a set turned and played off entirely,
    // over a set one card lighter, over a set never played off at all. Every
    // card moves through the build's own turn and its own auto-move, so what is
    // read is what the rules produced.
    poseStock(h, [
      { suit: "hearts", rank: 1 },
      { suit: "diamonds", rank: 1 },
      { suit: "clubs", rank: 1 },
      { suit: "spades", rank: 1 },
      { suit: "spades", rank: 13 },
      { suit: "spades", rank: 12 },
      { suit: "spades", rank: 11 },
      { suit: "spades", rank: 10 },
      { suit: "spades", rank: 9 },
    ]);
    h.debug.turnStock();
    h.debug.turnStock();
    expect(h.debug.autoMove("waste", 0)).toBe(true);
    h.debug.turnStock();
    expect(h.debug.snapshot().wasteSets).toEqual([3, 2, 3]);

    for (let i = 0; i < 3; i += 1) {
      expect(h.debug.autoMove("waste", 0)).toBe(true);
    }

    const shot = h.debug.snapshot();
    expect(shot.wasteSets).toEqual([3, 2]);
    // Two cards showing on a waste that still holds five, so neither the count
    // of the last turn nor a refilled fan of three reads the same.
    expect(shot.wasteVisibleCount).toBe(2);
    expect(shot.waste).toHaveLength(5);
    expect(shot.waste[shot.waste.length - 1]).toMatchObject({
      suit: "spades",
      rank: 13,
    });
  });

  it("shows and offers nothing while the memory is empty", () => {
    poseWaste(h, cards(3, true), []);
    const shot = h.debug.snapshot();
    expect(shot.waste).toHaveLength(3);
    expect(shot.wasteVisibleCount).toBe(0);
    expect(h.debug.move("waste", 0, 2, "tableau", 0)).toBe(false);
  });
});

describe("recycling", () => {
  it("returns every waste card to the stock face-down", () => {
    poseStock(h, cards(3));
    h.debug.turnStock();
    h.debug.turnStock();
    const shot = h.debug.snapshot();
    expect(shot.stock).toHaveLength(3);
    expect(shot.waste).toHaveLength(0);
    expect(shot.stock.every((card) => !card.faceUp)).toBe(true);
  });

  it("empties the waste and its set memory", () => {
    poseStock(h, cards(3));
    h.debug.turnStock();
    h.debug.turnStock();
    const shot = h.debug.snapshot();
    expect(shot.wasteSets).toEqual([]);
    expect(shot.wasteVisibleCount).toBe(0);
  });

  it("preserves the order, so a further pass turns the same cards again", () => {
    poseStock(h, cards(3));
    h.debug.turnStock();
    const first = h.debug.snapshot().waste.map((card) => card.id);
    h.debug.turnStock();
    h.debug.turnStock();
    expect(h.debug.snapshot().waste.map((card) => card.id)).toEqual(first);
  });

  it("allows unlimited passes through the stock", () => {
    poseStock(h, cards(3));
    h.debug.turnStock();
    const first = h.debug.snapshot().waste.map((card) => card.id);
    for (let pass = 0; pass < 4; pass += 1) {
      h.debug.turnStock();
      h.debug.turnStock();
      expect(h.debug.snapshot().waste.map((card) => card.id)).toEqual(first);
    }
  });

  it("never recycles while the stock holds cards", () => {
    poseStock(h, cards(5));
    h.debug.turnStock();
    h.debug.turnStock();
    expect(h.debug.snapshot().waste.length).toBeGreaterThan(0);
    expect(h.debug.snapshot().stock).toHaveLength(0);
  });

  it("leaves an empty stock and an empty waste both empty", () => {
    h.debug.turnStock();
    const shot = h.debug.snapshot();
    expect(shot.stock).toEqual([]);
    expect(shot.waste).toEqual([]);
    expect(shot.wasteSets).toEqual([]);
  });

  it("plays the recycle cue", () => {
    poseStock(h, cards(2));
    h.debug.turnStock();
    h.cues.length = 0;
    h.debug.turnStock();
    expect(h.cues.map((play) => play.cue)).toContain("recycle");
  });
});
