// tableau — the board as plain text, for the checks whose requirement is that
// something did NOT change. GROUP-LOCAL.
//
// Seven of this group's items decide that a column REFUSES what it is offered, and
// specs/tableau.md fixes what a refusal is: "A refused move changes nothing. Every
// card it carried returns to the pile it was taken from, in the order it left, with
// every face as it was, and the target keeps what it held."
// specs/instrumentation.md says the same of the operation: a refused `move` "leaves
// the board unchanged".
//
// "Unchanged" is not one field, so each of those checks reads the thirteen piles and
// the waste's set memory before the move and again after it, and compares the pair.
// A check that read only the column it named would pass a build that refused the
// move and then dropped the card somewhere else on the table.
//
// The cards are compared AS TEXT rather than as reported objects, so the comparison
// is over what a card IS — its rank, its suit and its face — rather than over the
// ids the build happened to hand out, and a failure prints a board a reviewer can
// read: `["9S", "8H"]` beside `["9S"]`. A face-down card is written with a leading
// `#`, so a board that turned a card reads differently from one that did not.
//
// Nothing here asserts and nothing here is a threshold: every figure this group
// holds a build to is stated in the check that holds it.

import {
  everyCard,
  type CascadeSnapshot,
  type SnapshotCard,
  type Suit,
} from "../harness";

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
 * One reported card written out: its rank, its suit, and a leading `#` when it lies
 * face-down. A rank or suit outside the deck is printed as it was reported rather
 * than hidden, because a check comparing two boards wants to SEE that.
 */
export function cardText(card: SnapshotCard): string {
  const face = card.faceUp ? "" : "#";
  const rank = RANK_TEXT[card.rank - 1] ?? String(card.rank);
  const suit = SUIT_TEXT[card.suit] ?? String(card.suit);
  return `${face}${rank}${suit}`;
}

/**
 * A whole pile written out, bottom card first — so for a column the last entry is
 * its lowest drawn card, the one a run stacks onto (specs/table.md).
 */
export function pileText(cards: readonly SnapshotCard[]): string[] {
  return cards.map(cardText);
}

/**
 * A foundation built by the rules from its Ace up to `upTo`, written out.
 *
 * specs/foundations.md: a foundation builds one suit upward from Ace to King, so a
 * foundation whose top card is rank `r` holds every rank below `r` of its own suit
 * beneath it, in order.
 */
export function builtText(suit: Suit, upTo: number): string[] {
  const built: string[] = [];
  for (let rank = 1; rank <= upTo; rank += 1) {
    built.push(`${RANK_TEXT[rank - 1] ?? String(rank)}${SUIT_TEXT[suit]}`);
  }
  return built;
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

/**
 * Every card on the table by its id, written out — what a check comparing FACES
 * across a move reads.
 *
 * A card keeps its id for as long as it is on the table, across every move and every
 * flip (specs/instrumentation.md, Identity), so the same id names the same card
 * before and after a move wherever that move put it. The value carries the face, so
 * a card that turned reads `2C` where it read `#2C` and the failure names which card
 * turned rather than merely reporting that some face differs.
 */
export function facesById(snapshot: CascadeSnapshot): Record<string, string> {
  const faces: Record<string, string> = {};
  for (const site of everyCard(snapshot)) {
    faces[String(site.card.id)] = cardText(site.card);
  }
  return faces;
}
