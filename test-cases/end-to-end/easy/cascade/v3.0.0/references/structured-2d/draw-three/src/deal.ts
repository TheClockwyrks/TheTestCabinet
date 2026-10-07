// Cascade — the deal (`specs/deal.md`).
//
// Every new game deals from a full deck shuffled uniformly at random, so every
// ordering of the fifty-two cards is as likely as any other and each new game is
// dealt afresh.
//
// The shuffled deck is dealt column by column, left to right: column 0 receives
// one card, column 1 two, and so on to column 6, which receives seven. In each
// column every card is dealt face-down except the last one dealt, which is turned
// face-up, so each column shows exactly one face-up card and it is the column's
// lowest card on the table. The remaining twenty-four cards form the stock,
// face-down, in the order they were left in.
//
// A new deal also CLEARS THE PAINTED TABLE, so a deal following a victory cascade
// leaves clean felt behind it.

import type { FrameEvents } from "./audio";
import { DEAL_TABLEAU_CARDS, TABLEAU_COLUMNS } from "./constants";
import { buildDeck } from "./deck";
import type { CascadeState } from "./game";
import { shuffle } from "./rng";

/** Empty the painted layer and the count of what it holds. */
export function clearTrail(state: CascadeState): void {
  state.trail.clear();
  state.trailStamps = 0;
}

/**
 * Deal a fresh game. It replaces the contents of all thirteen piles, empties the
 * waste's set memory, sets `launched` to `0` and clears the painted layer, and it
 * changes no other field, the screen included.
 */
export function dealGame(state: CascadeState, events: FrameEvents): void {
  const deck = shuffle(buildDeck(state));

  state.tableau = Array.from({ length: TABLEAU_COLUMNS }, () => []);
  let cursor = 0;
  for (let column = 0; column < TABLEAU_COLUMNS; column += 1) {
    for (let dealt = 0; dealt <= column; dealt += 1) {
      const card = deck[cursor];
      cursor += 1;
      card.faceUp = dealt === column;
      state.tableau[column].push(card);
    }
  }

  state.stock = deck.slice(DEAL_TABLEAU_CARDS);
  for (const card of state.stock) card.faceUp = false;

  state.waste = [];
  state.wasteSets = [];
  state.foundations = [[], [], [], []];

  state.launched = 0;
  clearTrail(state);

  events.deal = true;
}
