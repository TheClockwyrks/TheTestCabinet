// handling — the group's local helpers. GROUP-LOCAL.
//
// Two things every check in this group would otherwise restate.
//
// THE POINTER ARITHMETIC. specs/controls.md fixes what a held run does with the
// pointer: "it keeps the offset between the press point and the leading card's
// top-left, so the run travels exactly as far as the pointer does". So a check
// that wants a run's leading card to end up somewhere in particular works out
// where the POINTER has to go, and that is one subtraction. {@link carryTo} is
// that subtraction, written once. It is arithmetic over positions the check
// itself names; it asserts nothing and it decides nothing about the build.
//
// THE BOARD AS PLAIN TEXT. Three of this group's items decide that a gesture
// changed NOTHING — a press that lifts nothing, a release with nothing held, two
// quick presses on the bare table. "Nothing" is not one field, so those checks
// read the thirteen piles and the waste's set memory before the gesture and
// again after it and compare the pair. A check that read only the pile it was
// aimed at would pass a build that left that pile alone and disturbed another.
//
// The cards are compared AS TEXT rather than as reported objects, so the
// comparison is over what a card IS — its rank, its suit and its face — rather
// than over the ids the build happened to hand out, and a failure prints a board
// a reviewer can read: `["7S", "6H"]` beside `["7S"]`.
//
// Nothing here is a threshold: every figure this group holds a build to is
// stated in the check that holds it.

import type { CascadeSnapshot, Point, SnapshotCard, Suit } from "../harness";

/**
 * The point the pointer must reach to carry a held run's leading card from
 * `from` to `to`.
 *
 * `press` is where the gesture pressed, `from` the top-left the leading card was
 * drawn at when it entered the hand, and `to` the top-left it is to end at. The
 * run keeps the offset between the press point and that top-left
 * (specs/controls.md), so the pointer travels exactly the displacement the card
 * has to travel.
 */
export function carryTo(press: Point, from: Point, to: Point): Point {
  return { x: press.x + (to.x - from.x), y: press.y + (to.y - from.y) };
}

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
