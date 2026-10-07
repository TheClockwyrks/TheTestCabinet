// Cascade — the stock, the waste, and the set memory between them
// (specs/stock.md).
//
// A turn of a stock holding cards moves `TURN_COUNT` of them onto the waste,
// one at a time off the stock's top, and appends ONE SET holding exactly the
// cards it turned. A turn of an empty stock recycles instead: the whole waste
// goes back face-down in reverse order, so the card that lay at the bottom of
// the waste is the stock's top card and a further pass turns the same cards up
// in the same order, and the set memory is emptied with the waste.
//
// The set memory is what the waste SHOWS, which is the rule this file exists
// for: the waste shows the cards still on the newest set that holds any, and a
// set played off entirely leaves the memory, so the waste falls back to what is
// left of the turn before it. `src/piles.ts` holds the one function that takes a
// card off that memory, because play, a refused pose and `removeCard` all owe
// it the same arithmetic.

import type { FrameCues } from "./audio";
import { TURN_COUNT } from "./constants";
import type { CascadeState } from "./game";

/** Turn the stock, or recycle it when it is empty (specs/stock.md). */
export function turnStock(state: CascadeState, cues: FrameCues): void {
  if (state.stock.length > 0) {
    const count = Math.min(TURN_COUNT, state.stock.length);
    for (let i = 0; i < count; i += 1) {
      const card = state.stock.pop();
      if (card === undefined) break;
      card.faceUp = true;
      state.waste.push(card);
    }
    state.wasteSets.push(count);
    cues.turn = true;
    return;
  }

  // An empty stock and an empty waste is a turn with nothing to turn.
  if (state.waste.length === 0) return;

  while (state.waste.length > 0) {
    const card = state.waste.pop();
    if (card === undefined) break;
    card.faceUp = false;
    state.stock.push(card);
  }
  state.wasteSets.length = 0;
  cues.recycle = true;
}
