// Cascade — the rules of Klondike: what a foundation accepts, what a column
// accepts, and what makes an ordered run (specs/foundations.md,
// specs/tableau.md).
//
// Every function here is a pure question about cards. Nothing here moves a
// card; `src/moves.ts` is what applies a decision these rules made.

import { FOUNDATION_COUNT, RANK_MAX, RANK_MIN } from "./constants";
import { opposite } from "./deck";
import type { CardState, CascadeState } from "./game";

/**
 * Whether the cards are in run order: each one rank lower than, and the
 * opposite color of, the card above it. A single card is a run of one, and an
 * empty list is not a run at all.
 */
export function isRunOrdered(run: readonly CardState[]): boolean {
  if (run.length === 0) return false;
  for (let i = 1; i < run.length; i += 1) {
    const above = run[i - 1];
    const below = run[i];
    if (below.rank !== above.rank - 1) return false;
    if (!opposite(above.suit, below.suit)) return false;
  }
  return true;
}

/**
 * Whether a foundation accepts a run.
 *
 * A foundation takes exactly one card at a time: an Ace onto an empty
 * foundation, and thereafter the next-higher card of the suit it was started
 * with. A run of two or more is refused even when its leading card alone would
 * be accepted (specs/foundations.md).
 */
export function foundationAccepts(
  foundation: readonly CardState[],
  run: readonly CardState[],
): boolean {
  if (run.length !== 1) return false;
  const card = run[0];
  if (foundation.length === 0) return card.rank === RANK_MIN;
  const top = foundation[foundation.length - 1];
  if (top.rank >= RANK_MAX) return false;
  return card.suit === top.suit && card.rank === top.rank + 1;
}

/**
 * Whether a column accepts a run.
 *
 * An empty column takes a run led by a King. A column whose lowest card is
 * face-up takes a run led by a card one rank lower and of the other color. A
 * column whose lowest card is face-down takes nothing (specs/tableau.md).
 */
export function columnAccepts(
  column: readonly CardState[],
  run: readonly CardState[],
): boolean {
  if (!isRunOrdered(run)) return false;
  const leader = run[0];
  if (column.length === 0) return leader.rank === RANK_MAX;
  const lowest = column[column.length - 1];
  if (!lowest.faceUp) return false;
  return leader.rank === lowest.rank - 1 && opposite(lowest.suit, leader.suit);
}

/**
 * The foundation a card belongs on: the one already holding the next-lower card
 * of its own suit, or, for an Ace, the first empty foundation. `null` when no
 * foundation would take it (specs/foundations.md).
 */
export function foundationFor(
  state: CascadeState,
  card: CardState,
): number | null {
  for (let i = 0; i < FOUNDATION_COUNT; i += 1) {
    if (foundationAccepts(state.foundations[i], [card])) return i;
  }
  return null;
}

/** Whether every one of the fifty-two cards is home (specs/victory.md). */
export function boardComplete(state: CascadeState): boolean {
  return state.foundations.every((pile) => pile.length === RANK_MAX);
}
