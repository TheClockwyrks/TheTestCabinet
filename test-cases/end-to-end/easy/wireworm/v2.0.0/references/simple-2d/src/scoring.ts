// Wireworm — the score and the bonus life it earns (`specs/scoring.md`).
//
// Every figure the game pays goes through `addScore`, which is the one place the
// bonus life is granted: one extra life for each multiple of `BONUS_LIFE_EVERY`
// the score crosses through play, so a single award that carries the score past
// two multiples grants two. `setScore` on the debug surface deliberately does
// not come through here, because a pose is a precondition rather than a play.

import { BONUS_LIFE_EVERY } from "./constants";
import type { Sim } from "./sim";

/** Pay `amount` into the run's score, granting each bonus life it crosses. */
export function addScore(sim: Sim, amount: number): void {
  const before = sim.score;
  const after = before + amount;
  sim.score = after;
  if (amount <= 0) return;
  const crossed =
    Math.floor(after / BONUS_LIFE_EVERY) -
    Math.floor(before / BONUS_LIFE_EVERY);
  if (crossed > 0) sim.lives += crossed;
}
