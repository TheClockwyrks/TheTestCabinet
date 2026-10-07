// Cascade — what a foundation and a column accept.
//
// specs/foundations.md and specs/tableau.md fix these rules, and this file is a
// direct transcription of them. Every function here is a pure question about
// cards: nothing is moved, nothing is drawn, and nothing reads the state beyond
// the piles it is handed. The moves themselves are in `src/moves.ts`.

import { opposite, type Card } from "./cards";
import { RANK_MAX, RANK_MIN } from "./constants";

/**
 * Whether a list of cards is a run: each card one rank lower than, and the
 * opposite color of, the card above it. A single card is a run of one.
 *
 * A face-down card is never moved and is never read (specs/tableau.md), so a list
 * carrying one is not a run whatever its ranks say.
 */
export function isRun(cards: readonly Card[]): boolean {
  if (cards.length === 0) return false;
  for (const card of cards) if (!card.faceUp) return false;
  for (let i = 1; i < cards.length; i += 1) {
    const above = cards[i - 1];
    const below = cards[i];
    if (below.rank !== above.rank - 1) return false;
    if (!opposite(above.suit, below.suit)) return false;
  }
  return true;
}

/**
 * Whether a foundation accepts a run.
 *
 * A foundation builds one suit upward from the Ace and takes exactly one card at
 * a time, so a run of two or more is refused even when its leading card alone
 * would be accepted.
 */
export function foundationAccepts(
  foundation: readonly Card[],
  cards: readonly Card[],
): boolean {
  if (cards.length !== 1) return false;
  const card = cards[0];
  if (!card.faceUp) return false;
  const top = foundation[foundation.length - 1];
  if (top === undefined) return card.rank === RANK_MIN;
  return card.suit === top.suit && card.rank === top.rank + 1;
}

/**
 * Whether a column accepts a run.
 *
 * An empty column takes a run led by a King and nothing else. A column whose
 * lowest card is face-down accepts nothing, because that card is not readable
 * until a move has turned it.
 */
export function columnAccepts(
  column: readonly Card[],
  cards: readonly Card[],
): boolean {
  if (!isRun(cards)) return false;
  const leading = cards[0];
  const lowest = column[column.length - 1];
  if (lowest === undefined) return leading.rank === RANK_MAX;
  if (!lowest.faceUp) return false;
  return (
    leading.rank === lowest.rank - 1 && opposite(lowest.suit, leading.suit)
  );
}

/**
 * The index of the foundation a single card belongs on, or `-1`.
 *
 * The one already holding the next-lower card of the card's own suit, or, for an
 * Ace, the first empty foundation. No two foundations hold the same suit, so a
 * card belongs on at most one (specs/foundations.md).
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

/** Whether every foundation is complete, from its Ace through its King. */
export function allHome(foundations: readonly (readonly Card[])[]): boolean {
  return foundations.every((pile) => pile.length === RANK_MAX);
}
