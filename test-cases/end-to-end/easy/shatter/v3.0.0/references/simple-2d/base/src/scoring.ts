// Shatter — the score and the extra ship (`specs/scoring.md`).
//
// One running score, paid once per destruction, whatever destroyed the body.
// Nothing lowers it, and nothing else pays: a rock the star recycles, a shot
// the core absorbs and a shot that reaches nothing all pay zero, which is why
// every payment in this build goes through `addScore` and there is no second
// place a score is written.
//
// The extra ship is a CROSSING rather than an equality, so a single award that
// carries the score past more than one multiple of `EXTRA_LIFE_STEP` grants one
// ship for each multiple crossed.

import { CUES, EXTRA_LIFE_STEP } from "./constants";
import { EXTRA_LIFE_NOTICE } from "./theme";
import type { Sim, TickEvents } from "./sim";

/** Pay the score, and grant a ship for every extra-life multiple it crosses. */
export function addScore(sim: Sim, points: number, ev: TickEvents): void {
  if (points <= 0) return;
  const before = Math.floor(sim.score / EXTRA_LIFE_STEP);
  sim.score += points;
  const after = Math.floor(sim.score / EXTRA_LIFE_STEP);

  const granted = after - before;
  if (granted <= 0) return;
  sim.lives += granted;
  sim.extraLifeNotice = EXTRA_LIFE_NOTICE;
  ev.cues.add(CUES.extraLife);
}
