// Cascade — the waste's set memory.
//
// specs/stock.md states the rule positively, and this file is the whole of it.
// The waste keeps the cards of each turn together as a SET and remembers its sets
// in the order they were turned, oldest first. The cards on the waste belong to
// those sets from the bottom up, so the oldest set holds the bottom-most cards.
//
// The waste shows the cards of the NEWEST set that still holds any, and the last
// of them is the waste's top card. Playing the top card off leaves its set one
// card smaller; a set played off entirely leaves the memory, so the waste falls
// back to what is left of the set turned before it. That is what makes a waste of
// five cards show two after a set of three has been played off over a set that had
// already lost one: the fan is not refilled from the cards buried beneath it, and
// it is not the last turn's count either.
//
// A waste whose set memory is empty shows no card and offers none to play,
// whatever cards it still holds. That state is reachable — `clearWasteSets()`
// poses it — so it is a stated rule rather than an accident.

import type { Card } from "./cards";
import { WASTE_FAN_MAX } from "./constants";
import type { CascadeState } from "./state";

/**
 * The newest set's count, and `0` when the memory is empty.
 *
 * This is `wasteVisibleCount` as specs/instrumentation.md reports it: a
 * consequence of the set memory, built at the call rather than stored.
 */
export function wasteVisibleCount(state: CascadeState): number {
  return state.wasteSets[state.wasteSets.length - 1] ?? 0;
}

/**
 * How many cards of the newest set are actually on the waste.
 *
 * The same as {@link wasteVisibleCount} on any settled board. It differs only
 * while a card lifted off the waste is in hand: the set keeps its count for as
 * long as the card is held (specs/stock.md), so the count outruns the cards for
 * the length of that gesture, and what is DRAWN has to be what is there.
 */
export function wasteShownCount(state: CascadeState): number {
  const sets = state.wasteSets;
  if (sets.length === 0) return 0;
  let beneath = 0;
  for (let i = 0; i < sets.length - 1; i += 1) beneath += sets[i];
  const available = state.waste.length - beneath;
  const newest = sets[sets.length - 1];
  return Math.max(0, Math.min(newest, available, WASTE_FAN_MAX));
}

/** The cards of the shown set, oldest first, the last of them being the top. */
export function wasteShownCards(state: CascadeState): Card[] {
  const shown = wasteShownCount(state);
  return shown === 0 ? [] : state.waste.slice(state.waste.length - shown);
}

/**
 * The waste's top card, which is the only card on it that may be played, or
 * `null` when the waste shows none.
 */
export function wasteTop(state: CascadeState): Card | null {
  if (state.wasteSets.length === 0) return null;
  return state.waste[state.waste.length - 1] ?? null;
}

/** Append one set of `count` cards to the newest end of the memory. */
export function addWasteSet(state: CascadeState, count: number): void {
  state.wasteSets.push(count);
}

/** Empty the memory, leaving the cards on the waste standing. */
export function clearWasteSets(state: CascadeState): void {
  state.wasteSets.length = 0;
}

/**
 * Account for one card leaving the waste for good.
 *
 * It comes off the newest set that holds any, and a set left holding nothing
 * leaves the memory. That is the rule play itself follows, so `removeCard` on a
 * waste card follows it too and the memory stays consistent after any sequence of
 * poses.
 */
export function takeFromNewestSet(state: CascadeState): void {
  const sets = state.wasteSets;
  while (sets.length > 0 && sets[sets.length - 1] <= 0) sets.pop();
  if (sets.length === 0) return;
  sets[sets.length - 1] -= 1;
  if (sets[sets.length - 1] <= 0) sets.pop();
}
