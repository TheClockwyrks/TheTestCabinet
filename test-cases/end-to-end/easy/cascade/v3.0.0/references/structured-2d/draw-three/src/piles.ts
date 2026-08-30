// Cascade — the thirteen piles, and the waste's set memory.
//
// A pile is named by two scalars, `pile` and `index` (`specs/instrumentation.md`,
// Addressing a pile), and holds its cards in order from the pile's bottom card to
// its top card, so the last entry is the top card — which in a column is the card
// drawn LOWEST on the table and the one a run is stacked onto
// (`specs/table.md`, The order of a pile).
//
// The waste's set memory (`specs/stock.md`) is the list of counts this module
// also owns. The cards on the waste belong to those sets from the bottom up, so
// the oldest set holds the bottom-most cards; the waste SHOWS the cards on the
// newest set that still holds any; and a set played off entirely leaves the
// memory, so the waste falls back to what is left of the set turned before it. A
// waste whose memory is empty shows no card and offers none to play, whatever
// cards it still holds.

import { FOUNDATION_COUNT, TABLEAU_COLUMNS } from "./constants";
import type { CardState, CascadeState, PileKind } from "./game";

/** Whether `pile` and `index` name one of the thirteen piles. */
export function validPile(pile: PileKind, index: number): boolean {
  if (!Number.isInteger(index) || index < 0) return false;
  switch (pile) {
    case "stock":
    case "waste":
      return index === 0;
    case "foundation":
      return index < FOUNDATION_COUNT;
    case "tableau":
      return index < TABLEAU_COLUMNS;
  }
}

/**
 * The named pile's cards, live, so a caller pushes and splices the pile itself.
 * A name outside the thirteen returns `null` rather than throwing, because every
 * caller has a defined answer for a pile that is not there.
 */
export function pileOf(
  state: CascadeState,
  pile: PileKind,
  index: number,
): CardState[] | null {
  if (!validPile(pile, index)) return null;
  switch (pile) {
    case "stock":
      return state.stock;
    case "waste":
      return state.waste;
    case "foundation":
      return state.foundations[index];
    case "tableau":
      return state.tableau[index];
  }
}

/** Every one of the thirteen piles, in the order this file lists them. */
export function allPiles(state: CascadeState): CardState[][] {
  return [state.stock, state.waste, ...state.foundations, ...state.tableau];
}

/** The pile's top card, or `null` for a pile holding nothing. */
export function topOf(cards: readonly CardState[]): CardState | null {
  return cards.length === 0 ? null : cards[cards.length - 1];
}

// ---- The waste's set memory (specs/stock.md) ------------------------------

/**
 * The cards the waste shows: the newest set's count, and `0` when the memory is
 * empty. It is built at the call rather than stored.
 */
export function wasteVisibleCount(state: CascadeState): number {
  const sets = state.wasteSets;
  return sets.length === 0 ? 0 : sets[sets.length - 1];
}

/**
 * The cards on the set the waste is showing, bottom-most first, so the last of
 * them is the waste's top card.
 *
 * The count is clamped to the cards actually on the waste, which matters while a
 * card lifted off the waste is in hand: a lift leaves the memory untouched
 * (`specs/stock.md`), so for the length of that gesture the newest set counts one
 * card more than the waste holds.
 */
export function wasteShown(state: CascadeState): CardState[] {
  const count = Math.min(wasteVisibleCount(state), state.waste.length);
  if (count <= 0) return [];
  return state.waste.slice(state.waste.length - count);
}

/**
 * Take one card off the waste's set memory: it leaves the newest set that holds
 * any, and a set left holding nothing leaves the memory. That is the rule play
 * itself follows, so the memory stays consistent after any sequence of moves and
 * of poses.
 */
export function takeFromWasteSets(state: CascadeState): void {
  for (let i = state.wasteSets.length - 1; i >= 0; i -= 1) {
    if (state.wasteSets[i] <= 0) continue;
    state.wasteSets[i] -= 1;
    if (state.wasteSets[i] === 0) state.wasteSets.splice(i, 1);
    return;
  }
}
