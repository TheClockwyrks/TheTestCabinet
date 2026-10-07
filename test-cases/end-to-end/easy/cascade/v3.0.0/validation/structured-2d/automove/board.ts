// automove — the whole board as plain text, for the checks whose requirement is
// that NOTHING moved. GROUP-LOCAL.
//
// Five of this group's items decide a REFUSAL: an auto-move the rules do not
// allow "changes nothing" (specs/instrumentation.md: a pile that holds no
// playable card sends nothing, and a card no foundation accepts is not sent).
// "Nothing" is not one field, so each of those checks reads the thirteen piles
// and the waste's set memory before the call and again after it, and compares
// the pair. A check that read only the pile it named would pass a build that
// refused the move and then dropped the card somewhere else on the table.
//
// The cards are compared AS TEXT rather than as reported objects, so the
// comparison is over what a card IS — its rank, its suit and its face — rather
// than over the ids the build happened to hand out, and a failure prints a board
// a reviewer can read: `["AS", "2S"]` beside `["AS", "2S", "5H"]`.
//
// Nothing here asserts and nothing here is a threshold: every figure this group
// holds a build to is stated in the check that holds it.

import type { CascadeSnapshot, SnapshotCard, Suit } from "../harness";

/** The rank names a deck is read by, Ace low to King high (specs/deal.md). */
const RANK_TEXT: readonly string[] = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
];

/** The one letter each suit is written as. */
const SUIT_TEXT: Readonly<Record<Suit, string>> = {
  spades: "S",
  hearts: "H",
  diamonds: "D",
  clubs: "C",
};

/**
 * One reported card written out: its rank, its suit, and a leading `#` when it
 * lies face-down. A rank or suit outside the deck is printed as it was reported
 * rather than hidden, because a check comparing two boards wants to SEE that.
 */
export function cardText(card: SnapshotCard): string {
  const face = card.faceUp ? "" : "#";
  const rank = RANK_TEXT[card.rank - 1] ?? String(card.rank);
  const suit = SUIT_TEXT[card.suit] ?? String(card.suit);
  return `${face}${rank}${suit}`;
}

/** A whole pile written out, bottom card first, so the last entry is its top. */
export function pileText(cards: readonly SnapshotCard[]): string[] {
  return cards.map(cardText);
}

/** The thirteen piles, each bottom card first, and the waste's set memory. */
export interface BoardText {
  stock: string[];
  waste: string[];
  wasteSets: number[];
  foundations: string[][];
  tableau: string[][];
}

/** The board as {@link BoardText}, for a before-and-after comparison. */
export function boardText(snapshot: CascadeSnapshot): BoardText {
  return {
    stock: pileText(snapshot.stock),
    waste: pileText(snapshot.waste),
    wasteSets: [...snapshot.wasteSets],
    foundations: snapshot.foundations.map((cards) => pileText(cards)),
    tableau: snapshot.tableau.map((cards) => pileText(cards)),
  };
}
