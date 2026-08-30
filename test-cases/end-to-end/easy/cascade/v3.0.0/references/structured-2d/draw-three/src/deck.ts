// Cascade — the deck: what a card is, what colour it reads as, and the fifty-two
// the game is played with (`specs/deal.md`).
//
// Ace is the low rank and King the high one, and a card's rank orders it against
// every other card of its suit. A card's colour follows its suit, so it is read
// from the suit rather than held on the card (`specs/state.md`).

import { RANK_MAX, RANK_MIN, SUITS } from "./constants";
import type { CardState, Suit } from "./game";

/** The two colours the four suits divide into. */
export type CardColor = "red" | "black";

/** Hearts and diamonds are red; spades and clubs are black. */
export function colorOf(suit: Suit): CardColor {
  return suit === "hearts" || suit === "diamonds" ? "red" : "black";
}

/** Whether two cards read as opposite colours, which is what a column asks. */
export function oppositeColors(a: Suit, b: Suit): boolean {
  return colorOf(a) !== colorOf(b);
}

/** The label a rank is drawn with: `A`, `2` to `10`, `J`, `Q`, `K`. */
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

/** The symbol a suit is drawn with. */
export function suitSymbol(suit: Suit): string {
  switch (suit) {
    case "spades":
      return "♠";
    case "hearts":
      return "♥";
    case "diamonds":
      return "♦";
    default:
      return "♣";
  }
}

/** The carrier of the id counter: the game's own state object. */
export interface Identity {
  nextId: number;
}

/** One card, taking the next free id, so no two live entities share one. */
export function makeCard(
  identity: Identity,
  suit: Suit,
  rank: number,
  faceUp: boolean,
): CardState {
  const id = identity.nextId;
  identity.nextId = id + 1;
  return { id, suit, rank, faceUp };
}

/**
 * A full deck: each of the fifty-two suit-and-rank pairs exactly once, built
 * suit by suit in the order `SUITS` names and rank by rank from the Ace. Every
 * card is face-down, which is how a deal hands them out.
 */
export function buildDeck(identity: Identity): CardState[] {
  const deck: CardState[] = [];
  for (const suit of SUITS) {
    for (let rank = RANK_MIN; rank <= RANK_MAX; rank += 1) {
      deck.push(makeCard(identity, suit, rank, false));
    }
  }
  return deck;
}
