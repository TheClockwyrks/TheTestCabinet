// Cascade — what the foundations and the columns accept (specs/foundations.md,
// specs/tableau.md).
//
// Every function here is a question about cards alone. Nothing reads the table's
// geometry, the pointer, or the screen, so the same answers serve a released
// drop, a double click, and a move driven from the debug surface.

import { RANK_MAX, RANK_MIN } from "./constants";
import { colorOf, oppositeColor } from "./deck";
import type { CardState } from "./game";

/**
 * Whether `cards` are in run order: each one lower in rank than, and opposite in
 * color to, the card above it. A single card is a run of one.
 */
export function isRun(cards: readonly CardState[]): boolean {
  if (cards.length === 0) return false;
  for (let i = 1; i < cards.length; i++) {
    const above = cards[i - 1];
    const below = cards[i];
    if (below.rank !== above.rank - 1) return false;
    if (!oppositeColor(above.suit, below.suit)) return false;
  }
  return true;
}

/**
 * Whether a foundation holding `pile` accepts `cards`.
 *
 * A foundation takes exactly one card at a time: an Ace onto nothing, and
 * thereafter the next-higher card of the suit it was started with.
 */
export function foundationAccepts(
  pile: readonly CardState[],
  cards: readonly CardState[],
): boolean {
  if (cards.length !== 1) return false;
  const card = cards[0];
  if (pile.length === 0) return card.rank === RANK_MIN;
  const top = pile[pile.length - 1];
  return card.suit === top.suit && card.rank === top.rank + 1;
}

/**
 * Whether a column holding `pile` accepts the run `cards`.
 *
 * An empty column takes a run led by a King. A column whose lowest card is
 * face-up takes a run led by a card one rank lower and the opposite color. A
 * column whose lowest card is face-down takes nothing.
 */
export function tableauAccepts(
  pile: readonly CardState[],
  cards: readonly CardState[],
): boolean {
  if (!isRun(cards)) return false;
  const lead = cards[0];
  if (pile.length === 0) return lead.rank === RANK_MAX;
  const lowest = pile[pile.length - 1];
  if (!lowest.faceUp) return false;
  return lead.rank === lowest.rank - 1 && oppositeColor(lowest.suit, lead.suit);
}

/**
 * The index of the foundation `card` belongs on, or `-1` when none accepts it.
 *
 * A started foundation is locked to its suit, so at most one foundation can hold
 * any given card; an Ace takes the first empty one.
 */
export function foundationFor(
  foundations: readonly (readonly CardState[])[],
  card: CardState,
): number {
  for (let i = 0; i < foundations.length; i++) {
    if (
      foundations[i].length > 0 &&
      foundationAccepts(foundations[i], [card])
    ) {
      return i;
    }
  }
  if (card.rank !== RANK_MIN) return -1;
  return foundations.findIndex((pile) => pile.length === 0);
}

/** Whether every foundation is complete, its Ace through its King. */
export function boardComplete(
  foundations: readonly (readonly CardState[])[],
): boolean {
  return foundations.every((pile) => pile.length === RANK_MAX);
}

/** Whether a card reads as red, which is what a column's alternation is over. */
export function isRed(card: CardState): boolean {
  return colorOf(card.suit) === "red";
}
