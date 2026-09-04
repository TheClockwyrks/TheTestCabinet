// Meltdown — one frame of the simulation, in the order the specification fixes.
//
// The order is not an implementation detail. The heat pass has to run last,
// because it needs the frame's shot counts and because every flow it resolves
// is computed from the heats the frame opened with — which the combat pass
// above it therefore reads unchanged, so a shot is scaled by the heat the frame
// opened with and a measurement taken at a pinned heat cannot drift under the
// reading (specs/heat.md, specs/combat.md).
//
// Lives running out ends the run at once, on the frame it happens and whatever
// the phase, so a fatal leak on the final wave loses rather than clearing it
// (specs/waves.md).

import { noCues, type CueFlags } from "./audio";
import { resolveCombat } from "./combat";
import { resolveHeat } from "./heat";
import { advanceBuildTimer, loseRun, settleWave } from "./run";
import { advanceSpawner, moveSurge, tickSlows } from "./surge";
import type { MeltdownState } from "./game";

/**
 * Advance the floor by `dt` seconds of GAME time, which is the frame's elapsed
 * time already multiplied by the game speed. Returns the cues the frame raised.
 */
export function simulate(state: MeltdownState, dt: number): CueFlags {
  const cues = noCues();
  if (state.screen !== "playing") return cues;
  if (dt <= 0) return cues;

  advanceBuildTimer(state, dt);
  advanceSpawner(state, dt);

  const movement = moveSurge(state, dt);
  if (movement.leaked) cues.leak = true;
  if (movement.lost) {
    loseRun(state);
    cues.gameOver = true;
    return cues;
  }

  tickSlows(state, dt);

  const combat = resolveCombat(state, dt);
  if (combat.fired) cues.fire = true;
  if (combat.killed) cues.death = true;

  if (resolveHeat(state, dt, combat.shots).tripped) cues.trip = true;

  const settled = settleWave(state, movement.removed || combat.removed);
  if (settled.cleared) cues.waveClear = true;
  if (settled.won) cues.victory = true;

  return cues;
}
