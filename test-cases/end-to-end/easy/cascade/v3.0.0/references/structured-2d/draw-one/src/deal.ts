// Cascade — the deck and the deal (specs/deal.md).
//
// Every new game deals from a full deck shuffled uniformly at random, drawn off
// the state's own seeded generator so the same seed deals the same board
// (specs/instrumentation.md). The shuffled deck is held with its TOP at the end
// of the array, so dealing is a run of pops and the twenty-four cards left over
// are the stock exactly as they lie, bottom card first.
//
// A new deal also clears the painted table, which is `specs/deal.md`'s own rule
// rather than the cascade's: a deal following a victory cascade leaves clean
// felt behind it.

import type { FrameCues } from "./audio";
import { DEAL_STOCK_CARDS, TABLEAU_COLUMNS } from "./constants";
import { shuffledDeck } from "./deck";
import type { CardState, CascadeState } from "./game";
import { newCard } from "./piles";

/**
 * Deal a fresh game onto the thirteen piles.
 *
 * It replaces the contents of all thirteen piles, empties the waste's set
 * memory, sets `launched` to `0`, and clears the painted layer. It changes no
 * other field, the screen included (specs/instrumentation.md).
 */
export function dealGame(state: CascadeState, cues: FrameCues): void {
  const [deck, rngState] = shuffledDeck(state.rngState);
  state.rngState = rngState;

  const tableau: CardState[][] = [];
  for (let col = 0; col < TABLEAU_COLUMNS; col += 1) {
    const column: CardState[] = [];
    for (let row = 0; row <= col; row += 1) {
      const entry = deck.pop();
      if (entry === undefined) break;
      // Every card face-down except the last one dealt into the column, which
      // is turned face-up and is the column's lowest card on the table.
      column.push(newCard(state, entry.suit, entry.rank, row === col));
    }
    tableau.push(column);
  }

  const stock: CardState[] = deck
    .slice(0, DEAL_STOCK_CARDS)
    .map((entry) => newCard(state, entry.suit, entry.rank, false));

  state.tableau = tableau;
  state.stock = stock;
  state.waste = [];
  state.wasteSets = [];
  state.foundations = [[], [], [], []];

  state.launched = 0;
  state.trail.clear();
  state.trailStamps = 0;

  cues.deal = true;
}
