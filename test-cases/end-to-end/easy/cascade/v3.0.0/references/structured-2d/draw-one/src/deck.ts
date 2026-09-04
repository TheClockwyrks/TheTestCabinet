// Cascade — the deck: the fifty-two cards, their colors, and the shuffle a new
// game is dealt from (specs/deal.md).
//
// A card's color is READ FROM ITS SUIT rather than held on the card
// (specs/state.md), so there is one place the two red suits are named and no
// second copy to fall out of step with it.

import { RANK_MAX, RANK_MIN, SUITS } from "./constants";
import type { CardState, Suit } from "./game";
import { cursor } from "./rng";

/** One of the fifty-two suit-and-rank pairs, before it is dealt a card's id. */
export interface DeckEntry {
  suit: Suit;
  rank: number;
}

/** Hearts and diamonds are red; spades and clubs are black (specs/deal.md). */
export function colorOf(suit: Suit): "red" | "black" {
  return suit === "hearts" || suit === "diamonds" ? "red" : "black";
}

export function isRed(suit: Suit): boolean {
  return colorOf(suit) === "red";
}

/** Whether two cards are drawn in the two different colors. */
export function opposite(a: Suit, b: Suit): boolean {
  return colorOf(a) !== colorOf(b);
}

/** One standard deck: each of the fifty-two pairs exactly once, in suit order. */
export function buildDeck(): DeckEntry[] {
  const deck: DeckEntry[] = [];
  for (const suit of SUITS) {
    for (let rank = RANK_MIN; rank <= RANK_MAX; rank += 1) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

/**
 * The deck shuffled uniformly from `seed`, beside the generator state that
 * follows the shuffle. Fisher-Yates over a seeded draw, so every ordering is as
 * likely as any other and the same seed deals the same board.
 */
export function shuffledDeck(seed: number): readonly [DeckEntry[], number] {
  const rng = cursor(seed);
  const shuffled = rng.shuffle(buildDeck());
  return [shuffled, rng.state];
}

/** The label a face-up card shows for its rank: `A`, `2` to `10`, `J`, `Q`, `K`. */
export function rankLabel(rank: number): string {
  if (rank === 1) return "A";
  if (rank === 11) return "J";
  if (rank === 12) return "Q";
  if (rank === 13) return "K";
  return String(rank);
}

/** The character a face-up card shows for its suit. */
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

/** Whether two cards are the same card: same suit and same rank. */
export function sameCard(a: CardState, b: DeckEntry): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}
