// Cascade — the deck.
//
// One standard deck of fifty-two cards: four suits, thirteen ranks, Ace low and
// King high, each suit-and-rank pair exactly once (`specs/deal.md`). Nothing
// here shuffles or deals; that is `src/board.ts`, which owns the piles.

import { DECK_SIZE, RANK_MAX, RANK_MIN, SUITS } from "./constants";
import type { Suit } from "./types";

/** One suit-and-rank pair, before it becomes a card with an identity. */
export interface DeckEntry {
  suit: Suit;
  rank: number;
}

/**
 * A fresh, ordered deck of every suit-and-rank pair, suit by suit and Ace to
 * King within each.
 */
export function orderedDeck(): DeckEntry[] {
  const entries: DeckEntry[] = [];
  for (const suit of SUITS) {
    for (let rank = RANK_MIN; rank <= RANK_MAX; rank += 1) {
      entries.push({ suit, rank });
    }
  }
  return entries;
}

/** Whether a deck holds each of the fifty-two pairs exactly once. */
export function isFullDeck(entries: readonly DeckEntry[]): boolean {
  if (entries.length !== DECK_SIZE) return false;
  const seen = new Set(entries.map((entry) => `${entry.suit}:${entry.rank}`));
  return seen.size === DECK_SIZE;
}
