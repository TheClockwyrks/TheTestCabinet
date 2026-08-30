// Cascade — what a pile accepts (`specs/foundations.md`, `specs/tableau.md`).
//
// Every function here is a pure question about cards. It moves nothing and reads
// nothing but the cards it is handed, so the same rules answer a released drop,
// a `move` driven from code, and the auto-move, and the drop-target highlight
// asks exactly the question a release will.

import { RANK_MAX, RANK_MIN } from "./constants";
import { colorOf, oppositeColors } from "./deck";
import type { CardState } from "./game";
import { topOf } from "./piles";

/**
 * Whether a slice of cards is a RUN: one or more face-up cards ordered so that
 * each is one rank lower than, and the opposite colour of, the card above it. A
 * single face-up card is a run of one.
 *
 * A face-down card is never moved and is never read (`specs/tableau.md`), so a
 * slice carrying one is not a run.
 */
export function isRun(cards: readonly CardState[]): boolean {
  if (cards.length === 0) return false;
  for (const card of cards) if (!card.faceUp) return false;
  for (let i = 1; i < cards.length; i += 1) {
    const above = cards[i - 1];
    const below = cards[i];
    if (below.rank !== above.rank - 1) return false;
    if (!oppositeColors(above.suit, below.suit)) return false;
  }
  return true;
}

/**
 * Whether a foundation accepts one card: an Ace onto an empty foundation, and
 * thereafter the next-higher card of the same suit. A foundation holding its King
 * accepts nothing.
 */
export function foundationAccepts(
  foundation: readonly CardState[],
  card: CardState,
): boolean {
  const top = topOf(foundation);
  if (top === null) return card.rank === RANK_MIN;
  if (top.suit !== card.suit) return false;
  return card.rank === top.rank + 1;
}

/**
 * Whether a column accepts a run: a run led by a King onto an empty column, and
 * otherwise a run whose leading card is one rank lower than, and the opposite
 * colour of, the column's face-up lowest card. A column whose lowest card is
 * face-down accepts nothing.
 */
export function columnAccepts(
  column: readonly CardState[],
  run: readonly CardState[],
): boolean {
  if (!isRun(run)) return false;
  const lead = run[0];
  const lowest = topOf(column);
  if (lowest === null) return lead.rank === RANK_MAX;
  if (!lowest.faceUp) return false;
  if (lead.rank !== lowest.rank - 1) return false;
  return colorOf(lead.suit) !== colorOf(lowest.suit);
}

/**
 * The index of the foundation a card belongs on, or `-1` when none accepts it.
 * Every card belongs on at most one foundation, since no two foundations hold
 * one suit; an Ace belongs on the first empty one.
 */
export function foundationFor(
  foundations: readonly (readonly CardState[])[],
  card: CardState,
): number {
  for (let i = 0; i < foundations.length; i += 1) {
    if (foundationAccepts(foundations[i], card)) return i;
  }
  return -1;
}
