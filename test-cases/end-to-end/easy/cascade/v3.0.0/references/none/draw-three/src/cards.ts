// Cascade — the deck: what a card is, and how a fresh one is built.
//
// specs/deal.md fixes the deck exactly: four suits, thirteen ranks with the Ace
// low and the King high, each of the fifty-two pairs appearing once, and hearts
// and diamonds red against spades and clubs black. What is here is that, plus the
// two labels a card face is drawn with, which are this build's own.

import { RANK_MAX, RANK_MIN, SUITS, type Suit } from "./constants";

/** The two colors a suit is drawn in. */
export type CardColor = "red" | "black";

/**
 * One playing card.
 *
 * `id` is the card's identity, distinct among the cards live at any moment. A
 * card keeps it for as long as it is on the table, across every move, turn, flip
 * and recycle, and a card that launches keeps it as a flyer
 * (specs/instrumentation.md).
 */
export interface Card {
  id: number;
  suit: Suit;
  rank: number;
  faceUp: boolean;
}

/** A card's color, from its suit alone. */
export function cardColor(suit: Suit): CardColor {
  return suit === "hearts" || suit === "diamonds" ? "red" : "black";
}

/** Whether two cards are of opposite colors, which is what a column wants. */
export function opposite(a: Suit, b: Suit): boolean {
  return cardColor(a) !== cardColor(b);
}

/** The label a card face draws for each rank, indexed by rank. */
export const RANK_LABEL: readonly string[] = [
  "",
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
] as const;

/** The pip a card face draws for each suit. */
export const SUIT_PIP: Record<Suit, string> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

/** Whether a rank is one of the thirteen. */
export function isRank(rank: number): boolean {
  return Number.isInteger(rank) && rank >= RANK_MIN && rank <= RANK_MAX;
}

/** Whether a string names one of the four suits. */
export function isSuit(suit: string): suit is Suit {
  return (SUITS as readonly string[]).includes(suit);
}

/**
 * A fresh, ordered fifty-two card deck, every card face-down.
 *
 * `nextId` hands out the identities, so a deck dealt over one that came before it
 * shares no id with the cards still in flight from the last game.
 */
export function makeDeck(nextId: () => number): Card[] {
  const cards: Card[] = [];
  for (const suit of SUITS) {
    for (let rank = RANK_MIN; rank <= RANK_MAX; rank += 1) {
      cards.push({ id: nextId(), suit, rank, faceUp: false });
    }
  }
  return cards;
}
