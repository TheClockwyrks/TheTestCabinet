// The stock, the waste and the set memory between them (specs/stock.md).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TURN_COUNT } from "./constants";
import {
  createHarness,
  openTable,
  poseStock,
  poseWaste,
  type Harness,
} from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** Four cards on the stock, the last of them the next one turned. */
function stockOfFour(h: Harness): void {
  poseStock(h.debug, [
    { suit: "spades", rank: 2 },
    { suit: "hearts", rank: 3 },
    { suit: "diamonds", rank: 4 },
    { suit: "clubs", rank: 5 },
  ]);
}

describe("a turn", () => {
  it("moves the turn count of cards onto the waste, face-up", () => {
    const { debug } = h;
    openTable(debug);
    stockOfFour(h);
    debug.turnStock();
    const shot = debug.snapshot();
    expect(shot.stock).toHaveLength(4 - TURN_COUNT);
    expect(shot.waste).toHaveLength(TURN_COUNT);
    expect(shot.waste.every((card) => card.faceUp)).toBe(true);
  });

  it("takes the stock's top card first, so it ends deepest of the group", () => {
    const { debug } = h;
    openTable(debug);
    stockOfFour(h);
    debug.turnStock();
    expect(debug.snapshot().waste[0]).toMatchObject({
      suit: "clubs",
      rank: 5,
    });
  });

  it("appends exactly one set, holding the cards it turned", () => {
    const { debug } = h;
    openTable(debug);
    stockOfFour(h);
    debug.turnStock();
    expect(debug.snapshot().wasteSets).toEqual([TURN_COUNT]);
    debug.turnStock();
    expect(debug.snapshot().wasteSets).toEqual([TURN_COUNT, TURN_COUNT]);
  });

  it("turns all that remain when the stock holds fewer than the turn count", () => {
    const { debug } = h;
    openTable(debug);
    poseStock(debug, [{ suit: "spades", rank: 2 }]);
    debug.turnStock();
    const shot = debug.snapshot();
    expect(shot.stock).toHaveLength(0);
    expect(shot.waste).toHaveLength(1);
    expect(shot.wasteSets).toEqual([1]);
  });

  it("drains the stock exactly, losing and duplicating nothing", () => {
    const { debug } = h;
    debug.reset();
    debug.deal();
    const stock = debug.snapshot().stock.map((card) => card.id);
    for (let turns = 0; turns < 40 && debug.snapshot().stock.length > 0; turns += 1) {
      debug.turnStock();
    }
    const shot = debug.snapshot();
    expect(shot.stock).toHaveLength(0);
    expect(shot.waste.map((card) => card.id).sort()).toEqual([...stock].sort());
  });
});

describe("the set memory", () => {
  it("shrinks its newest set when the top card is played off", () => {
    const { debug } = h;
    openTable(debug);
    poseWaste(debug, [
      { suit: "spades", rank: 2 },
      { suit: "hearts", rank: 3 },
      { suit: "diamonds", rank: 4 },
    ], [1, 2]);
    debug.addCard("foundation", 0, "diamonds", 3, true);
    expect(debug.snapshot().wasteVisibleCount).toBe(2);
    expect(debug.move("waste", 0, 2, "foundation", 0)).toBe(true);
    const shot = debug.snapshot();
    expect(shot.wasteSets).toEqual([1, 1]);
    expect(shot.wasteVisibleCount).toBe(1);
  });

  it("falls back to the set turned before it once one is played off", () => {
    const { debug } = h;
    openTable(debug);
    // Two turns of one card each, then the newer card sent home.
    // Bottom card first, so the LAST card given is the one turned first: the
    // nine comes up on the first turn and the Ace on the second.
    poseStock(debug, [
      { suit: "spades", rank: 1 },
      { suit: "hearts", rank: 9 },
    ]);
    debug.turnStock();
    debug.turnStock();
    const older = debug.snapshot().waste[0];
    expect(debug.snapshot().wasteSets).toEqual([1, 1]);

    expect(debug.autoMove("waste", 0)).toBe(true);
    const shot = debug.snapshot();
    expect(shot.wasteSets).toEqual([1]);
    expect(shot.wasteVisibleCount).toBe(1);
    expect(shot.waste[shot.waste.length - 1].id).toBe(older.id);
  });

  it("offers nothing to play while the memory is empty", () => {
    const { debug } = h;
    openTable(debug);
    poseWaste(debug, [{ suit: "spades", rank: 1 }], [1]);
    debug.clearWasteSets();
    expect(debug.snapshot().wasteVisibleCount).toBe(0);
    expect(debug.move("waste", 0, 0, "foundation", 0)).toBe(false);
    expect(debug.autoMove("waste", 0)).toBe(false);
    expect(debug.snapshot().waste).toHaveLength(1);
  });

  it("refuses a move naming a waste card below the top", () => {
    const { debug } = h;
    openTable(debug);
    poseWaste(debug, [
      { suit: "spades", rank: 1 },
      { suit: "hearts", rank: 4 },
    ], [2]);
    expect(debug.move("waste", 0, 0, "foundation", 0)).toBe(false);
    expect(debug.snapshot().waste).toHaveLength(2);
  });
});

describe("recycling", () => {
  it("returns the whole waste to the stock face-down, in reverse order", () => {
    const { debug } = h;
    openTable(debug);
    stockOfFour(h);
    const order: number[] = [];
    while (debug.snapshot().stock.length > 0) {
      debug.turnStock();
      const waste = debug.snapshot().waste;
      order.push(waste[waste.length - 1].id);
    }
    debug.turnStock();
    const shot = debug.snapshot();
    expect(shot.waste).toHaveLength(0);
    expect(shot.wasteSets).toEqual([]);
    expect(shot.stock).toHaveLength(4);
    expect(shot.stock.every((card) => !card.faceUp)).toBe(true);

    const again: number[] = [];
    while (debug.snapshot().stock.length > 0) {
      debug.turnStock();
      const waste = debug.snapshot().waste;
      again.push(waste[waste.length - 1].id);
    }
    expect(again).toEqual(order);
  });

  it("never recycles a stock that still holds cards", () => {
    const { debug } = h;
    openTable(debug);
    stockOfFour(h);
    debug.turnStock();
    debug.turnStock();
    expect(debug.snapshot().waste.length).toBeGreaterThan(0);
    expect(debug.snapshot().stock.length).toBeGreaterThan(0);
  });

  it("leaves an empty stock and an empty waste alone", () => {
    const { debug } = h;
    openTable(debug);
    debug.turnStock();
    const shot = debug.snapshot();
    expect(shot.stock).toHaveLength(0);
    expect(shot.waste).toHaveLength(0);
  });

  it("passes through the stock without limit", () => {
    const { debug } = h;
    openTable(debug);
    stockOfFour(h);
    for (let pass = 0; pass < 4; pass += 1) {
      const turned: string[] = [];
      while (debug.snapshot().stock.length > 0) {
        debug.turnStock();
        const waste = debug.snapshot().waste;
        turned.push(`${waste[waste.length - 1].suit}${waste[waste.length - 1].rank}`);
      }
      expect(turned).toEqual(["clubs5", "diamonds4", "hearts3", "spades2"]);
      debug.turnStock();
    }
  });
});
