// Wireworm — the running score and the bonus life it earns.
//
// Every figure the game pays is in `specs/scoring.md` and named in
// `src/constants.ts`; this module is the one path a figure is paid along, so the
// bonus life cannot be missed by a caller that forgot it.
//
// `specs/scoring.md`: one extra life is granted each time the score crosses a
// multiple of `BONUS_LIFE_EVERY` through play, and a single award that carries
// the score across more than one multiple grants one life for each multiple
// crossed. Counting the multiples below the score before and after the award is
// exactly that rule, and it holds however large the award is.

import { BONUS_LIFE_EVERY } from "./constants";
import type { WirewormState } from "./game";

/**
 * Pay `amount` into the run's score, granting a life for every multiple of
 * `BONUS_LIFE_EVERY` the award carried the score across.
 */
export function addScore(state: WirewormState, amount: number): void {
  if (amount === 0) return;
  const before = state.score;
  state.score = before + amount;
  const crossed =
    Math.floor(state.score / BONUS_LIFE_EVERY) -
    Math.floor(before / BONUS_LIFE_EVERY);
  if (crossed > 0) state.lives += crossed;
}
