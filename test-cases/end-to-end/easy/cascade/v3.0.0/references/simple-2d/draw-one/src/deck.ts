// Cascade — the deck: the fifty-two cards, what each one reads as, and the
// shuffle a new game deals from (specs/deal.md).
//
// A card's color follows its suit rather than being stored, so nothing can hold
// a color that disagrees with the suit beside it.

import { RANK_MAX, RANK_MIN, SUITS } from "./constants";
import { shuffle, type Draw } from "./rng";
import type { CardState, Suit } from "./game";

/** One suit-and-rank pair, before it is dealt and given an identity. */
export interface CardFace {
  readonly suit: Suit;
  readonly rank: number;
}

/** The two colors a suit is drawn in (specs/deal.md). */
export type CardColor = "red" | "black";

/** Hearts and diamonds are red; spades and clubs are black. */
export function colorOf(suit: Suit): CardColor {
  return suit === "hearts" || suit === "diamonds" ? "red" : "black";
}

/** Whether two cards are opposite in color, which is what a column builds by. */
export function oppositeColor(a: Suit, b: Suit): boolean {
  return colorOf(a) !== colorOf(b);
}

/** The text drawn for a rank: `A`, `2` through `10`, `J`, `Q`, `K`. */
export function rankLabel(rank: number): string {
  if (rank === 1) return "A";
  if (rank === 11) return "J";
  if (rank === 12) return "Q";
  if (rank === 13) return "K";
  return String(rank);
}

/** The symbol drawn for a suit. */
export function suitGlyph(suit: Suit): string {
  switch (suit) {
    case "spades":
      return "♠";
    case "hearts":
      return "♥";
    case "diamonds":
      return "♦";
    case "clubs":
      return "♣";
  }
}

/** Whether a rank is one of the thirteen this deck holds. */
export function isRank(rank: number): boolean {
  return Number.isInteger(rank) && rank >= RANK_MIN && rank <= RANK_MAX;
}

/** Whether a string names one of the four suits. */
export function isSuit(suit: string): suit is Suit {
  return (SUITS as readonly string[]).includes(suit);
}

/**
 * One full deck: each of the fifty-two suit-and-rank pairs exactly once, suit by
 * suit and Ace to King within each.
 */
export function buildDeck(): readonly CardFace[] {
  const faces: CardFace[] = [];
  for (const suit of SUITS) {
    for (let rank = RANK_MIN; rank <= RANK_MAX; rank++) {
      faces.push({ suit, rank });
    }
  }
  return faces;
}

/** A full deck shuffled uniformly, and the generator state after the shuffle. */
export function shuffledDeck(rngState: number): Draw<readonly CardFace[]> {
  return shuffle(buildDeck(), rngState);
}

/** A card with an identity, ready to sit on a pile. */
export function makeCard(
  id: number,
  suit: Suit,
  rank: number,
  faceUp: boolean,
): CardState {
  return { id, suit, rank, faceUp };
}
