// Floe — the score, and the lives it earns (`specs/scoring.md`,
// `specs/progression.md`).
//
// Every award in the game runs through `addScore`, because a bonus life is a
// consequence of the score MOVING rather than of the score's value: `lives` rises
// once for each `BONUS_LIFE_EVERY` boundary the award carries the score across, so a
// single award crossing two boundaries earns two lives.
//
// A posed score is not an award. `setScore` writes the field directly and grants
// nothing, because a pose is a precondition and the award belongs to the path play
// takes (`specs/instrumentation.md`).

import { BONUS_LIFE_EVERY, CUES } from "./constants";
import type { TickEvents } from "./sim";
import type { Sim } from "./sim";

/** How many bonus-life boundaries lie between two scores. */
export function boundariesCrossed(from: number, to: number): number {
  const before = Math.floor(from / BONUS_LIFE_EVERY);
  const after = Math.floor(to / BONUS_LIFE_EVERY);
  return Math.max(0, after - before);
}

/** Pay `amount` into the score, and the lives the crossing earns with it. */
export function addScore(sim: Sim, amount: number, events: TickEvents): void {
  if (amount === 0) return;
  const before = sim.score;
  sim.score = before + amount;
  const earned = boundariesCrossed(before, sim.score);
  if (earned > 0) {
    sim.lives += earned;
    events.cues.add(CUES.bonusLife);
  }
}
