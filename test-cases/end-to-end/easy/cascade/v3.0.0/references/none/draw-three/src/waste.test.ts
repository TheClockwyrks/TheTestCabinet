// The waste's set memory, which is the rule specs/stock.md states positively.

import { beforeEach, describe, expect, it } from "vitest";
import type { Suit } from "./constants";
import { createState, type CascadeState } from "./state";
import {
  addWasteSet,
  clearWasteSets,
  takeFromNewestSet,
  wasteShownCards,
  wasteShownCount,
  wasteTop,
  wasteVisibleCount,
} from "./waste";

let state: CascadeState;

function put(count: number, suit: Suit = "spades"): void {
  for (let i = 0; i < count; i += 1) {
    state.waste.push({
      id: state.waste.length + 1,
      suit,
      rank: (state.waste.length % 13) + 1,
      faceUp: true,
    });
  }
}

beforeEach(() => {
  state = createState(() => null);
});

describe("wasteVisibleCount", () => {
  it("is zero on an empty memory", () => {
    expect(wasteVisibleCount(state)).toBe(0);
  });

  it("is the newest set's count", () => {
    put(6);
    state.wasteSets = [3, 3];
    expect(wasteVisibleCount(state)).toBe(3);
    state.wasteSets = [3, 2];
    expect(wasteVisibleCount(state)).toBe(2);
  });
});

describe("the shown set", () => {
  it("shows the cards of the newest set, the last of them on top", () => {
    put(6);
    state.wasteSets = [3, 3];
    const shown = wasteShownCards(state);
    expect(shown).toHaveLength(3);
    expect(shown[shown.length - 1]).toBe(state.waste[5]);
    expect(wasteTop(state)).toBe(state.waste[5]);
  });

  it("shows nothing and offers nothing when the memory is empty", () => {
    put(5);
    clearWasteSets(state);
    expect(wasteShownCount(state)).toBe(0);
    expect(wasteShownCards(state)).toEqual([]);
    expect(wasteTop(state)).toBeNull();
  });

  it("draws only what is really there while a card is in hand", () => {
    put(6);
    state.wasteSets = [3, 3];
    // A lift takes the card off the waste and leaves the set memory alone.
    state.waste.pop();
    expect(wasteVisibleCount(state)).toBe(3);
    expect(wasteShownCount(state)).toBe(2);
  });
});

describe("takeFromNewestSet", () => {
  it("leaves the newest set one card smaller", () => {
    put(6);
    state.wasteSets = [3, 3];
    state.waste.pop();
    takeFromNewestSet(state);
    expect(state.wasteSets).toEqual([3, 2]);
  });

  it("drops a set played off entirely and falls back to the one before it", () => {
    put(4);
    state.wasteSets = [3, 1];
    state.waste.pop();
    takeFromNewestSet(state);
    expect(state.wasteSets).toEqual([3]);
    expect(wasteVisibleCount(state)).toBe(3);
  });

  it("does nothing to an empty memory", () => {
    put(2);
    takeFromNewestSet(state);
    expect(state.wasteSets).toEqual([]);
  });
});

describe("the set the fold-in fix is about", () => {
  it("shows two of five once a whole set is played off a partly played one", () => {
    // Three turns of three, one card played off the second set, then the third
    // set played off entirely: nine cards turned, four played, five held, and the
    // waste falls back to what is left of the set turned before the last.
    put(3);
    addWasteSet(state, 3);
    put(3);
    addWasteSet(state, 3);
    state.waste.pop();
    takeFromNewestSet(state);
    expect(state.wasteSets).toEqual([3, 2]);

    put(3);
    addWasteSet(state, 3);
    expect(state.waste).toHaveLength(8);
    for (let i = 0; i < 3; i += 1) {
      state.waste.pop();
      takeFromNewestSet(state);
    }

    expect(state.waste).toHaveLength(5);
    expect(state.wasteSets).toEqual([3, 2]);
    expect(wasteVisibleCount(state)).toBe(2);
    expect(wasteShownCount(state)).toBe(2);
    expect(wasteTop(state)).toBe(state.waste[4]);
  });
});
