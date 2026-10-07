import { describe, expect, it } from "vitest";
import { openingState } from "./flow";
import { makeCard } from "./deck";
import {
  allCards,
  appendWasteSet,
  cardCount,
  dropFromNewestSet,
  findCard,
  isPile,
  pileCards,
  shownWasteCount,
  takeIds,
  topCard,
  wasteTopCard,
  wasteVisibleCount,
  withPile,
} from "./piles";
import type { CascadeState } from "./game";

function posed(): CascadeState {
  const base = openingState();
  return withPile(
    withPile(base, "waste", 0, [
      makeCard(1, "spades", 1, true),
      makeCard(2, "hearts", 2, true),
    ]),
    "tableau",
    3,
    [makeCard(3, "clubs", 5, false), makeCard(4, "diamonds", 9, true)],
  );
}

describe("addressing a pile", () => {
  it("names exactly the thirteen piles", () => {
    expect(isPile("stock", 0)).toBe(true);
    expect(isPile("stock", 1)).toBe(false);
    expect(isPile("waste", 0)).toBe(true);
    expect(isPile("foundation", 3)).toBe(true);
    expect(isPile("foundation", 4)).toBe(false);
    expect(isPile("tableau", 6)).toBe(true);
    expect(isPile("tableau", 7)).toBe(false);
    expect(isPile("tableau", 1.5)).toBe(false);
  });

  it("reads a pile bottom card first", () => {
    const state = posed();
    expect(pileCards(state, "waste", 0).map((c) => c.id)).toEqual([1, 2]);
    expect(topCard(state, "waste", 0)?.id).toBe(2);
    expect(topCard(state, "stock", 0)).toBeNull();
    expect(pileCards(state, "foundation", 9)).toEqual([]);
  });

  it("replaces one pile and leaves the other twelve", () => {
    const state = posed();
    const next = withPile(state, "foundation", 2, [
      makeCard(9, "spades", 1, true),
    ]);
    expect(next.foundations[2]).toHaveLength(1);
    expect(next.foundations[0]).toHaveLength(0);
    expect(next.waste).toBe(state.waste);
    expect(withPile(state, "tableau", 9, [])).toBe(state);
  });

  it("finds a card wherever it sits", () => {
    const state = posed();
    expect(findCard(state, 4)).toEqual({ pile: "tableau", index: 3, row: 1 });
    expect(findCard(state, 1)).toEqual({ pile: "waste", index: 0, row: 0 });
    expect(findCard(state, 99)).toBeNull();
  });

  it("counts the cards on the table", () => {
    expect(cardCount(posed())).toBe(4);
    expect(
      allCards(posed())
        .map((c) => c.id)
        .sort(),
    ).toEqual([1, 2, 3, 4]);
  });

  it("hands out fresh ids in order", () => {
    const state = openingState();
    const [ids, nextId] = takeIds(state, 3);
    expect(ids).toEqual([1, 2, 3]);
    expect(nextId).toBe(4);
  });
});

describe("the waste's set memory", () => {
  it("shows the newest set, and nothing when the memory is empty", () => {
    const cards = [
      makeCard(1, "spades", 1, true),
      makeCard(2, "hearts", 2, true),
      makeCard(3, "clubs", 3, true),
    ];
    const base = withPile(openingState(), "waste", 0, cards);
    expect(wasteVisibleCount(base)).toBe(0);
    expect(wasteTopCard(base)).toBeNull();

    const withSets = { ...base, wasteSets: [2, 1] };
    expect(wasteVisibleCount(withSets)).toBe(1);
    expect(wasteTopCard(withSets)?.id).toBe(3);
  });

  it("shows only the cards the waste still holds", () => {
    const held = { ...openingState(), waste: [], wasteSets: [1] };
    expect(wasteVisibleCount(held)).toBe(1);
    expect(shownWasteCount(held)).toBe(0);
    expect(wasteTopCard(held)).toBeNull();
  });

  it("appends a set on the newest end", () => {
    expect(appendWasteSet([2], 3)).toEqual([2, 3]);
  });

  it("takes a card off the newest set and drops a set played out", () => {
    expect(dropFromNewestSet([2, 3])).toEqual([2, 2]);
    expect(dropFromNewestSet([2, 1])).toEqual([2]);
    expect(dropFromNewestSet([1])).toEqual([]);
    expect(dropFromNewestSet([])).toEqual([]);
  });
});
