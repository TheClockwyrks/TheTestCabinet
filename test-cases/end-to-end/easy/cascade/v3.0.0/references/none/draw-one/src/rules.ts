// Cascade — what a pile accepts.
//
// The whole of `specs/foundations.md` and the acceptance half of
// `specs/tableau.md`, as pure predicates over card lists. Nothing here moves a
// card: `src/board.ts` asks these questions and then applies the answer, so the
// rule a released drop obeys and the rule the debug surface's `move` obeys are
// literally the same code.

import { RANK_MAX, RANK_MIN } from "./constants";
import type { Card } from "./types";
import { suitColor } from "./types";

/**
 * Whether the cards are an ordered run: each one rank lower than, and the
 * opposite colour of, the card above it. A single card is a run of one.
 */
export function isRun(cards: readonly Card[]): boolean {
  for (let i = 1; i < cards.length; i += 1) {
    const above = cards[i - 1];
    const below = cards[i];
    if (below.rank !== above.rank - 1) return false;
    if (suitColor(below.suit) === suitColor(above.suit)) return false;
  }
  return true;
}

/**
 * Whether a foundation accepts `cards`.
 *
 * A foundation builds one suit up from Ace to King, takes exactly one card at a
 * time, and refuses a run of two or more even when its leading card alone would
 * be accepted.
 */
export function foundationAccepts(
  foundation: readonly Card[],
  cards: readonly Card[],
): boolean {
  if (cards.length !== 1) return false;
  const card = cards[0];
  if (card.rank < RANK_MIN || card.rank > RANK_MAX) return false;
  if (foundation.length === 0) return card.rank === RANK_MIN;
  const top = foundation[foundation.length - 1];
  if (top.rank === RANK_MAX) return false;
  return top.suit === card.suit && card.rank === top.rank + 1;
}

/**
 * Whether a column accepts `cards`.
 *
 * An empty column takes a run led by a King. A column whose lowest card is
 * face-up takes a run led by a card one rank lower and the opposite colour. A
 * column whose lowest card is face-down takes nothing. A slice that is not an
 * ordered run is refused whatever it is offered to.
 */
export function tableauAccepts(
  column: readonly Card[],
  cards: readonly Card[],
): boolean {
  if (cards.length === 0) return false;
  if (!isRun(cards)) return false;
  const lead = cards[0];
  if (column.length === 0) return lead.rank === RANK_MAX;
  const lowest = column[column.length - 1];
  if (!lowest.faceUp) return false;
  return (
    suitColor(lowest.suit) !== suitColor(lead.suit) &&
    lowest.rank === lead.rank + 1
  );
}

/**
 * The index of the foundation `card` belongs on, or `-1` when none accepts it.
 *
 * Every card belongs on at most one foundation, since no two foundations hold
 * the same suit; the scan simply finds it.
 */
export function foundationFor(
  foundations: readonly (readonly Card[])[],
  card: Card,
): number {
  for (let i = 0; i < foundations.length; i += 1) {
    if (foundationAccepts(foundations[i], [card])) return i;
  }
  return -1;
}
