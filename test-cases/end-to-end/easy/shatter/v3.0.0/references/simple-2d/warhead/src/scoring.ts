// Shatter — the score and the extra ship (`specs/scoring.md`).
//
// One rule, in one place, because every scoring event in the game goes through
// it: a figure is paid on a destruction and NOTHING ELSE pays, the score only
// ever rises, and one extra ship is granted for EVERY multiple of
// EXTRA_LIFE_STEP the payment carries the score across — so a single kill that
// vaults two multiples grants two ships.
//
// `setScore` on the debug surface deliberately does not come through here: a
// pose is a precondition, and the award belongs to the scoring path
// (`specs/instrumentation.md`).

import { CUES, EXTRA_LIFE_STEP } from "./constants";
import { EXTRA_LIFE_FLASH_TIME } from "./tuning";
import type { FrameEvents, Sim } from "./sim";

/** Pay `points` for a destruction, granting whatever extra ships that crosses. */
export function award(sim: Sim, points: number, events: FrameEvents): void {
  if (points <= 0) return;

  const before = sim.score;
  sim.score = before + points;

  const crossed =
    Math.floor(sim.score / EXTRA_LIFE_STEP) -
    Math.floor(before / EXTRA_LIFE_STEP);
  if (crossed > 0) {
    sim.lives += crossed;
    sim.extraLifeFlash = EXTRA_LIFE_FLASH_TIME;
    events.cues.add(CUES.extraLife);
  }
}
