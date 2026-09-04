// Cascade — turning the stock, and recycling it (`specs/stock.md`).
//
// This build plays Draw Three, so a turn moves `TURN_COUNT` cards, or all that
// remain when the stock holds fewer. The cards are taken ONE AT A TIME from the
// top of the stock and placed face-up on the waste, so the stock's top card ends
// up the deepest of the group the turn moved and the last card taken is the
// waste's new top card.
//
// Each turn appends exactly one SET to the waste's memory, holding exactly the
// cards it moved. `src/piles.ts` owns the memory itself and the rule a card
// leaving the waste follows.
//
// A turn of an EMPTY stock recycles instead: every card on the waste returns to
// the stock face-down, in reverse order, so the card that lay at the bottom of
// the waste is the stock's top card and a further pass turns the same cards up
// in the same order. Passes are unlimited, so a stock emptied and recycled any
// number of times behaves the same each time.

import type { FrameEvents } from "./audio";
import { TURN_COUNT } from "./constants";
import type { CascadeState } from "./game";

/** One turn of the stock, or the recycle an empty stock turns into. */
export function turnStock(state: CascadeState, events: FrameEvents): void {
  if (state.stock.length > 0) {
    const count = Math.min(TURN_COUNT, state.stock.length);
    for (let i = 0; i < count; i += 1) {
      const card = state.stock.pop();
      if (card === undefined) break;
      card.faceUp = true;
      state.waste.push(card);
    }
    state.wasteSets.push(count);
    events.turn = true;
    return;
  }

  if (state.waste.length === 0) return;

  for (let i = state.waste.length - 1; i >= 0; i -= 1) {
    const card = state.waste[i];
    card.faceUp = false;
    state.stock.push(card);
  }
  state.waste = [];
  state.wasteSets = [];
  events.recycle = true;
}
