// Cascade — the deck, and the two rules that decide what a pile accepts.
//
// `specs/deal.md` fixes the deck; `specs/foundations.md` and `specs/tableau.md`
// fix what a foundation and a column take. All four are pure functions of the
// cards handed to them, so the same rule decides a pointer's drop, the debug
// surface's `move`, and the auto-move, and there is nowhere for the three to
// drift apart.
//
// A pile is always ordered from its BOTTOM card to its TOP card, so the last
// entry is the top card, which in a column is the card drawn lowest on the table
// (`specs/table.md`). A run is ordered the other way round for the same reason:
// `run[0]` is the card that was grabbed and leads the run, and the rest lie
// beneath it in the order they lay in the column.

import { RANK_MAX, RANK_MIN, SUITS } from "./constants";
import type { CardState, Suit } from "./game";

/** The two colours a suit is drawn in (`specs/deal.md`). */
export type CardColor = "red" | "black";

/** One suit-and-rank pair, before it is dealt and given an id. */
export interface CardFace {
  readonly suit: Suit;
  readonly rank: number;
}

/** Hearts and diamonds are red; spades and clubs are black. */
export function cardColor(suit: Suit): CardColor {
  return suit === "hearts" || suit === "diamonds" ? "red" : "black";
}

/** Whether `suit` names one of the four suits. */
export function isSuit(suit: string): suit is Suit {
  return (SUITS as readonly string[]).includes(suit);
}

/** The text a card's rank is drawn as: `A`, `2` to `10`, `J`, `Q`, `K`. */
export function rankLabel(rank: number): string {
  switch (rank) {
    case 1:
      return "A";
    case 11:
      return "J";
    case 12:
      return "Q";
    case 13:
      return "K";
    default:
      return String(rank);
  }
}

/** One of each of the fifty-two suit-and-rank pairs, suit by suit. */
export function buildDeck(): CardFace[] {
  const deck: CardFace[] = [];
  for (const suit of SUITS) {
    for (let rank = RANK_MIN; rank <= RANK_MAX; rank++) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

/**
 * Whether `run` is an ordered run: each card one rank lower than, and the
 * opposite colour of, the card above it (`specs/tableau.md`).
 *
 * A single card is a run of one, and an empty list is not a run at all.
 */
export function isOrderedRun(run: readonly CardState[]): boolean {
  if (run.length === 0) return false;
  for (let i = 1; i < run.length; i++) {
    const above = run[i - 1] as CardState;
    const below = run[i] as CardState;
    if (below.rank !== above.rank - 1) return false;
    if (cardColor(below.suit) === cardColor(above.suit)) return false;
  }
  return true;
}

/**
 * Whether a foundation holding `pile` accepts the run `run`
 * (`specs/foundations.md`).
 *
 * A foundation takes exactly one card at a time, so a run of two or more is
 * refused even when its leading card alone would be accepted.
 */
export function foundationAccepts(
  pile: readonly CardState[],
  run: readonly CardState[],
): boolean {
  if (run.length !== 1) return false;
  const card = run[0] as CardState;
  const top = pile[pile.length - 1];
  if (top === undefined) return card.rank === RANK_MIN;
  return card.suit === top.suit && card.rank === top.rank + 1;
}

/**
 * Whether a column holding `pile` accepts the run `run` (`specs/tableau.md`).
 *
 * An empty column takes a run led by a King; a column whose lowest card is
 * face-down takes nothing; otherwise the run's leading card is one rank lower
 * than that lowest card and the other colour.
 */
export function columnAccepts(
  pile: readonly CardState[],
  run: readonly CardState[],
): boolean {
  if (!isOrderedRun(run)) return false;
  const lead = run[0] as CardState;
  const lowest = pile[pile.length - 1];
  if (lowest === undefined) return lead.rank === RANK_MAX;
  if (!lowest.faceUp) return false;
  return (
    lead.rank === lowest.rank - 1 &&
    cardColor(lead.suit) !== cardColor(lowest.suit)
  );
}
