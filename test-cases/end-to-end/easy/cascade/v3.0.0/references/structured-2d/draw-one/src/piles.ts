// Cascade — the thirteen piles as data: reaching one by name, adding a card to
// one, and the waste's set memory.
//
// Every pile is an array ordered from its bottom card to its top card, so the
// LAST entry is the card on top — which in a tableau column is the card drawn
// lowest on the table (specs/table.md, specs/instrumentation.md).

import { FOUNDATION_COUNT, TABLEAU_COLUMNS } from "./constants";
import type { CardState, CascadeState, PileKind, Suit } from "./game";

/** Where a card sits: its pile, that pile's index, and its row from the bottom. */
export interface CardSite {
  pile: PileKind;
  index: number;
  row: number;
}

/** The array a pile name and index address, or `null` when they address none. */
export function pileArray(
  state: CascadeState,
  pile: PileKind,
  index: number,
): CardState[] | null {
  switch (pile) {
    case "stock":
      return index === 0 ? state.stock : null;
    case "waste":
      return index === 0 ? state.waste : null;
    case "foundation":
      return index >= 0 && index < FOUNDATION_COUNT
        ? state.foundations[index]
        : null;
    case "tableau":
      return index >= 0 && index < TABLEAU_COLUMNS ? state.tableau[index] : null;
  }
}

/** Every pile of the table, in the order the snapshot reports them. */
export function everyPile(state: CascadeState): CardState[][] {
  return [state.stock, state.waste, ...state.foundations, ...state.tableau];
}

/** A fresh card, taking the next id no live entity holds. */
export function newCard(
  state: CascadeState,
  suit: Suit,
  rank: number,
  faceUp: boolean,
): CardState {
  const card: CardState = { id: state.nextId, suit, rank, faceUp };
  state.nextId += 1;
  return card;
}

/** The id the next card or flyer takes, consumed. */
export function takeId(state: CascadeState): number {
  const id = state.nextId;
  state.nextId += 1;
  return id;
}

/**
 * Take one card off the waste's set memory: the newest set that still holds a
 * card loses one, and a set left holding nothing leaves the memory, so the
 * waste falls back to what the turn before it left (specs/stock.md).
 *
 * This is what play itself does when a card leaves the waste for good, and what
 * `removeCard` does for a card it takes off the waste.
 */
export function dropWasteCard(state: CascadeState): void {
  const sets = state.wasteSets;
  for (let i = sets.length - 1; i >= 0; i -= 1) {
    if (sets[i] > 0) {
      sets[i] -= 1;
      if (sets[i] === 0) sets.splice(i, 1);
      return;
    }
  }
}

/** Where the card with `id` sits, or `null` when no pile holds it. */
export function findCard(state: CascadeState, id: number): CardSite | null {
  const sites: [PileKind, number, CardState[]][] = [
    ["stock", 0, state.stock],
    ["waste", 0, state.waste],
  ];
  state.foundations.forEach((pile, index) =>
    sites.push(["foundation", index, pile]),
  );
  state.tableau.forEach((pile, index) => sites.push(["tableau", index, pile]));

  for (const [pile, index, cards] of sites) {
    const row = cards.findIndex((card) => card.id === id);
    if (row !== -1) return { pile, index, row };
  }
  return null;
}

/** Every card anywhere on the table, including any run currently in hand. */
export function everyCard(state: CascadeState): CardState[] {
  const cards = everyPile(state).flat();
  if (state.drag !== null) cards.push(...state.drag.cards);
  return cards;
}
