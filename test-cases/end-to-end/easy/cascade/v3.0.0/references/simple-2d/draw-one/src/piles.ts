// Cascade — the thirteen piles and the waste's set memory.
//
// Every pile is addressed by the two scalars specs/instrumentation.md fixes, a
// kind and an index, and is held bottom card first, so the last entry is the
// pile's top card and in a column the card drawn lowest on the table. Every
// function here is a transition: a state in, the next state out.

import { FOUNDATION_COUNT, TABLEAU_COLUMNS } from "./constants";
import type { CardState, CascadeState, PileKind } from "./game";

/** A pile, named the way the debug surface and the pointer both name one. */
export interface PileRef {
  readonly pile: PileKind;
  readonly index: number;
}

/** A card, named by its pile and its position from the bottom of that pile. */
export interface CardRef extends PileRef {
  /** The card's index within its pile, counted from the bottom. */
  readonly row: number;
}

/** Whether `pile` and `index` name one of the thirteen piles. */
export function isPile(pile: PileKind, index: number): boolean {
  if (!Number.isInteger(index)) return false;
  switch (pile) {
    case "stock":
    case "waste":
      return index === 0;
    case "foundation":
      return index >= 0 && index < FOUNDATION_COUNT;
    case "tableau":
      return index >= 0 && index < TABLEAU_COLUMNS;
  }
}

/** The cards on the named pile, bottom first. An unnamed pile holds nothing. */
export function pileCards(
  state: CascadeState,
  pile: PileKind,
  index: number,
): readonly CardState[] {
  if (!isPile(pile, index)) return [];
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

/** The named pile's top card, or `null` when it holds none. */
export function topCard(
  state: CascadeState,
  pile: PileKind,
  index: number,
): CardState | null {
  const cards = pileCards(state, pile, index);
  return cards.length === 0 ? null : cards[cards.length - 1];
}

/** One list with the entry at `index` replaced. */
function replaced<T>(
  items: readonly T[],
  index: number,
  value: T,
): readonly T[] {
  return items.map((item, i) => (i === index ? value : item));
}

/** The state with the named pile holding `cards` and nothing else changed. */
export function withPile(
  state: CascadeState,
  pile: PileKind,
  index: number,
  cards: readonly CardState[],
): CascadeState {
  if (!isPile(pile, index)) return state;
  switch (pile) {
    case "stock":
      return { ...state, stock: cards };
    case "waste":
      return { ...state, waste: cards };
    case "foundation":
      return {
        ...state,
        foundations: replaced(state.foundations, index, cards),
      };
    case "tableau":
      return { ...state, tableau: replaced(state.tableau, index, cards) };
  }
}

/** Where the card with that id sits, or `null` when no pile holds it. */
export function findCard(state: CascadeState, id: number): CardRef | null {
  const search: readonly PileRef[] = [
    { pile: "stock", index: 0 },
    { pile: "waste", index: 0 },
    ...state.foundations.map((_, index) => ({
      pile: "foundation" as const,
      index,
    })),
    ...state.tableau.map((_, index) => ({ pile: "tableau" as const, index })),
  ];
  for (const ref of search) {
    const row = pileCards(state, ref.pile, ref.index).findIndex(
      (card) => card.id === id,
    );
    if (row >= 0) return { ...ref, row };
  }
  return null;
}

/** Every card on the table, in no particular order. */
export function allCards(state: CascadeState): readonly CardState[] {
  return [
    ...state.stock,
    ...state.waste,
    ...state.foundations.flat(),
    ...state.tableau.flat(),
  ];
}

/** How many cards are on the table's thirteen piles. */
export function cardCount(state: CascadeState): number {
  return allCards(state).length;
}

// ---- Identity ------------------------------------------------------------

/** The next `count` ids, and the value `nextId` takes after them. */
export function takeIds(
  state: CascadeState,
  count: number,
): readonly [ids: readonly number[], nextId: number] {
  const ids: number[] = [];
  for (let i = 0; i < count; i++) ids.push(state.nextId + i);
  return [ids, state.nextId + count];
}

// ---- The waste's set memory (specs/stock.md) ------------------------------

/**
 * How many cards the set the waste is showing holds: the newest entry of the
 * memory, and `0` when the memory is empty (specs/instrumentation.md).
 */
export function wasteVisibleCount(state: CascadeState): number {
  const sets = state.wasteSets;
  return sets.length === 0 ? 0 : sets[sets.length - 1];
}

/**
 * How many of the waste's cards are actually drawn: what the shown set holds,
 * bounded by what the pile holds, so a waste whose top card is in hand shows
 * only the cards still on it.
 */
export function shownWasteCount(state: CascadeState): number {
  return Math.max(0, Math.min(wasteVisibleCount(state), state.waste.length));
}

/** The waste's top card while it shows one, and `null` otherwise. */
export function wasteTopCard(state: CascadeState): CardState | null {
  if (shownWasteCount(state) <= 0) return null;
  return state.waste[state.waste.length - 1];
}

/** The set memory with one more set of `count` cards on its newest end. */
export function appendWasteSet(
  sets: readonly number[],
  count: number,
): readonly number[] {
  return [...sets, count];
}

/**
 * The set memory after one card has left the waste for good.
 *
 * The card comes off the newest set that still holds any, and a set left holding
 * nothing leaves the memory, which is the rule play itself follows.
 */
export function dropFromNewestSet(sets: readonly number[]): readonly number[] {
  for (let i = sets.length - 1; i >= 0; i--) {
    if (sets[i] > 0) {
      const shrunk = sets[i] - 1;
      const next = [...sets];
      if (shrunk === 0) next.splice(i, 1);
      else next[i] = shrunk;
      return next;
    }
  }
  return sets;
}
